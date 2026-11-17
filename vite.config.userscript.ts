import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import packageJson from './package.json'
import { userscriptMetadata } from './scripts/userscript-metadata'

const metadata = userscriptMetadata(packageJson.version)
const license = readFileSync(new URL('./LICENSE', import.meta.url), 'utf8')

// Deliberately independent of the extension/Vue/browser auto-import configuration.
export default defineConfig({
  plugins: [{
    name: 'oneweb-userscript-metadata',
    enforce: 'post',
    generateBundle(_options, bundle) {
      this.emitFile({ type: 'asset', fileName: 'one-web.meta.js', source: metadata })
      for (const output of Object.values(bundle)) {
        if (output.type === 'chunk' && output.isEntry)
          output.code = `${metadata}/*\n${license}*/\n${output.code}`
      }
    },
  }],
  build: {
    outDir: fileURLToPath(new URL('./artifacts/build/userscript', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
    minify: false,
    sourcemap: false,
    lib: {
      entry: fileURLToPath(new URL('./src/userscript/main.ts', import.meta.url)),
      name: 'OneWebUserscript',
      formats: ['iife'],
      fileName: () => 'one-web.user.js',
    },
  },
})
