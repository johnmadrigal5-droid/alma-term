// @vitest-environment node
import { connect } from 'node:net'
import { duplexPair } from 'node:stream'
import { TunnelSpec } from '@alma/protocol'
import { describe, expect, it } from 'vitest'
import { realScheduler } from '../flow/scheduler'
import { FakeTunnelConnection } from '../test/fake-tunnel-net'
import { realTunnelNet } from './real-net'
import { TunnelManager } from './tunnel-manager'

const SID = '7d3c7c86-5f43-4a43-9a43-2b0a0c0f2e11'
const TID = '0b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c01'

describe('TunnelManager over real sockets', () => {
  it('C2: delivers a late reply to a client that half-closes right after its request', async () => {
    const conn = new FakeTunnelConnection()
    // A server that answers only once it has seen the whole request (its input ended).
    conn.forwardOut = async () => {
      const [local, remote] = duplexPair()
      const chunks: Buffer[] = []
      remote.on('data', (d: Buffer) => chunks.push(d))
      remote.on('end', () => {
        setTimeout(() => remote.end(Buffer.concat(chunks).toString().toUpperCase()), 30)
      })
      return local
    }
    const manager = new TunnelManager({
      net: realTunnelNet,
      scheduler: realScheduler,
      send: () => undefined,
    })
    const port = await manager.open(
      SID,
      TID,
      TunnelSpec.parse({ type: 'L', bindPort: 0, targetHost: 'db', targetPort: 1 }),
      conn,
    )
    const client = connect(port, '127.0.0.1')
    const received: Buffer[] = []
    client.on('data', (d: Buffer) => received.push(d))
    await new Promise<void>((resolve) => client.once('connect', resolve))
    client.end('hola')
    await new Promise<void>((resolve) => client.once('close', resolve))
    manager.dispose()
    expect(Buffer.concat(received).toString()).toBe('HOLA')
  })
})
