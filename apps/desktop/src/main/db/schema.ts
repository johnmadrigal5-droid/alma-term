import {
  type AnySQLiteColumn,
  blob,
  integer,
  sqliteTable,
  text,
  unique,
} from 'drizzle-orm/sqlite-core'

export const folders = sqliteTable('folders', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  parentId: text('parent_id').references((): AnySQLiteColumn => folders.id, {
    onDelete: 'cascade',
  }),
  sort: integer('sort').notNull().default(0),
})

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  folderId: text('folder_id').references(() => folders.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  host: text('host').notNull(),
  port: integer('port').notNull(),
  username: text('username').notNull(),
  auth: text('auth', { enum: ['password', 'key', 'agent'] }).notNull(),
  keyPath: text('key_path'),
  // JSON validated with Zod at the repository boundary.
  options: text('options').notNull().default('{}'),
})

export const credentials = sqliteTable(
  'credentials',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['password', 'passphrase'] }).notNull(),
    secretEnc: blob('secret_enc', { mode: 'buffer' }).notNull(),
  },
  (t) => [unique().on(t.sessionId, t.kind)],
)

export const knownHosts = sqliteTable(
  'known_hosts',
  {
    id: text('id').primaryKey(),
    host: text('host').notNull(),
    port: integer('port').notNull(),
    keyType: text('key_type').notNull(),
    fingerprintSha256: text('fingerprint_sha256').notNull(),
    publicKey: text('public_key').notNull(),
    addedAt: integer('added_at').notNull(),
  },
  (t) => [unique().on(t.host, t.port, t.keyType)],
)

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  // JSON validated with Zod by each reader.
  value: text('value').notNull(),
})

export const tunnels = sqliteTable('tunnels', {
  id: text('id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  type: text('type', { enum: ['L', 'R', 'D'] }).notNull(),
  bindHost: text('bind_host').notNull(),
  bindPort: integer('bind_port').notNull(),
  targetHost: text('target_host'),
  targetPort: integer('target_port'),
  autoStart: integer('auto_start', { mode: 'boolean' }).notNull().default(false),
  // JSON validated with Zod at the repository boundary: keeps `exposeExternally`, the explicit
  // consent a non-loopback bind needs, which the spec's columns have no room for.
  options: text('options').notNull().default('{}'),
})
