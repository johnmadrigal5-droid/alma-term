// Ports can arrive before or after the invoke() result; each port is handed out once.
export class PortRegistry<P extends { close(): void }> {
  private readonly ports = new Map<string, P>()
  private readonly waiters = new Map<string, ((port: P) => void)[]>()
  private readonly dropped = new Set<string>()

  /** The tab is gone: close its port now, or as soon as it arrives. */
  drop(sessionId: string): void {
    this.waiters.delete(sessionId)
    const port = this.ports.get(sessionId)
    if (port) {
      this.ports.delete(sessionId)
      port.close()
    } else this.dropped.add(sessionId)
  }

  deliver(sessionId: string, port: P): void {
    if (this.dropped.delete(sessionId)) {
      port.close()
      return
    }
    const waiting = this.waiters.get(sessionId)
    if (waiting && waiting.length > 0) {
      this.waiters.delete(sessionId)
      for (const resolve of waiting) resolve(port)
      return
    }
    this.ports.set(sessionId, port)
  }

  take(sessionId: string): Promise<P> {
    this.dropped.delete(sessionId)
    const port = this.ports.get(sessionId)
    if (port !== undefined) {
      this.ports.delete(sessionId)
      return Promise.resolve(port)
    }
    return new Promise((resolve) => {
      this.waiters.set(sessionId, [...(this.waiters.get(sessionId) ?? []), resolve])
    })
  }
}

function isPortMessage(data: unknown): data is { type: 'alma:port'; sessionId: string } {
  return (
    typeof data === 'object' &&
    data !== null &&
    'type' in data &&
    data.type === 'alma:port' &&
    'sessionId' in data &&
    typeof data.sessionId === 'string'
  )
}

export function listenForPorts(win: Window, registry: PortRegistry<MessagePort>): () => void {
  const onMessage = (event: MessageEvent) => {
    if (event.source !== win || !isPortMessage(event.data)) return
    const [port] = event.ports
    if (port) registry.deliver(event.data.sessionId, port)
  }
  win.addEventListener('message', onMessage)
  return () => win.removeEventListener('message', onMessage)
}
