import type { ProtocolError } from '@alma/protocol'

const UNREACHABLE = new Set(['ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN'])

export function mapSshError(error: unknown): ProtocolError {
  const message = error instanceof Error ? error.message : String(error)
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  if (code === 'ECONNREFUSED')
    return { code: 'ECONNREFUSED', message: `El servidor rechazó la conexión (${message})` }
  if (UNREACHABLE.has(code))
    return { code: 'EHOSTUNREACH', message: `No se pudo alcanzar el host (${message})` }
  if (code === 'ETIMEDOUT' || /timed out/i.test(message))
    return { code: 'ETIMEDOUT', message: `La conexión tardó demasiado (${message})` }
  if (/authentication methods failed/i.test(message))
    return { code: 'AUTH_FAILED', message: 'El servidor rechazó las credenciales' }
  return { code: 'HOST_UNAVAILABLE', message }
}
