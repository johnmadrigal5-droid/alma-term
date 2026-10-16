import { readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import type { ImportCandidate, ImportPreview, SavedSession } from '@alma/protocol'
import SSHConfig, { LineType, type Line } from 'ssh-config'

const MAX_INCLUDE_DEPTH = 16
const MAX_EXPANDED_BYTES = 1024 * 1024
const UNSUPPORTED = ['ProxyJump', 'ProxyCommand']

type Read = (path: string) => string | null
type List = (dir: string) => string[]

/** Reads a config file; null for anything unreadable (missing, directory, no permission). */
export function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/** Lists a directory; empty for anything that is not a readable directory. */
export function listDir(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

const isPattern = (alias: string) => /[*?!]/.test(alias)

function expandTilde(path: string, home: string): string {
  if (path === '~') return home
  if (path.startsWith('~/')) return join(home, path.slice(2))
  return path
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`)
}

// Splits "a 'b c' d" the way ssh_config tokenises Include arguments.
function words(text: string): string[] {
  return [...text.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? '')
}

/**
 * Inlines `Include` directives, which the ssh-config library does not follow. Relative paths
 * resolve against ~/.ssh as OpenSSH does for the user config; cycles and depth are bounded.
 */
export function expandIncludes(
  file: string,
  read: Read,
  list: List,
  home: string,
): { text: string; warnings: string[] } {
  const warnings: string[] = []
  let budget = MAX_EXPANDED_BYTES
  const visit = (path: string, stack: string[]): string => {
    const absolute = resolve(path)
    if (stack.includes(absolute)) {
      warnings.push(`Include en ciclo ignorado: ${path}`)
      return ''
    }
    if (stack.length >= MAX_INCLUDE_DEPTH) {
      warnings.push(`Include demasiado anidado ignorado: ${path}`)
      return ''
    }
    const text = read(absolute)
    if (text === null) {
      warnings.push(`No se pudo leer el archivo incluido ${path}`)
      return ''
    }
    if (text.length > budget) {
      if (budget >= 0) warnings.push(`La configuración supera 1 MiB; se ignora desde ${path}`)
      budget = -1
      return ''
    }
    budget -= text.length
    return text
      .split(/\r?\n/)
      .map((line) => {
        const include = /^\s*Include(?:\s*=\s*|\s+)(.+)$/i.exec(line)
        if (!include?.[1]) return line
        return words(include[1].replace(/\s+#.*$/, ''))
          .flatMap((arg) => {
            const expanded = expandTilde(arg, home)
            const target = isAbsolute(expanded) ? expanded : join(home, '.ssh', expanded)
            if (!/[*?]/.test(basename(target))) return [target]
            const matcher = globToRegExp(basename(target))
            return list(dirname(target))
              .filter((name) => matcher.test(name))
              .sort()
              .map((name) => join(dirname(target), name))
          })
          .map((target) => visit(target, [...stack, absolute]))
          .join('\n')
      })
      .join('\n')
  }
  return { text: visit(file, []), warnings }
}

function aliasesOf(line: Line): string[] {
  if (line.type !== LineType.DIRECTIVE || line.param.toLowerCase() !== 'host') return []
  return typeof line.value === 'string' ? words(line.value) : line.value.map((v) => v.val)
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

function expandTokens(
  value: string,
  tokens: { h: string; u: string; r: string },
  home: string,
): string {
  const replaced = value.replace(/%([%hur])/g, (_, t: string) =>
    t === '%' ? '%' : tokens[t as 'h' | 'u' | 'r'],
  )
  return expandTilde(replaced, home)
}

export interface ImportOptions {
  home: string
  localUser: string
  existing: readonly SavedSession[]
}

export function buildImport(
  text: string,
  { home, localUser, existing }: ImportOptions,
): { candidates: ImportCandidate[]; warnings: string[] } {
  const config = SSHConfig.parse(text)
  const warnings: string[] = []
  if (config.some((l) => l.type === LineType.DIRECTIVE && l.param.toLowerCase() === 'match'))
    warnings.push('Los bloques Match no se evalúan: la importación nunca ejecuta comandos')
  const aliases = [...new Set(config.flatMap(aliasesOf).filter((a) => !isPattern(a)))]
  const candidates = aliases.map((alias): ImportCandidate => {
    // matchExec: false — `Match exec` would run arbitrary commands from the file.
    const computed = config.compute(alias, { matchExec: false })
    const host = first(computed['HostName']) ?? alias
    const username = first(computed['User']) ?? localUser
    const rawPort = Number(first(computed['Port']) ?? 22)
    const hostWarnings: string[] = []
    const port = Number.isInteger(rawPort) && rawPort >= 1 && rawPort <= 65535 ? rawPort : 22
    if (port !== rawPort) hostWarnings.push(`Puerto inválido, se usa 22`)
    for (const key of UNSUPPORTED)
      if (computed[key] !== undefined) hostWarnings.push(`${key} no está soportado y se ignora`)
    const identity = first(computed['IdentityFile'])
    // `IdentityFile none` disables keys in OpenSSH.
    const keyPath =
      identity && identity.toLowerCase() !== 'none'
        ? expandTokens(identity, { h: host, u: localUser, r: username }, home)
        : null
    return {
      alias,
      target: { host, port, username },
      keyPath,
      warnings: hostWarnings,
      duplicate: existing.some(
        (s) => s.host === host && s.port === port && s.username === username,
      ),
    }
  })
  return { candidates, warnings }
}

export function previewImport(deps: ImportOptions & { read: Read; list: List }): ImportPreview {
  const file = join(deps.home, '.ssh', 'config')
  if (deps.read(file) === null)
    return { file: '~/.ssh/config', candidates: [], warnings: ['No se encontró ~/.ssh/config'] }
  const included = expandIncludes(file, deps.read, deps.list, deps.home)
  const built = buildImport(included.text, deps)
  return {
    file: '~/.ssh/config',
    candidates: built.candidates,
    warnings: [...included.warnings, ...built.warnings],
  }
}
