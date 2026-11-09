#!/usr/bin/env node
// cartography-mcp: the MCP server over stdio. Stdout carries the protocol, so logs go to stderr.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.ts';

const server = createServer(process.cwd());
await server.connect(new StdioServerTransport());
console.error('cartography-mcp ready on stdio');
