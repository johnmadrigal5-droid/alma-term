import { createHmac } from 'node:crypto'
import type { KnownHostEntry } from '@alma/protocol'
import { describe, expect, it } from 'vitest'
import {
  fingerprintSha256,
  knownKeyTypes,
  matchesHost,
  parseKnownHosts,
  verifyHostKey,
} from './known-hosts'

const KEY_A = 'AAAAC3NzaC1lZDI1NTE5AAAAIJiGiuoA8zoanDABZkLqhD8Ybmq/A9fKjDH33M1OSry0'
const FP_A = 'SHA256:GlTO0lQ5F7b2JYx83c+cZhdAMSOusuN3u9ivvULipU8'
const KEY_B = 'AAAAC3NzaC1lZDI1NTE5AAAAIPd6RFHJS9RwY1R0tekQisQTozxfDfQpzRRqIHigsMkc'
const FP_B = 'SHA256:xqjg91mCqRhJ6dNLUGBSJz/3ECCOKwcsS+twNF+2yv8'
const blob = (b64: string) => Buffer.from(b64, 'base64')

function hashedLine(name: string, key: string): string {
  const salt = Buffer.from('0123456789abcdef0123')
  const hash = createHmac('sha1', salt).update(name).digest()
  return `|1|${salt.toString('base64')}|${hash.toString('base64')} ssh-ed25519 ${key}`
}

describe('fingerprintSha256', () => {
  it('matches ssh-keygen -l output', () => {
    expect(fingerprintSha256(blob(KEY_A))).toBe(FP_A)
  })
})

describe('parseKnownHosts', () => {
  it('skips comments, blank lines and warns about markers', () => {
    const { entries, warnings } = parseKnownHosts(
      `# comment\n\nsrv ssh-ed25519 ${KEY_A}\n@revoked bad ssh-ed25519 ${KEY_B}\n`,
    )
    expect(entries).toHaveLength(1)
    expect(warnings).toHaveLength(1)
  })
})

describe('matchesHost', () => {
  const [plain, list, ported, hashed, hashedPort] = parseKnownHosts(
    [
      `srv ssh-ed25519 ${KEY_A}`,
      `a.example,b.example ssh-ed25519 ${KEY_A}`,
      `[srv]:2222 ssh-ed25519 ${KEY_A}`,
      hashedLine('hidden', KEY_A),
      hashedLine('[hidden]:2200', KEY_A),
    ].join('\n'),
  ).entries
  it('matches plain names only on port 22', () => {
    expect(plain && matchesHost(plain, 'srv', 22)).toBe(true)
    expect(plain && matchesHost(plain, 'srv', 2222)).toBe(false)
  })
  it('matches comma lists', () => {
    expect(list && matchesHost(list, 'b.example', 22)).toBe(true)
  })
  it('matches [host]:port', () => {
    expect(ported && matchesHost(ported, 'srv', 2222)).toBe(true)
  })
  it('matches hashed entries', () => {
    expect(hashed && matchesHost(hashed, 'hidden', 22)).toBe(true)
    expect(hashed && matchesHost(hashed, 'other', 22)).toBe(false)
    expect(hashedPort && matchesHost(hashedPort, 'hidden', 2200)).toBe(true)
  })
})

describe('verifyHostKey', () => {
  const appEntry = (key: string, fp: string): KnownHostEntry => ({
    host: 'srv',
    port: 22,
    keyType: 'ssh-ed25519',
    fingerprint: fp,
    publicKey: key,
  })
  const file = parseKnownHosts(`srv ssh-ed25519 ${KEY_A}`).entries

  it('returns new when nothing is known', () => {
    expect(verifyHostKey({ app: [], file: [] }, 'srv', 22, 'ssh-ed25519', blob(KEY_A))).toEqual({
      status: 'new',
    })
  })
  it('trusts a key found in the user file', () => {
    expect(verifyHostKey({ app: [], file }, 'srv', 22, 'ssh-ed25519', blob(KEY_A)).status).toBe(
      'trusted',
    )
  })
  it('reports a changed key with the known fingerprint', () => {
    expect(verifyHostKey({ app: [], file }, 'srv', 22, 'ssh-ed25519', blob(KEY_B))).toEqual({
      status: 'changed',
      knownFingerprint: FP_A,
    })
  })
  it('lets the app store win over a stale user file', () => {
    const app = [appEntry(KEY_B, FP_B)]
    expect(verifyHostKey({ app, file }, 'srv', 22, 'ssh-ed25519', blob(KEY_B)).status).toBe(
      'trusted',
    )
  })
  it('reports changed against the app store', () => {
    const app = [appEntry(KEY_B, FP_B)]
    expect(verifyHostKey({ app, file }, 'srv', 22, 'ssh-ed25519', blob(KEY_A))).toEqual({
      status: 'changed',
      knownFingerprint: FP_B,
    })
  })
})

describe('knownKeyTypes', () => {
  it('lists app types first, then file types, without duplicates', () => {
    const app = [
      { host: 'h', port: 22, keyType: 'ssh-ed25519', fingerprint: 'x', publicKey: 'AAAA' },
      {
        host: 'other',
        port: 22,
        keyType: 'ecdsa-sha2-nistp256',
        fingerprint: 'x',
        publicKey: 'AAAA',
      },
    ]
    const file = parseKnownHosts(
      'h ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQ==\nh ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIA==\n',
    ).entries
    expect(knownKeyTypes('h', 22, app, file)).toEqual(['ssh-ed25519', 'ssh-rsa'])
  })
  it('is empty for an unknown host', () => {
    expect(knownKeyTypes('h', 22, [], [])).toEqual([])
  })
})
