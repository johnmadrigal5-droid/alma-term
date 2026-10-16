import { z } from 'zod'
import { ProtocolError } from './errors'
import { RequestId, SessionId } from './ids'

export const RemoteKind = z.enum(['file', 'dir', 'link', 'other'])
export type RemoteKind = z.infer<typeof RemoteKind>

export const RemoteEntry = z.object({
  name: z.string(),
  kind: RemoteKind,
  size: z.number().int().nonnegative(),
  mtimeMs: z.number().int().nonnegative(),
  /** Permission bits only (0..0o7777). */
  mode: z.number().int().min(0).max(0o7777),
})
export type RemoteEntry = z.infer<typeof RemoteEntry>

export const FilePath = z
  .string()
  .min(1)
  .max(4096)
  .refine((p) => !p.includes('\0'), 'La ruta contiene un carácter nulo')
  // A name crafted by the server ("../../x") must never climb out of the chosen folder.
  .refine((p) => !p.split(/[\\/]/).includes('..'), 'La ruta no puede contener «..»')

export const TransferId = z.uuid()
export const TransferDirection = z.enum(['upload', 'download'])
export type TransferDirection = z.infer<typeof TransferDirection>
export const TransferState = z.enum(['queued', 'running', 'paused', 'done', 'error', 'cancelled'])
export type TransferState = z.infer<typeof TransferState>

// Renderer → main argument shapes; main adds type and requestId before the host sees them.
export const SftpSessionArgs = z.object({ sessionId: SessionId })
export type SftpSessionArgs = z.infer<typeof SftpSessionArgs>
export const SftpPathArgs = z.object({ sessionId: SessionId, path: FilePath })
export type SftpPathArgs = z.infer<typeof SftpPathArgs>
export const SftpRenameArgs = z.object({ sessionId: SessionId, from: FilePath, to: FilePath })
export type SftpRenameArgs = z.infer<typeof SftpRenameArgs>
export const SftpRemoveArgs = SftpPathArgs.extend({ kind: RemoteKind })
export type SftpRemoveArgs = z.infer<typeof SftpRemoveArgs>
export const SftpChmodArgs = SftpPathArgs.extend({ mode: z.number().int().min(0).max(0o7777) })
export type SftpChmodArgs = z.infer<typeof SftpChmodArgs>
export const TransferStartArgs = z.object({
  /** Optional from the renderer: main generates one when absent. */
  transferId: TransferId.optional(),
  sessionId: SessionId,
  direction: TransferDirection,
  localPath: FilePath,
  remotePath: FilePath,
  overwrite: z.boolean(),
})
export type TransferStartArgs = z.infer<typeof TransferStartArgs>
export const TransferIdArgs = z.object({ transferId: TransferId })
export type TransferIdArgs = z.infer<typeof TransferIdArgs>

export const LocalExistsArgs = z.object({ path: z.string().min(1).max(4096) })
export type LocalExistsArgs = z.infer<typeof LocalExistsArgs>

const request = <T extends string>(type: T) =>
  z.object({ type: z.literal(type), requestId: RequestId })

export const SftpHome = request('sftp.home').extend(SftpSessionArgs.shape)
export const SftpList = request('sftp.list').extend(SftpPathArgs.shape)
export const SftpStat = request('sftp.stat').extend(SftpPathArgs.shape)
export const SftpMkdir = request('sftp.mkdir').extend(SftpPathArgs.shape)
export const SftpRename = request('sftp.rename').extend(SftpRenameArgs.shape)
export const SftpRm = request('sftp.rm').extend(SftpRemoveArgs.shape)
export const SftpChmod = request('sftp.chmod').extend(SftpChmodArgs.shape)
export const TransferStart = request('transfer.start').extend({
  ...TransferStartArgs.shape,
  transferId: TransferId,
})
export const TransferPause = request('transfer.pause').extend(TransferIdArgs.shape)
export const TransferResume = request('transfer.resume').extend(TransferIdArgs.shape)
export const TransferCancel = request('transfer.cancel').extend(TransferIdArgs.shape)
export type TransferStart = z.infer<typeof TransferStart>

export const TransferEvent = z.object({
  type: z.literal('event.transfer'),
  transferId: TransferId,
  sessionId: SessionId,
  direction: TransferDirection,
  name: z.string(),
  state: TransferState,
  bytes: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  error: ProtocolError.optional(),
})
export type TransferEvent = z.infer<typeof TransferEvent>
