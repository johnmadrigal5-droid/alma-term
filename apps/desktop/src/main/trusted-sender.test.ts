import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isTrustedSender } from './trusted-sender'

const rendererFile = '/opt/alma/out/renderer/index.html'
const prod = { devServerUrl: undefined, rendererFile }
const dev = { devServerUrl: 'http://localhost:5173', rendererFile }

describe('isTrustedSender', () => {
  it('accepts the packaged renderer file, ignoring hash and query', () => {
    expect(isTrustedSender(`${pathToFileURL(rendererFile).href}#/x?y=1`, prod)).toBe(true)
  })
  it('rejects other files in production', () => {
    expect(isTrustedSender(pathToFileURL('/tmp/evil.html').href, prod)).toBe(false)
  })
  it('accepts only the dev server origin in dev', () => {
    expect(isTrustedSender('http://localhost:5173/index.html', dev)).toBe(true)
    expect(isTrustedSender('http://localhost:9999/', dev)).toBe(false)
  })
  it('rejects missing and malformed urls', () => {
    expect(isTrustedSender(undefined, prod)).toBe(false)
    expect(isTrustedSender('not a url', prod)).toBe(false)
  })
})
