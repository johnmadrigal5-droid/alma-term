// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { connectTerminal, type TermLike } from './connect-terminal'

class FakeTerm implements TermLike {
  readonly writes: Uint8Array[] = []
  dataListener: ((d: string) => void) | null = null
  binaryListener: ((d: string) => void) | null = null
  write(data: Uint8Array, callback: () => void): void {
    this.writes.push(data)
    callback()
  }
  onData(listener: (d: string) => void) {
    this.dataListener = listener
    return {
      dispose: () => {
        this.dataListener = null
      },
    }
  }
  onBinary(listener: (d: string) => void) {
    this.binaryListener = listener
    return {
      dispose: () => {
        this.binaryListener = null
      },
    }
  }
}

function next(port: MessagePort): Promise<unknown> {
  return new Promise((resolve) => {
    port.onmessage = (event) => resolve(event.data)
  })
}

describe('connectTerminal', () => {
  it('writes data and acks the drawn byte count', async () => {
    const { port1, port2 } = new MessageChannel()
    const term = new FakeTerm()
    connectTerminal(term, port1, { onExit: vi.fn() })
    const ack = next(port2)
    port2.postMessage({ type: 'data', seq: 0, bytes: new Uint8Array([104, 111, 108, 97]) })
    expect(await ack).toEqual({ type: 'ack', bytes: 4 })
    expect(term.writes).toHaveLength(1)
    port1.close()
  })

  it('sends typed text as input bytes', async () => {
    const { port1, port2 } = new MessageChannel()
    const term = new FakeTerm()
    connectTerminal(term, port1, { onExit: vi.fn() })
    const input = next(port2)
    term.dataListener?.('ls\r')
    expect(await input).toEqual({ type: 'input', bytes: new Uint8Array([108, 115, 13]) })
    port1.close()
  })

  it('sends binary events byte for byte', async () => {
    const { port1, port2 } = new MessageChannel()
    const term = new FakeTerm()
    connectTerminal(term, port1, { onExit: vi.fn() })
    const input = next(port2)
    term.binaryListener?.('\x1b[M\xff')
    expect(await input).toEqual({ type: 'input', bytes: new Uint8Array([0x1b, 0x5b, 0x4d, 0xff]) })
    port1.close()
  })

  it('reports exit and ignores invalid messages', async () => {
    const { port1, port2 } = new MessageChannel()
    const term = new FakeTerm()
    const onExit = vi.fn()
    connectTerminal(term, port1, { onExit })
    port2.postMessage({ type: 'data', seq: 0, bytes: 'not bytes' })
    port2.postMessage({ type: 'exit', code: 2 })
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledWith(2))
    expect(term.writes).toHaveLength(0)
    port1.close()
  })
  it('reports typed text to onInput after sending it', () => {
    const term = new FakeTerm()
    const { port1, port2 } = new MessageChannel()
    const seen: string[] = []
    connectTerminal(term, port1, { onExit: () => undefined, onInput: (d) => seen.push(d) })
    term.dataListener?.('ls')
    expect(seen).toEqual(['ls'])
    port1.close()
    port2.close()
  })

  it('does not report binary input (mouse reports in X10 mode)', () => {
    const term = new FakeTerm()
    const { port1, port2 } = new MessageChannel()
    const onInput = vi.fn()
    connectTerminal(term, port1, { onExit: () => undefined, onInput })
    term.binaryListener?.('\x1b[M !!')
    expect(onInput).not.toHaveBeenCalled()
    port1.close()
    port2.close()
  })
})
