// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { remoteBasename } from './remote'

describe('remote paths', () => {
  it('takes the last component of a remote path', () => {
    expect(remoteBasename('/a/b.txt')).toBe('b.txt')
    expect(remoteBasename('/b.txt')).toBe('b.txt')
  })
})
