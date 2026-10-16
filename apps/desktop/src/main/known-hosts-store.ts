import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, renameSync } from 'node:fs'
import { KnownHostEntry } from '@alma/protocol'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { AlmaDb } from './db/open-database'
import { knownHosts } from './db/schema'

const LegacyFile = z.object({ version: z.literal(1), entries: z.array(KnownHostEntry) })

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error))

// Host keys trusted from inside the app. Takes precedence over ~/.ssh/known_hosts,
// which the app only reads.
export class KnownHostsStore {
  constructor(
    private readonly db: AlmaDb,
    private readonly warn: (message: string) => void = () => {},
  ) {}

  async list(host: string, port: number): Promise<KnownHostEntry[]> {
    const rows = await this.db
      .select()
      .from(knownHosts)
      .where(and(eq(knownHosts.host, host), eq(knownHosts.port, port)))
    return rows.map((r) => ({
      host: r.host,
      port: r.port,
      keyType: r.keyType,
      fingerprint: r.fingerprintSha256,
      publicKey: r.publicKey,
    }))
  }

  async trust(entry: KnownHostEntry): Promise<void> {
    try {
      await this.insert(KnownHostEntry.parse(entry))
    } catch (error) {
      // Never crash main over a database error; the key is simply not kept.
      this.warn(`no se pudo guardar la clave de host (${reason(error)})`)
    }
  }

  /** Moves the milestone 2 `known_hosts.json` into the database, once. */
  async importLegacyJson(file: string): Promise<number> {
    if (!existsSync(file)) return 0
    let entries: KnownHostEntry[]
    try {
      entries = LegacyFile.parse(JSON.parse(readFileSync(file, 'utf8'))).entries
    } catch (error) {
      this.warn(`claves de host antiguas ignoradas: ${file} no es válido (${reason(error)})`)
      return 0
    }
    for (const entry of entries) await this.insert(entry)
    renameSync(file, `${file}.migrated`)
    return entries.length
  }

  private async insert(entry: KnownHostEntry): Promise<void> {
    const values = {
      fingerprintSha256: entry.fingerprint,
      publicKey: entry.publicKey,
      addedAt: Date.now(),
    }
    await this.db
      .insert(knownHosts)
      .values({
        id: randomUUID(),
        host: entry.host,
        port: entry.port,
        keyType: entry.keyType,
        ...values,
      })
      .onConflictDoUpdate({
        target: [knownHosts.host, knownHosts.port, knownHosts.keyType],
        set: values,
      })
  }
}
