import { execFile, execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer, connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const SSH_TEST_IMAGE = 'lscr.io/linuxserver/openssh-server:10.3_p1-r1-ls239'
export const SSH_TEST_USER = 'alma'
export const SSH_TEST_PASSWORD = 'alma-pass'

export interface TestSshServer {
  host: string
  port: number
  /** Unencrypted ed25519 private key authorised for the test user. */
  privateKeyPath: string
  /** ssh-keyscan output for the container (OpenSSH known_hosts lines). */
  keyscan(): string
  /** TCP connections established to sshd inside the container (from /proc/net/tcp). */
  established(): number
  /** Runs a command inside the container and returns its stdout. Async: the caller's event loop keeps running. */
  exec(command: string): Promise<string>
  /**
   * The image ships `AllowTcpForwarding no`. Switches it on and reloads sshd: connections made
   * afterwards may forward ports, earlier ones keep being denied.
   */
  allowTcpForwarding(): Promise<void>
  /** Removes the sftp subsystem and reloads sshd: connections made afterwards get no SFTP. */
  disableSftp(): Promise<void>
  stop(): void
}

export function dockerAvailable(): boolean {
  return spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => resolve(typeof address === 'object' && address ? address.port : 0))
    })
  })
}

function sshBannerReady(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1')
    const done = (ok: boolean) => {
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(1000, () => done(false))
    socket.once('data', (data) => done(data.toString().startsWith('SSH-')))
    socket.once('error', () => done(false))
    socket.once('close', () => done(false))
  })
}

export async function startTestSshServer(): Promise<TestSshServer> {
  const dir = mkdtempSync(join(tmpdir(), 'alma-ssh-'))
  const privateKeyPath = join(dir, 'id_ed25519')
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', privateKeyPath])
  const publicKey = readFileSync(`${privateKeyPath}.pub`, 'utf8').trim()
  const port = await freePort()
  const id = execFileSync('docker', [
    'run',
    '-d',
    '--rm',
    '-p',
    `127.0.0.1:${port}:2222`,
    '-e',
    'PASSWORD_ACCESS=true',
    '-e',
    `USER_NAME=${SSH_TEST_USER}`,
    '-e',
    `USER_PASSWORD=${SSH_TEST_PASSWORD}`,
    '-e',
    `PUBLIC_KEY=${publicKey}`,
    SSH_TEST_IMAGE,
  ])
    .toString()
    .trim()
  const stop = () => {
    spawnSync('docker', ['rm', '-f', id], { stdio: 'ignore' })
    rmSync(dir, { recursive: true, force: true })
  }
  const deadline = Date.now() + 30_000
  while (!(await sshBannerReady(port))) {
    if (Date.now() > deadline) {
      stop()
      throw new Error('El servidor SSH de test no arrancó en 30 s')
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return {
    host: '127.0.0.1',
    port,
    privateKeyPath,
    keyscan: () =>
      execFileSync('ssh-keyscan', ['-p', String(port), '127.0.0.1'], {
        stdio: ['ignore', 'pipe', 'ignore'],
      }).toString(),
    exec: (command) =>
      new Promise((resolve, reject) => {
        execFile(
          'docker',
          ['exec', id, 'sh', '-c', command],
          { timeout: 10_000 },
          (error, stdout) => (error ? reject(error) : resolve(stdout)),
        )
      }),
    disableSftp: async () => {
      execFileSync('docker', [
        'exec',
        id,
        'sh',
        '-c',
        "sed -i 's/^Subsystem[[:space:]]\\+sftp/#Subsystem sftp/' /config/sshd/sshd_config && kill -HUP $(cat /config/sshd.pid)",
      ])
      await new Promise((r) => setTimeout(r, 1500))
    },
    allowTcpForwarding: async () => {
      execFileSync('docker', [
        'exec',
        id,
        'sh',
        '-c',
        "sed -i 's/^AllowTcpForwarding no/AllowTcpForwarding yes/' /config/sshd/sshd_config && kill -HUP $(cat /config/sshd.pid)",
      ])
      await new Promise((r) => setTimeout(r, 1500))
    },
    established: () => {
      const table = execFileSync('docker', ['exec', id, 'cat', '/proc/net/tcp']).toString()
      // Columns: sl local_address rem_address st … ; 08AE = port 2222, st 01 = ESTABLISHED.
      return table
        .split('\n')
        .map((line) => line.trim().split(/\s+/))
        .filter((cols) => cols[1]?.endsWith(':08AE') && cols[3] === '01').length
    },
    stop,
  }
}
