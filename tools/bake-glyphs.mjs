// Bakes the tile-face glyphs the engine's canvas text cannot draw (the colour
// moon emoji 🌑…🌘 🌝, 〰 and ☔, which the engine's OffscreenCanvas fillText
// leaves out; reported) as the browser build's Chrome canvas drew them in
// js/main.js faceTexture: "144px serif", #1a2030, centred, at 2× for the
// Ultra face budget. Writes assets/glyphs.png: one 360×360 cell per glyph
// (the 180×180 authored-pixel square around the glyph's centre), in the order
// of GLYPHS in native/render.ts. Runs Chrome on the GPU (~/games/tools/
// gpu-chrome.mjs). Offline tool: run it after changing the glyph set.
//   node tools/bake-glyphs.mjs
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const { launchChrome } = await import('/home/albert/games/tools/gpu-chrome.mjs');
export const GLYPHS = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘', '🌝', '〰', '☔'];
const { browser, close } = await launchChrome(chromium);
try {
  const page = await browser.newPage();
  await page.setContent('<html><body></body></html>');
  const data = await page.evaluate(async (glyphs) => {
    const K = 2, CELL = 180;
    const c = document.createElement('canvas');
    c.width = CELL * K * glyphs.length; c.height = CELL * K;
    const g = c.getContext('2d');
    await document.fonts.ready;
    g.scale(K, K);
    g.fillStyle = '#1a2030'; g.font = '144px serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    glyphs.forEach((ch, i) => g.fillText(ch, i * CELL + CELL / 2, CELL / 2));
    return c.toDataURL('image/png');
  }, GLYPHS);
  const out = fileURLToPath(new URL('../assets/glyphs.png', import.meta.url));
  writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'));
  console.log('wrote', out);
} finally { await close(); }
