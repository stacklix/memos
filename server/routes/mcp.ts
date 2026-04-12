/**
 * MCP (Model Context Protocol) server for Memos.
 *
 * Exposes memo operations as MCP tools so any MCP-compatible AI client
 * (Claude Desktop, Cursor, Zed, etc.) can interact with the Memos instance.
 *
 * Endpoint: ANY /mcp  (Streamable HTTP transport, MCP spec 2025-03-26)
 *
 * Authentication: Bearer <JWT-access-token> or Bearer <memos_pat_...>
 * Public reads (list/get public memos, list tags) work without auth.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import type { AppDeps } from "../types/deps.js";
import { createRepository } from "../db/repository.js";
import { verifyAccessToken } from "../services/jwt-access.js";
import { memoToJson, attachmentToJson } from "../lib/serializers.js";
import { normalizeMemoStateFromClient, normalizeMemoVisibilityFromClient } from "../lib/memo-enums.js";
import { parseMemoListFilter, memoRowMatchesFilter, memoListFilterNeedsMemory, MEMO_FILTER_MAX_SCAN } from "../lib/memo-filter.js";
import type { DbMemoRow } from "../db/repository.js";

/** Resolve auth from an HTTP request (Bearer JWT or PAT). */
async function resolveAuth(
  req: Request,
  repo: ReturnType<typeof createRepository>,
  jwtSecret: string | null,
): Promise<{ username: string; role: "ADMIN" | "USER" } | null> {
  const header = req.headers.get("authorization");
  const bearer = header?.match(/^\s*Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!bearer) return null;
  if (jwtSecret) {
    const access = await verifyAccessToken(bearer, jwtSecret);
    if (access) {
      let username: string | null = null;
      if (access.userId != null) {
        const u = await repo.getUserByInternalId(access.userId);
        username = u?.username ?? null;
      }
      if (!username && access.username) username = access.username;
      if (username) return { username, role: access.role };
    }
  }
  if (bearer.startsWith("memos_pat_")) {
    const user = await repo.findUserByPat(bearer);
    if (user) return { username: user.username, role: user.role === "ADMIN" ? "ADMIN" : "USER" };
  }
  return null;
}

/** Returns true if the Origin header is acceptable (same host or no origin). */
function isAllowedOrigin(req: Request, instanceUrl: string): boolean {
  const origin = req.headers.get("Origin");
  if (!origin) return true; // CLI / desktop clients don't send Origin
  try {
    const originHost = new URL(origin).host;
    const reqHost = req.headers.get("host") ?? "";
    if (originHost === reqHost) return true;
    if (instanceUrl) {
      const instanceHost = new URL(instanceUrl).host;
      if (originHost === instanceHost) return true;
    }
  } catch {
    // malformed origin → deny
  }
  return false;
}

function memoIdFromName(name: string): string | null {
  const p = name.startsWith("memos/") ? name.slice("memos/".length) : name;
  return p.length > 0 ? p : null;
}

function canViewMemo(m: DbMemoRow, auth: { username: string } | null): boolean {
  if (m.visibility === "PUBLIC") return true;
  if (!auth) return false;
  if (m.visibility === "PROTECTED") return true;
  return m.creator_username === auth.username;
}

