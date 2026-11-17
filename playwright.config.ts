/**
 * @see {@link https://playwright.dev/docs/chrome-extensions Chrome extensions | Playwright}
 */
import process from 'node:process'
import { defineConfig } from '@playwright/test'

export default defineConfig({
  failOnFlakyTests: Boolean(process.env.CI),
  testDir: './e2e',
  testIgnore: ['**/*.live.spec.ts', '**/userscript/**'],
  outputDir: process.env.ONEWEB_TEST_OUTPUT_DIR || 'test-results',
  retries: 1,
  workers: 1,
  timeout: 60_000,
  use: {
    trace: 'retain-on-failure',
  },
})
