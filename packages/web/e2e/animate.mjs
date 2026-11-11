// Export → Animation: a GIF and a video (MP4 where the browser encodes H.264, else WebM) of a
// walkthrough's steps, and a GIF of a diagram's layers; checked by their headers, size and duration.
// node e2e/animate.mjs <outDir>
import fs from 'node:fs';
import { chromium } from '@playwright/test';
const out = process.argv[2] ?? '.';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const problems = [];
const fail = (m) => problems.push(m);
page.on('pageerror', (e) => fail(e.message));
// Against the built app (vite preview) its Content-Security-Policy applies: whatever it blocks is a problem.
page.on('console', (m) => m.type() === 'error' && /Content Security Policy/i.test(m.text()) && fail(m.text()));
const example = (f) => fs.readFileSync(new URL(`../../../examples/${f}`, import.meta.url), 'utf8');

/** A GIF's size and how long it plays: the delays of its graphic control blocks, walked block by block. */
function gifInfo(b) {
  if (b.subarray(0, 6).toString('latin1') !== 'GIF89a') return undefined;
  const width = b.readUInt16LE(6);
  const height = b.readUInt16LE(8);
  let p = 13 + (b[10] & 0x80 ? 3 * (2 << (b[10] & 7)) : 0);
  let ms = 0;
  let frames = 0;
  const skip = () => {
    for (let n = b[p++]; n; n = b[p++]) p += n;
  };
  while (p < b.length) {
    const kind = b[p++];
    if (kind === 0x3b) break;
    if (kind === 0x21) {
      if (b[p] === 0xf9) ms += b.readUInt16LE(p + 3) * 10;
      p++;
      skip();
    } else if (kind === 0x2c) {
      frames++;
      const packed = b[p + 8];
      p += 9 + (packed & 0x80 ? 3 * (2 << (packed & 7)) : 0) + 1;
      skip();
    } else return undefined;
  }
  return { width, height, ms, frames };
}

/** An MP4's length from its mvhd, a WebM's from its Duration. */
function videoInfo(b) {
  if (b.subarray(4, 8).toString('latin1') === 'ftyp') {
    const at = b.indexOf('mvhd', 0, 'latin1');
    return { kind: 'mp4', ms: (b.readUInt32BE(at + 20) / b.readUInt32BE(at + 16)) * 1000 };
  }
  if (b.readUInt32BE(0) === 0x1a45dfa3) {
    const at = b.indexOf(Buffer.from([0x44, 0x89, 0x88]));
    return { kind: 'webm', ms: b.readDoubleBE(at + 3) };
  }
  return undefined;
}

/** Opens a diagram as if it were the last one edited: seeded before the app starts, which writes its own on the way out. */
async function open(text, name) {
  await page.addInitScript(
    ([text, name]) => {
      if (sessionStorage.getItem('seeded') === name) return;
      sessionStorage.setItem('seeded', name);
      localStorage.clear();
      for (const [k, v] of Object.entries({ started: true, hinted: true, view: 'visual', doc: { text, doc: { name } } })) localStorage.setItem(`cartography:${k}`, JSON.stringify(v));
    },
    [text, name],
  );
  await page.goto(process.env.CARTO_URL ?? 'http://localhost:5178/');
  await page.waitForSelector('.drawing svg', { timeout: 15000 });
}

async function dialog() {
  await page.click('button:has-text("Export")');
  await page.click('[role=menuitem]:has-text("Animation")');
  await page.waitForSelector('.animate-dialog');
  // The choices load with the dialog: the export button is ready once they have.
  await page.waitForFunction(() => !document.querySelector('.animate-dialog button.primary')?.hasAttribute('disabled'));
}

async function exported(keys = 'Enter', timeout = 120000) {
  const [download] = await Promise.all([page.waitForEvent('download', { timeout }), page.keyboard.press(keys)]);
  const file = `${out}/${download.suggestedFilename()}`;
  await download.saveAs(file);
  return { file, bytes: fs.readFileSync(file) };
}

// No network beyond the app itself: the encoders come with it.
const origin = new URL(process.env.CARTO_URL ?? 'http://localhost:5178/').origin;
page.on('request', (r) => !r.url().startsWith(origin) && !r.url().startsWith('data:') && !r.url().startsWith('blob:') && fail(`left the app: ${r.url()}`));

