import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TransferEvent } from '@alma/protocol'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { realScheduler } from '../flow/scheduler'
import { AutoFiles, type FilesMode } from '../sftp/auto-files'
import { SftpService } from '../sftp/sftp-service'
import { nodeFs, TransferQueue } from '../sftp/transfer-queue'
import type { SshConnection } from '../ssh/connector-types'
import { ssh2Connector } from '../ssh/ssh2-connector'
import {
  dockerAvailable,
  SSH_TEST_PASSWORD,
  SSH_TEST_USER,
  startTestSshServer,
  type TestSshServer,
} from '../ssh/test/ssh-server'
import { ScpService } from './scp-service'

const hasDocker = dockerAvailable()
if (!hasDocker) console.warn('[scp] Docker no disponible: tests SCP omitidos')

const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')
const SID = '7d3c7c86-5f43-4a43-9a43-2b0a0c0f2e11'
const id = (n: number) => `0b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c${String(n).padStart(2, '0')}`

describe.skipIf(!hasDocker)('scp fallback (native, Docker, no SFTP subsystem)', () => {
  let server: TestSshServer
  let connection: SshConnection
  let files: AutoFiles
  let home: string
  let local: string
  const modes: FilesMode[] = []
  const events: TransferEvent[] = []
  const queue = new TransferQueue({
    local: nodeFs,
    scheduler: realScheduler,
    send: (e) => events.push(e),
  })

  beforeAll(async () => {
    server = await startTestSshServer()
    await server.disableSftp()
    connection = await ssh2Connector.connect({
      target: { host: server.host, port: server.port, username: SSH_TEST_USER },
      auth: { type: 'password', password: SSH_TEST_PASSWORD },
      cols: 80,
      rows: 24,
      rememberable: false,
      signal: new AbortController().signal,
      hooks: {
        step: () => {},
        verifyHostKey: async () => true,
        askAuth: async () => ({ responses: [], remember: false }),
      },
    })
    const exec = connection.exec?.bind(connection)
    if (!exec) throw new Error('el conector no ofrece exec')
    files = new AutoFiles(
      new SftpService(() => connection.openSftp()),
      new ScpService(exec),
      (mode) => modes.push(mode),
    )
    local = mkdtempSync(join(tmpdir(), 'alma-scp-'))
    home = await files.home()
  }, 120_000)

  afterAll(() => {
    queue.dispose()
    files?.dispose()
    connection?.end()
    server?.stop()
    rmSync(local, { recursive: true, force: true })
  })

  async function transfer(
    n: number,
    direction: 'upload' | 'download',
    localPath: string,
    remotePath: string,
  ) {
    queue.add({
      transferId: id(n),
      sessionId: SID,
      direction,
      localPath,
      remotePath,
      overwrite: false,
      sftp: () => files.stream(),
    })
    const deadline = Date.now() + 30_000
    for (;;) {
      const last = events.filter((e) => e.transferId === id(n)).at(-1)
      if (last && ['done', 'error', 'cancelled'].includes(last.state)) return last
      if (Date.now() > deadline) throw new Error('la transferencia no terminó')
      await new Promise((r) => setTimeout(r, 50))
    }
  }

  it('falls back to scp because the server has no sftp subsystem', () => {
    expect(modes).toEqual(['scp'])
    expect(home).toMatch(/^\/config|^\/home/)
  })

  it('creates a folder, lists it and removes it', async () => {
    await files.mkdir(`${home}/alma scp`)
    const listed = await files.list(home)
    expect(listed.find((e) => e.name === 'alma scp')).toMatchObject({ kind: 'dir' })
    await files.remove(`${home}/alma scp`, 'dir')
    expect((await files.list(home)).some((e) => e.name === 'alma scp')).toBe(false)
  }, 30_000)

  it('uploads and downloads 1 MiB with the same SHA-256, under a name with spaces and quotes', async () => {
    const source = join(local, 'origen.bin')
    writeFileSync(source, randomBytes(1024 * 1024))
    const remote = `${home}/it's a file.bin`
    expect((await transfer(1, 'upload', source, remote)).state).toBe('done')
    expect((await files.stat(remote))?.size).toBe(1024 * 1024)
    const back = join(local, 'vuelta.bin')
    expect((await transfer(2, 'download', back, remote)).state).toBe('done')
    expect(sha256(back)).toBe(sha256(source))
    await files.remove(remote, 'file')
  }, 60_000)

  it('reports a missing remote file on download as ENOENT', async () => {
    const last = await transfer(3, 'download', join(local, 'nada.bin'), `${home}/no-existe.bin`)
    expect(last).toMatchObject({ state: 'error', error: { code: 'ENOENT' } })
  }, 30_000)

  it('does not let a crafted name run a command on the server', async () => {
    // No slash in it, so it is one folder name; were it run, "pwned" would appear in the home.
    const evil = `${home}/x'; touch pwned; echo '`
    await files.mkdir(evil)
    expect(await server.exec(`test -e ${home}/pwned && echo si || echo no`)).toContain('no')
    expect((await files.list(home)).some((e) => e.name === "x'; touch pwned; echo '")).toBe(true)
    await files.remove(evil, 'dir')
  }, 30_000)
})
