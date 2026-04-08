export type OAuth2FieldMapping = {
  identifier: string;
  displayName: string;
  email: string;
  avatarUrl: string;
};

export type OAuth2Config = {
  clientId: string;
  clientSecret: string;
  authUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scopes: string[];
  fieldMapping: OAuth2FieldMapping;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function readString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function readStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

export function parseOAuth2Config(raw: unknown): OAuth2Config | null {
  const obj = asRecord(raw);
  if (!obj) return null;
  const fm = asRecord(obj.fieldMapping) ?? {};
  const cfg: OAuth2Config = {
    clientId: readString(obj.clientId),
    clientSecret: readString(obj.clientSecret),
    authUrl: readString(obj.authUrl),
    tokenUrl: readString(obj.tokenUrl),
    userInfoUrl: readString(obj.userInfoUrl),
    scopes: readStringArray(obj.scopes),
    fieldMapping: {
      identifier: readString(fm.identifier),
      displayName: readString(fm.displayName),
      email: readString(fm.email),
      avatarUrl: readString(fm.avatarUrl),
    },
  };
  if (
    !cfg.clientId ||
    !cfg.clientSecret ||
    !cfg.tokenUrl ||
    !cfg.userInfoUrl ||
    !cfg.fieldMapping.identifier
  ) {
    return null;
  }
  return cfg;
}

function readJsonOrForm(data: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(data) as unknown;
    return asRecord(parsed) ?? {};
  } catch {
    const out: Record<string, unknown> = {};
    const p = new URLSearchParams(data);
    for (const [k, v] of p.entries()) out[k] = v;
    return out;
  }
}

function getOAuthRequestHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    "User-Agent": "memos-oauth2-client",
    Accept: "application/json",
    ...extra,
  };
}

export async function exchangeOAuth2Token(args: {
  config: OAuth2Config;
  redirectUri: string;
  code: string;
  codeVerifier?: string;
}): Promise<string> {
  const form = new URLSearchParams();
  form.set("grant_type", "authorization_code");
  form.set("code", args.code);
  form.set("redirect_uri", args.redirectUri);
  form.set("client_id", args.config.clientId);
  form.set("client_secret", args.config.clientSecret);
  if (args.codeVerifier) form.set("code_verifier", args.codeVerifier);
  const resp = await fetch(args.config.tokenUrl, {
    method: "POST",
    headers: getOAuthRequestHeaders({
      "Content-Type": "application/x-www-form-urlencoded",
    }),
    body: form.toString(),
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`failed to exchange token: ${resp.status} ${text}`.trim());
  }
  const tokenPayload = readJsonOrForm(text);
  const token = readString(tokenPayload.access_token);
  if (!token) throw new Error("missing access token from authorization response");
  return token;
}

function pickClaim(claims: Record<string, unknown>, key: string): string {
  if (!key) return "";
  const parts = key.split(".").filter((x) => x.length > 0);
  let cur: unknown = claims;
  for (const part of parts) {
    const rec = asRecord(cur);
    if (!rec) return "";
    cur = rec[part];
  }
  return typeof cur === "string" ? cur : "";
}

export async function fetchOAuth2UserInfo(args: {
  config: OAuth2Config;
  accessToken: string;
}): Promise<{
  identifier: string;
  displayName: string;
  email: string;
  avatarUrl: string;
}> {
  const resp = await fetch(args.config.userInfoUrl, {
    method: "GET",
    headers: getOAuthRequestHeaders({
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.accessToken}`,
    }),
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`failed to get user information: ${resp.status} ${text}`.trim());
  }
  const claims = readJsonOrForm(text);
  const identifier = pickClaim(claims, args.config.fieldMapping.identifier);
  if (!identifier) {
    throw new Error(`identifier claim "${args.config.fieldMapping.identifier}" is missing`);
  }
  const displayName = pickClaim(claims, args.config.fieldMapping.displayName) || identifier;
  const email = pickClaim(claims, args.config.fieldMapping.email);
  const avatarUrl = pickClaim(claims, args.config.fieldMapping.avatarUrl);
  return { identifier, displayName, email, avatarUrl };
}
