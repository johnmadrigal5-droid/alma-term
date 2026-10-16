import type { ProtocolError, TunnelSpec, TunnelType } from '@alma/protocol'

export const TYPE_LABEL: Record<TunnelType, string> = {
  L: 'Local',
  R: 'Remoto',
  D: 'Dinámico',
}

/** "127.0.0.1:8080 → db:5432", or the SOCKS5 proxy address for a dynamic tunnel. */
export function describeTunnel(spec: TunnelSpec, boundPort: number): string {
  const bind = `${spec.bindHost}:${boundPort || spec.bindPort}`
  if (spec.type === 'D') return `${bind} · SOCKS5`
  return `${bind} → ${spec.targetHost}:${spec.targetPort}`
}

export interface TunnelErrorCopy {
  title: string
  /** What the user can do next, when there is a clear step. */
  action?: string
}

// Spec §6: a failure says what happened and offers the next step.
export function tunnelErrorCopy(error: ProtocolError): TunnelErrorCopy {
  switch (error.code) {
    case 'TUNNEL_BIND_IN_USE':
      return { title: 'Puerto local en uso', action: 'Elegir otro puerto' }
    case 'SESSION_NOT_FOUND':
      return { title: 'La sesión ya no está abierta' }
    default:
      return { title: error.message }
  }
}
