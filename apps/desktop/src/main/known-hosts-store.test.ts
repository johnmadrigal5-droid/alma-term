import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { KnownHostEntry } from '@alma/protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDatabase, type AlmaDb } from './db/open-database'
import { KnownHostsStore } from './known-hosts-store'

const migrations = join(import.meta.dirname, '../../drizzle')

const entry = (over: Partial<KnownHostEntry> = {}): KnownHostEntry => ({
  host: 'srv.example',
  port: 22,
  keyType: 'ssh-ed25519',
  fingerprint: 'SHA256:aaa',
  publicKey: 'AAAA',
  ...over,
})

let dir: string
let db: AlmaDb
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'alma-kh-'))
  db = await openDatabase(':memory:', migrations)
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('KnownHostsStore', () => {
  it('is empty in a new database', async () => {
    expect(await new KnownHostsStore(db).list('srv.example', 22)).toEqual([])
  })

  it('keeps one entry per host, port and key type with the newest key', async () => {
    const store = new KnownHostsStore(db)
    await store.trust(entry())
    await store.trust(entry({ fingerprint: 'SHA256:bbb', publicKey: 'BBBB' }))
    expect(await store.list('srv.example', 22)).toEqual([
      entry({ fingerprint: 'SHA256:bbb', publicKey: 'BBBB' }),
    ])
  })

  it('filters by port', async () => {
    const store = new KnownHostsStore(db)
    await store.trust(entry({ port: 2222 }))
    expect(await store.list('srv.example', 22)).toEqual([])
    expect(await store.list('srv.example', 2222)).toHaveLength(1)
  })

  it('imports the milestone 2 JSON file once and renames it', async () => {
    const file = join(dir, 'known_hosts.json')
    writeFileSync(
      file,
      JSON.stringify({ version: 1, entries: [entry(), entry({ host: 'other', port: 2222 })] }),
    )
    const store = new KnownHostsStore(db)
    expect(await store.importLegacyJson(file)).toBe(2)
    expect(existsSync(file)).toBe(false)
    expect(existsSync(`${file}.migrated`)).toBe(true)
    expect(await store.list('other', 2222)).toHaveLength(1)
  })

  it('leaves an invalid legacy file in place and warns', async () => {
    const file = join(dir, 'known_hosts.json')
    writeFileSync(file, '{ nope')
    const warn = vi.fn()
    expect(await new KnownHostsStore(db, warn).importLegacyJson(file)).toBe(0)
    expect(existsSync(file)).toBe(true)
    expect(warn).toHaveBeenCalledOnce()
  })

  it('returns 0 when there is no legacy file', async () => {
    expect(await new KnownHostsStore(db).importLegacyJson(join(dir, 'missing.json'))).toBe(0)
  })

  it('warns instead of throwing when the key cannot be saved', async () => {
    const warn = vi.fn()
    const store = new KnownHostsStore(db, warn)
    db.close()
    await expect(store.trust(entry())).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledOnce()
    db = await openDatabase(':memory:', migrations)
  })
})
