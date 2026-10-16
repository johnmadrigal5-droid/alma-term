import { describe, expect, it } from 'vitest'
import { expandHome } from './expand-path'

describe('expandHome', () => {
  it('expands ~/ to the home directory', () => {
    expect(expandHome('~/.ssh/id', '/h')).toBe('/h/.ssh/id')
  })
  it('expands a bare ~', () => {
    expect(expandHome('~', '/h')).toBe('/h')
  })
  it('leaves absolute paths alone', () => {
    expect(expandHome('/abs/key', '/h')).toBe('/abs/key')
  })
  it('leaves ~user alone', () => {
    expect(expandHome('~otro/x', '/h')).toBe('~otro/x')
  })
  it('expands ~\\ on Windows-style paths', () => {
    expect(expandHome('~\\.ssh\\id', 'C:\\Users\\a')).toBe('C:\\Users\\a\\.ssh\\id')
  })
})
