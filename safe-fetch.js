// Guarded fetch for user-supplied image URLs (edit_image's reference_image_url).
// Blocks SSRF to loopback / private / link-local / metadata addresses, refuses
// redirects, applies a timeout and enforces a size cap while reading.
import { BlockList, isIP } from "node:net";
import { lookup } from "node:dns/promises";

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;

const blocked = new BlockList();
// IPv4
blocked.addSubnet("0.0.0.0", 8, "ipv4"); // "this" network
blocked.addSubnet("10.0.0.0", 8, "ipv4"); // private
blocked.addSubnet("100.64.0.0", 10, "ipv4"); // CGNAT
blocked.addSubnet("127.0.0.0", 8, "ipv4"); // loopback
blocked.addSubnet("169.254.0.0", 16, "ipv4"); // link-local (cloud metadata)
blocked.addSubnet("172.16.0.0", 12, "ipv4"); // private
blocked.addSubnet("192.0.0.0", 24, "ipv4"); // IETF protocol assignments
blocked.addSubnet("192.168.0.0", 16, "ipv4"); // private
blocked.addSubnet("198.18.0.0", 15, "ipv4"); // benchmarking
blocked.addSubnet("224.0.0.0", 4, "ipv4"); // multicast
blocked.addSubnet("240.0.0.0", 4, "ipv4"); // reserved + broadcast
// IPv6
blocked.addAddress("::", "ipv6"); // unspecified
blocked.addAddress("::1", "ipv6"); // loopback
blocked.addSubnet("64:ff9b::", 96, "ipv6"); // NAT64
blocked.addSubnet("fc00::", 7, "ipv6"); // unique-local
blocked.addSubnet("fe80::", 10, "ipv6"); // link-local
blocked.addSubnet("ff00::", 8, "ipv6"); // multicast

/** True if the IP literal must not be fetched. */
export function isBlockedAddress(address) {
  const family = isIP(address);
  if (family === 4) return blocked.check(address, "ipv4");
  if (family === 6) {
    // Canonicalize (WHATWG URL compresses and lowercases IPv6), then unwrap
    // IPv4-mapped addresses (::ffff:a.b.c.d / ::ffff:XXXX:XXXX) and check them as IPv4.
    const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
    const mapped = canonical.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mapped) {
      const hi = parseInt(mapped[1], 16);
      const lo = parseInt(mapped[2], 16);
      return blocked.check(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`, "ipv4");
    }
    return blocked.check(canonical, "ipv6");
  }
  return true; // not an IP literal: refuse
}

/** Parse and validate the URL and every address its hostname resolves to. */
export async function assertSafeImageUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("reference_image_url is not a valid URL");
  }
  if (url.protocol !== "https:") throw new Error("reference_image_url must use https");
  if (url.username || url.password) throw new Error("reference_image_url must not contain credentials");

  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses;
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error("Could not resolve reference image host");
  }
  if (!addresses.length || addresses.some((a) => isBlockedAddress(a.address))) {
    throw new Error("reference_image_url points to a disallowed address");
  }
  return url;
}

export async function fetchImageAsBase64(rawUrl) {
  const url = await assertSafeImageUrl(rawUrl);

  let res;
  try {
    res = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch {
    throw new Error("Could not fetch reference image");
  }
  if (!res.ok) throw new Error("Could not fetch reference image");

  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
    await res.body?.cancel();
    throw new Error("Reference image too large (>15MB)");
  }

  const chunks = [];
  let total = 0;
  try {
    for await (const chunk of res.body) {
      total += chunk.byteLength;
      if (total > MAX_IMAGE_BYTES) throw new RangeError("too large");
      chunks.push(chunk);
    }
  } catch (err) {
    await res.body?.cancel().catch(() => {});
    if (err instanceof RangeError) throw new Error("Reference image too large (>15MB)");
    throw new Error("Could not fetch reference image");
  }

  const mime = (res.headers.get("content-type") || "image/png").split(";")[0].trim();
  return { data: Buffer.concat(chunks).toString("base64"), mimeType: mime };
}
