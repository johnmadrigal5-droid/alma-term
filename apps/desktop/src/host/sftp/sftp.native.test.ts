import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TransferEvent, TransferState } from '@alma/protocol'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { realScheduler } from '../flow/scheduler'
import type { SshConnection } from '../ssh/connector-types'
import { ssh2Connector } from '../ssh/ssh2-connector'
import {
  dockerAvailable,
  SSH_TEST_PASSWORD,
  SSH_TEST_USER,
  startTestSshServer,
  type TestSshServer,
} from '../ssh/test/ssh-server'
import { SftpService } from './sftp-service'
import { nodeFs, TransferQueue, type TransferJob } from './transfer-queue'

const hasDocker = dockerAvailable()
if (!hasDocker) console.warn('[sftp] Docker no disponible: tests SFTP omitidos')

const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')

describe.skipIf(!hasDocker)('SFTP (native, Docker)', () => {
  let server: TestSshServer
  let connection: SshConnection
  let sftp: SftpService
  let local: string
  let home: string
  const events: TransferEvent[] = []
  const queue = new TransferQueue({
    local: nodeFs,
    scheduler: realScheduler,
    send: (e) => events.push(e),
  })

  beforeAll(async () => {
    server = await startTestSshServer()
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
    sftp = new SftpService(() => connection.openSftp())
    home = await sftp.home()
    local = mkdtempSync(join(tmpdir(), 'alma-sftp-'))
  }, 120_000)

  afterAll(async () => {
    queue.dispose()
    await sftp?.dispose()
    connection?.end()
    server?.stop()
    if (local) rmSync(local, { recursive: true, force: true })
  })

  const job = (over: Partial<TransferJob>): TransferJob => ({
    transferId: randomUUID(),
    sessionId: randomUUID(),
    direction: 'upload',
    localPath: '',
    remotePath: '',
    overwrite: false,
    sftp: () => sftp.stream(),
    ...over,
  })

  const until = (transferId: string, states: TransferState[], timeout = 10_000) =>
    new Promise<TransferEvent>((resolve, reject) => {
      const started = Date.now()
      const tick = () => {
        const hit = events.find((e) => e.transferId === transferId && states.includes(e.state))
        if (hit) return resolve(hit)
        if (Date.now() - started > timeout) {
          const seen = events.filter((e) => e.transferId === transferId)
          return reject(new Error(`sin ${states.join('/')}: ${JSON.stringify(seen.at(-1))}`))
        }
        setTimeout(tick, 20)
      }
      tick()
    })

  it('resolves the home folder of the user', () => {
    expect(home).toBe('/config')
  })

  it('uploads and downloads 1 MiB with the same SHA-256', async () => {
    const source = join(local, 'random.bin')
    writeFileSync(source, randomBytes(1024 * 1024))
    const up = job({ localPath: source, remotePath: `${home}/random.bin` })
    queue.add(up)
    expect((await until(up.transferId, ['done', 'error'])).state).toBe('done')
    const back = join(local, 'back.bin')
    const down = job({ direction: 'download', localPath: back, remotePath: `${home}/random.bin` })
    queue.add(down)
    expect(await until(down.transferId, ['done', 'error'])).toMatchObject({
      state: 'done',
      bytes: 1024 * 1024,
      total: 1024 * 1024,
    })
    expect(sha256(back)).toBe(sha256(source))
  })

  it('creates, renames and removes inside the home folder', async () => {
    await sftp.mkdir(`${home}/prueba`)
    await sftp.rename(`${home}/prueba`, `${home}/prueba-2`)
    expect((await sftp.list(home)).some((e) => e.name === 'prueba-2' && e.kind === 'dir')).toBe(
      true,
    )
    await sftp.remove(`${home}/prueba-2`, 'dir')
    expect(await sftp.stat(`${home}/prueba-2`)).toBeNull()
  })

  it('reports EACCES for /root and for an upload into it', async () => {
    await expect(sftp.list('/root')).rejects.toMatchObject({ code: 'EACCES' })
    const source = join(local, 'small.txt')
    writeFileSync(source, 'hola')
    const up = job({ localPath: source, remotePath: '/root/x' })
    queue.add(up)
    expect(await until(up.transferId, ['done', 'error'])).toMatchObject({
      state: 'error',
      error: { code: 'EACCES' },
    })
  })

  it('cancels a 32 MiB upload halfway and leaves no remote file', async () => {
    const source = join(local, 'big.bin')
    writeFileSync(source, randomBytes(32 * 1024 * 1024))
    const up = job({ localPath: source, remotePath: `${home}/big.bin` })
    queue.add(up)
    await new Promise<void>((resolve) => {
      const tick = () => {
        const progressed = events.some((e) => e.transferId === up.transferId && e.bytes > 0)
        if (progressed) resolve()
        else setTimeout(tick, 5)
      }
      tick()
    })
    queue.cancel(up.transferId)
    expect((await until(up.transferId, ['cancelled'])).state).toBe('cancelled')
    await expect.poll(() => sftp.stat(`${home}/big.bin`), { timeout: 5000 }).toBeNull()
  })
})
