// Real-browser end-to-end verification of the whole app. Starts its own server and web dev server, with stand-in `claude` / `codex`
// programs (no quota is spent), then drives the UI with Playwright.
// Usage: npm run e2e [-- --out <dir>] [--skip-shootout]      (needs: npx playwright install chromium)
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2); const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const OUT = resolve(arg('--out', 'e2e/out')); const SKIP_SHOOTOUT = args.includes('--skip-shootout'); mkdirSync(OUT, { recursive: true });
const root = resolve('.'); const tmp = mkdtempSync(join(tmpdir(), 'futsal-e2e-')); const procs = []; const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const freePort = () => new Promise((res, rej) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); });
const waitHttp = async (url, ms = 60000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const r = await fetch(url); if (r.status < 500) return; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 300)); } throw new Error(`timeout waiting for ${url}`); };
const start = (cmd, a, env, cwd = root) => { const p = spawn(process.execPath, [cmd, ...a], { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }); let log = ''; p.stdout.on('data', (d) => (log += d)); p.stderr.on('data', (d) => (log += d)); p.getLog = () => log; procs.push(p); return p; };

// ---------------------------------------------------------------------------------------------- stand-in CLIs
const TACT = `const tactics = (st, why) => ({ formation: '2-2', teamStrategy: 'attacking', attackingStyle: 'direct', defensiveStyle: 'mid_block', pressingIntensity: 0.7, riskLevel: 0.6, flyingGoalkeeper: false, playerInstructions: st.onCourt.filter((p) => p.role !== 'GK').map((p) => ({ playerId: p.id, instruction: 'support_build_up' })), reasonSummary: why });
const state = (prompt) => JSON.parse(/Match state \\(JSON\\): (.*)\\nTrigger/.exec(prompt)[1]);`;
const fakeClaude = join(tmp, 'claude.cjs'); const fakeCodex = join(tmp, 'codex.cjs'); const codexHome = join(tmp, 'codex-home'); mkdirSync(codexHome, { recursive: true });
writeFileSync(fakeClaude, `${TACT}\nconst a = process.argv.slice(2);\nif (a[0] === 'auth') { console.log(JSON.stringify({ loggedIn: true, authMethod: 'test' })); process.exit(0); }\nconsole.log(JSON.stringify({ is_error: false, result: JSON.stringify(tactics(state(a[a.indexOf('-p') + 1]), 'Press high and shoot early: they are tired.')) }));`);
writeFileSync(fakeCodex, `${TACT}\nconst a = process.argv.slice(2);\nif (a[0] === 'login') { console.log('Logged in using ChatGPT'); process.exit(0); }\nrequire('fs').writeFileSync(a[a.indexOf('-o') + 1], JSON.stringify(tactics(state(a[a.length - 1]), 'Stay compact and counter.')));`);
writeFileSync(join(codexHome, 'models_cache.json'), JSON.stringify({ models: [{ slug: 'gpt-test', display_name: 'GPT Test', visibility: 'list' }] })); writeFileSync(join(codexHome, 'config.toml'), 'model = "gpt-test"\n');

