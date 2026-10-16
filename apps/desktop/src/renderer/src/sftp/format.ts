const UNITS = ['KB', 'MB', 'GB', 'TB'] as const

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(1)} ${UNITS[unit]}`
}

/** SCP lists names only: such entries carry zeros and are shown with a dash instead. */
export function isUnknownMeta(entry: { size: number; mtimeMs: number }): boolean {
  return entry.size === 0 && entry.mtimeMs === 0
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}

export function formatMode(mode: number): string {
  return [6, 3, 0]
    .map((shift) => {
      const bits = (mode >> shift) & 7
      return `${bits & 4 ? 'r' : '-'}${bits & 2 ? 'w' : '-'}${bits & 1 ? 'x' : '-'}`
    })
    .join('')
}

/** Octal permissions as typed by the user ("644", "0755"); null when invalid. */
export function parseMode(text: string): number | null {
  const trimmed = text.trim()
  return /^[0-7]{3,4}$/.test(trimmed) ? Number.parseInt(trimmed, 8) : null
}

/** Server names are shown as they are; only control characters become visible symbols. */
export function displayName(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\u0000-\u001f]/g, (c) => String.fromCharCode(0x2400 + c.charCodeAt(0)))
}

/** A remote name usable as a local file name; Windows forbids more characters than POSIX. */
export function isLocalName(name: string, platform: string): boolean {
  if (name === '' || name === '.' || name === '..' || name.includes('/') || name.includes('\0'))
    return false
  // eslint-disable-next-line no-control-regex
  return platform !== 'win32' || !/[\\:*?"<>|\u0000-\u001f]/.test(name)
}

export function joinLocal(folder: string, name: string, platform: string): string {
  const sep = platform === 'win32' ? '\\' : '/'
  return folder.endsWith(sep) ? `${folder}${name}` : `${folder}${sep}${name}`
}

/** Last component of a local path on any platform. */
export function localBasename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}
