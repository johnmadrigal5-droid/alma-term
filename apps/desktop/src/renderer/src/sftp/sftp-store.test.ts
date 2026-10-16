// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createSftpStore } from './sftp-store'

describe('sftp store mode', () => {
  it('starts on sftp', () => {
    const store = createSftpStore()
    store.getState().patch('s', { path: '/' })
    expect(store.getState().panels['s']?.mode).toBe('sftp')
  })

  it('records scp for a session, even before its panel loaded', () => {
    const store = createSftpStore()
    store.getState().setMode('s', 'scp')
    expect(store.getState().panels['s']?.mode).toBe('scp')
    store.getState().patch('s', { path: '/home' })
    expect(store.getState().panels['s']?.mode).toBe('scp')
  })
})