/** Build the shared McpServer with all tools registered. */
function buildMcpServer(
  repo: ReturnType<typeof createRepository>,
  authRef: { value: { username: string; role: "ADMIN" | "USER" } | null },
): McpServer {
  const server = new McpServer({ name: "Memos", version: "1.0.0" });

  // ── Memo tools ─────────────────────────────────────────────────────────

  server.tool(
    "list_memos",
    "List memos. Authenticated users see their own and visible memos; unauthenticated callers see public memos only.",
    {
      page_size: z.number().int().min(1).max(200).optional().describe("Max results to return (default 50)"),
      page: z.number().int().min(1).optional().describe("1-based page number (default 1)"),
      state: z.enum(["NORMAL", "ARCHIVED"]).optional().describe("Memo state filter (default NORMAL)"),
      order_by_pinned: z.boolean().optional().describe("When true, pinned memos appear first"),
      filter: z.string().optional().describe("CEL-style filter (e.g. 'creator == \"users/alice\"')"),
    },
    async ({ page_size = 50, page = 1, state = "NORMAL", filter = "" }) => {
      const auth = authRef.value;
      const pageSize = Math.min(200, Math.max(1, page_size));
      const offset = (Math.max(1, page) - 1) * pageSize;
      const parsed = parseMemoListFilter(filter);
      const needsMemory = memoListFilterNeedsMemory(parsed);

      let rows: DbMemoRow[];
      const baseArgs = {
        state,
        ...(auth ? { viewerUsername: auth.username } : { visibility: "PUBLIC" }),
      };

      if (needsMemory) {
        const all = await repo.listMemosTopLevel({
          ...baseArgs,
          limit: MEMO_FILTER_MAX_SCAN,
          offset: 0,
        });
        const filtered = all.filter((m) => memoRowMatchesFilter(m, parsed));
        rows = filtered.slice(offset, offset + pageSize);
      } else {
        rows = await repo.listMemosTopLevel({
          ...baseArgs,
          limit: pageSize,
          offset,
        });
      }

      const memos = await Promise.all(
        rows.map(async (m) => {
          const atts = await repo.listAttachments({ memoUid: m.id, limit: 100, offset: 0 });
          return memoToJson(m, { attachments: atts.map(attachmentToJson) });
        }),
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(memos, null, 2) }] };
    },
  );

  server.tool(
    "get_memo",
    "Get a single memo by resource name.",
    { name: z.string().describe("Memo resource name, e.g. memos/abc123") },
    async ({ name }) => {
      const id = memoIdFromName(name);
      if (!id) return { content: [{ type: "text" as const, text: "invalid memo name" }], isError: true };
      const auth = authRef.value;
      const row = await repo.getMemoById(id);
      if (!row || row.parent_memo_id) {
        return { content: [{ type: "text" as const, text: "memo not found" }], isError: true };
      }
      if (!canViewMemo(row, auth)) {
        return { content: [{ type: "text" as const, text: "permission denied" }], isError: true };
      }
      const atts = await repo.listAttachments({ memoUid: row.id, limit: 100, offset: 0 });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(memoToJson(row, { attachments: atts.map(attachmentToJson) }), null, 2) }],
      };
    },
  );

  server.tool(
    "search_memos",
    "Full-text search of memo content.",
    {
      query: z.string().min(1).describe("Search query string"),
      page_size: z.number().int().min(1).max(200).optional(),
    },
    async ({ query, page_size = 50 }) => {
      const auth = authRef.value;
      const all = await repo.listMemosTopLevel({
        state: "NORMAL",
        ...(auth ? { viewerUsername: auth.username } : { visibility: "PUBLIC" }),
        limit: MEMO_FILTER_MAX_SCAN,
        offset: 0,
      });
      const matched = all
        .filter((m) => m.content.toLowerCase().includes(query.toLowerCase()))
        .slice(0, page_size);
      const memos = await Promise.all(
        matched.map(async (m) => {
          const atts = await repo.listAttachments({ memoUid: m.id, limit: 100, offset: 0 });
          return memoToJson(m, { attachments: atts.map(attachmentToJson) });
        }),
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(memos, null, 2) }] };
    },
  );

  server.tool(
    "create_memo",
    "Create a new memo. Requires authentication.",
    {
      content: z.string().min(1).describe("Memo content (Markdown)"),
      visibility: z.enum(["PUBLIC", "PROTECTED", "PRIVATE"]).optional().describe("Visibility (default PRIVATE)"),
    },
    async ({ content, visibility = "PRIVATE" }) => {
      const auth = authRef.value;
      if (!auth) return { content: [{ type: "text" as const, text: "authentication required" }], isError: true };
      const id = crypto.randomUUID();
      const row = await repo.createMemo({
        id,
        creator: auth.username,
        content,
        visibility: normalizeMemoVisibilityFromClient(visibility),
        state: "NORMAL",
        pinned: false,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(memoToJson(row), null, 2) }] };
    },
  );

  server.tool(
    "update_memo",
    "Update a memo you own (or any memo if admin). Requires authentication.",
    {
      name: z.string().describe("Memo resource name, e.g. memos/abc123"),
      content: z.string().optional().describe("New content"),
      visibility: z.enum(["PUBLIC", "PROTECTED", "PRIVATE"]).optional(),
      pinned: z.boolean().optional(),
      state: z.enum(["NORMAL", "ARCHIVED"]).optional(),
    },
    async ({ name, content, visibility, pinned, state }) => {
      const auth = authRef.value;
      if (!auth) return { content: [{ type: "text" as const, text: "authentication required" }], isError: true };
      const id = memoIdFromName(name);
      if (!id) return { content: [{ type: "text" as const, text: "invalid memo name" }], isError: true };
      const row = await repo.getMemoById(id);
      if (!row) return { content: [{ type: "text" as const, text: "memo not found" }], isError: true };
      if (row.creator_username !== auth.username && auth.role !== "ADMIN") {
        return { content: [{ type: "text" as const, text: "permission denied" }], isError: true };
      }
      await repo.updateMemo(id, {
        content,
        visibility: visibility !== undefined ? normalizeMemoVisibilityFromClient(visibility) : undefined,
        pinned,
        state: state !== undefined ? normalizeMemoStateFromClient(state) : undefined,
      });
      const updated = await repo.getMemoById(id);
      if (!updated) return { content: [{ type: "text" as const, text: "memo not found" }], isError: true };
      return { content: [{ type: "text" as const, text: JSON.stringify(memoToJson(updated), null, 2) }] };
    },
  );

  server.tool(
    "delete_memo",
    "Delete (archive) a memo you own. Pass force=true to hard-delete. Requires authentication.",
    {
      name: z.string().describe("Memo resource name"),
      force: z.boolean().optional().describe("When true, hard-delete instead of archiving"),
    },
    async ({ name, force = false }) => {
      const auth = authRef.value;
      if (!auth) return { content: [{ type: "text" as const, text: "authentication required" }], isError: true };
      const id = memoIdFromName(name);
      if (!id) return { content: [{ type: "text" as const, text: "invalid memo name" }], isError: true };
      const row = await repo.getMemoById(id);
      if (!row) return { content: [{ type: "text" as const, text: "memo not found" }], isError: true };
      if (row.creator_username !== auth.username && auth.role !== "ADMIN") {
        return { content: [{ type: "text" as const, text: "permission denied" }], isError: true };
      }
      if (force) {
        await repo.hardDeleteMemo(id);
      } else {
        await repo.archiveMemo(id);
      }
      return { content: [{ type: "text" as const, text: "{}" }] };
    },
  );

  server.tool(
    "list_memo_comments",
    "List comments on a memo.",
    { name: z.string().describe("Memo resource name") },
    async ({ name }) => {
      const auth = authRef.value;
      const id = memoIdFromName(name);
      if (!id) return { content: [{ type: "text" as const, text: "invalid memo name" }], isError: true };
      const parent = await repo.getMemoById(id);
      if (!parent) return { content: [{ type: "text" as const, text: "memo not found" }], isError: true };
      if (!canViewMemo(parent, auth)) {
        return { content: [{ type: "text" as const, text: "permission denied" }], isError: true };
      }
      const comments = await repo.listCommentsForMemo(id);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(comments.map((m) => memoToJson(m)), null, 2) }],
      };
    },
  );

  server.tool(
    "create_memo_comment",
    "Add a comment to a memo. Requires authentication.",
    {
      name: z.string().describe("Parent memo resource name"),
      content: z.string().min(1).describe("Comment content"),
    },
    async ({ name, content }) => {
      const auth = authRef.value;
      if (!auth) return { content: [{ type: "text" as const, text: "authentication required" }], isError: true };
      const parentId = memoIdFromName(name);
      if (!parentId) return { content: [{ type: "text" as const, text: "invalid memo name" }], isError: true };
      const parent = await repo.getMemoById(parentId);
      if (!parent) return { content: [{ type: "text" as const, text: "memo not found" }], isError: true };
      if (!canViewMemo(parent, auth)) {
        return { content: [{ type: "text" as const, text: "permission denied" }], isError: true };
      }
      const commentId = crypto.randomUUID();
      const row = await repo.createMemo({
        id: commentId,
        creator: auth.username,
        content,
        visibility: "PRIVATE",
        state: "NORMAL",
        pinned: false,
        parentId,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(memoToJson(row), null, 2) }] };
    },
  );

  // ── Tag tools ───────────────────────────────────────────────────────────

  server.tool(
    "list_tags",
    "List all tags with their memo counts. Results are sorted by count descending, then alphabetically.",
    {},
    async () => {
      const auth = authRef.value;
      const memos = await repo.listMemosTopLevel({
        state: "NORMAL",
        ...(auth ? { viewerUsername: auth.username } : { visibility: "PUBLIC" }),
        limit: MEMO_FILTER_MAX_SCAN,
        offset: 0,
      });
      const counts: Record<string, number> = {};
      for (const m of memos) {
        for (const tag of m.payload_tags) {
          counts[tag] = (counts[tag] ?? 0) + 1;
        }
      }
      const tags = Object.entries(counts)
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
      return { content: [{ type: "text" as const, text: JSON.stringify(tags, null, 2) }] };
    },
  );

  return server;
}

