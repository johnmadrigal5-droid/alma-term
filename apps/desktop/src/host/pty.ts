import { createRequire } from 'node:module'
import type * as NodePty from 'node-pty'
import type { PtyFactory } from './pty-types'

const require = createRequire(import.meta.url)
const nodePty = require('node-pty') as typeof NodePty

export const nodePtyFactory: PtyFactory = ({ shell, args, cols, rows, cwd, env }) => {
  // encoding: null makes node-pty emit raw Buffers instead of decoded strings.
  const pty = nodePty.spawn(shell, args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    env,
    encoding: null,
  })
  return {
    onData: (listener) =>
      pty.onData((data: string | Buffer) =>
        listener(typeof data === 'string' ? new TextEncoder().encode(data) : data),
      ),
    onExit: (listener) => pty.onExit(({ exitCode }) => listener({ exitCode })),
    write: (data) => pty.write(Buffer.from(data)),
    resize: (c, r) => pty.resize(c, r),
    // Windows ConPTY rejects signal names; there kill() always terminates.
    kill: (signal) => (process.platform === 'win32' ? pty.kill() : pty.kill(signal)),
    pause: () => pty.pause(),
    resume: () => pty.resume(),
  }
}
