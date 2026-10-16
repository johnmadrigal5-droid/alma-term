import { fileURLToPath } from 'node:url'

export const aliases = {
  '@alma/protocol': fileURLToPath(new URL('../../packages/protocol/src/index.ts', import.meta.url)),
}
