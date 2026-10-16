import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import type { AsyncRemoteCallback } from 'drizzle-orm/sqlite-proxy'

// Drizzle's sqlite-proxy driver speaks (sql, params, method) and expects rows as arrays;
// this adapter maps it onto Node's built-in synchronous SQLite.
export function createProxyCallback(db: DatabaseSync): AsyncRemoteCallback {
  return async (sql, params, method) => {
    const statement = db.prepare(sql)
    const args = params as SQLInputValue[]
    if (method === 'run') {
      statement.run(...args)
      return { rows: [] }
    }
    statement.setReturnArrays(true)
    if (method === 'get') {
      const row = statement.get(...args)
      return { rows: row === undefined ? undefined : (row as unknown as unknown[]) } as {
        rows: unknown[]
      }
    }
    return { rows: statement.all(...args) as unknown as unknown[][] }
  }
}
