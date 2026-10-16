import { z } from 'zod'

export const ErrorCode = z.enum([
  'INVALID_MESSAGE',
  'SESSION_NOT_FOUND',
  'SPAWN_FAILED',
  'TIMEOUT',
  'HOST_UNAVAILABLE',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ETIMEDOUT',
  'AUTH_FAILED',
  'HOSTKEY_REJECTED',
  'PROMPT_CANCELLED',
  'CREDENTIALS_UNAVAILABLE',
  'NOT_FOUND',
  'SFTP_UNAVAILABLE',
  'EACCES',
  'ENOSPC',
  'ENOENT',
  'EEXIST',
  'ENOTEMPTY',
  'IO_FAILED',
  'TRANSFER_STALLED',
  'TRANSFER_CANCELLED',
  'CONNECTION_LOST',
  'TUNNEL_BIND_IN_USE',
  'TUNNEL_FAILED',
])
export type ErrorCode = z.infer<typeof ErrorCode>

export const ProtocolError = z.object({ code: ErrorCode, message: z.string() })
export type ProtocolError = z.infer<typeof ProtocolError>
