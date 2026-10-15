import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";

if (!GEMINI_KEY) {
  console.error("GEMINI_API_KEY is not set. Get one free at https://aistudio.google.com/apikey");
  process.exit(1);
}

export { MODEL };

async function callGemini(parts) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini API ${res.status}: ${body.slice(0, 500)}`);
  }
  const data = await res.json();
  const outParts = data?.candidates?.[0]?.content?.parts || [];
  const img = outParts.find((p) => p.inlineData);
  const text = outParts.filter((p) => p.text).map((p) => p.text).join("\n");
  if (!img) throw new Error(`No image returned. Model said: ${text || "(nothing)"}`);
  return { b64: img.inlineData.data, mime: img.inlineData.mimeType || "image/png", text };
}

async function fetchImageAsBase64(imageUrl) {
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Could not fetch reference image (${res.status})`);
  const mime = res.headers.get("content-type") || "image/png";
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 15 * 1024 * 1024) throw new Error("Reference image too large (>15MB)");
  return { data: buf.toString("base64"), mimeType: mime.split(";")[0] };
}

export function buildServer() {
  const server = new McpServer({ name: "nanobanana", version: "1.0.0" });

  server.registerTool(
    "generate_image",
    {
      title: "Generate image (Nano Banana)",
      description:
        "Generate a photorealistic or stylized image from a text prompt using Google's Nano Banana (Gemini image model). Returns the image inline. For a series of consistent images (same room/character, new angle), first generate one, then use edit_image with its URL as reference.",
      inputSchema: {
        prompt: z.string().describe("Full image description: subject, style, materials, lighting, camera position, aspect ratio."),
      },
    },
    async ({ prompt }) => {
      const { b64, mime, text } = await callGemini([{ text: prompt }]);
      const content = [{ type: "image", data: b64, mimeType: mime }];
      if (text) content.push({ type: "text", text });
      return { content };
    }
  );

  server.registerTool(
    "edit_image",
    {
      title: "Edit / re-shoot image (Nano Banana)",
      description:
        "Generate a new image using an existing image as reference — e.g. 'same room as this image, camera at the window looking at the headboard wall', or targeted edits like 'make the curtains white'. Pass a publicly fetchable image URL as reference_image_url.",
      inputSchema: {
        prompt: z.string().describe("What to change or which new camera angle/scene to produce, referencing the input image."),
        reference_image_url: z.string().url().describe("Publicly accessible URL of the reference image (https)."),
      },
    },
    async ({ prompt, reference_image_url }) => {
      const ref = await fetchImageAsBase64(reference_image_url);
      const { b64, mime, text } = await callGemini([
        { inlineData: ref },
        { text: prompt },
      ]);
      const content = [{ type: "image", data: b64, mimeType: mime }];
      if (text) content.push({ type: "text", text });
      return { content };
    }
  );

  return server;
}
