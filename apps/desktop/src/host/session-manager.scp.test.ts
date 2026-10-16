import { EventEmitter } from 'node:events'
import type { HostToMain, SftpModeEvent, TransferEvent } from '@alma/protocol'
import { describe, expect, it, vi } from 'vitest'
import { SessionManager } from './session-manager'
import type { ChannelLike } from './ssh/channel-pty'
import type { SshConnection } from './ssh/connector-types'
import { FakePort } from './test/fake-port'
import { FakePty } from './test/fake-pty'
import { FakeScheduler } from './test/fake-scheduler'
import { FakeScpHost } from './test/fake-scp-host'
import { FakeSftp } from './test/fake-sftp'
import { MemoryFs } from './test/memory-fs'

const SID = '0b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c7d'
const TID = '2b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c7d'
const rid = (n: number) => `6f1c3c2e-8f6a-4b8e-9d3f-2a1b0c9d8e${String(n).padStart(2, '0')}`

class FakeChannel extends EventEmitter implements ChannelLike {
  readonly stderr = new EventEmitter()
  write(): boolean {
    return true
  }
  setWindow(): void {}
  close(): void {
    this.emit('close')
  }
  pause(): void {}
  resume(): void {}
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r))
}

function setup(sftpAvailable: boolean) {
  const sent: HostToMain[] = []
  const fake = new FakeSftp()
  const scp = new FakeScpHost()
  const local = new MemoryFs()
  const connection: SshConnection = {
    channel: new FakeChannel(),
    end: vi.fn(),
    openSftp: async () => {
      if (!sftpAvailable) throw new Error('Unable to start subsystem: sftp')
      return fake
    },
    exec: scp.exec,
    remembered: null,
  }
  const manager = new SessionManager({
    ptyFactory: () => new FakePty(),
    shell: () => ({ shell: '/bin/sh', args: [] }),
    env: () => ({}),
    cwd: () => '/',
    send: (m) => sent.push(m),
    scheduler: new FakeScheduler(),
    warn: vi.fn(),
    sshConnector: { connect: async () => connection },
    readKnownHostsFile: () => '',
    localFs: local,
  })
  manager.handle(
    {
      type: 'ssh.open',
      requestId: rid(1),
      sessionId: SID,
      cols: 80,
      rows: 24,
      target: { host: 'srv', port: 22, username: 'alma' },
      auth: { type: 'agent' },
      trusted: [],
      rememberable: false,
    },
    [new FakePort()],
  )
  const response = (n: number) => sent.find((m) => m.type === 'response' && m.requestId === rid(n))
  const modes = () => sent.filter((m): m is SftpModeEvent => m.type === 'event.sftp-mode')
  const transfers = () => sent.filter((m): m is TransferEvent => m.type === 'event.transfer')
  return { manager, sent, fake, scp, local, response, modes, transfers }
}

describe('SessionManager over scp', () => {
  it('lists through scp when the server has no SFTP, and says the mode once', async () => {
    const { manager, scp, response, modes } = setup(false)
    await settle()
    scp.dirs.add('/home/alma/docs')
    scp.files.set('/home/alma/nota.txt', Buffer.from('x'))
    manager.handle({ type: 'sftp.home', requestId: rid(2), sessionId: SID }, [])
    await settle()
    expect(response(2)).toMatchObject({ ok: true, data: '/home/alma' })
    manager.handle({ type: 'sftp.list', requestId: rid(3), sessionId: SID, path: '/home/alma' }, [])
    await settle()
    expect(response(3)).toMatchObject({
      ok: true,
      data: [
        { name: 'docs', kind: 'dir' },
        { name: 'nota.txt', kind: 'file' },
      ],
    })
    expect(modes()).toEqual([{ type: 'event.sftp-mode', sessionId: SID, mode: 'scp' }])
  })

  it('keeps using SFTP when the server has it', async () => {
    const { manager, fake, response, modes, scp } = setup(true)
    await settle()
    fake.mkdirp('/home/alma/a')
    manager.handle({ type: 'sftp.list', requestId: rid(2), sessionId: SID, path: '/home/alma' }, [])
    await settle()
    expect(response(2)).toMatchObject({ ok: true, data: [{ name: 'a' }] })
    expect(modes()).toEqual([{ type: 'event.sftp-mode', sessionId: SID, mode: 'sftp' }])
    expect(scp.commands).toEqual([])
  })

  it('uploads and downloads through scp with the same transfer queue', async () => {
    const { manager, local, scp, transfers } = setup(false)
    await settle()
    local.files.set('/l/a.txt', Buffer.from('por scp'))
    manager.handle(
      {
        type: 'transfer.start',
        requestId: rid(2),
        transferId: TID,
        sessionId: SID,
        direction: 'upload',
        localPath: '/l/a.txt',
        remotePath: '/home/alma/a.txt',
        overwrite: false,
      },
      [],
    )
    await settle()
    expect(transfers().at(-1)).toMatchObject({ state: 'done' })
    expect(scp.files.get('/home/alma/a.txt')?.toString()).toBe('por scp')
    scp.files.set('/home/alma/b.txt', Buffer.from('de vuelta'))
    manager.handle(
      {
        type: 'transfer.start',
        requestId: rid(3),
        transferId: '3b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c7d',
        sessionId: SID,
        direction: 'download',
        localPath: '/l/b.txt',
        remotePath: '/home/alma/b.txt',
        overwrite: false,
      },
      [],
    )
    await settle()
    expect(local.files.get('/l/b.txt')?.toString()).toBe('de vuelta')
  })
})
