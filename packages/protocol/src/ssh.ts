import { z } from 'zod'

export const SshTarget = z.object({
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  username: z.string().min(1).max(64),
})
export type SshTarget = z.infer<typeof SshTarget>

export const SshAuth = z.discriminatedUnion('type', [
  z.object({ type: z.literal('password'), password: z.string().optional() }),
  z.object({
    type: z.literal('key'),
    privateKeyPath: z.string().min(1),
    passphrase: z.string().optional(),
  }),
  z.object({ type: z.literal('agent') }),
])
export type SshAuth = z.infer<typeof SshAuth>

export const KnownHostEntry = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  keyType: z.string().min(1),
  fingerprint: z.string().min(1),
  publicKey: z.string().min(1),
})
export type KnownHostEntry = z.infer<typeof KnownHostEntry>

export const HostKeyPrompt = z.object({
  kind: z.literal('hostkey'),
  status: z.enum(['new', 'changed']),
  host: z.string(),
  port: z.number().int(),
  keyType: z.string(),
  fingerprint: z.string(),
  knownFingerprint: z.string().optional(),
})
export type HostKeyPrompt = z.infer<typeof HostKeyPrompt>

export const AuthPrompt = z.object({
  kind: z.literal('auth'),
  title: z.string(),
  instructions: z.string(),
  fields: z.array(z.object({ label: z.string(), echo: z.boolean() })).min(1),
  // Set by the host only on password and passphrase prompts of a saved session.
  remember: z.enum(['password', 'passphrase']).optional(),
})
export type AuthPrompt = z.infer<typeof AuthPrompt>

export const Prompt = z.discriminatedUnion('kind', [HostKeyPrompt, AuthPrompt])
export type Prompt = z.infer<typeof Prompt>

export const PromptAnswer = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hostkey'), accept: z.boolean() }),
  z.object({
    type: z.literal('auth'),
    responses: z.array(z.string()),
    remember: z.boolean().optional(),
  }),
  z.object({ type: z.literal('cancel') }),
])
export type PromptAnswer = z.infer<typeof PromptAnswer>

export const ConnectStep = z.enum(['tcp', 'hostkey', 'auth', 'shell'])
export type ConnectStep = z.infer<typeof ConnectStep>
