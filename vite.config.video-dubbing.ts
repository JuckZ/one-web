import { defineConfig } from 'vite'
import packageJson from './package.json'
import { e, isDev, isFirefox, r } from './scripts/utils'
import { sharedConfig } from './vite.config'

export default defineConfig({
  ...sharedConfig,
  define: {
    ...sharedConfig.define,
    '__DEV__': isDev,
    '__FIREFOX__': isFirefox,
    '__NAME__': JSON.stringify(packageJson.name),
    'process.env.NODE_ENV': JSON.stringify(isDev ? 'development' : 'production'),
  },
  build: {
    watch: isDev ? {} : undefined,
    outDir: e('dist/videoDubbing'),
    cssCodeSplit: false,
    emptyOutDir: false,
    sourcemap: isDev ? 'inline' : false,
    lib: {
      entry: r('src/videoDubbingContent/index.ts'),
      name: 'onewebVideoDubbing',
      formats: ['iife'],
    },
    rollupOptions: {
      output: {
        entryFileNames: 'index.global.js',
        extend: true,
      },
    },
  },
})
