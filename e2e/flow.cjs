// End-to-end browser flow against a running server (:8787) and web dev server (:5173).
// Uses the Playwright that ships with the environment. Usage: node e2e/flow.cjs [outDir]
const { chromium } = require('playwright');
const out = process.argv[2] ?? '.';
const base = process.env.WEB ?? 'http://127.0.0.1:5173';
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/401 \(Unauthorized\)/.test(m.text())) errors.push('console: ' + m.text()); });  // 401s are the expected anonymous /api/me probe
  const user = 'e2e' + Date.now() % 100000;
  await page.goto(base + '/'); await page.screenshot({ path: out + '/01-landing.png' });
  await page.goto(base + '/login?register=1');
  await page.fill('input[autocomplete=username]', user); await page.fill('input[type=password]', 'password123'); await page.click('button[type=submit]');
  await page.waitForURL('**/app'); await page.screenshot({ path: out + '/02-dashboard.png' });
  await page.goto(base + '/create'); await page.screenshot({ path: out + '/03-create.png', fullPage: true });
  await page.click('button[role=radio]:has-text("1 min")');
  const watch = page.locator('label:has-text("Watch live") input'); if (await watch.isChecked()) await watch.uncheck(); // fast mode: same sim, no real-time pacing
  await page.fill('label:has-text("Seed") input', process.env.SEED ?? '3');
  await page.click('button:has-text("Kick off")');
  await page.waitForURL(/\/match\/\d+$/); await page.waitForTimeout(2500); await page.screenshot({ path: out + '/04-live.png' });
  await page.waitForSelector('text=Open replay', { timeout: 120000 }); await page.waitForTimeout(800); await page.screenshot({ path: out + '/05-results.png', fullPage: true });
  for (const t of ['Team stats', 'Players', 'Tactical & AI']) { await page.click(`button[role=tab]:has-text("${t}")`); await page.waitForTimeout(700); await page.screenshot({ path: out + `/06-${t.replace(/\W+/g, '_')}.png`, fullPage: true }); }
  if (await page.locator('button[role=tab]:has-text("Shootout")').count()) { await page.click('button[role=tab]:has-text("Shootout")'); await page.click('button:has-text("Replay") >> nth=0'); await page.waitForTimeout(2000); await page.screenshot({ path: out + '/07-shootout.png', fullPage: true }); }
  await page.click('a:has-text("Open replay")'); await page.waitForSelector('text=Back to results'); await page.waitForTimeout(2500); await page.screenshot({ path: out + '/08-replay.png' });
  await page.goto(base + '/matches'); await page.waitForSelector('table'); const rows = await page.locator('tbody tr').count();
  const m = await ctx.newPage(); await m.setViewportSize({ width: 390, height: 844 }); m.on('pageerror', (e) => errors.push('mobile pageerror: ' + e.message));
  await m.goto(base + '/create'); await m.waitForTimeout(800); await m.screenshot({ path: out + '/09-mobile-create.png', fullPage: true });
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  console.log(JSON.stringify({ ok: errors.length === 0, historyRows: rows, mobileHorizontalOverflow: overflow, errors: errors.slice(0, 8) }));
  await browser.close();
})().catch((e) => { console.error('E2E FAILED', e); process.exit(1); });
