import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import { aliases } from './aliases'
import { buildCsp } from './src/main/csp'

const root = import.meta.dirname

export default defineConfig({
  main: {
    resolve: { alias: aliases },
    build: {
      rollupOptions: {
        input: {
          index: resolve(root, 'src/main/index.ts'),
          host: resolve(root, 'src/host/main.ts'),
        },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(root, 'src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    resolve: { alias: aliases },
    build: { assetsInlineLimit: 0 },
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'alma-csp',
        transformIndexHtml: {
          order: 'pre',
          handler: (html, ctx) => html.replace('%ALMA_CSP%', buildCsp(Boolean(ctx.server))),
        },
      },
    ],
  },
})
