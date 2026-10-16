import type { AlmaApi } from '@alma/protocol'

declare global {
  interface Window {
    api: AlmaApi
  }
}

export {}
