import { defineConfig } from 'vitest/config'
import { aliases } from './aliases'

export default defineConfig({
  resolve: { alias: aliases },
  test: { environment: 'node', include: ['src/**/*.native.test.ts'], testTimeout: 15_000 },
})
