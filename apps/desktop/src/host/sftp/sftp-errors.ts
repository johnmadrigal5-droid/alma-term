import type { ErrorCode, ProtocolError } from '@alma/protocol'

// SFTP v3 status codes as ssh2 puts them on Error#code.
const NO_SUCH_FILE = 2
const PERMISSION_DENIED = 3
const FAILURE = 4

const COPY: Partial<Record<ErrorCode, string>> = {
  ENOENT: 'No existe el archivo o la carpeta',
  EACCES: 'Permiso denegado',
  ENOTEMPTY: 'La carpeta no está vacía',
  EEXIST: 'Ya existe un archivo con ese nombre',
  ENOSPC: 'No queda espacio en el disco',
}

const LOCAL: readonly ErrorCode[] = ['ENOENT', 'EACCES', 'ENOTEMPTY', 'EEXIST', 'ENOSPC']

function failure(code: ErrorCode, fallback: string): ProtocolError {
  return { code, message: COPY[code] ?? fallback }
}

/** `rmdir` lets the generic FAILURE stand for a folder with content, as OpenSSH sends it. */
export function mapSftpError(error: unknown, op?: 'rmdir'): ProtocolError {
  const message = error instanceof Error ? error.message : String(error)
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null
  if (code === NO_SUCH_FILE) return failure('ENOENT', message)
  if (code === PERMISSION_DENIED) return failure('EACCES', message)
  if (code === FAILURE && op === 'rmdir') return failure('ENOTEMPTY', message)
  if (code === 'EPERM') return failure('EACCES', message)
  const local = LOCAL.find((c) => c === code)
  if (local) return failure(local, message)
  if (/no space/i.test(message)) return failure('ENOSPC', message)
  if (code === FAILURE)
    return {
      code: 'IO_FAILED',
      message: `El servidor no pudo completar la operación; puede que el disco esté lleno o que falten permisos (${message})`,
    }
  return { code: 'IO_FAILED', message }
}

/** A mapped failure that keeps its protocol code while travelling as an exception. */
export class SftpFailure extends Error {
  readonly code: ErrorCode
  constructor(error: ProtocolError) {
    super(error.message)
    this.code = error.code
  }

  toProtocol(): ProtocolError {
    return { code: this.code, message: this.message }
  }
}
