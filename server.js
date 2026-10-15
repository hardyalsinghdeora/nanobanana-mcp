import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildServer, MODEL } from "./tools.js";

const PORT = process.env.PORT || 8080;

const app = express();
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
