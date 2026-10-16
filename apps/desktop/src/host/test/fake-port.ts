import type { PortLike } from '../ports'

export class FakePort implements PortLike {
  readonly sent: unknown[] = []
  closed = false
  private readonly messageListeners: ((message: unknown) => void)[] = []
  private readonly closeListeners: (() => void)[] = []

  postMessage(message: unknown): void {
    this.sent.push(message)
  }

  onMessage(listener: (message: unknown) => void): void {
    this.messageListeners.push(listener)
  }

  onClose(listener: () => void): void {
    this.closeListeners.push(listener)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const l of this.closeListeners) l()
  }

  deliver(message: unknown): void {
    for (const l of this.messageListeners) l(message)
  }
}
