export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function randomTokenHex(bytes = 32): string {
  const u = crypto.getRandomValues(new Uint8Array(bytes));
  return [...u].map((b) => b.toString(16).padStart(2, "0")).join("");
}
