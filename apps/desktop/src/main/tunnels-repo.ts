import { randomUUID } from 'node:crypto'
import { SavedTunnel, SavedTunnelInput, TunnelSpec } from '@alma/protocol'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { AlmaDb } from './db/open-database'
import { tunnels } from './db/schema'

const Options = z.object({ exposeExternally: z.boolean().default(false) })

/** Tunnels kept with saved sessions. Every row is validated again on the way out. */
export class TunnelsRepo {
  constructor(private readonly db: AlmaDb) {}

  async list(savedId: string): Promise<SavedTunnel[]> {
    // SQLite's own insertion counter keeps the order tunnels were saved in (a fixed fragment,
    // no input in it).
    const rows = await this.db
      .select()
      .from(tunnels)
      .where(eq(tunnels.sessionId, savedId))
      .orderBy(sql`rowid`)
    return rows.flatMap((row) => {
      const options = Options.safeParse(safeJson(row.options))
      const spec = TunnelSpec.safeParse({
        type: row.type,
        bindHost: row.bindHost,
        bindPort: row.bindPort,
        ...(row.targetHost !== null && row.targetPort !== null
          ? { targetHost: row.targetHost, targetPort: row.targetPort }
          : {}),
        exposeExternally: options.success ? options.data.exposeExternally : false,
      })
      // A row edited by hand into something the schema refuses is dropped, not trusted.
      return spec.success
        ? [{ id: row.id, savedId: row.sessionId, spec: spec.data, autoStart: row.autoStart }]
        : []
    })
  }

  async save(input: SavedTunnelInput): Promise<SavedTunnel> {
    const { savedId, spec, autoStart } = SavedTunnelInput.parse(input)
    const id = randomUUID()
    await this.db.insert(tunnels).values({
      id,
      sessionId: savedId,
      type: spec.type,
      bindHost: spec.bindHost,
      bindPort: spec.bindPort,
      targetHost: spec.targetHost ?? null,
      targetPort: spec.targetPort ?? null,
      autoStart,
      options: JSON.stringify({ exposeExternally: spec.exposeExternally }),
    })
    return { id, savedId, spec, autoStart }
  }

  async remove(id: string): Promise<void> {
    await this.db.delete(tunnels).where(eq(tunnels.id, id))
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}
