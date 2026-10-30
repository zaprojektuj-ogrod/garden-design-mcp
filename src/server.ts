// MCP Server setup — register tools, resources, prompts

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { ALL_TOOLS } from "./tools/index.js";
import { sendToBrowser, isConnected, WS_PORT } from "./bridge.js";
import { RESOURCES, readResource } from "./resources.js";
import { PROMPTS, getPromptMessages } from "./prompts.js";
import { createDispatcher, DESIGN_GUIDE_TOOL } from "./dispatch.js";

// Source of truth: package.json. Resolves to ../package.json from dist/server.js
// at runtime (and the same from src/server.ts under tsx, since import.meta.url
// tracks the source path). Avoids the prior duplicate-version drift.
const pkg = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"),
    "utf8",
  ),
) as { version: string };
const MCP_SERVER_VERSION = pkg.version;

// Server instructions, sent at initialize so every client sees them: how to talk with the owner
// and a pointer to get_design_guide. Clients cut instructions short (Claude Code: 2048 chars by
// default), so they stay short; get_design_guide serves the core rules the built-in assistant
// carries (agent-instructions.md), the MCP route's note in place of its chat note, and the guide.
const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file: string) => readFileSync(join(PKG_DIR, file), "utf8");
const MCP_INSTRUCTIONS = read("mcp-instructions.md");
const DESIGN_GUIDE = read("agent-instructions.md") + read("mcp-note.md") + "\n\n---\n\n" + read("agent-prompt.md");
const INSTRUCTIONS_LIMIT = 2048;
if (MCP_INSTRUCTIONS.length > INSTRUCTIONS_LIMIT) {
  console.error(`[MCP] mcp-instructions.md is ${MCP_INSTRUCTIONS.length} chars; clients truncate beyond ${INSTRUCTIONS_LIMIT}`);
}

// Connection status tool — handled locally (not forwarded to browser)
const CONNECTION_STATUS_TOOL = {
  name: "connection_status",
  description: "Check if the browser is connected",
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
};

// Version tool — reports MCP server + editor versions for capability checks at session start
const GET_VERSION_TOOL = {
  name: "get_version",
  description:
    "Returns version info for the MCP server and the connected browser editor. Use at session start to confirm you are talking to a build that supports the features you depend on (e.g. M25 plant-attribute search). Response: { mcpServer: { name, version }, editor: { version, buildTime, gitHash } | null }. The editor block is null when the browser is not connected.",
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
};


const dispatcher = createDispatcher(sendToBrowser, DESIGN_GUIDE);

export function createServer(): Server {
  const server = new Server(
    {
      name: "garden-editor-mcp",
      version: MCP_SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
      instructions: MCP_INSTRUCTIONS,
    }
  );

  // ── Tools ──

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: [...ALL_TOOLS, CONNECTION_STATUS_TOOL, GET_VERSION_TOOL, DESIGN_GUIDE_TOOL] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      // connection_status is handled locally
      if (name === "connection_status") {
        const connected = isConnected();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  connected,
                  wsPort: WS_PORT,
                  message: connected
                    ? "Browser is connected"
                    : "Browser not connected. Open the garden viewer with ?edit=true",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      // get_version is handled locally — merges MCP-server self-version with the browser editor's
      if (name === "get_version") {
        const mcpServer = { name: "garden-editor-mcp", version: MCP_SERVER_VERSION };
        let editor: unknown = null;
        if (isConnected()) {
          try {
            const browserResult = (await sendToBrowser("get_version", {})) as
              | { editor?: unknown }
              | undefined;
            editor = browserResult?.editor ?? null;
          } catch {
            // Browser is connected but the bridge does not implement get_version
            // (older editor build). Leave editor=null; caller can interpret as
            // "browser version unknown — likely pre-2.1 build".
            editor = null;
          }
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ mcpServer, editor }, null, 2),
            },
          ],
        };
      }

      return await dispatcher.callTool(name, args as Record<string, unknown> | undefined);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  // ── Resources ──

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: RESOURCES.map((r) => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType,
      })),
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    try {
      const text = await readResource(uri);
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text,
          },
        ],
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to read resource ${uri}: ${message}`);
    }
  });

  // ── Prompts ──

  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return {
      prompts: PROMPTS.map((p) => ({
        name: p.name,
        description: p.description,
        arguments: p.arguments,
      })),
    };
  });

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const messages = getPromptMessages(name, args);
      return { messages };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get prompt ${name}: ${message}`);
    }
  });

  return server;
}
