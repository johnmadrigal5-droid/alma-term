import { MessageChannel } from 'node:worker_threads'
import type { HostToMain } from '@alma/protocol'
import { describe, expect, it } from 'vitest'
import { fromNodePort } from './ports'
import { nodePtyFactory } from './pty'
import { SessionManager } from './session-manager'

const SID = '0b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c7d'

describe.skipIf(process.platform === 'win32')('SessionManager with real pty (native)', () => {
  it('echoes input typed through the data port', async () => {
    const sent: HostToMain[] = []
    const manager = new SessionManager({
      ptyFactory: nodePtyFactory,
      shell: () => ({ shell: '/bin/sh', args: [] }),
      env: () => ({ PATH: process.env['PATH'] ?? '/usr/bin:/bin', TERM: 'xterm-256color' }),
      cwd: () => process.cwd(),
      send: (m) => sent.push(m),
    })
    const { port1, port2 } = new MessageChannel()
    manager.handle(
      {
        type: 'local.open',
        requestId: '6f1c3c2e-8f6a-4b8e-9d3f-2a1b0c9d8e7f',
        sessionId: SID,
        cols: 80,
        rows: 24,
      },
      [fromNodePort(port1)],
    )
    let output = ''
    const seen = new Promise<void>((resolve) => {
      port2.on('message', (m: { type: string; bytes?: Uint8Array }) => {
        if (m.type === 'data' && m.bytes) output += new TextDecoder().decode(m.bytes)
        if (output.includes('alma-42')) resolve()
      })
    })
    port2.postMessage({
      type: 'input',
      bytes: new TextEncoder().encode('echo alma-$((40+2))\r'),
    })
    await seen
    expect(sent[0]).toMatchObject({ type: 'event.status', state: 'ready' })
    manager.dispose()
    port2.close()
  })
})
