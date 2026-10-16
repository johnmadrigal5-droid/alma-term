import { posix } from 'node:path'

/** Joins one name received from the server or typed by the user; never climbs out of `dir`. */
export function isEntryName(name: string): boolean {
  return name !== '' && name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\0')
}

export function joinRemote(dir: string, name: string): string {
  if (!isEntryName(name)) throw new Error(`Nombre de archivo no válido: ${JSON.stringify(name)}`)
  return posix.join(normalizeRemote(dir), name)
}

export function parentOf(path: string): string {
  return posix.dirname(normalizeRemote(path))
}

export function normalizeRemote(path: string): string {
  const normalized = posix.normalize(`/${path}`)
  return normalized.length > 1 ? normalized.replace(/\/+$/, '') : '/'
}