// 1. The walkthrough as a GIF, with Enter: 7 steps at 1280×720, small, as long as its holds and blends.
await open(example('systems/invoice-walkthrough.yaml'), 'invoice-walkthrough.yaml');
await dialog();
if (await page.locator('.animate-dialog [role=radiogroup][aria-label="Tell"]').count()) fail('a Tell choice for a diagram without layers');
await page.click('.animate-dialog [role=radio]:has-text("GIF")');
{
  const { file, bytes } = await exported();
  const gif = gifInfo(bytes);
  if (!file.endsWith('invoice-walkthrough.gif')) fail(`gif: named ${file}`);
  if (!gif) fail('gif: not a GIF');
  else {
    if (gif.width !== 1280 || gif.height !== 720) fail(`gif: ${gif.width}×${gif.height}`);
    // 6 holds of 2.5 s, an end hold of 5 s, 7 blends of half a second (one back to the start).
    if (Math.abs(gif.ms - 23300) > 400) fail(`gif: plays ${gif.ms} ms, expected about 23.3 s`);
    if (bytes.length > 2e6) fail(`gif: ${bytes.length} bytes, over 2 MB`);
    console.log(`gif: ${gif.width}×${gif.height}, ${gif.frames} frames, ${(gif.ms / 1000).toFixed(1)} s, ${Math.round(bytes.length / 1000)} kB`);
  }
}
if (await page.locator('.animate-dialog').count()) fail('the dialog stayed open after the export');

// 2. The same as a video: MP4 when this browser encodes H.264, else WebM; 1920×1080, quicker holds.
await dialog();
const mp4 = await page.locator('.animate-dialog [role=radio]:has-text("MP4")').isEnabled();
const webmOk = await page.locator('.animate-dialog [role=radio]:has-text("WebM")').isEnabled();
if (!mp4 && !webmOk) fail('video: neither MP4 nor WebM can be encoded here');
else {
  await page.click(`.animate-dialog [role=radio]:has-text("${mp4 ? 'MP4' : 'WebM'}")`);
  await page.click('.animate-dialog [role=radio]:has-text("1920 × 1080")');
  await page.click('.animate-dialog [role=radio]:has-text("1.5 s")');
  const { file, bytes } = await exported();
  const v = videoInfo(bytes);
  if (!v) fail(`video: ${file} is neither MP4 nor WebM`);
  else {
    // 6 holds of 1.5 s, an end hold of 3 s, 6 blends of 14 frames at 30 a second: 14.8 s.
    if (Math.abs(v.ms - 14800) > 200) fail(`video: ${v.ms} ms, expected about 14.8 s`);
    if (bytes.length > 8e6) fail(`video: ${bytes.length} bytes`);
    console.log(`video: ${v.kind}, ${(v.ms / 1000).toFixed(1)} s, ${Math.round(bytes.length / 1000)} kB`);
  }
  // The browser plays what it made, as long as it says.
  if (v?.kind === 'webm' || (await page.evaluate(() => document.createElement('video').canPlayType('video/mp4; codecs="avc1.640028"')))) {
    const played = await page.evaluate(async (b64) => {
      const v = document.createElement('video');
      v.muted = true;
      v.src = URL.createObjectURL(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))]));
      await new Promise((ok, no) => ((v.onloadedmetadata = ok), (v.onerror = () => no(new Error('cannot play')))));
      return { w: v.videoWidth, h: v.videoHeight, s: v.duration };
    }, bytes.toString('base64')).catch((e) => fail(`video: ${e.message}`));
    if (played && (played.w !== 1920 || played.h !== 1080)) fail(`video: plays at ${played.w}×${played.h}`);
  }
}

// 3. Layers, and the keyboard: a diagram with steps and layers offers both; Escape closes.
await open(example('azure/web-shop.yaml'), 'web-shop.yaml');
await dialog();
await page.keyboard.press('Escape');
if (await page.locator('.animate-dialog').count()) fail('Escape did not close the dialog');
await dialog();
await page.click('.animate-dialog [role=radio]:has-text("Layers")');
await page.click('.animate-dialog [role=radio]:has-text("GIF")');
await page.click('.animate-dialog [role=radio]:has-text("1280 × 720")');
await page.click('.animate-dialog [role=radio]:has-text("2.5 s")');
{
  const { file, bytes } = await exported();
  const gif = gifInfo(bytes);
  if (!file.endsWith('web-shop-layers.gif')) fail(`layers: named ${file}`);
  // The whole, then three layers: 3 holds, the end hold, 4 blends.
  if (!gif || Math.abs(gif.ms - 14400) > 400) fail(`layers: plays ${gif?.ms} ms, expected about 14.4 s`);
}

console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'animation exports ok');
await browser.close();
process.exitCode = problems.length ? 1 : 0;
