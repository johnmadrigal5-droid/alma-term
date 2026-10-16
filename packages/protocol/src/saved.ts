import { z } from 'zod'
import { SshTarget } from './ssh'

export const SavedAuth = z.enum(['password', 'key', 'agent'])
export type SavedAuth = z.infer<typeof SavedAuth>

export const SecretKind = z.enum(['password', 'passphrase'])
export type SecretKind = z.infer<typeof SecretKind>

const Name = z.string().trim().min(1).max(80)

export const Folder = z.object({
  id: z.uuid(),
  name: Name,
  parentId: z.uuid().nullable(),
  sort: z.number().int(),
})
export type Folder = z.infer<typeof Folder>

export const SavedSession = z.object({
  id: z.uuid(),
  folderId: z.uuid().nullable(),
  name: Name,
  ...SshTarget.shape,
  auth: SavedAuth,
  keyPath: z.string().min(1).nullable(),
  hasPassword: z.boolean(),
  hasPassphrase: z.boolean(),
})
export type SavedSession = z.infer<typeof SavedSession>

export const SaveSessionInput = z
  .object({
    id: z.uuid().optional(),
    folderId: z.uuid().nullable(),
    name: Name,
    ...SshTarget.shape,
    auth: SavedAuth,
    keyPath: z.string().min(1).nullable(),
    // Absent: keep the stored secret. value null: forget it.
    secret: z.object({ kind: SecretKind, value: z.string().min(1).nullable() }).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.auth === 'key' && v.keyPath === null)
      ctx.addIssue({ code: 'custom', path: ['keyPath'], message: 'Falta el archivo de clave' })
    if (v.auth !== 'key' && v.keyPath !== null)
      ctx.addIssue({
        code: 'custom',
        path: ['keyPath'],
        message: 'Solo el método clave usa archivo',
      })
  })
export type SaveSessionInput = z.infer<typeof SaveSessionInput>

export const SessionTree = z.object({
  folders: z.array(Folder),
  sessions: z.array(SavedSession),
  canRemember: z.boolean(),
})
export type SessionTree = z.infer<typeof SessionTree>
