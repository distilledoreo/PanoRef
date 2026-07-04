import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

export async function resolveAppUrl() {
  if (process.env.CONTINUITY_STAGE_URL) {
    return process.env.CONTINUITY_STAGE_URL;
  }

  const ports = Array.from({ length: 11 }, (_, index) => 3000 + index);
  for (const port of ports) {
    const candidate = `http://127.0.0.1:${port}`;
    try {
      const response = await fetch(candidate, { signal: AbortSignal.timeout(1500) });
      if (!response.ok) continue;
      const html = await response.text();
      if (html.includes('Continuity Stage') || html.includes('Continuity Render Bridge')) {
        return candidate;
      }
    } catch {
      // Try the next dev-server port.
    }
  }

  throw new Error(
    'No Continuity Stage dev server found on ports 3000-3010. '
    + 'Start one with `npm run dev`, or set CONTINUITY_STAGE_URL.',
  );
}

export async function renderProjectWithBridge(projectJson, options = {}) {
  const appUrl = await resolveAppUrl();
  const renderUrl = `${appUrl.replace(/\/$/, '')}/mcp-render.html`;
  const chromePath = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const debugPort = Number(process.env.CHROME_DEBUG_PORT ?? 9332);
  const profileDir = options.profileDir
    ?? resolve(repoRoot, '.tmp-mcp-render-profile');

  await mkdir(profileDir, { recursive: true });

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
    await client.send('Page.navigate', { url: renderUrl });
    await waitFor(
      client,
      'window.__continuityRenderBridge?.ready === true',
      'render bridge ready',
      options.readyTimeoutMs ?? 30000,
    );

    const includeGraybox = options.includeGraybox ?? true;
    const includeShotFrames = options.includeShotFrames ?? true;
    const shotIds = options.shotIds ?? [];

    let graybox;
    if (includeGraybox) {
      graybox = await evaluate(client, `
        window.__continuityRenderBridge.renderGraybox(${JSON.stringify(projectJson)})
      `);
    }

    let shotFrames = [];
    if (includeShotFrames) {
      shotFrames = await evaluate(client, `
        window.__continuityRenderBridge.renderShotFrames(
          ${JSON.stringify(projectJson)},
          ${JSON.stringify(shotIds.length > 0 ? shotIds : undefined)}
        )
      `);
    }

    await client.close();
    return { graybox, shotFrames };
  } finally {
    chrome.kill();
  }
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
  await new Promise((resolvePromise, reject) => {
    socket.addEventListener('open', resolvePromise, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const handlers = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) handlers.reject(new Error(message.error.message));
    else handlers.resolve(message.result);
  });

  return {
    send(method, params = {}) {
      id += 1;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolvePromise, reject) => pending.set(id, { resolve: resolvePromise, reject }));
    },
    close() {
      socket.close();
    },
  };
}

async function waitFor(client, expression, label, timeout = 20000) {
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
    const text = result.exceptionDetails.exception?.description
      ?? result.exceptionDetails.text
      ?? 'Render bridge evaluation failed.';
    throw new Error(text);
  }
  return result.result?.value;
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}