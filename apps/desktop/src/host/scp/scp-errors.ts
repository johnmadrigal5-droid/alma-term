import type { ProtocolError } from '@alma/protocol'
import { SftpFailure } from '../sftp/sftp-errors'

/** What a server or a command said, as a typed error with the Spanish copy the UI shows. */
export function mapScpMessage(text: string): ProtocolError {
  const message = text.trim()
  if (/no such file|not found|cannot access/i.test(message))
    return { code: 'ENOENT', message: 'No existe el archivo o la carpeta' }
  if (/permission denied|operation not permitted|not permitted/i.test(message))
    return { code: 'EACCES', message: 'Permiso denegado' }
  if (/no space|disk quota|quota exceeded/i.test(message))
    return { code: 'ENOSPC', message: 'No queda espacio en el disco' }
  if (/not empty/i.test(message)) return { code: 'ENOTEMPTY', message: 'La carpeta no está vacía' }
  if (/file exists|already exists/i.test(message))
    return { code: 'EEXIST', message: 'Ya existe un archivo con ese nombre' }
  return { code: 'IO_FAILED', message: message || 'La operación falló en el servidor' }
}

export const scpFailure = (text: string) => new SftpFailure(mapScpMessage(text))
