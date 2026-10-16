import { join } from 'node:path'
import type { SaveSessionInput } from '@alma/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppError } from './app-error'
import { openDatabase, type AlmaDb } from './db/open-database'
import type { SecretStore } from './secrets'
import { SessionsRepo } from './sessions-repo'

const migrations = join(import.meta.dirname, '../../drizzle')

function fakeSecrets(secure = true): SecretStore & { secure: boolean } {
  return {
    secure,
    isSecure() {
      return this.secure
    },
    encrypt: async (plain) => Buffer.from(plain).reverse(),
    decrypt: async (cipher) => Buffer.from(cipher).reverse().toString(),
  }
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

describe('SessionsRepo', () => {
  let db: AlmaDb
  let secrets: ReturnType<typeof fakeSecrets>
  let repo: SessionsRepo

  beforeEach(async () => {
    db = await openDatabase(':memory:', migrations)
    secrets = fakeSecrets()
    repo = new SessionsRepo(db, secrets)
  })
  afterEach(() => db.close())

  it('creates a session without id and updates it with one', async () => {
    const created = await repo.save(base)
    const updated = await repo.save({ ...base, id: created.id, name: 'staging' })
    const tree = await repo.tree()
    expect(tree.sessions).toHaveLength(1)
    expect(updated.name).toBe('staging')
    expect(tree.sessions[0]?.name).toBe('staging')
  })

  it('never exposes the secret in the tree', async () => {
    await repo.save({ ...base, secret: { kind: 'password', value: 'hunter2-secret' } })
    const tree = await repo.tree()
    const text = JSON.stringify(tree)
    expect(text).not.toContain('hunter2-secret')
    expect(text).not.toContain('2terces')
    expect(text).not.toContain('secretEnc')
    expect(tree.sessions[0]?.hasPassword).toBe(true)
    expect(tree.sessions[0]?.hasPassphrase).toBe(false)
    expect(tree.canRemember).toBe(true)
  })

  it('keeps the stored secret when secret is absent and forgets it with null', async () => {
    const s = await repo.save({ ...base, secret: { kind: 'password', value: 'pw' } })
    await repo.save({ ...base, id: s.id, name: 'renamed' })
    expect((await repo.tree()).sessions[0]?.hasPassword).toBe(true)
    await repo.save({ ...base, id: s.id, secret: { kind: 'password', value: null } })
    expect((await repo.tree()).sessions[0]?.hasPassword).toBe(false)
  })

  it('refuses to store a secret without a secure store and writes nothing', async () => {
    secrets.secure = false
    const error = await repo
      .save({ ...base, secret: { kind: 'password', value: 'pw' } })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe('CREDENTIALS_UNAVAILABLE')
    expect((await repo.tree()).sessions).toEqual([])
    expect((await repo.tree()).canRemember).toBe(false)
  })

  it('decrypts the password in connectConfig', async () => {
    const s = await repo.save({ ...base, secret: { kind: 'password', value: 'pw' } })
    expect(await repo.connectConfig(s.id)).toEqual({
      name: 'prod',
      target: { host: 'example.com', port: 22, username: 'alma' },
      auth: { type: 'password', password: 'pw' },
    })
  })

  it('builds key auth with the stored passphrase', async () => {
    const s = await repo.save({
      ...base,
      auth: 'key',
      keyPath: '~/.ssh/id_ed25519',
      secret: { kind: 'passphrase', value: 'frase' },
    })
    expect((await repo.connectConfig(s.id)).auth).toEqual({
      type: 'key',
      privateKeyPath: '~/.ssh/id_ed25519',
      passphrase: 'frase',
    })
  })

  it('builds password auth without a stored password', async () => {
    const s = await repo.save(base)
    expect((await repo.connectConfig(s.id)).auth).toEqual({ type: 'password' })
  })

  it('fails with NOT_FOUND for an unknown id', async () => {
    const error = await repo
      .connectConfig('7d3c7c86-5f43-4a43-9a43-2b0a0c0f2e11')
      .catch((e: unknown) => e)
    expect((error as AppError).code).toBe('NOT_FOUND')
  })

  it('removes a session', async () => {
    const s = await repo.save(base)
    await repo.remove(s.id)
    expect((await repo.tree()).sessions).toEqual([])
  })

  it('manages folders and moves sessions to the root when a folder is removed', async () => {
    const parent = await repo.createFolder('Clientes', null)
    const child = await repo.createFolder('ACME', parent.id)
    const s = await repo.save({ ...base, folderId: child.id })
    await repo.renameFolder(parent.id, 'Clientes 2026')
    expect((await repo.tree()).folders.map((f) => f.name).sort()).toEqual(['ACME', 'Clientes 2026'])
    await repo.removeFolder(parent.id)
    const tree = await repo.tree()
    expect(tree.folders).toEqual([])
    expect(tree.sessions.find((x) => x.id === s.id)?.folderId).toBeNull()
  })

  it('opens without the secret when it can no longer be decrypted', async () => {
    const s = await repo.save({ ...base, secret: { kind: 'password', value: 'pw' } })
    secrets.decrypt = async () => {
      throw new Error('Error while decrypting the ciphertext provided to safeStorage')
    }
    expect((await repo.connectConfig(s.id)).auth).toEqual({ type: 'password' })
  })

  it('keeps the previous password when encrypting the new one fails', async () => {
    const s = await repo.save({ ...base, secret: { kind: 'password', value: 'viejo' } })
    secrets.encrypt = async () => {
      throw new Error('keyring locked')
    }
    await expect(
      repo.save({ ...base, id: s.id, secret: { kind: 'password', value: 'nuevo' } }),
    ).rejects.toThrow()
    expect((await repo.connectConfig(s.id)).auth).toEqual({ type: 'password', password: 'viejo' })
  })

  it('forgets the password when the session switches to key auth', async () => {
    const s = await repo.save({ ...base, secret: { kind: 'password', value: 'pw' } })
    await repo.save({ ...base, id: s.id, auth: 'key', keyPath: '/k' })
    expect((await repo.tree()).sessions[0]).toMatchObject({ hasPassword: false })
  })

  it('forgets every secret when the session switches to the agent', async () => {
    const s = await repo.save({
      ...base,
      auth: 'key',
      keyPath: '/k',
      secret: { kind: 'passphrase', value: 'pp' },
    })
    await repo.save({ ...base, id: s.id, auth: 'agent' })
    expect((await repo.tree()).sessions[0]).toMatchObject({ hasPassphrase: false })
  })
})
