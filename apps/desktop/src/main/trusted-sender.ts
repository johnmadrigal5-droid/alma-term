import { pathToFileURL } from 'node:url'

export interface TrustOptions {
  devServerUrl: string | undefined
  rendererFile: string
}

export function isTrustedSender(frameUrl: string | undefined, options: TrustOptions): boolean {
  if (!frameUrl) return false
  let url: URL
  try {
    url = new URL(frameUrl)
  } catch {
    return false
  }
  if (options.devServerUrl) return url.origin === new URL(options.devServerUrl).origin
  url.hash = ''
  url.search = ''
  return url.href === pathToFileURL(options.rendererFile).href
}
