import { z } from 'zod'
import { ControlResponse } from './control'
import { SessionId } from './ids'
import { SecretKind } from './saved'
import { TransferEvent } from './sftp'
import { TunnelEvent } from './tunnel'
import { ConnectStep, KnownHostEntry, Prompt } from './ssh'

// lost: the connection dropped (network, keepalive) rather than the shell exiting.
export const SessionState = z.enum(['ready', 'closed', 'lost'])
export type SessionState = z.infer<typeof SessionState>

export const StatusEvent = z.object({
  type: z.literal('event.status'),
  sessionId: SessionId,
  state: SessionState,
  exitCode: z.number().int().nullable(),
})
export type StatusEvent = z.infer<typeof StatusEvent>

export const StepEvent = z.object({
  type: z.literal('event.step'),
  sessionId: SessionId,
  step: ConnectStep,
})
export type StepEvent = z.infer<typeof StepEvent>

export const PromptEvent = z.object({
  type: z.literal('event.prompt'),
  sessionId: SessionId,
  promptId: z.uuid(),
  prompt: Prompt,
})
export type PromptEvent = z.infer<typeof PromptEvent>

export const PromptClosedEvent = z.object({
  type: z.literal('event.prompt-closed'),
  sessionId: SessionId,
  promptId: z.uuid(),
})
export type PromptClosedEvent = z.infer<typeof PromptClosedEvent>

export const HostKeyTrustedEvent = z.object({
  type: z.literal('event.hostkey-trusted'),
  sessionId: SessionId,
  entry: KnownHostEntry,
})
export type HostKeyTrustedEvent = z.infer<typeof HostKeyTrustedEvent>

// Host → main only: a secret the user asked to remember, sent after authentication succeeded.
// Main stores it encrypted and never forwards it to the renderer.
export const CredentialEvent = z.object({
  type: z.literal('event.credential'),
  sessionId: SessionId,
  kind: SecretKind,
  secret: z.string().min(1),
})
export type CredentialEvent = z.infer<typeof CredentialEvent>

/** Which remote file protocol a session ended up with: SFTP, or scp when the server has none. */
export const SftpModeEvent = z.object({
  type: z.literal('event.sftp-mode'),
  sessionId: SessionId,
  mode: z.enum(['sftp', 'scp']),
})
export type SftpModeEvent = z.infer<typeof SftpModeEvent>

export const HostEvent = z.discriminatedUnion('type', [
  StatusEvent,
  StepEvent,
  PromptEvent,
  PromptClosedEvent,
  HostKeyTrustedEvent,
  CredentialEvent,
  TransferEvent,
  TunnelEvent,
  SftpModeEvent,
])
export type HostEvent = z.infer<typeof HostEvent>

export const HostToMain = z.union([ControlResponse, HostEvent])
export type HostToMain = z.infer<typeof HostToMain>
