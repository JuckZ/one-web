import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e/userscript',
  outputDir: 'artifacts/test-results/userscript',
  retries: 0,
  workers: 1,
  timeout: 30_000,
  use: { headless: true, trace: 'retain-on-failure' },
})
