import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { buildPtyEnv, defaultShell } from './defaults'
import { fromElectronPort, type ElectronPortShape } from './ports'
import { nodePtyFactory } from './pty'
import { SessionManager } from './session-manager'
import { ssh2Connector } from './ssh/ssh2-connector'

interface ParentPortShape {
  on(
    event: 'message',
    listener: (event: { data: unknown; ports: ElectronPortShape[] }) => void,
  ): unknown
  postMessage(message: unknown): void
}

const parentPort = (process as NodeJS.Process & { parentPort?: ParentPortShape }).parentPort
if (!parentPort)
  throw new Error('El session host debe ejecutarse dentro de un utilityProcess de Electron')

const manager = new SessionManager({
  ptyFactory: nodePtyFactory,
  shell: () => defaultShell(process.platform, process.env),
  env: () => buildPtyEnv(process.env),
  cwd: () => homedir(),
  send: (message) => parentPort.postMessage(message),
  warn: (message) => console.warn(`[host] ${message}`),
  sshConnector: ssh2Connector,
  // Read-only: the app never writes the user's known_hosts.
  readKnownHostsFile: () => {
    try {
      return readFileSync(join(homedir(), '.ssh', 'known_hosts'), 'utf8')
    } catch {
      return ''
    }
  },
})

parentPort.on('message', (event) => manager.handle(event.data, event.ports.map(fromElectronPort)))

process.on('uncaughtException', (error) => {
  console.error('[host] excepción no capturada', error)
  manager.dispose()
  process.exit(1)
})
