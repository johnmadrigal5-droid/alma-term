import { z } from 'zod'
import { ProtocolError } from './errors'
import { RequestId, SessionId } from './ids'
import { SIZE_LIMITS } from './limits'
import {
  SftpChmod,
  SftpHome,
  SftpList,
  SftpMkdir,
  SftpRename,
  SftpRm,
  SftpStat,
  TransferCancel,
  TransferPause,
  TransferResume,
  TransferStart,
} from './sftp'
import { TunnelClose, TunnelOpen } from './tunnel'
import { KnownHostEntry, PromptAnswer, SshAuth, SshTarget } from './ssh'

const Cols = z.number().int().min(SIZE_LIMITS.minCols).max(SIZE_LIMITS.maxCols)
const Rows = z.number().int().min(SIZE_LIMITS.minRows).max(SIZE_LIMITS.maxRows)

/** Where and under which name the host writes the text log of a session. */
export const SessionLog = z.object({
  dir: z.string().min(1).max(4096),
  name: z.string().min(1).max(255),
})
export type SessionLog = z.infer<typeof SessionLog>

export const LocalOpen = z.object({
  type: z.literal('local.open'),
  requestId: RequestId,
  sessionId: SessionId,
  cols: Cols,
  rows: Rows,
  shell: z.string().min(1).optional(),
  cwd: z.string().min(1).optional(),
  log: SessionLog.optional(),
})

export const SessionResize = z.object({
  type: z.literal('session.resize'),
  requestId: RequestId,
  sessionId: SessionId,
  cols: Cols,
  rows: Rows,
})

export const SessionClose = z.object({
  type: z.literal('session.close'),
  requestId: RequestId,
  sessionId: SessionId,
})

export const SessionReattach = z.object({
  type: z.literal('session.reattach'),
  requestId: RequestId,
  sessionId: SessionId,
})

export const SshOpen = z.object({
  type: z.literal('ssh.open'),
  requestId: RequestId,
  sessionId: SessionId,
  cols: Cols,
  rows: Rows,
  target: SshTarget,
  auth: SshAuth,
  trusted: z.array(KnownHostEntry),
  // True only for a saved session on a system with a secure secret store.
  rememberable: z.boolean().default(false),
  log: SessionLog.optional(),
})

export const PromptAnswerRequest = z.object({
  type: z.literal('prompt.answer'),
  requestId: RequestId,
  promptId: z.uuid(),
  answer: PromptAnswer,
})

export const ControlRequest = z.discriminatedUnion('type', [
  LocalOpen,
  SshOpen,
  PromptAnswerRequest,
  SessionResize,
  SessionClose,
  SessionReattach,
  SftpHome,
  SftpList,
  SftpStat,
  SftpMkdir,
  SftpRename,
  SftpRm,
  SftpChmod,
  TransferStart,
  TransferPause,
  TransferResume,
  TransferCancel,
  TunnelOpen,
  TunnelClose,
])
export type ControlRequest = z.infer<typeof ControlRequest>

export const ControlResponse = z.union([
  z.object({
    type: z.literal('response'),
    requestId: RequestId,
    ok: z.literal(true),
    data: z.unknown(),
  }),
  z.object({
    type: z.literal('response'),
    requestId: RequestId,
    ok: z.literal(false),
    error: ProtocolError,
  }),
])
export type ControlResponse = z.infer<typeof ControlResponse>
