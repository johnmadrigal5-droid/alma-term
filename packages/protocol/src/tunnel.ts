import { z } from 'zod'
import { ProtocolError } from './errors'
import { RequestId, SessionId } from './ids'

export const TunnelId = z.uuid()
export const TunnelType = z.enum(['L', 'R', 'D'])
export type TunnelType = z.infer<typeof TunnelType>

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost'])
export const isLoopback = (host: string) => LOOPBACK.has(host.toLowerCase())

// A host name or address: no whitespace or control characters, bounded length.
const Host = z
  .string()
  .min(1)
  .max(255)
  // eslint-disable-next-line no-control-regex
  .regex(/^[^\s\u0000-\u001f\u007f]+$/, 'Host inválido')
const BindPort = z.number().int().min(0).max(65535)
const TargetPort = z.number().int().min(1).max(65535)

export const TunnelSpec = z
  .object({
    type: TunnelType,
    bindHost: Host.default('127.0.0.1'),
    bindPort: BindPort,
    targetHost: Host.optional(),
    targetPort: TargetPort.optional(),
    /** Listening beyond loopback is a deliberate, explicit choice (spec §3). */
    exposeExternally: z.boolean().default(false),
  })
  .superRefine((spec, ctx) => {
    const hasTarget = spec.targetHost !== undefined && spec.targetPort !== undefined
    if (spec.type === 'D' && (spec.targetHost !== undefined || spec.targetPort !== undefined))
      ctx.addIssue({ code: 'custom', message: 'Un túnel dinámico no lleva destino' })
    if (spec.type !== 'D' && !hasTarget)
      ctx.addIssue({ code: 'custom', message: 'Falta el destino del túnel' })
    if (!isLoopback(spec.bindHost) && !spec.exposeExternally)
      ctx.addIssue({
        code: 'custom',
        message: 'Escuchar fuera de 127.0.0.1 exige activarlo de forma explícita',
      })
  })
export type TunnelSpec = z.infer<typeof TunnelSpec>
/** What a caller may send: defaults are filled in by the schema. */
export type TunnelSpecInput = z.input<typeof TunnelSpec>

export const TunnelOpen = z.object({
  type: z.literal('tunnel.open'),
  requestId: RequestId,
  tunnelId: TunnelId,
  sessionId: SessionId,
  spec: TunnelSpec,
})
export const TunnelClose = z.object({
  type: z.literal('tunnel.close'),
  requestId: RequestId,
  tunnelId: TunnelId,
})

export const TunnelOpenArgs = z.object({
  sessionId: SessionId,
  spec: TunnelSpec,
  tunnelId: TunnelId.optional(),
})
export type TunnelOpenArgs = z.infer<typeof TunnelOpenArgs>
/** What the renderer sends: schema defaults (bind host, exposure) may be left out. */
export type TunnelOpenInput = z.input<typeof TunnelOpenArgs>
export const TunnelCloseArgs = z.object({ tunnelId: TunnelId })
export type TunnelCloseArgs = z.infer<typeof TunnelCloseArgs>

export const TunnelState = z.enum(['open', 'closed', 'error'])
export type TunnelState = z.infer<typeof TunnelState>

export const TunnelEvent = z.object({
  type: z.literal('event.tunnel'),
  tunnelId: TunnelId,
  sessionId: SessionId,
  spec: TunnelSpec,
  state: TunnelState,
  /** The port actually listening (local for L/D, on the server for R). */
  boundPort: z.number().int().min(0).max(65535),
  connections: z.number().int().min(0),
  error: ProtocolError.optional(),
})
export type TunnelEvent = z.infer<typeof TunnelEvent>