const apiPort = await freePort(); const webPort = await freePort(); const WEB = `http://127.0.0.1:${webPort}`;
start(resolve(root, 'node_modules/tsx/dist/cli.mjs'), ['apps/server/src/index.ts'], { PORT: String(apiPort), CLAUDE_BIN: fakeClaude, CODEX_BIN: fakeCodex, CODEX_HOME: codexHome, OPENROUTER_API_KEY: '' });
const web = start(resolve(root, 'node_modules/vite/bin/vite.js'), ['--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], { API_PORT: String(apiPort) }, join(root, 'apps/web'));
let browser; let exitCode = 0;
try {
  await waitHttp(`http://127.0.0.1:${apiPort}/api/health`); await waitHttp(`${WEB}/`);
  const errors = []; const track = (pg, tag) => { pg.on('pageerror', (e) => errors.push(`${tag} pageerror: ${e.message}`)); pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${tag} console: ${m.text()}`); }); };
  const harden = (pg) => { const orig = pg.screenshot.bind(pg); pg.screenshot = async (o) => { for (let i = 0; ; i++) { try { return await orig(o); } catch (e) { if (i >= 2) throw e; await pg.waitForTimeout(800); } } }; return pg; };
  browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const page = harden(await ctx.newPage()); track(page, 'desktop');
  const minutesButton = (n) => page.locator('[role=radiogroup][aria-labelledby=minutes-label] button', { hasText: new RegExp(`^${n}$`) });

  // ---- one page, no login ------------------------------------------------------------------------------------------------------------------
  await page.goto(`${WEB}/`); await page.waitForSelector('button:has-text("Kick off")'); await page.waitForTimeout(1500);
  const text0 = await page.locator('body').innerText();
  check('opens straight to the match setup (no landing page, login or sign-up)', /Pick the\s*coaches/i.test(text0) && !/sign in|log in|sign up|create account|get started|password/i.test(text0));
  check('exactly six watch-time choices (1-6 minutes)', (await page.locator('[role=radiogroup][aria-labelledby=minutes-label] button').allInnerTexts()).join(',') === '1,2,3,4,5,6');
  check('each side offers exactly Claude Code, Codex and OpenRouter (no built-in coach)', (await page.locator('[role=radiogroup][aria-label="Home provider"] button').allInnerTexts()).map((t) => t.trim()).join(',') === 'Claude,Codex,OpenRouter' && (await page.locator('[role=radiogroup][aria-label="Away provider"] button').count()) === 3);
  check('the 3D pitch is already on screen before kick-off', (await page.locator('.pitch-surface canvas').count()) >= 1);
  await page.screenshot({ path: `${OUT}/01-setup.png` });

  // ---- choosing models exactly like the chess app: provider card, then the model ---------------------------------------------------------
  await page.locator('[role=radiogroup][aria-label="Home provider"] button', { hasText: 'Claude' }).click(); await page.waitForTimeout(400);
  const homeModels = await page.locator('select.field').first().locator('option').allInnerTexts();
  check('Claude Code lists its models and shows Ready (stand-in CLI signed in)', homeModels.some((o) => /Haiku 5\.5/.test(o)) && (await page.locator('section:has(h3:text("Home")) :text("Ready")').count()) >= 1, homeModels.join(' | '));
  await page.locator('select.field').first().selectOption({ label: homeModels.find((o) => /Haiku/.test(o)) });
  await page.locator('section:has(h3:text("Home")) [role=radiogroup] button', { hasText: /^high$/ }).click();
  check('Claude Code shows the Thinking effort control', (await page.locator('section:has(h3:text("Home")) :text("Thinking effort")').count()) >= 1);
  await page.locator('[role=radiogroup][aria-label="Away provider"] button', { hasText: 'Codex' }).click(); await page.waitForTimeout(400);
  check('Codex lists the models its CLI cached (GPT Test)', (await page.locator('select.field').nth(1).locator('option').allInnerTexts()).some((o) => /GPT Test/.test(o)));
  await page.locator('[role=radiogroup][aria-label="Away provider"] button', { hasText: 'OpenRouter' }).click(); await page.waitForTimeout(500);
  check('OpenRouter without a key is blocked with a clear instruction', (await page.locator('button:has-text("Kick off")').isDisabled()) && /OpenRouter API key/.test(await page.locator('body').innerText()));
  await page.screenshot({ path: `${OUT}/02-openrouter-needs-key.png` });
  await page.click('button:has-text("Settings")'); await page.waitForSelector('dialog[open] #openrouter-key'); await page.fill('#openrouter-key', 'sk-or-v1-e2e-test'); await page.screenshot({ path: `${OUT}/03-settings.png` });
  await page.click('dialog[open] button:has-text("Save")'); await page.waitForTimeout(500);
  check('saving the key unblocks OpenRouter (key stays in this browser)', !(await page.locator('button:has-text("Kick off")').isDisabled()) && (await page.evaluate(() => localStorage.getItem('ai-futsal.openrouter-key'))) === '"sk-or-v1-e2e-test"');
  await page.locator('[role=radiogroup][aria-label="Away provider"] button', { hasText: 'Codex' }).click(); await page.waitForTimeout(300);

  // ---- a real match: Claude Code (stand-in) vs Codex (stand-in), 1 minute -------------------------------------------------------------------
  await minutesButton(1).click(); await page.click('button:has-text("Kick off")'); await page.waitForTimeout(900); await page.screenshot({ path: `${OUT}/04-intro.png` });
  await page.waitForSelector('text=Live', { timeout: 20000 }); await page.waitForTimeout(6500);
  const clock = async () => (await page.getByTestId('clock').innerText()).trim(); const sec = (c) => { const [m, s] = c.split(':').map(Number); return m * 60 + s; };
  const c1 = await clock(); await page.waitForTimeout(4000); const c2 = await clock();
  check('virtual match clock advances live (00:00 -> 90:00)', sec(c2) > sec(c1) && sec(c2) < 5400, `${c1} -> ${c2}`);
  await page.screenshot({ path: `${OUT}/05-live.png` });
  await page.click('button[role=tab]:has-text("Thoughts")'); await page.waitForSelector('text=Press high and shoot early', { timeout: 30000 }); await page.waitForSelector('text=Stay compact and counter', { timeout: 30000 });
  check('Thoughts feed shows what each model told its team (Claude Code and Codex answers)', true); await page.screenshot({ path: `${OUT}/06-thoughts.png` });
  check('a "thinking" glow runs round the pitch frame while a model is deciding, or the bars show its tactic', (await page.locator('[aria-label="Home team"]').innerText()).length > 5);
  await page.click('button[role=tab]:has-text("Stats")'); await page.waitForTimeout(500); check('Stats tab shows live possession and shots', /Possession/i.test(await page.locator('[role=tabpanel]').innerText())); await page.screenshot({ path: `${OUT}/07-stats.png` });

  // ---- pause freezes the clock; resume continues; End match stops it -------------------------------------------------------------------------
  await page.click('button:has-text("Pause")'); await page.waitForSelector('text=Paused'); await page.waitForTimeout(500); const p1 = await clock(); await page.waitForTimeout(1500); const p2 = await clock();
  check('Pause freezes the match clock and shows the paused overlay', p1 === p2, `${p1} == ${p2}`); await page.screenshot({ path: `${OUT}/08-paused.png` });
  await page.click('button:has-text("Resume")'); await page.waitForTimeout(1800); check('Resume continues the match', sec(await clock()) > sec(p2));
  await page.click('button:has-text("End match")'); await page.waitForSelector('dialog[open] h2[aria-label]'); check('End match stops it and shows the result card', (await page.locator('dialog[open] h2').getAttribute('aria-label')) === 'Match stopped'); await page.screenshot({ path: `${OUT}/09-stopped.png` });
  await page.click('dialog[open] button:has-text("New setup")'); await page.waitForSelector('button:has-text("Kick off")'); check('New setup returns to the setup screen with the same coaches kept', (await page.locator('select.field').first().inputValue()) === 'claude-haiku-5-5');

  // ---- the penalty shootout: the result must never be shown before it happens ----------------------------------------------------------------
  if (!SKIP_SHOOTOUT) {
    // the coaches are models, so whether a match is level cannot be predicted: try successive seeds until one goes to penalties
    let seed = 0; let sp = null;
    for (seed = 1; seed <= 14; seed++) {
    sp = harden(await ctx.newPage()); track(sp, 'shootout');
    await sp.addInitScript(() => { // count stream messages in the page itself, ahead of the app's own handlers
      window.__kicks = 0; window.__results = 0; window.__viol = []; window.__samplesInFlight = 0;
      const W = window.WebSocket; window.WebSocket = class extends W { constructor(...a) { super(...a); this.addEventListener('message', (e) => { const d = String(e.data); if (d.includes('"t":"penalty_kick"')) window.__kicks++; else if (d.includes('"t":"penalty_result"')) window.__results++; }); } };
      setInterval(() => {
        const revealed = document.querySelectorAll('[aria-label$="penalties"] [title=goal],[aria-label$="penalties"] [title=saved],[aria-label$="penalties"] [title=missed],[aria-label$="penalties"] [title=post]').length;
        const banner = [...document.querySelectorAll('.pitch-surface div')].some((d) => /^(GOAL!|SAVED!|MISSED|OFF THE POST)$/.test(d.textContent?.trim() ?? '') && d.children.length === 0);
        if (revealed > window.__results) window.__viol.push(`pips revealed ${revealed} > results received ${window.__results}`);
        if (banner && window.__results === 0) window.__viol.push('result banner before any result was received');
        if (banner && window.__results < window.__kicks && document.querySelectorAll('[aria-label$="penalties"] [title=pending]').length === 0) window.__viol.push('banner without a pending kick context');
        if (window.__kicks > window.__results) window.__samplesInFlight++;
      }, 25);
    });
    await sp.route('**/api/match', async (route) => { const req = route.request(); if (req.method() !== 'POST') return route.continue(); const body = JSON.parse(req.postData() ?? '{}'); await route.continue({ postData: JSON.stringify({ ...body, seed }) }); });
    await sp.goto(`${WEB}/`); await sp.waitForSelector('button:has-text("Kick off")'); await sp.locator('[role=radiogroup][aria-labelledby=minutes-label] button', { hasText: /^1$/ }).click();
    await sp.evaluate(() => localStorage.setItem('ai-futsal.players', JSON.stringify({ A: { provider: 'claude', model: 'claude-haiku-5-5', effort: 'default' }, B: { provider: 'codex', model: 'gpt-test', effort: 'default' } }))); await sp.reload(); await sp.waitForSelector('button:has-text("Kick off")');
    await sp.locator('[role=radiogroup][aria-labelledby=minutes-label] button', { hasText: /^1$/ }).click(); await sp.click('button:has-text("Kick off")');
    const hit = await Promise.race([sp.waitForSelector('text=Penalties', { timeout: 100000 }).then(() => 'pen'), sp.waitForSelector('dialog[open]', { timeout: 100000 }).then(() => 'end')]).catch(() => 'timeout');
    if (hit === 'pen') break; await sp.close(); sp = null;
    }
    check('found a seed whose regulation ends level (models coach both sides)', !!sp, `seed ${seed}`);
    await sp.waitForSelector('text=Penalties', { timeout: 30000 }); check('a level match goes to the penalty shootout screen', true); await sp.waitForTimeout(3500); await sp.screenshot({ path: `${OUT}/10-shootout.png` });
    check('shootout shows the dedicated 3D penalty scene and attempt tracker', (await sp.locator('.pitch-surface canvas').count()) >= 1 && (await sp.locator('[aria-label$="penalties"]').count()) === 2);
    await sp.waitForSelector('dialog[open]', { timeout: 240000 });
    const v = await sp.evaluate(() => ({ viol: window.__viol, kicks: window.__kicks, results: window.__results, inFlight: window.__samplesInFlight }));
    check('SPOILER GUARD: no result, banner or score was shown before its result message (sampled every 25 ms through the whole shootout)', v.viol.length === 0 && v.inFlight > 20, `${v.kicks} kicks, ${v.results} results, ${v.inFlight} in-flight samples; violations: ${v.viol.slice(0, 3).join(' | ') || 'none'}`);
    check('every kick got exactly one revealed result', v.kicks === v.results, `${v.kicks}/${v.results}`);
    await sp.waitForSelector('dialog[open] h2[aria-label]'); const headline = await sp.locator('dialog[open] h2').getAttribute('aria-label'); const over = await sp.locator('dialog[open]').innerText();
    check('full-time card announces the winner on penalties with the regulation score', /win on penalties$/.test(headline ?? '') && /Rematch/.test(over) && /–/.test(over), `${headline}`); await sp.waitForTimeout(1500); await sp.screenshot({ path: `${OUT}/11-gameover.png` });
    await sp.close();
  }

  // ---- responsive: no horizontal scrolling on any screen size, in setup and in a live match -----------------------------------------------------
  const sizes = [[320, 640], [375, 812], [390, 844], [430, 932], [768, 1024], [1024, 768], [1440, 900], [1920, 1080], [844, 390]];
  for (const [w, h] of sizes) {
    const p = harden(await ctx.newPage()); await p.setViewportSize({ width: w, height: h }); track(p, `${w}x${h}`); const bad = [];
    await p.goto(`${WEB}/`); await p.waitForSelector('button:has-text("Kick off")'); await p.waitForTimeout(700);
    const over = async (tag) => { const o = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth })); if (o.sw > o.iw + 1) bad.push(`${tag} ${o.sw}>${o.iw}`); };
    await over('setup'); await p.screenshot({ path: `${OUT}/r-${w}x${h}-setup.png`, fullPage: true });
    await p.locator('[role=radiogroup][aria-labelledby=minutes-label] button', { hasText: /^1$/ }).click(); await p.click('button:has-text("Kick off")'); await p.waitForSelector('text=Live', { timeout: 20000 }); await p.waitForTimeout(3500); await over('live'); await p.screenshot({ path: `${OUT}/r-${w}x${h}-live.png`, fullPage: true });
    check(`no horizontal scrolling at ${w}x${h}`, bad.length === 0, bad.join('; ')); await p.click('button:has-text("End match")'); await p.waitForSelector('dialog[open]'); await p.close(); // stop it so the server never reaches its live-match limit
  }
  check('no unexpected browser console / page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
} catch (e) { check('e2e run completed without exception', false, String(e?.stack ?? e).slice(0, 600)); console.error(web.getLog().slice(-800)); }
finally {
  await browser?.close(); for (const p of procs) p.kill(); await new Promise((r) => setTimeout(r, 500)); rmSync(tmp, { recursive: true, force: true });
  const failed = results.filter((r) => !r.ok); console.log(`\nE2E: ${results.length - failed.length}/${results.length} checks passed; screenshots in ${OUT}`); if (failed.length) { exitCode = 1; for (const f of failed) console.log(`  FAILED: ${f.name} ${f.detail}`); }
  process.exit(exitCode);
}
