import { chromium } from 'playwright-core';
import { loadEnvFile } from 'node:process';

try {
  loadEnvFile('.env.local');
} catch {
  // CI should provide the same variables directly.
}

export const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3001';
export const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export async function launchBrowser() {
  return chromium.launch({ executablePath: CHROME, headless: true });
}

export async function login(page) {
  const email = process.env.E2E_OWNER_EMAIL ?? process.env.OWNER_EMAIL;
  const password = process.env.E2E_OWNER_PASSWORD ?? process.env.OWNER_PASSWORD;
  if (!email || !password) throw new Error('Owner test credentials are not configured');
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(`${BASE}/`, { timeout: 20_000 });
  await page.locator('.route-loading').waitFor({ state: 'detached' }).catch(() => {});
}

export function trackErrors(page, label = '') {
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${label} console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`${label} page: ${error.message}`));
  return errors;
}
