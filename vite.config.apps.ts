import { defineConfig } from 'vite'
import { e, isDev, r } from './scripts/utils'
import { sharedConfig } from './vite.config'

// Opaque Firefox sandbox documents reject extension ES module imports. Keep the complete
// rendering-only loader in one classic script, without relaxing privileged page CSP.
export default defineConfig({
  ...sharedConfig,
  build: {
    watch: isDev ? {} : undefined,
    outDir: e('dist/apps'),
    emptyOutDir: false,
    sourcemap: isDev ? 'inline' : false,
    lib: { entry: r('src/apps/sandbox.ts'), name: 'onewebAppSandbox', formats: ['iife'] },
    rollupOptions: { output: { entryFileNames: 'sandbox.js', inlineDynamicImports: true } },
  },
})
