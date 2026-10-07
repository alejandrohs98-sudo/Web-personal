import { defineConfig, devices } from '@playwright/test';

// Las pruebas e2e nunca tocan la red real: la API de GitHub se simula con
// tests/fixtures/githubFalso.ts y cualquier otra petición externa se bloquea.
const base = process.env.BASE_PATH ?? '/Web-personal/';
const url = `http://localhost:4173${base}`;
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  retries: 0,
  use: {
    ...devices['iPhone 13'],
    browserName: 'chromium',
    defaultBrowserType: 'chromium',
    viewport: { width: 390, height: 844 },
    baseURL: url,
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: {
    command: 'npx vite build && npx vite preview --port 4173 --strictPort',
    url,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
