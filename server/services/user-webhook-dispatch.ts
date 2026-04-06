import type { Repository } from "../db/repository.js";

type MemoCommentWebhookEvent = {
  type: "MEMO_COMMENT";
  memoComment: {
    memo: string;
    relatedMemo: string;
  };
  sender: string;
  receiver: string;
  createTime: string;
};

async function postJsonWithTimeout(url: string, payload: MemoCommentWebhookEvent): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Best-effort webhook delivery for memo comment notifications.
 * Delivery failures must not block the main API flow.
 */
export async function dispatchMemoCommentWebhooks(args: {
  repo: Repository;
  receiverUsername: string;
  senderUsername: string;
  commentMemoUid: string;
  relatedMemoUid: string;
}): Promise<void> {
  if (args.receiverUsername === args.senderUsername) return;
  const hooks = await args.repo.listWebhooks(args.receiverUsername);
  if (hooks.length === 0) return;

  const payload: MemoCommentWebhookEvent = {
    type: "MEMO_COMMENT",
    memoComment: {
      memo: `memos/${args.commentMemoUid}`,
      relatedMemo: `memos/${args.relatedMemoUid}`,
    },
    sender: `users/${args.senderUsername}`,
    receiver: `users/${args.receiverUsername}`,
    createTime: new Date().toISOString(),
  };

  await Promise.allSettled(
    hooks
      .map((h) => h.url?.trim())
      .filter((u): u is string => Boolean(u))
      .map((url) => postJsonWithTimeout(url, payload)),
  );
}
