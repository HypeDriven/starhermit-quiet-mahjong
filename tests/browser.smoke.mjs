/**
 * Browser smoke test over raw CDP (no dependencies; Node >= 22).
 * Starts headless Chrome against the running server, then drives the UI:
 * title -> modes -> practice setup -> start -> tap a legal pair via the
 * mirror -> hint -> pause -> resume. Fails on any page exception.
 */
import { spawn } from 'node:child_process';

const PORT_DBG = 9222;
const chrome = spawn('google-chrome', [
  '--headless', '--disable-gpu', '--no-sandbox', '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${PORT_DBG}`, '--window-size=1280,800', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let ws, msgId = 0;
const pending = new Map();
const errors = [];

async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://localhost:${PORT_DBG}/json`)).json();
      const page = list.find(t => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
          if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description || ''));
          if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value || a.description).join(' '));
        };
        return;
      }
    } catch { /* retry */ }
    await sleep(250);
  }
  throw new Error('chrome not reachable');
}
function send(method, params = {}) {
  return new Promise((res) => {
    const id = ++msgId;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error('page eval failed: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result.result.value;
}

let failed = 0;
const check = (cond, name) => { console.log((cond ? 'PASS' : 'FAIL') + ' ' + name); if (!cond) failed++; };

try {
  await connect();
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'http://localhost:8080/' });
  await sleep(2500);

  check(await evalJs(`document.getElementById('loading').hidden`), 'boot completes, loading hidden');
  check(await evalJs(`!document.getElementById('screen-title').hidden`), 'title screen visible');
  check(await evalJs(`!!document.querySelector('#stage canvas')`), '3D canvas present');

  await evalJs(`document.getElementById('btn-play').click()`);
  await sleep(200);
  check(await evalJs(`!document.getElementById('screen-modes').hidden`), 'mode select opens');

  await evalJs(`document.querySelector('#screen-modes [data-mode="practice"]').click()`);
  await sleep(200);
  check(await evalJs(`!document.getElementById('screen-setup').hidden`), 'practice setup opens');
  check(await evalJs(`document.getElementById('setup-facts').textContent.includes('Ranked')`), 'setup shows ranked facts');

  await evalJs(`document.getElementById('btn-start').click()`);
  await sleep(500);
  check(await evalJs(`!document.getElementById('screen-play').hidden`), 'play HUD shown');
  const mirrorCount = await evalJs(`document.querySelectorAll('#board-mirror button').length`);
  check(mirrorCount === 48, `mirror has 48 tile buttons (got ${mirrorCount})`);

  // Tap a legal pair through the accessible mirror.
  const removed = await evalJs(`(() => {
    const free = [...document.querySelectorAll('#board-mirror button[data-free="true"]')];
    const byFace = new Map();
    for (const b of free) {
      const name = b.textContent;
      if (byFace.has(name)) {
        byFace.get(name).click(); b.click();
        return true;
      }
      byFace.set(name, b);
    }
    return false;
  })()`);
  await sleep(300);
  check(removed, 'found a free pair in mirror');
  check(await evalJs(`document.getElementById('hud-progress').textContent.startsWith('1 /')`), 'pair removed, progress updates');

  await evalJs(`document.getElementById('btn-hint').click()`);
  await sleep(200);
  check(await evalJs(`document.getElementById('hud-score').textContent`) !== '50', 'hint penalty reflected in score');

  await evalJs(`document.getElementById('btn-pause').click()`);
  await sleep(200);
  check(await evalJs(`!document.getElementById('screen-pause').hidden`), 'pause overlay opens');
  await evalJs(`document.getElementById('btn-resume').click()`);
  await sleep(200);
  check(await evalJs(`document.getElementById('screen-pause').hidden`), 'resume closes pause');

  // Keyboard: arrows move focus, Enter taps.
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 });
  await sleep(100);
  check(await evalJs(`document.activeElement && document.activeElement.dataset && !!document.activeElement.dataset.tileId`), 'arrow key focuses a tile');

  // Screenshot for visual sanity.
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const fs = await import('node:fs');
  fs.writeFileSync('/tmp/qm-play.png', Buffer.from(shot.result.data, 'base64'));
  console.log('screenshot saved to /tmp/qm-play.png');
} catch (e) {
  console.error('SMOKE ERROR', e.message);
  failed++;
} finally {
  chrome.kill();
}

if (errors.length) { console.error('PAGE ERRORS:'); errors.forEach(e => console.error('  ' + e)); failed += errors.length; }
process.exit(failed ? 1 : 0);
