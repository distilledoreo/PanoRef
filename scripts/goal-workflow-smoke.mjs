import { spawn } from 'node:child_process';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const downloadDir = resolve(repoRoot, 'artifacts/ai-brief-smoke');
const appUrl = process.env.CONTINUITY_STAGE_URL ?? 'http://127.0.0.1:3001';
const chromePath = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const debugPort = Number(process.env.CHROME_DEBUG_PORT ?? 9331);
const profileDir = resolve(repoRoot, '.tmp-goal-chrome-profile');

await rm(profileDir, { recursive: true, force: true });
await rm(downloadDir, { recursive: true, force: true });
await mkdir(profileDir, { recursive: true });
await mkdir(downloadDir, { recursive: true });

const chrome = spawn(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profileDir}`,
  'about:blank',
], { stdio: 'ignore' });

try {
  const pageSocketUrl = await waitForPageSocket(debugPort);
  const client = await createCdpClient(pageSocketUrl);
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloadDir,
  }).catch(() => undefined);
  await client.send('Page.navigate', { url: appUrl });
  await waitFor(client, 'document.title === "Continuity Stage" && document.body.textContent.includes("Reference")', 'app shell');

  await clickButton(client, 'Reference');
  await clickButton(client, 'Use Attached Reference');
  await waitFor(client, 'document.body.textContent.includes("attached-canonical-reference")', 'attached reference');

  await clickButton(client, 'Render Graybox 360');
  await waitFor(client, 'document.body.textContent.includes("graybox_render")', 'graybox pano');

  await clickButton(client, 'Shots');
  await waitFor(client, 'document.body.textContent.includes("Camera 001")', 'origin camera');

  await clickButton(client, 'Review');
  await clickButton(client, 'Export AI Brief ZIP');
  const zipPath = await waitForDownloadedZip(downloadDir);
  await importAiResultFrame(client);
  await waitForValue(
    client,
    `(() => {
      const button = [...document.querySelectorAll('button')]
        .find((candidate) => candidate.textContent?.includes('Download AI Result'));
      return button && !button.disabled ? 'ok' : '';
    })()`,
    'imported AI result frame',
  );

  await clickButton(client, 'Export');
  await clickButton(client, 'Export ZIP');
  await waitFor(client, 'document.body.textContent.includes("shot_001/outputs/ai_result_frame.png")', 'final package export with AI result');

  const questState = await evaluate(client, `
    document.querySelector('header + div')?.textContent ?? ''
  `);
  console.log(JSON.stringify({
    zipPath,
    bytes: (await stat(zipPath)).size,
    questState: String(questState).replace(/\s+/g, ' ').trim(),
  }, null, 2));
  await client.close();
} finally {
  chrome.kill();
}

async function waitForPageSocket(port) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const pages = await response.json();
      const page = pages.find((candidate) => candidate.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // Chrome is still starting.
    }
    await delay(100);
  }
  throw new Error('Chrome DevTools endpoint did not become available.');
}

async function createCdpClient(socketUrl) {
  const socket = new WebSocket(socketUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });
  return {
    send(method, params = {}) {
      id += 1;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    close() {
      socket.close();
    },
  };
}

async function importAiResultFrame(client) {
  const imported = await evaluate(client, `
    (() => {
      const input = [...document.querySelectorAll('input[type="file"]')]
        .find((candidate) => candidate.accept?.includes('image/png'));
      if (!input) return false;
      const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAGElEQVR4nGNk+M+ABzDhkxyMOnDqAQCmUQYFh4C22AAAAABJRU5ErkJggg==';
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const file = new File([bytes], 'smoke-ai-result.png', { type: 'image/png' });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()
  `);
  if (!imported) throw new Error('Could not find the AI result file input.');
}

async function clickButton(client, text, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const clicked = await evaluate(client, `
      (() => {
        const button = [...document.querySelectorAll('button')]
          .find((candidate) => candidate.textContent?.includes(${JSON.stringify(text)}));
        if (!button || button.disabled) return false;
        button.click();
        return true;
      })()
    `);
    if (clicked) {
      await delay(300);
      return;
    }
    await delay(200);
  }
  const available = await evaluate(client, '[...document.querySelectorAll("button")].map((button) => button.textContent?.trim()).join(" | ")');
  throw new Error(`Could not find enabled button: ${text}. Available: ${available}`);
}

async function waitFor(client, expression, label, timeout = 20000) {
  await waitForValue(client, `${expression} ? "ok" : ""`, label, timeout);
}

async function waitForValue(client, expression, label, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = await evaluate(client, expression);
    if (value) return value;
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? 'Runtime evaluation failed.');
  }
  return result.result.value;
}

async function waitForDownloadedZip(dir, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const files = await readdir(dir);
    const zip = files.find((name) => name.endsWith('.zip'));
    const partial = files.some((name) => name.endsWith('.crdownload'));
    if (zip && !partial) return resolve(dir, zip);
    await delay(250);
  }
  throw new Error('Timed out waiting for downloaded ZIP.');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
