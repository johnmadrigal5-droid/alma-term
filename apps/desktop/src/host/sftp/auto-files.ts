import type { RemoteEntry, RemoteKind } from '@alma/protocol'
import type { RemoteFiles } from './remote-files'
import { SftpFailure } from './sftp-errors'
import type { TransferBackend } from './sftp-types'

export type FilesMode = 'sftp' | 'scp'

/**
 * SFTP first; when the server has no SFTP subsystem, scp over exec for the rest of the
 * connection. The choice is made on first use and reported once.
 */
export class AutoFiles implements RemoteFiles {
  private choice: Promise<RemoteFiles> | null = null

  constructor(
    private readonly sftp: RemoteFiles,
    private readonly scp: RemoteFiles | null,
    private readonly onMode: (mode: FilesMode) => void,
  ) {}

  private pick(): Promise<RemoteFiles> {
    if (this.choice) return this.choice
    const choice = this.sftp.stream().then(
      () => {
        this.onMode('sftp')
        return this.sftp
      },
      (error: unknown) => {
        // Only a refused subsystem is remembered (SftpService raises SFTP_UNAVAILABLE for that
        // alone); a busy server or a dropped channel may work the next time.
        if (error instanceof SftpFailure && error.code === 'SFTP_UNAVAILABLE' && this.scp) {
          this.onMode('scp')
          return this.scp
        }
        if (this.choice === choice) this.choice = null
        throw error
      },
    )
    this.choice = choice
    return choice
  }

  async home(): Promise<string> {
    return (await this.pick()).home()
  }
  async list(path: string): Promise<RemoteEntry[]> {
    return (await this.pick()).list(path)
  }
  async stat(path: string): Promise<RemoteEntry | null> {
    return (await this.pick()).stat(path)
  }
  async mkdir(path: string): Promise<void> {
    return (await this.pick()).mkdir(path)
  }
  async rename(from: string, to: string): Promise<void> {
    return (await this.pick()).rename(from, to)
  }
  async remove(path: string, kind: RemoteKind): Promise<void> {
    return (await this.pick()).remove(path, kind)
  }
  async chmod(path: string, mode: number): Promise<void> {
    return (await this.pick()).chmod(path, mode)
  }
  async stream(): Promise<TransferBackend> {
    return (await this.pick()).stream()
  }

  dispose(): void {
    this.sftp.dispose()
    this.scp?.dispose()
  }
}
