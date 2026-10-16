// Only the current user's home: `~user` would need a passwd lookup and stays as typed.
export function expandHome(path: string, home: string): string {
  if (path === '~') return home
  if (path.startsWith('~/') || path.startsWith('~\\')) return home + path.slice(1)
  return path
}
