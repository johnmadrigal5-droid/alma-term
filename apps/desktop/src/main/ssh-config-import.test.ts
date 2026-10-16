import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SavedSession } from '@alma/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildImport, expandIncludes, listDir, previewImport, readText } from './ssh-config-import'

let home: string
const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : null)
const list = (d: string) => (existsSync(d) ? readdirSync(d) : [])
const write = (rel: string, text: string) => {
  const file = join(home, '.ssh', rel)
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, text)
  return file
}
const opts = (existing: SavedSession[] = []) => ({ home, localUser: 'yo', existing })

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'alma-sshcfg-'))
})
afterEach(() => rmSync(home, { recursive: true, force: true }))

describe('buildImport', () => {
  it('creates one candidate per alias of a Host line', () => {
    const { candidates } = buildImport('Host a b\n  HostName 10.0.0.1\n', opts())
    expect(candidates.map((c) => c.alias)).toEqual(['a', 'b'])
    expect(candidates[0]?.target).toEqual({ host: '10.0.0.1', port: 22, username: 'yo' })
  })

  it('skips wildcard hosts but inherits their values', () => {
    const { candidates } = buildImport(
      'Host *\n  User root\nHost *.corp\n  Port 2200\nHost web\n',
      opts(),
    )
    expect(candidates.map((c) => c.alias)).toEqual(['web'])
    expect(candidates[0]?.target).toEqual({ host: 'web', port: 22, username: 'root' })
  })

  it('respects Port and HostName', () => {
    const { candidates } = buildImport(
      'Host db\n  HostName db.internal\n  Port 2222\n  User pg\n',
      opts(),
    )
    expect(candidates[0]?.target).toEqual({ host: 'db.internal', port: 2222, username: 'pg' })
  })

  it('expands ~ and %h, %u, %r, %% in IdentityFile', () => {
    const { candidates } = buildImport(
      'Host srv\n  HostName srv.example\n  User admin\n  IdentityFile ~/.ssh/%h_%u_%r_100%%\n',
      opts(),
    )
    expect(candidates[0]?.keyPath).toBe(join(home, '.ssh/srv.example_yo_admin_100%'))
  })

  it('treats IdentityFile none as no key', () => {
    const { candidates } = buildImport('Host a\n  IdentityFile none\n', opts())
    expect(candidates[0]?.keyPath).toBeNull()
  })

  it('warns about ProxyJump on the host that uses it', () => {
    const { candidates } = buildImport('Host inner\n  ProxyJump bastion\nHost plain\n', opts())
    expect(candidates[0]?.warnings.join(' ')).toContain('ProxyJump')
    expect(candidates[1]?.warnings).toEqual([])
  })

  it('never runs Match exec and warns about Match blocks', () => {
    const marker = join(home, 'ran')
    const { candidates, warnings } = buildImport(
      `Host web\nMatch exec "touch ${marker}"\n  User hacked\n`,
      opts(),
    )
    expect(existsSync(marker)).toBe(false)
    expect(candidates[0]?.target.username).toBe('yo')
    expect(warnings.join(' ')).toContain('Match')
  })

  it('marks candidates that already exist as saved sessions', () => {
    const existing: SavedSession = {
      id: '7d3c7c86-5f43-4a43-9a43-2b0a0c0f2e11',
      folderId: null,
      name: 'old',
      host: 'h',
      port: 22,
      username: 'yo',
      auth: 'password',
      keyPath: null,
      hasPassword: false,
      hasPassphrase: false,
    }
    const { candidates } = buildImport('Host h\nHost other\n', opts([existing]))
    expect(candidates.map((c) => c.duplicate)).toEqual([true, false])
  })
})

describe('expandIncludes', () => {
  it('inlines matching files of a relative glob in alphabetical order', () => {
    write('conf.d/b.conf', 'Host b\n')
    write('conf.d/a.conf', 'Host a\n')
    write('conf.d/skip.txt', 'Host nope\n')
    const config = write('config', 'Include conf.d/*.conf\nHost c\n')
    const { text, warnings } = expandIncludes(config, read, list, home)
    expect(buildImport(text, opts()).candidates.map((c) => c.alias)).toEqual(['a', 'b', 'c'])
    expect(warnings).toEqual([])
  })

  it('stops on an include cycle and warns', () => {
    const config = write('config', 'Host a\nInclude config\n')
    const { text, warnings } = expandIncludes(config, read, list, home)
    expect(buildImport(text, opts()).candidates.map((c) => c.alias)).toEqual(['a'])
    expect(warnings.join(' ')).toContain('ciclo')
  })

  it('accepts Include=path and a trailing comment', () => {
    write('one', 'Host one\n')
    write('two', 'Host two\n')
    const config = write('config', 'Include=one\nInclude two # extra\n')
    const { text, warnings } = expandIncludes(config, read, list, home)
    expect(buildImport(text, opts()).candidates.map((c) => c.alias)).toEqual(['one', 'two'])
    expect(warnings).toEqual([])
  })

  it('stops expanding past 1 MiB of text and warns', () => {
    write('big', `Host big\n${'# relleno\n'.repeat(60_000)}`)
    // Siblings are not a cycle: three copies of ~600 KB exceed the limit.
    const config = write('config', 'Include big big big\nHost after\n')
    const { text, warnings } = expandIncludes(config, read, list, home)
    expect(text.length).toBeLessThanOrEqual(1024 * 1024)
    expect(warnings.join(' ')).toContain('1 MiB')
  })

  it('warns about a missing included file', () => {
    const config = write('config', 'Include ~/.ssh/nope.conf\nHost a\n')
    const { warnings } = expandIncludes(config, read, list, home)
    expect(warnings.join(' ')).toContain('nope.conf')
  })
})

describe('previewImport', () => {
  it('warns when ~/.ssh/config does not exist', () => {
    const preview = previewImport({ home, localUser: 'yo', existing: [], read, list })
    expect(preview.candidates).toEqual([])
    expect(preview.warnings).toEqual(['No se encontró ~/.ssh/config'])
  })

  it('reads ~/.ssh/config with its includes', () => {
    write('extra', 'Host extra\n')
    write('config', 'Include extra\nHost main\n')
    const preview = previewImport({ home, localUser: 'yo', existing: [], read, list })
    expect(preview.candidates.map((c) => c.alias)).toEqual(['extra', 'main'])
  })
})

describe('real file system readers', () => {
  it('warn instead of throwing for an Include of a directory or an unreadable file', () => {
    write('conf.d/a.conf', 'Host a\n')
    const locked = write('locked', 'Host secreto\n')
    chmodSync(locked, 0o000)
    write('config', 'Include conf.d\nInclude locked\nInclude config/*\nHost main\n')
    const preview = previewImport({
      home,
      localUser: 'yo',
      existing: [],
      read: readText,
      list: listDir,
    })
    expect(preview.candidates.map((c) => c.alias)).toEqual(['main'])
    expect(preview.warnings.join(' ')).toContain('conf.d')
    expect(preview.warnings.join(' ')).toContain('locked')
  })
})
