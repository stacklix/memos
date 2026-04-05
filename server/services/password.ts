const ITERATIONS = 100_000;

function toB64url(u8: Uint8Array): string {
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]!);
  const b64 = btoa(s);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const pad = (4 - (s.length % 4)) % 4;
  const b64 = (s + "=".repeat(pad)).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );
  const hash = new Uint8Array(bits);
  return `pbkdf2-sha256$${ITERATIONS}$${toB64url(salt)}$${toB64url(hash)}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const match = /^pbkdf2-sha256\$(\d+)\$([^$]+)\$([^$]+)$/.exec(stored);
  if (!match) return false;
  const iterations = Number(match[1]);
  const salt = fromB64url(match[2]!);
  const expectHash = fromB64url(match[3]!);
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );
  const out = new Uint8Array(bits);
  if (out.length !== expectHash.length) return false;
  let diff = 0;
  for (let i = 0; i < out.length; i++) diff |= out[i]! ^ expectHash[i]!;
  return diff === 0;
}
