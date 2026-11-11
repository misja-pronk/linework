// Screenshots of the built site, light and dark, desktop and phone width, to look at after a change:
//   pnpm --filter @cartography/site shoot <outDir> [page.html …]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const dist = path.resolve(import.meta.dirname, '../dist');
const [outDir = path.join(dist, '../shots'), ...only] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const pages = only.length ? only : ['index.html', 'types.html', 'embed.html', 'gallery/index.html', 'gallery/systems.html', 'benchmark.html'];

const browser = await chromium.launch();
const errors: string[] = [];
for (const [label, viewport, scheme] of [
  ['desktop', { width: 1440, height: 900 }, 'light'],
  ['dark', { width: 1440, height: 900 }, 'dark'],
  ['phone', { width: 390, height: 844 }, 'light'],
] as const) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: label === 'phone' ? 2 : 1, colorScheme: scheme });
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  for (const p of pages.filter((x) => fs.existsSync(path.join(dist, x)))) {
    await page.goto(pathToFileURL(path.join(dist, p)).href);
    await page.waitForTimeout(150);
    const name = `${p.replace(/\//g, '-').replace(/\.html$/, '')}-${label}.png`;
    await page.screenshot({ path: path.join(outDir, name), fullPage: process.env.FULL === '1' });
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (wide > 1) errors.push(`${p} (${label}) scrolls sideways by ${wide}px`);
  }
  await page.close();
}
await browser.close();
for (const e of errors) console.error(e);
console.log(`→ ${outDir}`);
process.exitCode = errors.length ? 1 : 0;
