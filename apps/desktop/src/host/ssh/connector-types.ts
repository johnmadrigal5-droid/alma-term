import type { Duplex, Readable } from 'node:stream'
import type { AuthPrompt, ConnectStep, SecretKind, SshAuth, SshTarget } from '@alma/protocol'
import type { SftpLike } from '../sftp/sftp-types'
import type { ChannelLike } from './channel-pty'

export interface SshHooks {
  step(step: ConnectStep): void
  verifyHostKey(keyType: string, keyBlob: Uint8Array): Promise<boolean>
  askAuth(prompt: AuthPrompt): Promise<AuthAnswer>
}

export interface AuthAnswer {
  responses: string[]
  remember: boolean
}

export interface RememberedSecret {
  kind: SecretKind
  secret: string
}

export interface SshConnectOptions {
  target: SshTarget
  auth: SshAuth
  cols: number
  rows: number
  hooks: SshHooks
  signal: AbortSignal
  /** Saved session on a secure secret store: password and passphrase prompts offer "Recordar". */
  rememberable: boolean
  /** Host key types already known for this host; negotiated first so the server keeps its key. */
  preferredHostKeys?: string[]
}

/** A command running on the server: its input and output on one duplex, and its exit. */
export interface ExecChannel {
  io: Duplex
  stderr: Readable
  /** Exit code once the command ended; null when it was killed by a signal. */
  exit: Promise<number | null>
  close(): void
}

export interface SshConnection {
  channel: ChannelLike
  end(): void
  /** Opens an SFTP channel on the same connection; rejects when the server has no subsystem. */
  openSftp(): Promise<SftpLike>
  /** The last secret typed with "Recordar" checked; only set once the shell is open. */
  remembered: RememberedSecret | null
  /** Port forwarding over this connection; absent on connections that cannot (test fakes). */
  forwardOut?(srcHost: string, srcPort: number, dstHost: string, dstPort: number): Promise<Duplex>
  /** Asks the server to listen; resolves with the port it really bound. Rejects when denied. */
  forwardIn?(bindHost: string, bindPort: number): Promise<number>
  unforwardIn?(bindHost: string, bindPort: number): Promise<void>
  /** Connections that arrive on a remotely forwarded port: the listener accepts or rejects. */
  onTcpConnection?(
    listener: (
      info: { destHost: string; destPort: number; srcHost: string; srcPort: number },
      accept: () => Duplex,
      reject: () => void,
    ) => void,
  ): void
  /** Runs a command (no pty); used by the scp fallback when the server has no SFTP. */
  exec?(command: string): Promise<ExecChannel>
  /** Called when the connection drops after the shell opened (network, keepalive). */
  onLost?(listener: () => void): void
}

export interface SshConnector {
  connect(options: SshConnectOptions): Promise<SshConnection>
}
