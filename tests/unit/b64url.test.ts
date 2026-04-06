import { describe, expect, it } from "vitest";
import { b64urlToUtf8, utf8ToB64url } from "../../server/lib/b64url.js";

describe("b64url unit", () => {
  it("round-trips utf8 page token offsets", () => {
    const s = "12345";
    expect(b64urlToUtf8(utf8ToB64url(s))).toBe(s);
  });
});
