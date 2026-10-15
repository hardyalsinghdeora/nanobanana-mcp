// stdio entrypoint — used by Claude Code, which launches this process itself.
// The HTTP entrypoint (server.js) is still what the Dockerfile / Cloud Run deploy runs.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./tools.js";

const server = buildServer();
await server.connect(new StdioServerTransport());
