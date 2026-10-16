export interface Disposable {
  dispose(): void
}

/** lost: the transport dropped (SSH network failure) instead of the shell exiting. */
export interface PtyExit {
  exitCode: number
  lost?: boolean
}

export interface PtyLike {
  onData(listener: (data: Uint8Array) => void): Disposable
  onExit(listener: (event: PtyExit) => void): Disposable
  write(data: Uint8Array): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
  pause(): void
  resume(): void
}

export interface PtySpawnOptions {
  shell: string
  args: string[]
  cols: number
  rows: number
  cwd: string
  env: Record<string, string>
}

export type PtyFactory = (options: PtySpawnOptions) => PtyLike
