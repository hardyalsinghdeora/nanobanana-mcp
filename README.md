# Nano Banana MCP server

A minimal MCP server that gives Claude real image generation via Google's Nano Banana (Gemini image model). Two tools:

- `generate_image(prompt)` — text → image, returned inline in chat
- `edit_image(prompt, reference_image_url)` — image + text → image, for "same room, new camera angle" consistency or targeted edits

Stateless Streamable-HTTP transport, verified against the MCP `initialize` / `tools/list` handshake.

## 1. Get a Gemini API key (free tier works)

https://aistudio.google.com/apikey — copy the key.

## 2. Deploy (pick one)

The HTTP server requires a bearer token. Generate one and keep it secret:
```bash
export MCP_AUTH_TOKEN=$(openssl rand -hex 32)
```
Clients must send `Authorization: Bearer $MCP_AUTH_TOKEN` on every `POST /mcp`.
If `MCP_AUTH_TOKEN` is unset the server refuses to start, unless you explicitly set
`ALLOW_UNAUTHENTICATED=true` (not recommended: anyone with the URL can spend your Gemini quota).

**Google Cloud Run** (simplest for a Google API):
```bash
gcloud run deploy nanobanana-mcp --source . --region asia-south1 \
  --allow-unauthenticated \
  --set-env-vars GEMINI_API_KEY=YOUR_KEY,MCP_AUTH_TOKEN=$MCP_AUTH_TOKEN
```
`--allow-unauthenticated` here only disables Cloud Run IAM so the request reaches the
container; the app itself still rejects requests without the bearer token. For real
deployments prefer storing both values in Secret Manager (`--set-secrets`) instead of plain env vars.
Note the service URL it prints, e.g. `https://nanobanana-mcp-xxxx.run.app`.

**Railway / Render**: create a new service from this folder (Dockerfile is included), set `GEMINI_API_KEY` and `MCP_AUTH_TOKEN` in the environment settings, deploy, note the public URL.

**Local test** (before deploying). Nothing loads `.env` automatically: either export the
variables, or copy `.env.example` to `.env` and use `npm run start:env` (Node's built-in `--env-file`).
```bash
GEMINI_API_KEY=YOUR_KEY MCP_AUTH_TOKEN=$MCP_AUTH_TOKEN npm start
curl http://localhost:8080/healthz
```

## 3. Add it to Claude

claude.ai → **Settings → Connectors → Add custom connector** →
- Name: `Nano Banana`
- URL: `https://YOUR-DEPLOY-URL/mcp`  ← don't forget the `/mcp` path

Then enable it in the chat's connector menu. Ask Claude to "generate an image of …" and the render appears inline.

Note: a claude.ai custom connector cannot send a static `Authorization` header, so it will
get `401` from a token-protected server. Use Claude Code (below) or the local stdio setup,
or put an OAuth layer in front of the service if you need the claude.ai connector.

Claude Code instead:
```bash
claude mcp add --transport http nanobanana https://YOUR-DEPLOY-URL/mcp \
  --header "Authorization: Bearer $MCP_AUTH_TOKEN"
```

## Notes

- `POST /mcp` requires `Authorization: Bearer <MCP_AUTH_TOKEN>`. Your Gemini key stays server-side; rotate the token if it leaks.
- Model is pinned via `GEMINI_IMAGE_MODEL` (default `gemini-2.5-flash-image`). If Google has shipped a newer Nano Banana model, change the env var — no code change needed.
- `edit_image` needs a *publicly fetchable* `https` image URL (max 15 MB). Redirects are refused, and URLs that resolve to loopback, private, link-local or other internal addresses are rejected. Easiest flow: generate shot 1, save it, upload it somewhere reachable (Drive with link sharing, Imgur, your own bucket), then reference it.
- Free-tier Gemini has daily image limits; a 429 from the API will surface as a tool error in chat.

## Local setup (Claude Code, stdio — no deploy)

Claude Code launches the server itself, so nothing has to stay running and no
public endpoint is exposed. The tool definitions live in `tools.js`, shared by
two entrypoints: `stdio.js` (Claude Code) and `server.js` (HTTP / Cloud Run).

Register it with the key passed as an environment variable:

```bash
npm install
claude mcp add --scope user nanobanana \
  --env GEMINI_API_KEY=YOUR_KEY \
  -- node /absolute/path/to/nanobanana-mcp/stdio.js
claude mcp get nanobanana        # expect: Connected
```

`--env` stores the key in your Claude Code config. To keep it out of that file, point
`claude mcp add` at a small launcher script of your own that reads the key from your
secret manager (e.g. `pass`, 1Password CLI, macOS Keychain), exports `GEMINI_API_KEY`
and then runs `exec node /absolute/path/to/nanobanana-mcp/stdio.js`.

Switch models with `GEMINI_IMAGE_MODEL` (add `--env GEMINI_IMAGE_MODEL=...`).
