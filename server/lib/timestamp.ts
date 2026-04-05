/** Proto JSON encoding for google.protobuf.Timestamp (RFC 3339). */
export function toProtoTimestamp(date: Date): { seconds: string; nanos: number } {
  const ms = date.getTime();
  const seconds = Math.floor(ms / 1000);
  const nanos = (ms % 1000) * 1_000_000;
  return { seconds: String(seconds), nanos };
}

export function timestampFromDate(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function parseTimestamp(iso: string): Date {
  return new Date(iso);
}
