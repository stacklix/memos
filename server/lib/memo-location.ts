/** REST JSON body → DB fields for memos.api.v1.Location. */

export type MemoLocationDb = {
  location_placeholder: string;
  location_latitude: number;
  location_longitude: number;
};

/**
 * Match golang `convertLocationToStore`: pass through proto fields with JSON defaults
 * (empty placeholder, 0,0 for omitted numbers). Reject wrong JSON types and non-finite numbers.
 */
function parseLocationObject(
  raw: Record<string, unknown>,
): { ok: true; value: MemoLocationDb } | { ok: false; message: string } {
  const phRaw = raw.placeholder;
  if (phRaw !== undefined && phRaw !== null && typeof phRaw !== "string") {
    return { ok: false, message: "location.placeholder must be a string" };
  }
  const placeholder = typeof phRaw === "string" ? phRaw : "";

  const latRaw = raw.latitude;
  if (latRaw !== undefined && latRaw !== null) {
    if (typeof latRaw !== "number" || !Number.isFinite(latRaw)) {
      return { ok: false, message: "location.latitude must be a finite number" };
    }
  }
  const latitude = typeof latRaw === "number" && Number.isFinite(latRaw) ? latRaw : 0;

  const lngRaw = raw.longitude;
  if (lngRaw !== undefined && lngRaw !== null) {
    if (typeof lngRaw !== "number" || !Number.isFinite(lngRaw)) {
      return { ok: false, message: "location.longitude must be a finite number" };
    }
  }
  const longitude = typeof lngRaw === "number" && Number.isFinite(lngRaw) ? lngRaw : 0;

  return {
    ok: true,
    value: {
      location_placeholder: placeholder,
      location_latitude: latitude,
      location_longitude: longitude,
    },
  };
}

/** Create: absent / null → no location; object → same rules as Go CreateMemo. */
export function parseMemoLocationForCreate(
  raw: unknown,
): { ok: true; value: MemoLocationDb | null } | { ok: false; message: string } {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, message: "memo.location must be an object" };
  }
  return parseLocationObject(raw as Record<string, unknown>);
}

/** Patch: absent → omit; null → clear; object → set (same as Go UpdateMemo). */
export function parseMemoLocationForPatch(
  raw: unknown,
):
  | { kind: "omit" }
  | { kind: "clear" }
  | { kind: "set"; value: MemoLocationDb }
  | { kind: "error"; message: string } {
  if (raw === undefined) return { kind: "omit" };
  if (raw === null) return { kind: "clear" };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { kind: "error", message: "memo.location must be an object or null" };
  }
  const parsed = parseLocationObject(raw as Record<string, unknown>);
  if (!parsed.ok) return { kind: "error", message: parsed.message };
  return { kind: "set", value: parsed.value };
}
