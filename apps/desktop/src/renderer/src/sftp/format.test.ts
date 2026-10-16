// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { displayName, isUnknownMeta, formatMode, formatSize, joinLocal, parseMode } from './format'

describe('formatSize', () => {
  it('uses B, KB, MB and GB with one decimal above bytes', () => {
    expect(formatSize(0)).toBe('0 B')
    expect(formatSize(1023)).toBe('1023 B')
    expect(formatSize(1536)).toBe('1.5 KB')
    expect(formatSize(5 * 1024 ** 2)).toBe('5.0 MB')
    expect(formatSize(5 * 1024 ** 3)).toBe('5.0 GB')
  })
})

describe('permissions', () => {
  it('shows rwx triplets and parses octal input', () => {
    expect(formatMode(0o755)).toBe('rwxr-xr-x')
    expect(formatMode(0o640)).toBe('rw-r-----')
    expect(parseMode('644')).toBe(0o644)
    expect(parseMode('0755')).toBe(0o755)
    expect(parseMode('9')).toBeNull()
    expect(parseMode('77777')).toBeNull()
  })
})

describe('displayName', () => {
  it('keeps the name literal and makes control characters visible', () => {
    expect(displayName('mi archivo é #1')).toBe('mi archivo é #1')
    expect(displayName('a\nb')).toBe('a\u240Ab')
  })
})

describe('joinLocal', () => {
  it('joins with the separator of the platform', () => {
    expect(joinLocal('/home/yo', 'a.txt', 'linux')).toBe('/home/yo/a.txt')
    expect(joinLocal('/home/yo/', 'a.txt', 'linux')).toBe('/home/yo/a.txt')
    expect(joinLocal('C:\\Users\\yo', 'a.txt', 'win32')).toBe('C:\\Users\\yo\\a.txt')
  })
})

describe('isUnknownMeta', () => {
  it('treats an entry with no size and no date as one the server gave no details for', () => {
    expect(isUnknownMeta({ size: 0, mtimeMs: 0 })).toBe(true)
    expect(isUnknownMeta({ size: 10, mtimeMs: 0 })).toBe(false)
    expect(isUnknownMeta({ size: 0, mtimeMs: 1_700_000_000_000 })).toBe(false)
  })
})
