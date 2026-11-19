import { fileURLToPath } from 'node:url'
import React from '@vitejs/plugin-react'
import { coverageConfigDefaults, defineConfig } from 'vitest/config'

const r = (value: string) => fileURLToPath(new URL(value, import.meta.url))
export default defineConfig({
  root: r('./src'),
  plugins: [React()],
  resolve: {
    alias: [
      { find: '@oneweb/module-sdk/capability-client', replacement: r('./packages/module-sdk/src/capability-client.ts') },
      { find: '@oneweb/module-sdk/capability-rpc', replacement: r('./packages/module-sdk/src/capability-rpc.ts') },
      { find: '@oneweb/module-sdk/storage-module', replacement: r('./packages/module-sdk/src/storage-module.ts') },
      { find: '@oneweb/module-sdk/runtime', replacement: r('./packages/module-sdk/src/runtime-client.ts') },
      { find: '@oneweb/module-sdk', replacement: r('./packages/module-sdk/src/index.ts') },
      { find: '~', replacement: r('./src') },
    ],
  },
  define: { __DEV__: false, __FIREFOX__: false, __NAME__: JSON.stringify('one-web') },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['**/*.{test,spec}.{ts,tsx,js,jsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: '../coverage',
      exclude: [...coverageConfigDefaults.exclude, '**/main.ts', '**/*.d.ts', 'manifest.ts', 'entrypoints/**'],
      thresholds: { lines: 4, functions: 30, branches: 40, statements: 4 },
    },
  },
})
