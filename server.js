import { createHash, timingSafeEqual } from "node:crypto";
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildServer, MODEL } from "./tools.js";

const PORT = process.env.PORT || 8080;
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN || "";
const ALLOW_UNAUTHENTICATED = process.env.ALLOW_UNAUTHENTICATED === "true";

if (!AUTH_TOKEN) {
  if (!ALLOW_UNAUTHENTICATED) {
    console.error(
      "MCP_AUTH_TOKEN is not set. Refusing to start an unauthenticated HTTP server.\n" +
        "Set MCP_AUTH_TOKEN (e.g. `openssl rand -hex 32`), or set ALLOW_UNAUTHENTICATED=true to accept the risk."
    );
    process.exit(1);
  }
  console.warn(
    "WARNING: ALLOW_UNAUTHENTICATED=true and no MCP_AUTH_TOKEN: anyone who can reach /mcp can spend your Gemini quota."
  );
}

// Hash both sides so timingSafeEqual always compares equal-length buffers.
const digest = (value) => createHash("sha256").update(value, "utf8").digest();
const expectedDigest = AUTH_TOKEN ? digest(AUTH_TOKEN) : null;

function requireAuth(req, res, next) {
  if (!expectedDigest) return next();
  const match = /^Bearer\s+(.+)$/i.exec(req.get("authorization") || "");
  if (match && timingSafeEqual(digest(match[1].trim()), expectedDigest)) return next();
  res.set("WWW-Authenticate", 'Bearer realm="mcp"');
  return res.status(401).json({
    jsonrpc: "2.0",
    error: { code: -32001, message: "Unauthorized" },
    id: null,
  });
}

const app = express();
app.use("/mcp", requireAuth);
app.use(express.json({ limit: "25mb" }));

app.get("/healthz", (_req, res) => res.json({ ok: true, model: MODEL }));

app.post("/mcp", async (req, res) => {
  try {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request failed:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

app.get("/mcp", (_req, res) =>
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Stateless server: POST only" },
    id: null,
  })
);

app.listen(PORT, () => console.log(`Nano Banana MCP listening on :${PORT} (model: ${MODEL})`));
