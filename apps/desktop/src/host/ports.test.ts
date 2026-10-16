import { MessageChannel } from 'node:worker_threads'
import { describe, expect, it } from 'vitest'
import { fromNodePort } from './ports'

describe('fromNodePort', () => {
  it('relays messages and close events', async () => {
    const { port1, port2 } = new MessageChannel()
    const port = fromNodePort(port1)
    const received = new Promise<unknown>((resolve) => port.onMessage(resolve))
    const closed = new Promise<void>((resolve) => port.onClose(resolve))
    port2.postMessage({ type: 'input', bytes: new Uint8Array([104]) })
    expect(await received).toEqual({ type: 'input', bytes: new Uint8Array([104]) })
    port2.close()
    await closed
  })
})
