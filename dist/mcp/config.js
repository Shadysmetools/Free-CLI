"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupMCPClient = setupMCPClient;
const client_1 = require("./client");
async function setupMCPClient(settings) {
    if (!settings.mcp?.servers || Object.keys(settings.mcp.servers).length === 0) {
        return undefined;
    }
    const client = new client_1.MCPClient();
    for (const [name, config] of Object.entries(settings.mcp.servers)) {
        await client.connectServer(name, config);
    }
    return client;
}
//# sourceMappingURL=config.js.map