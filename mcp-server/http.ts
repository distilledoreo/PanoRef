#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createContinuityMcpServer } from './createServer';

const port = Number(process.env.MCP_HTTP_PORT ?? 8787);
const app = createMcpExpressApp({ host: '0.0.0.0' });
const transports: Record<string, StreamableHTTPServerTransport> = {};

const CHATGPT_ORIGINS = ['https://chatgpt.com', 'https://chat.openai.com'];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && CHATGPT_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Accept, mcp-session-id, mcp-protocol-version, Authorization',
  );
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

function getSessionId(req: Request) {
  const header = req.headers['mcp-session-id'];
  return Array.isArray(header) ? header[0] : header;
}

function logProbe(req: Request, detail: string) {
  const agent = req.headers['user-agent'];
  if (typeof agent === 'string' && agent.includes('openai-mcp')) {
    console.log(`[chatgpt-probe] ${req.method} ${req.path} ${detail}`);
  }
}

function invalidSessionResponse(res: Response) {
  res.status(400).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
    id: null,
  });
}

async function mcpPostHandler(req: Request, res: Response) {
  const sessionId = getSessionId(req);
  logProbe(req, sessionId ? `session=${sessionId}` : 'initialize');

  try {
    let transport: StreamableHTTPServerTransport | undefined;

    if (sessionId && transports[sessionId]) {
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports[id] = transport!;
          logProbe(req, `session-initialized=${id}`);
        },
      });

      transport.onclose = () => {
        const id = transport?.sessionId;
        if (id && transports[id]) {
          delete transports[id];
        }
      };

      const server = await createContinuityMcpServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    } else {
      invalidSessionResponse(res);
      return;
    }

    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('MCP HTTP error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
}

async function mcpGetHandler(req: Request, res: Response) {
  const sessionId = getSessionId(req);
  logProbe(req, sessionId ? `sse session=${sessionId}` : 'missing-session');

  if (!sessionId || !transports[sessionId]) {
    invalidSessionResponse(res);
    return;
  }

  await transports[sessionId].handleRequest(req, res);
}

async function mcpDeleteHandler(req: Request, res: Response) {
  const sessionId = getSessionId(req);
  logProbe(req, sessionId ? `delete session=${sessionId}` : 'missing-session');

  if (!sessionId || !transports[sessionId]) {
    invalidSessionResponse(res);
    return;
  }

  await transports[sessionId].handleRequest(req, res);
}

app.get('/', (_req, res) => {
  res.json({
    name: 'continuity-stage',
    version: '0.1.0',
    mcp: '/mcp',
    status: 'ok',
  });
});

app.post('/mcp', mcpPostHandler);
app.get('/mcp', mcpGetHandler);
app.delete('/mcp', mcpDeleteHandler);

app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (
    error instanceof SyntaxError &&
    typeof error === 'object' &&
    error !== null &&
    'body' in error &&
    !res.headersSent
  ) {
    res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32700, message: 'Parse error: Invalid JSON' },
      id: null,
    });
    return;
  }
  next(error);
});

app.listen(port, () => {
  console.log(`Continuity Stage MCP HTTP server listening on http://127.0.0.1:${port}/mcp`);
  console.log('For ChatGPT Apps on Plus, expose this with ngrok or Cloudflare Tunnel:');
  console.log(`  npm run mcp:cloudflare`);
  console.log('Connector URL must end with /mcp, e.g. https://<host>.trycloudflare.com/mcp');
  console.log('Authentication: No Authentication');
  console.log('For rendering tools, also run: npm run dev');
});