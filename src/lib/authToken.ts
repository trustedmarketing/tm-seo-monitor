// lib/authToken.ts — signed role cookie, verified in edge middleware.
const enc = new TextEncoder();

async function hmacKey(secret: string) {
  return crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]
  );
}

export type Role = "admin" | "viewer";

export async function makeToken(role: Role, secret: string): Promise<string> {
  const exp = Date.now() + 30 * 86_400_000; // 30 days
  const data = `${role}.${exp}`;
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(data));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${data}.${hex}`;
}

export async function verifyToken(token: string | undefined, secret: string): Promise<Role | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [role, expStr, hex] = parts;
  if (role !== "admin" && role !== "viewer") return null;
  if (Date.now() > Number(expStr)) return null;
  const pairs = hex.match(/.{2}/g);
  if (!pairs) return null;
  const sig = new Uint8Array(pairs.map((h) => parseInt(h, 16)));
  const ok = await crypto.subtle.verify(
    "HMAC", await hmacKey(secret), sig, enc.encode(`${role}.${expStr}`)
  );
  return ok ? (role as Role) : null;
}