/**
 * Create a Hono-compatible request handler for the MCP endpoint.
 * Returns a function `(req: Request) => Promise<Response>`.
 */
export function createMcpHandler(deps: AppDeps): (req: Request) => Promise<Response> {
  const repo = createRepository(deps.sql);

  return async (req: Request): Promise<Response> => {
    // CORS / origin validation (DNS rebinding protection)
    if (!isAllowedOrigin(req, deps.instanceUrl)) {
      return new Response(JSON.stringify({ error: "invalid origin" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    // CORS preflight
    const origin = req.headers.get("Origin");
    if (req.method === "OPTIONS") {
      const headers = new Headers();
      if (origin) {
        headers.set("Vary", "Origin");
        headers.set("Access-Control-Allow-Origin", origin);
        headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID");
        headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      }
      return new Response(null, { status: 204, headers });
    }

    // Resolve auth
    const jwtSecret = deps.demo ? "usememos" : (await repo.getSecretKey());
    const auth = await resolveAuth(req, repo, jwtSecret);

    if (auth && !auth.username) {
      return new Response(JSON.stringify({ error: "invalid or expired token" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Build a per-request MCP server + transport (stateless mode)
    const authRef: { value: { username: string; role: "ADMIN" | "USER" } | null } = { value: auth };
    const mcpServer = buildMcpServer(repo, authRef);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
      enableJsonResponse: true,
    });

    await mcpServer.connect(transport);
    const response = await transport.handleRequest(req);

    // Attach CORS headers to response
    if (origin) {
      const headers = new Headers(response.headers);
      headers.set("Vary", "Origin");
      headers.set("Access-Control-Allow-Origin", origin);
      return new Response(response.body, {
        status: response.status,
        headers,
      });
    }
    return response;
  };
}
