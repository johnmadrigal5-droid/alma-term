import { join } from 'node:path'
import type { ControlRequest, ImportPreview, SaveSessionInput } from '@alma/protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from './db/open-database'
import { KnownHostsStore } from './known-hosts-store'
import { createSavedHandlers, type SavedHandlerDeps } from './saved-handlers'
import type { SecretStore } from './secrets'
import { SessionRegistry } from './session-registry'
import { SessionsRepo } from './sessions-repo'

const migrations = join(import.meta.dirname, '../../drizzle')
const SID = '0b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c7d'
const MISSING = '7d3c7c86-5f43-4a43-9a43-2b0a0c0f2e11'

const secrets: SecretStore = {
  isSecure: () => true,
  encrypt: async (plain) => Buffer.from(plain).reverse(),
  decrypt: async (cipher) => Buffer.from(cipher).reverse().toString(),
}

const base: SaveSessionInput = {
  folderId: null,
  name: 'prod',
  host: 'example.com',
  port: 22,
  username: 'alma',
  auth: 'password',
  keyPath: null,
}

interface FakePort {
  closed: boolean
  close(): void
}

function setup(preview: ImportPreview = { file: '~/.ssh/config', candidates: [], warnings: [] }) {
  return async () => {
    const db = await openDatabase(':memory:', migrations)
    const repo = new SessionsRepo(db, secrets)
    const registry = new SessionRegistry()
    const requests: ControlRequest[] = []
    const posted: string[] = []
    const request = vi.fn(async (message: ControlRequest) => {
      requests.push(message)
      return null
    })
    const deps: SavedHandlerDeps<FakePort> = {
      repo,
      secrets,
      registry,
      knownHosts: new KnownHostsStore(db),
      request,
      newChannel: () => {
        const make = (): FakePort => ({
          closed: false,
          close() {
            this.closed = true
          },
        })
        return { port1: make(), port2: make() }
      },
      postPort: (sessionId) => posted.push(sessionId),
      previewImport: () => preview,
      saveExportFile: async () => '/tmp/alma-sesiones.json',
    }
    return { db, repo, registry, requests, posted, request, handlers: createSavedHandlers(deps) }
  }
}

