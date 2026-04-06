/**
 * Remove EXIF APP1 segment from JPEG bytes.
 * Best-effort parser: keeps original content on malformed structure by throwing.
 */
export function stripJpegExifMetadata(input: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBufferLike> {
  if (input.length < 4) return input;
  // SOI marker
  if (!(input[0] === 0xff && input[1] === 0xd8)) return input;

  const out: number[] = [0xff, 0xd8];
  let i = 2;

  while (i + 1 < input.length) {
    if (input[i] !== 0xff) {
      // Start of entropy-coded scan data, copy remainder.
      for (let j = i; j < input.length; j++) out.push(input[j]!);
      return new Uint8Array(out);
    }

    const marker = input[i + 1]!;
    // SOS / EOI: copy rest and finish.
    if (marker === 0xda || marker === 0xd9) {
      for (let j = i; j < input.length; j++) out.push(input[j]!);
      return new Uint8Array(out);
    }

    // Markers with no payload length.
    if (marker >= 0xd0 && marker <= 0xd7) {
      out.push(0xff, marker);
      i += 2;
      continue;
    }

    if (i + 3 >= input.length) throw new Error("invalid jpeg segment");
    const len = (input[i + 2]! << 8) | input[i + 3]!;
    if (len < 2 || i + 2 + len > input.length) throw new Error("invalid jpeg segment length");
    const segmentEnd = i + 2 + len;

    // Skip APP1 segment (commonly EXIF).
    if (marker !== 0xe1) {
      for (let j = i; j < segmentEnd; j++) out.push(input[j]!);
    }
    i = segmentEnd;
  }

  return new Uint8Array(out);
}
