# Nano Banana MCP server

A minimal MCP server that gives Claude real image generation via Google's Nano Banana (Gemini image model). Two tools:

- `generate_image(prompt)` — text → image, returned inline in chat
- `edit_image(prompt, reference_image_url)` — image + text → image, for "same room, new camera angle" consistency or targeted edits

Stateless Streamable-HTTP transport, verified against the MCP `initialize` / `tools/list` handshake.

## 1. Get a Gemini API key (free tier works)

https://aistudio.google.com/apikey — copy the key.

## 2. Deploy (pick one)

**Google Cloud Run** (simplest for a Google API):
```bash
gcloud run deploy nanobanana-mcp --source . --region asia-south1 \
  --allow-unauthenticated --set-env-vars GEMINI_API_KEY=YOUR_KEY
```
Note the service URL it prints, e.g. `https://nanobanana-mcp-xxxx.run.app`.

**Railway / Render**: create a new service from this folder (Dockerfile is included), set `GEMINI_API_KEY` in the environment settings, deploy, note the public URL.

**Local test** (before deploying):
```bash
GEMINI_API_KEY=YOUR_KEY npm start
curl http://localhost:8080/healthz
```

## 3. Add it to Claude

claude.ai → **Settings → Connectors → Add custom connector** →
- Name: `Nano Banana`
- URL: `https://YOUR-DEPLOY-URL/mcp`  ← don't forget the `/mcp` path

Then enable it in the chat's connector menu. Ask Claude to "generate an image of …" and the render appears inline.

Claude Code instead: `claude mcp add --transport http nanobanana https://YOUR-DEPLOY-URL/mcp`

## Notes

- The endpoint is public and unauthenticated (claude.ai custom connectors without OAuth). Your Gemini key stays server-side, but anyone with the URL can generate images on your quota — keep the URL private, or put the service behind Cloud Run IAM + an OAuth layer if that matters.
- Model is pinned via `GEMINI_IMAGE_MODEL` (default `gemini-2.5-flash-image`). If Google has shipped a newer Nano Banana model, change the env var — no code change needed.
- `edit_image` needs a *publicly fetchable* image URL. Easiest flow: generate shot 1, save it, upload it somewhere reachable (Drive with link sharing, Imgur, your own bucket), then reference it.
- Free-tier Gemini has daily image limits; a 429 from the API will surface as a tool error in chat.

## Local setup (Claude Code, stdio — no deploy)

Claude Code launches the server itself, so nothing has to stay running and no
public endpoint is exposed. The tool definitions live in `tools.js`, shared by
two entrypoints: `stdio.js` (Claude Code) and `server.js` (HTTP / Cloud Run).

The key is read from `claude-vault` at launch by
`~/Workspace/Claude/Scripts/nanobanana-mcp.sh`, so it never lands in
`~/.claude.json`, a `.env`, or the process argv:

```bash
npm install
claude mcp add --scope user nanobanana -- ~/Workspace/Claude/Scripts/nanobanana-mcp.sh
claude mcp get nanobanana        # expect: ✔ Connected
```

Switch models by editing `GEMINI_IMAGE_MODEL` in that launcher (as of 2026-08-30
the account also has `gemini-3.1-flash-image` and `gemini-3-pro-image`).
