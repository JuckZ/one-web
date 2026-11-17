import { defineConfig } from '@playwright/test'
import baseConfig from './playwright.config'

// Explicitly invoked only: normal CI ignores *.live.spec.ts and never resolves live credentials.
export default defineConfig({
  ...baseConfig,
  testDir: './e2e/live',
  testMatch: '**/*.live.spec.ts',
  testIgnore: [],
  outputDir: 'artifacts/test-results/live-magpie',
  retries: 0,
  workers: 1,
  reporter: [['line'], ['json', { outputFile: 'artifacts/test-results/live-magpie/report.json' }]],
  timeout: 180000,
  use: { ...baseConfig.use, trace: 'off', screenshot: 'off', video: 'off' },
})
