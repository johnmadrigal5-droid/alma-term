import { DataToRenderer } from '@alma/protocol'

export interface TermLike {
  write(data: Uint8Array, callback: () => void): void
  onData(listener: (data: string) => void): { dispose(): void }
  onBinary(listener: (data: string) => void): { dispose(): void }
}

const encoder = new TextEncoder()

// xterm emits binary events as strings whose char codes are raw bytes.
function binaryToBytes(data: string): Uint8Array {
  const out = new Uint8Array(data.length)
  for (let i = 0; i < data.length; i++) out[i] = data.charCodeAt(i) & 0xff
  return out
}

export function sendInput(port: MessagePort, text: string): void {
  port.postMessage({ type: 'input', bytes: encoder.encode(text) })
}

export function connectTerminal(
  term: TermLike,
  port: MessagePort,
  handlers: { onExit(code: number | null): void; onInput?(data: string): void },
): () => void {
  port.onmessage = (event: MessageEvent) => {
    const parsed = DataToRenderer.safeParse(event.data)
    if (!parsed.success) return
    const message = parsed.data
    if (message.type === 'exit') {
      handlers.onExit(message.code)
      return
    }
    const size = message.bytes.length
    term.write(message.bytes, () => port.postMessage({ type: 'ack', bytes: size }))
  }
  const data = term.onData((text) => {
    sendInput(port, text)
    handlers.onInput?.(text)
  })
  // Binary input is mouse reports in X10 mode: it stays with this terminal, never broadcast.
  const binary = term.onBinary((text) =>
    port.postMessage({ type: 'input', bytes: binaryToBytes(text) }),
  )
  return () => {
    data.dispose()
    binary.dispose()
    port.onmessage = null
    port.close()
  }
}
