import axe from 'axe-core';
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

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 1024 } });
const errors = trackErrors(page);
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.addScriptTag({ content: axe.source });
let serious = 0;

const audit = async (label, selector = 'document') => {
  const result = await page.evaluate(async (targetSelector) => {
    const target = targetSelector === 'document' ? document : document.querySelector(targetSelector);
    if (!target) return null;
    return window.axe.run(target, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
      },
    });
  }, selector);
  if (!result) throw new Error(`Axe target not found: ${label}`);
  const issues = result.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    count: violation.nodes.length,
    targets: violation.nodes.slice(0, 3).map((node) => node.target.join(' ')),
  }));
  const blocking = issues.filter((issue) => issue.impact === 'serious' || issue.impact === 'critical');
  serious += blocking.length;
  console.log(`${label}: ${issues.length} rules, ${blocking.length} blocking`);
  if (issues.length) console.log(JSON.stringify(issues, null, 2));
};

await audit('login');
await login(page);

for (const [name, route] of routes) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
  await page.locator('.route-loading').waitFor({ state: 'detached' }).catch(() => {});
  await page.addScriptTag({ content: axe.source });
  await audit(name);
}

await page.goto(`${BASE}/pipeline`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'New lead' }).click();
await page.waitForTimeout(350);
await page.addScriptTag({ content: axe.source });
await audit('lead-dialog', '[role="dialog"]');
await page.keyboard.press('Escape');

await page.goto(`${BASE}/invoices/invoice-2/edit`, { waitUntil: 'networkidle' });
const paymentButton = page.getByRole('button', { name: 'Record payment' }).first();
if (await paymentButton.count()) {
  await paymentButton.click();
  await page.waitForTimeout(350);
  await page.addScriptTag({ content: axe.source });
  await audit('payment-dialog', '[role="dialog"]');
  await page.keyboard.press('Escape');
}

await browser.close();
console.log(`A11Y_BLOCKING_RULES=${serious}`);
if (errors.length) console.log(JSON.stringify(errors, null, 2));
if (serious > 0) process.exitCode = 1;
