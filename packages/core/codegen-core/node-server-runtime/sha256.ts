// The SHA-256 digests of the boundary (the strong ETag, the throttle bucket key, the idempotency key) on Web Crypto,
// so every server target, Node or Web-standard, derives the same text. Copied into the generated tree as is.
const BASE64_PAD = /=+$/;

/** The SHA-256 of the UTF-8 text or the bytes, as lowercase hex. */
export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const digest = await sha256(input);

  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The SHA-256 of the UTF-8 text or the bytes, as unpadded base64url. */
export async function sha256Base64Url(input: string | Uint8Array): Promise<string> {
  const digest = await sha256(input);

  return btoa(String.fromCharCode(...digest))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(BASE64_PAD, "");
}

async function sha256(input: string | Uint8Array): Promise<Uint8Array> {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  // A copy into a fresh buffer: `digest` takes an `ArrayBuffer`-backed view, which a Node `Buffer` may not be.
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));

  return new Uint8Array(digest);
}