describe('saved session handlers', () => {
  let ctx: Awaited<ReturnType<ReturnType<typeof setup>>>
  beforeEach(async () => {
    ctx = await setup()()
  })
  afterEach(() => ctx.db.close())

  it('opens a saved session with the decrypted password and returns no secret', async () => {
    const saved = await ctx.repo.save({ ...base, secret: { kind: 'password', value: 'pw-123' } })
    const result = await ctx.handlers.openSaved({
      sessionId: SID,
      savedId: saved.id,
      cols: 80,
      rows: 24,
    })
    expect(ctx.requests[0]).toMatchObject({
      type: 'ssh.open',
      sessionId: SID,
      auth: { type: 'password', password: 'pw-123' },
      rememberable: true,
    })
    expect(result).toEqual({
      ok: true,
      data: { sessionId: SID, kind: 'ssh', title: 'prod', savedId: saved.id },
    })
    expect(JSON.stringify(result)).not.toContain('pw-123')
    expect(ctx.posted).toEqual([SID])
  })

  it('fails with NOT_FOUND for an unknown saved session', async () => {
    const result = await ctx.handlers.openSaved({
      sessionId: SID,
      savedId: MISSING,
      cols: 80,
      rows: 24,
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
  })

  it('stores a remembered credential for a session opened from a bookmark', async () => {
    const saved = await ctx.repo.save(base)
    await ctx.handlers.openSaved({ sessionId: SID, savedId: saved.id, cols: 80, rows: 24 })
    await ctx.handlers.onCredential({
      type: 'event.credential',
      sessionId: SID,
      kind: 'password',
      secret: 'nuevo',
    })
    expect((await ctx.repo.connectConfig(saved.id)).auth).toEqual({
      type: 'password',
      password: 'nuevo',
    })
  })

  it('stores a credential that arrives while the bookmark is still connecting', async () => {
    const saved = await ctx.repo.save(base)
    ctx.request.mockImplementationOnce(async () => {
      await ctx.handlers.onCredential({
        type: 'event.credential',
        sessionId: SID,
        kind: 'password',
        secret: 'temprano',
      })
      return null
    })
    await ctx.handlers.openSaved({ sessionId: SID, savedId: saved.id, cols: 80, rows: 24 })
    expect((await ctx.repo.connectConfig(saved.id)).auth).toEqual({
      type: 'password',
      password: 'temprano',
    })
  })

  it('ignores a credential for a session without bookmark', async () => {
    const saved = await ctx.repo.save(base)
    ctx.registry.add({ sessionId: SID, kind: 'ssh', title: 'x', savedId: null })
    await ctx.handlers.onCredential({
      type: 'event.credential',
      sessionId: SID,
      kind: 'password',
      secret: 'nuevo',
    })
    expect((await ctx.repo.tree()).sessions.find((s) => s.id === saved.id)?.hasPassword).toBe(false)
  })

  it('closes connecting sessions left by a reloaded renderer before reattaching', async () => {
    ctx.registry.addPending(SID, null)
    await ctx.handlers.reattachAll()
    expect(ctx.requests).toContainEqual(
      expect.objectContaining({ type: 'session.close', sessionId: SID }),
    )
  })

  it('exports the tree to the chosen file', async () => {
    await ctx.repo.save(base)
    expect(await ctx.handlers.exportJson()).toEqual({
      ok: true,
      data: { file: '/tmp/alma-sesiones.json' },
    })
  })
})

describe('saved session import', () => {
  const preview: ImportPreview = {
    file: '~/.ssh/config',
    warnings: [],
    candidates: [
      {
        alias: 'web',
        target: { host: 'web', port: 22, username: 'u' },
        keyPath: null,
        warnings: [],
        duplicate: false,
      },
      {
        alias: 'db',
        target: { host: 'db', port: 22, username: 'u' },
        keyPath: '/k',
        warnings: [],
        duplicate: false,
      },
    ],
  }
  let ctx: Awaited<ReturnType<ReturnType<typeof setup>>>
  beforeEach(async () => {
    ctx = await setup(preview)()
  })
  afterEach(() => ctx.db.close())

  it('creates the import folder once across two imports and skips duplicates', async () => {
    expect(await ctx.handlers.applyImport({ aliases: ['web'] })).toEqual({
      ok: true,
      data: { created: 1 },
    })
    expect(await ctx.handlers.applyImport({ aliases: ['web', 'db'] })).toEqual({
      ok: true,
      data: { created: 1 },
    })
    const tree = await ctx.repo.tree()
    expect(tree.folders.map((f) => f.name)).toEqual(['Importadas de ~/.ssh/config'])
    expect(tree.sessions.map((s) => [s.name, s.auth]).sort()).toEqual([
      ['db', 'key'],
      ['web', 'password'],
    ])
  })

  it('trims long aliases to 80 characters and skips invalid hosts with a warning', async () => {
    const long = 'x'.repeat(120)
    const candidate = {
      alias: '',
      target: { host: 'h', port: 22, username: 'u' },
      keyPath: null,
      warnings: [],
      duplicate: false,
    }
    ctx = await setup({
      file: '~/.ssh/config',
      warnings: [],
      candidates: [
        { ...candidate, alias: long, target: { host: 'h', port: 22, username: 'u' } },
        {
          ...candidate,
          alias: 'vacio',
          target: { host: '', port: 22, username: 'u' },
        },
      ],
    })()
    const shown = await ctx.handlers.previewImport()
    expect(shown.ok && shown.data.candidates.map((c) => c.alias)).toEqual([long])
    expect(shown.ok && shown.data.warnings.join(' ')).toContain('vacio')
    expect(await ctx.handlers.applyImport({ aliases: [long, 'vacio'] })).toEqual({
      ok: true,
      data: { created: 1 },
    })
    expect((await ctx.repo.tree()).sessions.map((s) => s.name)).toEqual(['x'.repeat(80)])
  })
})
