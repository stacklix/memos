import type { DbMemoRow, DbUserRow } from "../db/repository.js";
import { deriveMemoProperty } from "../services/memo-content-props.js";

export function userToJson(u: DbUserRow) {
  return {
    name: `users/${u.username}`,
    role: u.role === "ADMIN" ? "ADMIN" : "USER",
    username: u.username,
    email: u.email ?? "",
    displayName: u.display_name ?? "",
    avatarUrl: u.avatar_url ?? "",
    description: u.description ?? "",
    state: u.state,
    createTime: u.create_time,
    updateTime: u.update_time,
  };
}

export function memoToJson(m: DbMemoRow, extras?: { tags?: string[] }) {
  const lat = m.location_latitude;
  const lng = m.location_longitude;
  const ph = m.location_placeholder;
  const hasLocation =
    ph != null &&
    lat != null &&
    lng != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng);
  return {
    name: `memos/${m.id}`,
    state: m.state,
    creator: `users/${m.creator_username}`,
    createTime: m.create_time,
    updateTime: m.update_time,
    displayTime: m.display_time ?? m.create_time,
    content: m.content,
    visibility: m.visibility,
    tags: extras?.tags ?? [],
    pinned: Boolean(m.pinned),
    attachments: [],
    relations: [],
    reactions: [],
    property: deriveMemoProperty(m.content),
    snippet: m.snippet ?? "",
    parent: m.parent_memo_id ? `memos/${m.parent_memo_id}` : undefined,
    ...(hasLocation
      ? {
          location: {
            placeholder: ph ?? "",
            latitude: lat,
            longitude: lng,
          },
        }
      : {}),
  };
}
