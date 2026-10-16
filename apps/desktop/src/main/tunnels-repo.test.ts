import { join } from 'node:path'
import type { SaveSessionInput } from '@alma/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AlmaDb } from './db/open-database'
import { tunnels } from './db/schema'
import type { SecretStore } from './secrets'
import { SessionsRepo } from './sessions-repo'
import { TunnelsRepo } from './tunnels-repo'

const migrations = join(import.meta.dirname, '../../drizzle')
const secrets: SecretStore = {
  isSecure: () => true,
  encrypt: async (p) => Buffer.from(p),
  decrypt: async (c) => Buffer.from(c).toString(),
}
const session: SaveSessionInput = {
  folderId: null,
  name: 'prod',
  host: 'example.com',
  port: 22,
  username: 'alma',
  auth: 'agent',
  keyPath: null,
}
const spec = {
  type: 'L',
  bindHost: '127.0.0.1',
  bindPort: 8080,
  targetHost: 'db',
  targetPort: 5432,
  exposeExternally: false,
} as const

describe('TunnelsRepo', () => {
  let db: AlmaDb
  let sessionsRepo: SessionsRepo
  let repo: TunnelsRepo
  let savedId: string
  beforeEach(async () => {
    db = await openDatabase(':memory:', migrations)
    sessionsRepo = new SessionsRepo(db, secrets)
    repo = new TunnelsRepo(db)
    savedId = (await sessionsRepo.save(session)).id
  })
  afterEach(() => db.close())

  it('saves and lists the tunnels of a session in the order they were saved', async () => {
    const a = await repo.save({ savedId, spec, autoStart: true })
    const b = await repo.save({ savedId, spec: { ...spec, bindPort: 9090 }, autoStart: false })
    const list = await repo.list(savedId)
    expect(list.map((t) => t.id)).toEqual([a.id, b.id])
    expect(list[0]).toMatchObject({ autoStart: true, spec: { bindPort: 8080 } })
    expect(list[1]?.autoStart).toBe(false)
  })

  it('does not mix the tunnels of another session', async () => {
    const other = (await sessionsRepo.save({ ...session, name: 'otra' })).id
    await repo.save({ savedId, spec, autoStart: false })
    expect(await repo.list(other)).toEqual([])
  })

  it('removes one tunnel', async () => {
    const a = await repo.save({ savedId, spec, autoStart: false })
    await repo.remove(a.id)
    expect(await repo.list(savedId)).toEqual([])
  })

  it('deletes the tunnels with their session', async () => {
    await repo.save({ savedId, spec, autoStart: true })
    await sessionsRepo.remove(savedId)
    expect(await db.select().from(tunnels)).toEqual([])
  })

  it('keeps the explicit exposure of an external bind', async () => {
    const saved = await repo.save({
      savedId,
      spec: { ...spec, bindHost: '0.0.0.0', exposeExternally: true },
      autoStart: false,
    })
    expect(saved.spec).toMatchObject({ bindHost: '0.0.0.0', exposeExternally: true })
    expect((await repo.list(savedId))[0]?.spec.exposeExternally).toBe(true)
  })

  it('skips a row whose stored spec is no longer valid instead of failing the list', async () => {
    await repo.save({ savedId, spec, autoStart: false })
    await db.insert(tunnels).values({
      id: '0b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c99',
      sessionId: savedId,
      type: 'L',
      bindHost: '0.0.0.0',
      bindPort: 1,
      targetHost: 'x',
      targetPort: 1,
      autoStart: false,
      options: '{}',
    })
    expect(await repo.list(savedId)).toHaveLength(1)
  })
})
