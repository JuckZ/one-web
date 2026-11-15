import { defineConfig } from 'vite'
import { e, isDev, r } from './scripts/utils'
import { sharedConfig } from './vite.config'

export default defineConfig({
  ...sharedConfig,
  build: {
    watch: isDev ? {} : undefined,
    outDir: e('dist/assistantContent'),
    emptyOutDir: false,
    sourcemap: isDev ? 'inline' : false,
    lib: { entry: r('src/assistantContent/index.ts'), name: 'onewebAssistant', formats: ['iife'] },
    rollupOptions: { output: { entryFileNames: 'index.global.js', extend: true } },
  },
})
