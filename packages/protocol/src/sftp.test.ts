import { describe, expect, it } from 'vitest'
import { ControlRequest } from './control'
import { HostToMain } from './events'

const sessionId = '7d3c7c86-5f43-4a43-9a43-2b0a0c0f2e11'
const requestId = '0b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c7d'
const transferId = '1b9a8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c7d'

const start = {
  type: 'transfer.start',
  requestId,
  transferId,
  sessionId,
  direction: 'upload',
  localPath: '/home/yo/a.txt',
  remotePath: '/srv/a.txt',
  overwrite: false,
}

describe('sftp protocol', () => {
  it('accepts a transfer start and rejects a NUL in a path', () => {
    expect(ControlRequest.safeParse(start).success).toBe(true)
    expect(ControlRequest.safeParse({ ...start, localPath: '/home/yo/a\0b' }).success).toBe(false)
    expect(ControlRequest.safeParse({ ...start, remotePath: '' }).success).toBe(false)
  })

  it('rejects a .. component in any path, with either separator', () => {
    for (const path of ['/home/../etc', '/descargas/../../x', 'C:\\d\\..\\evil', '..'])
      expect(ControlRequest.safeParse({ ...start, localPath: path }).success, path).toBe(false)
    expect(ControlRequest.safeParse({ ...start, remotePath: '/a/..' }).success).toBe(false)
    expect(ControlRequest.safeParse({ ...start, localPath: '/a/..b/c' }).success).toBe(true)
  })

  it('accepts permission bits and rejects anything above 0o7777', () => {
    const chmod = { type: 'sftp.chmod', requestId, sessionId, path: '/a', mode: 0o755 }
    expect(ControlRequest.safeParse(chmod).success).toBe(true)
    expect(ControlRequest.safeParse({ ...chmod, mode: 0o10000 }).success).toBe(false)
  })

  it('accepts every sftp control request', () => {
    for (const message of [
      { type: 'sftp.home', requestId, sessionId },
      { type: 'sftp.list', requestId, sessionId, path: '/' },
      { type: 'sftp.stat', requestId, sessionId, path: '/a' },
      { type: 'sftp.mkdir', requestId, sessionId, path: '/a' },
      { type: 'sftp.rename', requestId, sessionId, from: '/a', to: '/b' },
      { type: 'sftp.rm', requestId, sessionId, path: '/a', kind: 'dir' },
      { type: 'transfer.pause', requestId, transferId },
      { type: 'transfer.resume', requestId, transferId },
      { type: 'transfer.cancel', requestId, transferId },
    ])
      expect(ControlRequest.safeParse(message).success, message.type).toBe(true)
  })

  it('accepts a transfer event that failed with ENOSPC', () => {
    expect(
      HostToMain.safeParse({
        type: 'event.transfer',
        transferId,
        sessionId,
        direction: 'upload',
        name: 'a.txt',
        state: 'error',
        bytes: 10,
        total: 20,
        error: { code: 'ENOSPC', message: 'No queda espacio en el disco' },
      }).success,
    ).toBe(true)
  })
})
