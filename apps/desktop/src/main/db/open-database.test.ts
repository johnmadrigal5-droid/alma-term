import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AlmaDb } from './open-database'
import { credentials, folders, knownHosts, sessions, settings } from './schema'

const migrations = join(import.meta.dirname, '../../../drizzle')

function sessionRow(folderId: string | null) {
  return {
    id: randomUUID(),
    folderId,
    name: 'prod',
    host: 'example.com',
    port: 22,
    username: 'alma',
    auth: 'password' as const,
    keyPath: null,
  }
}

describe('openDatabase', () => {
  let db: AlmaDb

  beforeEach(async () => {
    db = await openDatabase(':memory:', migrations)
  })
  afterEach(() => db.close())

  it('creates the five tables', async () => {
    expect(await db.select().from(folders)).toEqual([])
    expect(await db.select().from(sessions)).toEqual([])
    expect(await db.select().from(credentials)).toEqual([])
    expect(await db.select().from(knownHosts)).toEqual([])
    expect(await db.select().from(settings)).toEqual([])
  })

  it('cascades folder deletes to subfolders and detaches their sessions', async () => {
    const parent = randomUUID()
    const child = randomUUID()
    await db.insert(folders).values({ id: parent, name: 'a', parentId: null, sort: 0 })
    await db.insert(folders).values({ id: child, name: 'b', parentId: parent, sort: 0 })
    const s = sessionRow(child)
    await db.insert(sessions).values(s)

    await db.delete(folders).where(eq(folders.id, parent))

    expect(await db.select().from(folders)).toEqual([])
    const [kept] = await db.select().from(sessions)
    expect(kept?.id).toBe(s.id)
    expect(kept?.folderId).toBeNull()
  })

  it('deletes credentials with their session', async () => {
    const s = sessionRow(null)
    await db.insert(sessions).values(s)
    await db.insert(credentials).values({
      id: randomUUID(),
      sessionId: s.id,
      kind: 'password',
      secretEnc: Buffer.from('x'),
    })
    await db.delete(sessions).where(eq(sessions.id, s.id))
    expect(await db.select().from(credentials)).toEqual([])
  })

  it('rejects two credentials of the same kind for one session', async () => {
    const s = sessionRow(null)
    await db.insert(sessions).values(s)
    const row = { sessionId: s.id, kind: 'password' as const, secretEnc: Buffer.from('x') }
    await db.insert(credentials).values({ id: randomUUID(), ...row })
    const error: unknown = await db
      .insert(credentials)
      .values({ id: randomUUID(), ...row })
      .catch((e: unknown) => e)
    // Drizzle wraps the driver error; the SQLite constraint message is its cause.
    expect(error instanceof Error && String(error.cause)).toMatch(/UNIQUE/)
  })

  it('returns undefined from get when there is no row', async () => {
    const row = await db.select().from(settings).where(eq(settings.key, 'missing')).get()
    expect(row).toBeUndefined()
  })

  it('round-trips blobs and JSON options', async () => {
    const s = sessionRow(null)
    await db.insert(sessions).values(s)
    const [read] = await db.select().from(sessions)
    expect(read?.options).toBe('{}')
    await db.insert(credentials).values({
      id: randomUUID(),
      sessionId: s.id,
      kind: 'password',
      secretEnc: Buffer.from([1, 2, 3]),
    })
    const [cred] = await db.select().from(credentials)
    expect(cred && Buffer.from(cred.secretEnc)).toEqual(Buffer.from([1, 2, 3]))
  })
})

describe('openDatabase on disk', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'alma-db-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('does not reapply migrations when reopened', async () => {
    const file = join(dir, 'alma.db')
    const first = await openDatabase(file, migrations)
    await first.insert(settings).values({ key: 'k', value: '1' })
    first.close()
    const second = await openDatabase(file, migrations)
    expect(await second.select().from(settings)).toEqual([{ key: 'k', value: '1' }])
    second.close()
  })
})
