import { connect, createServer } from 'node:net'
import type { TunnelNet } from './tunnel-manager'

// Half-open on both legs: a client that sends its request and closes its writing side (nc,
// HTTP/1.0 tools) still gets the reply. Each side ends the other when its own input ends.
/** TCP for real: listening servers for -L and -D, outgoing connections for -R targets. */
export const realTunnelNet: TunnelNet = {
  listen: (host, port, onSocket, onError) =>
    new Promise((resolve, reject) => {
      const server = createServer({ allowHalfOpen: true }, onSocket)
      server.once('error', reject)
      server.listen(port, host, () => {
        server.removeListener('error', reject)
        // After listening, an error must not reach the host process unhandled.
        server.on('error', (error) => onError?.(error))
        const address = server.address()
        resolve({
          port: typeof address === 'object' && address ? address.port : port,
          close: () => {
            server.close()
          },
        })
      })
    }),
  connect: (host, port) => connect({ port, host, allowHalfOpen: true }),
}
