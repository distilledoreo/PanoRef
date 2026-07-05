#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createContinuityMcpServer } from './createServer';

const server = await createContinuityMcpServer();
const transport = new StdioServerTransport();
await server.connect(transport);