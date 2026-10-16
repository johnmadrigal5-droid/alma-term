import type { SessionLog } from '@alma/protocol'

/** Where session logs go: the folder the user chose, else the default one. */
export class SessionLogConfig {
  constructor(
    private readonly settings: { logDir(): Promise<string | null> },
    private readonly defaultDir: string,
  ) {}

  async dir(): Promise<string> {
    return (await this.settings.logDir()) ?? this.defaultDir
  }

  /** What the host needs to log a session called `name`. */
  async forSession(name: string): Promise<SessionLog> {
    return { dir: await this.dir(), name }
  }
}
