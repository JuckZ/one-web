import { defineConfig } from 'vite'
import { e, isDev, r } from './scripts/utils'

export default defineConfig({
  build: {
    watch: isDev ? {} : undefined,
    outDir: e('dist/network'),
    emptyOutDir: false,
    sourcemap: isDev ? 'inline' : false,
    rollupOptions: {
      input: {
        support: r('src/networkContent/support.ts'),
        devices: r('src/networkContent/devices.ts'),
        additional: r('src/networkContent/additional.ts'),
      },
      output: { entryFileNames: '[name].js' },
    },
  },
})
