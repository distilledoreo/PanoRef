import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';

async function waitForHttpServer(port: number, child: ChildProcessWithoutNullStreams) {
  const rootUrl = `http://127.0.0.1:${port}/`;
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`MCP HTTP server exited early with code ${child.exitCode}`);
    }

    try {
      const response = await fetch(rootUrl);
      if (response.ok) {
        return;
      }
    } catch {
      await delay(200);
    }
  }

  throw new Error('Timed out waiting for MCP HTTP server to start.');
}

async function stopProcess(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null) {
    return;
  }

  child.kill();
  await Promise.race([
    once(child, 'exit'),
    delay(2_000).then(() => {
      if (child.exitCode === null) {
        child.kill('SIGKILL');
      }
    }),
  ]);
}

describe('MCP HTTP server', () => {
  it('accepts a streamable HTTP initialize request and creates a session', async () => {
    const port = 18_787;
    const child = spawn(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'mcp-server/http.ts'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          MCP_HTTP_PORT: String(port),
          CONTINUITY_WORKSPACE: `${process.cwd()}\\.tmp-mcp-http-test-workspace`,
        },
      },
    );

    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });

    try {
      await waitForHttpServer(port, child);

      const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'vitest', version: '1.0.0' },
          },
        }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('mcp-session-id')).toMatch(/[0-9a-f-]{36}/);
      expect(await response.text()).toContain('continuity-stage');
    } catch (error) {
      throw new Error(`${String(error)}\nServer output:\n${output}`);
    } finally {
      await stopProcess(child);
    }
  }, 25_000);
});
