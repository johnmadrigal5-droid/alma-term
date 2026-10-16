import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { aliases } from './aliases'

export default defineConfig({
  resolve: { alias: aliases },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/main/**/*.test.ts', 'src/host/**/*.test.ts'],
          exclude: ['**/*.native.test.ts'],
        },
      },
      {
        extends: true,
        plugins: [react()],
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['src/renderer/src/**/*.test.{ts,tsx}'],
          setupFiles: ['src/renderer/src/test-setup.ts'],
        },
      },
    ],
  },
})
