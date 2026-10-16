import { describe, expect, it } from 'vitest'
import { nodePtyFactory } from './pty'

describe.skipIf(process.platform === 'win32')('nodePtyFactory (native)', () => {
  it('runs a command and reports its exit code', async () => {
    const pty = nodePtyFactory({
      shell: '/bin/sh',
      args: ['-c', 'printf alma-ok; exit 3'],
      cols: 80,
      rows: 24,
      cwd: process.cwd(),
      env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin' },
    })
    const chunks: Uint8Array[] = []
    pty.onData((c) => chunks.push(c))
    const code = await new Promise<number>((resolve) => pty.onExit((e) => resolve(e.exitCode)))
    expect(new TextDecoder().decode(Buffer.concat(chunks))).toContain('alma-ok')
    expect(code).toBe(3)
  })
})
