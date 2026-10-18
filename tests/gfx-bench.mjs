// Graphics benchmark hook for tools/gfx-bench.mjs (dev-only): picks a preset in Settings → Graphics,
// starts a Practice round on the Grand layout (108 tiles) and keeps clearing matching free pairs by
// clicking the board's real tile buttons (the accessible mirror over the 3D tiles, as the e2e does),
// shuffling when stuck — tile lifts, removals, match sparks, fireflies and lantern flicker run all the time.
export const presets = ['low', 'balanced', 'high', 'ultra'];
export const levels = { low: 0, balanced: 4, high: 10, ultra: 17 };

export async function setPreset(page, preset) {
  await page.waitForFunction(() => !document.getElementById('screen-title').hidden && document.getElementById('loading').hidden, null, { timeout: 30000 });
  await page.click('#btn-settings');
  await page.waitForFunction(() => !document.getElementById('screen-pause').hidden);
  if (!(await page.evaluate(() => document.getElementById('settings-graphics').open))) await page.click('#settings-graphics > summary');
  await page.selectOption('#set-quality', preset);
  await page.waitForFunction((p) => document.body.dataset.gfxPreset === p, preset);
  await page.click('#btn-settings-back');
  await page.waitForFunction(() => !document.getElementById('screen-title').hidden);
}

// A matching pair of free tiles, read from the mirror like a player reads the board.
const nextPair = (page) => page.evaluate(() => {
  const byFace = new Map();
  for (const b of document.querySelectorAll('#board-mirror button[data-free="true"]')) {
    const f = b.textContent;
    if (byFace.has(f)) return [byFace.get(f), Number(b.dataset.tileId)];
    byFace.set(f, Number(b.dataset.tileId));
  }
  return document.querySelectorAll('#board-mirror button').length ? 'stuck' : 'empty';
});
const tap = (page, id) => page.evaluate((t) => document.querySelector(`#board-mirror [data-tile-id="${t}"]`)?.click(), id);

export async function start(page) {
  await page.click('#btn-play');
  await page.waitForFunction(() => !document.getElementById('screen-modes').hidden);
  await page.click('#screen-modes [data-mode="practice"]');
  await page.waitForFunction(() => !document.getElementById('screen-setup').hidden);
  await page.locator('#setup-options .card', { hasText: 'Grand' }).click();
  await page.click('#btn-start');
  await page.waitForFunction(() => document.querySelectorAll('#board-mirror button').length > 0);
  let open = true;
  page.once('close', () => { open = false; });
  (async () => {
    while (open) {
      try {
        const m = await nextPair(page);
        if (m === 'empty') return;
        if (m === 'stuck') await page.click('#btn-shuffle', { timeout: 3000 });
        else { await tap(page, m[0]); await page.waitForTimeout(250); await tap(page, m[1]); }
      } catch (e) { if (!open) return; if (process.env.BENCH_DEBUG) console.error(e.message); }
      await page.waitForTimeout(400).catch(() => {});
    }
  })();
  await page.waitForTimeout(1500);
}
