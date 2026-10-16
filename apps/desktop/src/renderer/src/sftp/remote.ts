/** POSIX remote paths in the renderer (no node:path here). */
export function joinRemote(dir: string, name: string): string {
  return `${dir.replace(/\/+$/, '')}/${name}`
}

export const remoteBasename = (path: string) => path.slice(path.lastIndexOf('/') + 1)

export function parentRemote(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const index = trimmed.lastIndexOf('/')
  return index <= 0 ? '/' : trimmed.slice(0, index)
}

/** Breadcrumb segments: [{ name: '/', path: '/' }, { name: 'home', path: '/home' }, …]. */
export function crumbs(path: string): { name: string; path: string }[] {
  const parts = path.split('/').filter(Boolean)
  return [
    { name: '/', path: '/' },
    ...parts.map((name, i) => ({ name, path: `/${parts.slice(0, i + 1).join('/')}` })),
  ]
}

/** A name typed by the user for a new folder or a rename; null when it is acceptable. */
export function invalidName(name: string): string | null {
  if (!name.trim()) return 'Indica un nombre'
  if (name === '.' || name === '..') return 'Ese nombre no está permitido'
  if (name.includes('/')) return 'El nombre no puede contener «/»'
  if (name.length > 255) return 'Máximo 255 caracteres'
  return null
}
