import { describe, expect, it } from 'vitest'
import { sftpError } from '../test/fake-sftp'
import { mapSftpError } from './sftp-errors'

describe('mapSftpError', () => {
  it('maps SFTP status codes', () => {
    expect(mapSftpError(sftpError(2, 'No such file')).code).toBe('ENOENT')
    expect(mapSftpError(sftpError(3, 'Permission denied')).code).toBe('EACCES')
  })

  it('reads a generic failure of rmdir as a folder that is not empty', () => {
    expect(mapSftpError(sftpError(4, 'Failure'), 'rmdir')).toEqual({
      code: 'ENOTEMPTY',
      message: 'La carpeta no está vacía',
    })
    expect(mapSftpError(sftpError(4, 'Failure')).code).toBe('IO_FAILED')
  })

  it('explains a bare SFTP failure in Spanish (OpenSSH sends disk full as "Failure")', () => {
    expect(mapSftpError(sftpError(4, 'Failure'))).toEqual({
      code: 'IO_FAILED',
      message:
        'El servidor no pudo completar la operación; puede que el disco esté lleno o que falten permisos (Failure)',
    })
  })

  it('keeps the code of local Node errors', () => {
    const local = Object.assign(new Error('ENOSPC: no space left'), { code: 'ENOSPC' })
    expect(mapSftpError(local).code).toBe('ENOSPC')
  })
})
