import { mkdir } from 'node:fs/promises';
import { BASE, launchBrowser, login, trackErrors } from './lib/browser.mjs';

const routes = [
  ['overview', '/'],
  ['ai', '/ai'],
  ['ai-replies', '/ai/replies'],
  ['ai-contact', '/ai/contacts/lead-1'],
  ['pipeline', '/pipeline'],
  ['inbox', '/inbox'],
  ['lead-detail', '/leads/lead-1'],
  ['clients', '/clients'],
  ['client-detail', '/clients/client-1'],
  ['proposals', '/proposals'],
  ['proposal-editor', '/proposals/proposal-4/edit'],
  ['invoices', '/invoices'],
  ['invoice-editor', '/invoices/invoice-1/edit'],
  ['finance', '/finance'],
  ['calendar', '/calendar'],
  ['integrations', '/settings/integrations'],
  ['templates', '/settings/templates'],
  ['ai-settings', '/settings/ai'],
];
const viewports = [
  ['1440', 1440, 1024],
  ['1280', 1280, 800],
  ['768', 768, 1024],
  ['390', 390, 844],
];

await mkdir('screenshots', { recursive: true });
const browser = await launchBrowser();
const errors = [];

for (const [size, width, height] of viewports) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  errors.push(...trackErrors(page, size));
  await login(page);
  await page.screenshot({
    path: `screenshots/overview-${size}.png`,
    fullPage: true,
    animations: 'disabled',
  });

  for (const [name, route] of routes) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
    await page.locator('.route-loading').waitFor({ state: 'detached' }).catch(() => {});
    await page.screenshot({
      path: `screenshots/${name}-${size}.png`,
      fullPage: true,
      animations: 'disabled',
    });
    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    const overflow = metrics.scrollWidth - metrics.clientWidth;
    if (overflow > 0) throw new Error(`${size}-${name}: page overflow ${overflow}px`);
  }

  if (size === '390') {
    await page.goto(`${BASE}/pipeline`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'New lead' }).click();
    await page.waitForTimeout(350);
    await page.screenshot({
      path: 'screenshots/new-lead-modal-390.png',
      fullPage: false,
      animations: 'disabled',
    });
    await page.keyboard.press('Escape');

    await page.goto(`${BASE}/inbox`, { waitUntil: 'networkidle' });
    await page.locator('.conversation-item').first().click();
    await page.screenshot({
      path: 'screenshots/inbox-thread-390.png',
      fullPage: true,
      animations: 'disabled',
    });
  }

  console.log(`${size}px viewport checked`);
  await context.close();
}

await browser.close();
if (errors.length) {
  console.log(JSON.stringify(errors, null, 2));
  process.exitCode = 1;
}
console.log('Visual route capture and overflow checks complete.');
