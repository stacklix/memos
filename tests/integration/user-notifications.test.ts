import { describe, expect, it } from "vitest";
import { apiJson, apiRequest } from "../helpers/http.js";
import { createTestApp } from "../helpers/test-app.js";
import { memoIdFromName, postMemo, postUserAsAdmin, seedAdmin, signIn } from "../helpers/seed.js";

async function seedMemoCommentNotification() {
  const app = createTestApp();
  const { accessToken: adminToken } = await seedAdmin(app, {
    username: "adm",
    password: "secret123",
  });
  expect((await postUserAsAdmin(app, adminToken, { username: "owner", password: "secret123" })).status).toBe(200);
  expect((await postUserAsAdmin(app, adminToken, { username: "buddy", password: "secret123" })).status).toBe(200);

  const { accessToken: ownerToken } = await signIn(app, "owner", "secret123");
  const { accessToken: buddyToken } = await signIn(app, "buddy", "secret123");

  const parent = await postMemo(app, ownerToken, { content: "root", visibility: "PUBLIC" });
  expect(parent.status).toBe(200);
  const parentId = memoIdFromName((parent.body as { name: string }).name);

  const comment = await apiJson(app, `/api/v1/memos/${encodeURIComponent(parentId)}/comments`, {
    method: "POST",
    bearer: buddyToken,
    json: { comment: { content: "hello", visibility: "PUBLIC" } },
  });
  expect(comment.status).toBe(200);
  const commentId = memoIdFromName((comment.body as { name: string }).name);

  const list = await apiJson<{
    notifications: Array<{
      name: string;
      sender: string;
      type: string;
      status: string;
      memoComment?: { memo: string; relatedMemo: string };
    }>;
  }>(app, "/api/v1/users/owner/notifications", { bearer: ownerToken });
  expect(list.status).toBe(200);
  expect(list.body.notifications).toHaveLength(1);

  return {
    app,
    ownerToken,
    buddyToken,
    parentId,
    commentId,
    notification: list.body.notifications[0]!,
  };
}

describe("integration: user notifications", () => {
  it("lists MEMO_COMMENT notifications with payload", async () => {
    const seeded = await seedMemoCommentNotification();

    expect(seeded.notification.sender).toBe("users/buddy");
    expect(seeded.notification.type).toBe("MEMO_COMMENT");
    expect(seeded.notification.status).toBe("UNREAD");
    expect(seeded.notification.memoComment?.memo).toBe(`memos/${seeded.commentId}`);
    expect(seeded.notification.memoComment?.relatedMemo).toBe(`memos/${seeded.parentId}`);
  });

  it("omits memoComment payload when related memos are deleted", async () => {
    const seeded = await seedMemoCommentNotification();

    const delParent = await apiRequest(
      seeded.app,
      `/api/v1/memos/${encodeURIComponent(seeded.parentId)}`,
      { method: "DELETE", bearer: seeded.ownerToken },
    );
    expect(delParent.status).toBe(200);

    const listAfterDelete = await apiJson<{
      notifications: Array<{ memoComment?: unknown; type: string }>;
    }>(seeded.app, "/api/v1/users/owner/notifications", { bearer: seeded.ownerToken });
    expect(listAfterDelete.status).toBe(200);
    expect(listAfterDelete.body.notifications).toHaveLength(1);
    expect(listAfterDelete.body.notifications[0]!.type).toBe("MEMO_COMMENT");
    expect(listAfterDelete.body.notifications[0]!.memoComment).toBeUndefined();
  });

  it("updates status and enforces updateMask/status validation", async () => {
    const seeded = await seedMemoCommentNotification();
    const nid = seeded.notification.name.split("/").pop()!;

    const invalidMask = await apiJson(
      seeded.app,
      `/api/v1/users/owner/notifications/${encodeURIComponent(nid)}`,
      {
        method: "PATCH",
        bearer: seeded.ownerToken,
        json: { notification: { status: "ARCHIVED" }, updateMask: { paths: [] } },
      },
    );
    expect(invalidMask.status).toBe(400);

    const invalidStatus = await apiJson(
      seeded.app,
      `/api/v1/users/owner/notifications/${encodeURIComponent(nid)}`,
      {
        method: "PATCH",
        bearer: seeded.ownerToken,
        json: { notification: { status: "READ" }, updateMask: { paths: ["status"] } },
      },
    );
    expect(invalidStatus.status).toBe(400);

    const patched = await apiJson<{ status: string }>(
      seeded.app,
      `/api/v1/users/owner/notifications/${encodeURIComponent(nid)}`,
      {
        method: "PATCH",
        bearer: seeded.ownerToken,
        json: { notification: { status: "ARCHIVED" }, updateMask: { paths: ["status"] } },
      },
    );
    expect(patched.status).toBe(200);
    expect(patched.body.status).toBe("ARCHIVED");
  });

  it("forbids non-owner from listing/updating/deleting owner's notifications", async () => {
    const seeded = await seedMemoCommentNotification();
    const nid = seeded.notification.name.split("/").pop()!;

    const listForbidden = await apiJson(seeded.app, "/api/v1/users/owner/notifications", {
      bearer: seeded.buddyToken,
    });
    expect(listForbidden.status).toBe(403);

    const patchForbidden = await apiJson(
      seeded.app,
      `/api/v1/users/owner/notifications/${encodeURIComponent(nid)}`,
      {
        method: "PATCH",
        bearer: seeded.buddyToken,
        json: { notification: { status: "ARCHIVED" }, updateMask: { paths: ["status"] } },
      },
    );
    expect(patchForbidden.status).toBe(403);

    const delForbidden = await apiRequest(
      seeded.app,
      `/api/v1/users/owner/notifications/${encodeURIComponent(nid)}`,
      { method: "DELETE", bearer: seeded.buddyToken },
    );
    expect(delForbidden.status).toBe(403);
  });
});
