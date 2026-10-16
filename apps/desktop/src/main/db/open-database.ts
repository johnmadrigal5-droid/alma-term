import { DatabaseSync } from 'node:sqlite'
import { drizzle, type SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy'
import { migrate } from 'drizzle-orm/sqlite-proxy/migrator'
import { createProxyCallback } from './driver'
import * as schema from './schema'

export type AlmaDb = SqliteRemoteDatabase<typeof schema> & { close(): void }

export async function openDatabase(file: string, migrationsFolder: string): Promise<AlmaDb> {
  const sqlite = new DatabaseSync(file)
  // The only hand-written statement: SQLite leaves foreign keys off per connection.
  sqlite.exec('PRAGMA foreign_keys = ON')
  const db = drizzle(createProxyCallback(sqlite), { schema })
  await migrate(
    db,
    async (queries) => {
      for (const query of queries) sqlite.exec(query)
    },
    { migrationsFolder },
  )
  return Object.assign(db, { close: () => sqlite.close() })
}
