import type { PtyLike } from '../pty-types'

export class FakePty implements PtyLike {
  readonly written: Uint8Array[] = []
  readonly resized: [number, number][] = []
  kills = 0
  readonly signals: (string | undefined)[] = []
  pauses = 0
  resumes = 0
  private dataListeners: ((d: Uint8Array) => void)[] = []
  private exitListeners: ((e: { exitCode: number }) => void)[] = []

  onData(listener: (d: Uint8Array) => void): { dispose(): void } {
    this.dataListeners.push(listener)
    return {
      dispose: () => {
        this.dataListeners = this.dataListeners.filter((l) => l !== listener)
      },
    }
  }

  onExit(listener: (e: { exitCode: number }) => void): { dispose(): void } {
    this.exitListeners.push(listener)
    return {
      dispose: () => {
        this.exitListeners = this.exitListeners.filter((l) => l !== listener)
      },
    }
  }

  write(data: Uint8Array): void {
    this.written.push(data)
  }

  resize(cols: number, rows: number): void {
    this.resized.push([cols, rows])
  }

  kill(signal?: string): void {
    this.kills++
    this.signals.push(signal)
  }

  pause(): void {
    this.pauses++
  }

  resume(): void {
    this.resumes++
  }

  emitData(data: Uint8Array | string): void {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
    for (const l of this.dataListeners) l(bytes)
  }

  emitExit(exitCode: number): void {
    for (const l of this.exitListeners) l({ exitCode })
  }
}
