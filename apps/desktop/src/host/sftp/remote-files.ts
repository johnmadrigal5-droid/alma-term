import type { RemoteEntry, RemoteKind } from '@alma/protocol'
import type { TransferBackend } from './sftp-types'

/** The remote side of the file browser: SFTP when the server has it, scp over exec when not. */
export interface RemoteFiles {
  home(): Promise<string>
  list(path: string): Promise<RemoteEntry[]>
  stat(path: string): Promise<RemoteEntry | null>
  mkdir(path: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  remove(path: string, kind: RemoteKind): Promise<void>
  chmod(path: string, mode: number): Promise<void>
  /** What the transfer queue streams over. */
  stream(): Promise<TransferBackend>
  dispose(): void
}
