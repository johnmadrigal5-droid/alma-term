import { z } from 'zod'
import { SessionId } from './ids'
import { TunnelId, TunnelSpec } from './tunnel'

/** A tunnel kept with a saved session (not with a live tab); `autoStart` opens it on connect. */
export const SavedTunnel = z.object({
  id: TunnelId,
  /** Id of the saved session (bookmark) it belongs to. */
  savedId: SessionId,
  spec: TunnelSpec,
  autoStart: z.boolean(),
})
export type SavedTunnel = z.infer<typeof SavedTunnel>

export const SavedTunnelInput = z.object({
  savedId: SessionId,
  spec: TunnelSpec,
  autoStart: z.boolean(),
})
export type SavedTunnelInput = z.infer<typeof SavedTunnelInput>
/** What the renderer sends: schema defaults of the spec may be left out. */
export type SavedTunnelRequest = z.input<typeof SavedTunnelInput>

export const SavedTunnelListArgs = z.object({ savedId: SessionId })
export type SavedTunnelListArgs = z.infer<typeof SavedTunnelListArgs>
export const SavedTunnelRemoveArgs = z.object({ id: TunnelId })
export type SavedTunnelRemoveArgs = z.infer<typeof SavedTunnelRemoveArgs>
