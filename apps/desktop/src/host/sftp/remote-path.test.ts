import { describe, expect, it } from 'vitest'
import { joinRemote, normalizeRemote, parentOf } from './remote-path'

describe('remote paths', () => {
  it('joins a name to a directory', () => {
    expect(joinRemote('/a', 'b')).toBe('/a/b')
    expect(joinRemote('/', 'b')).toBe('/b')
    expect(joinRemote('/a/', 'mi archivo #1.txt')).toBe('/a/mi archivo #1.txt')
  })

  it('refuses names that would leave the directory or are not a single component', () => {
    for (const name of ['', '.', '..', 'a/b', 'a\0b'])
      expect(() => joinRemote('/a', name)).toThrow()
  })

  it('finds the parent and stops at the root', () => {
    expect(parentOf('/a/b')).toBe('/a')
    expect(parentOf('/a')).toBe('/')
    expect(parentOf('/')).toBe('/')
  })

  it('collapses repeated slashes and dots', () => {
    expect(normalizeRemote('//a/./b//')).toBe('/a/b')
    expect(normalizeRemote('')).toBe('/')
  })
})
