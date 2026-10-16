import type { ErrorCode } from '@alma/protocol'

export type ErrorAction = 'retry' | 'edit'

export interface ErrorCopy {
  title: string
  description: string
  actions: ErrorAction[]
}

const unreachable = (description: string): ErrorCopy => ({
  title: 'No se pudo alcanzar el servidor',
  description,
  actions: ['retry', 'edit'],
})

// Spec §6: every SSH failure says what happened and offers the next step.
const copy: Partial<Record<ErrorCode, ErrorCopy>> = {
  ECONNREFUSED: unreachable(
    'El servidor rechazó la conexión en ese puerto. Revisa el puerto o que el servicio SSH esté activo.',
  ),
  EHOSTUNREACH: unreachable(
    'No se encontró el host o la red no lo alcanza. Revisa el nombre o la dirección.',
  ),
  ETIMEDOUT: unreachable(
    'El servidor no respondió a tiempo. Puede estar caído o detrás de un cortafuegos.',
  ),
  AUTH_FAILED: {
    title: 'No se pudo autenticar',
    description:
      'El servidor rechazó la credencial. Prueba con otra o cambia el método de autenticación.',
    actions: ['retry', 'edit'],
  },
  HOSTKEY_REJECTED: {
    title: 'Conexión cancelada',
    description: 'No se confió en la clave del servidor, así que no se envió ninguna credencial.',
    actions: ['retry', 'edit'],
  },
  PROMPT_CANCELLED: {
    title: 'Conexión cancelada',
    description: 'Se canceló la conexión antes de abrir la sesión.',
    actions: ['retry', 'edit'],
  },
}

export function errorCopy(code: ErrorCode): ErrorCopy {
  return (
    copy[code] ?? {
      title: 'No se pudo conectar',
      description: 'Ocurrió un error inesperado al abrir la sesión.',
      actions: ['retry', 'edit'],
    }
  )
}
