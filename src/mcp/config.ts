import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MCPClient } from './client';
import { Settings } from '../config/settings';

export async function setupMCPClient(settings: Settings): Promise<MCPClient | undefined> {
  if (!settings.mcp?.servers || Object.keys(settings.mcp.servers).length === 0) {
    return undefined;
  }

  const client = new MCPClient();

  for (const [name, config] of Object.entries(settings.mcp.servers)) {
    await client.connectServer(name, config);
  }

  return client;
}
