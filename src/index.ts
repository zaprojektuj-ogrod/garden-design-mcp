#!/usr/bin/env node

// Entry point — parse args, select transport, start MCP server

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main() {
  const args = process.argv.slice(2);

  // Parse --transport flag (default: stdio)
  const transportIndex = args.indexOf("--transport");
  const transport =
    transportIndex !== -1 ? args[transportIndex + 1] : "stdio";

  const server = createServer();

  if (transport === "http") {
    // Parse --port flag (default: 8080)
    const portIndex = args.indexOf("--port");
    const port = portIndex !== -1 ? parseInt(args[portIndex + 1], 10) : 8080;

    // Dynamically import StreamableHTTPServerTransport (optional dep)
    try {
      const { StreamableHTTPServerTransport } = await import(
        "@modelcontextprotocol/sdk/server/streamableHttp.js"
      );
      const httpTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      // Create basic HTTP server
      const http = await import("node:http");
      const httpServer = http.createServer(async (req, res) => {
        if (req.url === "/mcp") {
          await httpTransport.handleRequest(req, res);
        } else {
          res.writeHead(404);
          res.end("Not found");
        }
      });

      await server.connect(httpTransport);
      httpServer.listen(port, () => {
        console.error(
          `[MCP] Garden Editor MCP server started (HTTP) on port ${port}`
        );
      });
    } catch (e) {
      console.error(
        "[MCP] Failed to start HTTP transport. Ensure @modelcontextprotocol/sdk supports StreamableHTTPServerTransport.",
        e
      );
      process.exit(1);
    }
  } else {
    // Default: stdio transport
    const stdioTransport = new StdioServerTransport();
    await server.connect(stdioTransport);
    console.error("[MCP] Garden Editor MCP server started (stdio)");
  }
}

main().catch((error) => {
  console.error("[MCP] Fatal error:", error);
  process.exit(1);
});
