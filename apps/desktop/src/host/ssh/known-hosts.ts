import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { KnownHostEntry } from '@alma/protocol'

export interface FileEntry {
  patterns: string[]
  hashed?: { salt: Buffer; hash: Buffer }
  keyType: string
  keyBlob: Buffer
}

export type HostKeyStatus =
  { status: 'trusted' | 'new' } | { status: 'changed'; knownFingerprint: string }

export function fingerprintSha256(keyBlob: Uint8Array): string {
  return `SHA256:${createHash('sha256').update(keyBlob).digest('base64').replace(/=+$/, '')}`
}

export function parseKnownHosts(text: string): { entries: FileEntry[]; warnings: string[] } {
  const entries: FileEntry[] = []
  const warnings: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('@')) {
      warnings.push(`Entrada no soportada en known_hosts ignorada: ${line.split(/\s+/)[0]}`)
      continue
    }
    const [hosts, keyType, key] = line.split(/\s+/)
    if (!hosts || !keyType || !key) continue
    const keyBlob = Buffer.from(key, 'base64')
    if (hosts.startsWith('|1|')) {
      const [, , salt, hash] = hosts.split('|')
      if (!salt || !hash) continue
      entries.push({
        patterns: [],
        hashed: { salt: Buffer.from(salt, 'base64'), hash: Buffer.from(hash, 'base64') },
        keyType,
        keyBlob,
      })
    } else {
      entries.push({ patterns: hosts.split(','), keyType, keyBlob })
    }
  }
  return { entries, warnings }
}

function hostName(host: string, port: number): string {
  return port === 22 ? host : `[${host}]:${port}`
}

export function matchesHost(entry: FileEntry, host: string, port: number): boolean {
  const name = hostName(host, port)
  if (entry.hashed) {
    const digest = createHmac('sha1', entry.hashed.salt).update(name).digest()
    return digest.length === entry.hashed.hash.length && timingSafeEqual(digest, entry.hashed.hash)
  }
  return entry.patterns.includes(name)
}

// The app store wins: when it knows this key type for the host, the user file is not consulted.
export function verifyHostKey(
  known: { app: readonly KnownHostEntry[]; file: readonly FileEntry[] },
  host: string,
  port: number,
  keyType: string,
  keyBlob: Uint8Array,
): HostKeyStatus {
  const offered = Buffer.from(keyBlob)
  const app = known.app.filter((e) => e.host === host && e.port === port && e.keyType === keyType)
  if (app.length > 0) {
    if (app.some((e) => Buffer.from(e.publicKey, 'base64').equals(offered)))
      return { status: 'trusted' }
    return { status: 'changed', knownFingerprint: app[0]?.fingerprint ?? '' }
  }
  const file = known.file.filter((e) => e.keyType === keyType && matchesHost(e, host, port))
  if (file.length > 0) {
    if (file.some((e) => e.keyBlob.equals(offered))) return { status: 'trusted' }
    const first = file[0]
    return { status: 'changed', knownFingerprint: first ? fingerprintSha256(first.keyBlob) : '' }
  }
  return { status: 'new' }
}

/** Key types already known for the host, app store first, as OpenSSH orders HostKeyAlgorithms. */
export function knownKeyTypes(
  host: string,
  port: number,
  app: readonly KnownHostEntry[],
  file: readonly FileEntry[],
): string[] {
  const types = [
    ...app.filter((e) => e.host === host && e.port === port).map((e) => e.keyType),
    ...file.filter((e) => matchesHost(e, host, port)).map((e) => e.keyType),
  ]
  return [...new Set(types)]
}
