// WebSocket client — connects to the browser's WebSocketBridge

import { WebSocketServer, WebSocket } from "ws";

// The editor always dials 3333; another port is for harnesses that proxy the
// browser socket (e.g. eval runs beside an interactive session).
const WS_PORT = Number(process.env.GARDEN_MCP_WS_PORT) || 3333;

let browserClient: WebSocket | null = null;
const pendingRequests = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();
let requestId = 0;

// Start WebSocket server for browser connections
const wss = new WebSocketServer({ port: WS_PORT });

wss.on("connection", (ws) => {
  console.error(`[MCP] Browser connected`);
  browserClient = ws;

  ws.on("message", (data) => {
    try {
      const message = JSON.parse(data.toString());
      if (message.type === "response" && message.id) {
        const pending = pendingRequests.get(message.id);
        if (pending) {
          pendingRequests.delete(message.id);
          if (message.error) {
            pending.reject(new Error(message.error));
          } else {
            pending.resolve(message.result);
          }
        }
      }
    } catch (e) {
      console.error("[MCP] Error parsing message:", e);
    }
  });

  ws.on("close", () => {
    console.error(`[MCP] Browser disconnected`);
    if (browserClient === ws) {
      browserClient = null;
    }
  });

  ws.on("error", (error) => {
    console.error(`[MCP] WebSocket error:`, error);
  });
});

console.error(`[MCP] WebSocket server listening on ws://localhost:${WS_PORT}`);

/**
 * Send a command to the browser and wait for a response.
 *
 * @param timeoutMs Per-call timeout (default 30 s). Use a longer value for
 *                  tools that wrap genuinely slow remote services — e.g.
 *                  `import_buildings` waits on the ULDK grid scan, which
 *                  takes 1–2 minutes for a residential parcel.
 */
export async function sendToBrowser(
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number = 30000
): Promise<unknown> {
  if (!browserClient || browserClient.readyState !== WebSocket.OPEN) {
    throw new Error(
      "Browser not connected. Open the garden viewer with ?edit=true"
    );
  }

  const id = `req_${++requestId}`;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error("Request timeout — browser did not respond"));
    }, timeoutMs);

    pendingRequests.set(id, {
      resolve: (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    });

    browserClient!.send(
      JSON.stringify({ type: "request", id, method, params })
    );
  });
}

/**
 * Check if a browser client is currently connected
 */
export function isConnected(): boolean {
  return browserClient !== null && browserClient.readyState === WebSocket.OPEN;
}

export { WS_PORT };
