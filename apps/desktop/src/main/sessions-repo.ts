import { randomUUID } from 'node:crypto'
import type {
  Folder,
  SavedAuth,
  SavedSession,
  SaveSessionInput,
  SecretKind,
  SessionTree,
  SshAuth,
  SshTarget,
} from '@alma/protocol'
import { and, eq } from 'drizzle-orm'
import { AppError } from './app-error'
import type { AlmaDb } from './db/open-database'
import { credentials, folders, sessions } from './db/schema'
import type { SecretStore } from './secrets'

export interface ConnectConfig {
  name: string
  target: SshTarget
  auth: SshAuth
}

type SessionRow = typeof sessions.$inferSelect

const SecretKindValues: readonly SecretKind[] = ['password', 'passphrase']
/** The only secret each auth method can use; the others are dropped on save. */
const APPLICABLE: Record<SavedAuth, SecretKind | null> = {
  password: 'password',
  key: 'passphrase',
  agent: null,
}

export class SessionsRepo {
  constructor(
    private readonly db: AlmaDb,
    private readonly secrets: SecretStore,
  ) {}

  async tree(): Promise<SessionTree> {
    const folderRows = await this.db.select().from(folders)
    const sessionRows = await this.db.select().from(sessions)
    const kinds = await this.db
      .select({ sessionId: credentials.sessionId, kind: credentials.kind })
      .from(credentials)
    const has = (id: string, kind: SecretKind) =>
      kinds.some((k) => k.sessionId === id && k.kind === kind)
    return {
      folders: folderRows.map((f) => ({
        id: f.id,
        name: f.name,
        parentId: f.parentId,
        sort: f.sort,
      })),
      sessions: sessionRows.map((s) => toSaved(s, has(s.id, 'password'), has(s.id, 'passphrase'))),
      canRemember: this.secrets.isSecure(),
    }
  }

  async save(input: SaveSessionInput): Promise<SavedSession> {
    // Check before writing anything so a refused secret leaves no half-saved session.
    if (input.secret?.value && !this.secrets.isSecure())
      throw new AppError(
        'CREDENTIALS_UNAVAILABLE',
        'Tu sistema no tiene un llavero disponible; la contraseña no se puede guardar de forma segura.',
      )
    // Encrypt first: a failing keyring must leave the previous credential in place.
    const cipher = input.secret?.value ? await this.secrets.encrypt(input.secret.value) : null
    const id = input.id ?? randomUUID()
    const row = {
      folderId: input.folderId,
      name: input.name,
      host: input.host,
      port: input.port,
      username: input.username,
      auth: input.auth,
      keyPath: input.keyPath,
    }
    if (input.id) {
      const existing = await this.db.select().from(sessions).where(eq(sessions.id, id)).get()
      if (!existing) throw new AppError('NOT_FOUND', 'La sesión ya no existe')
      await this.db.update(sessions).set(row).where(eq(sessions.id, id))
    } else {
      await this.db.insert(sessions).values({ id, ...row })
    }
    for (const kind of SecretKindValues)
      if (kind !== APPLICABLE[input.auth]) await this.deleteCredential(id, kind)
    if (input.secret) await this.writeCredential(id, input.secret.kind, cipher)
    const saved = (await this.tree()).sessions.find((s) => s.id === id)
    if (!saved) throw new AppError('NOT_FOUND', 'La sesión ya no existe')
    return saved
  }

  async remove(id: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.id, id))
  }

  async createFolder(name: string, parentId: string | null): Promise<Folder> {
    const folder: Folder = { id: randomUUID(), name, parentId, sort: 0 }
    await this.db.insert(folders).values(folder)
    return folder
  }

  async renameFolder(id: string, name: string): Promise<void> {
    await this.db.update(folders).set({ name }).where(eq(folders.id, id))
  }

  async removeFolder(id: string): Promise<void> {
    await this.db.delete(folders).where(eq(folders.id, id))
  }

  /** Main-only: the decrypted secrets never leave the main process except towards the host. */
  async connectConfig(id: string): Promise<ConnectConfig> {
    const row = await this.db.select().from(sessions).where(eq(sessions.id, id)).get()
    if (!row) throw new AppError('NOT_FOUND', 'La sesión ya no existe')
    const target = { host: row.host, port: row.port, username: row.username }
    const secret = async (kind: SecretKind) => {
      const cred = await this.db
        .select()
        .from(credentials)
        .where(and(eq(credentials.sessionId, id), eq(credentials.kind, kind)))
        .get()
      if (!cred) return undefined
      try {
        return await this.secrets.decrypt(Buffer.from(cred.secretEnc))
      } catch {
        // Keyring locked or changed: connect without it and let the server ask.
        return undefined
      }
    }
    switch (row.auth) {
      case 'password': {
        const password = await secret('password')
        return {
          name: row.name,
          target,
          auth: { type: 'password', ...(password ? { password } : {}) },
        }
      }
      case 'key': {
        if (!row.keyPath) throw new AppError('NOT_FOUND', 'La sesión no tiene archivo de clave')
        const passphrase = await secret('passphrase')
        return {
          name: row.name,
          target,
          auth: { type: 'key', privateKeyPath: row.keyPath, ...(passphrase ? { passphrase } : {}) },
        }
      }
      case 'agent':
        return { name: row.name, target, auth: { type: 'agent' } }
    }
  }

  /** Stores or forgets one secret of an existing session (used by "Recordar"). */
  async setSecret(id: string, kind: SecretKind, value: string | null): Promise<void> {
    if (value && !this.secrets.isSecure())
      throw new AppError('CREDENTIALS_UNAVAILABLE', 'No hay un llavero seguro disponible')
    const row = await this.db.select().from(sessions).where(eq(sessions.id, id)).get()
    if (!row) throw new AppError('NOT_FOUND', 'La sesión ya no existe')
    await this.writeCredential(id, kind, value === null ? null : await this.secrets.encrypt(value))
  }

  private async deleteCredential(sessionId: string, kind: SecretKind) {
    await this.db
      .delete(credentials)
      .where(and(eq(credentials.sessionId, sessionId), eq(credentials.kind, kind)))
  }

  private async writeCredential(sessionId: string, kind: SecretKind, cipher: Buffer | null) {
    await this.deleteCredential(sessionId, kind)
    if (cipher === null) return
    await this.db
      .insert(credentials)
      .values({ id: randomUUID(), sessionId, kind, secretEnc: cipher })
  }
}

function toSaved(row: SessionRow, hasPassword: boolean, hasPassphrase: boolean): SavedSession {
  return {
    id: row.id,
    folderId: row.folderId,
    name: row.name,
    host: row.host,
    port: row.port,
    username: row.username,
    auth: row.auth,
    keyPath: row.keyPath,
    hasPassword,
    hasPassphrase,
  }
}
