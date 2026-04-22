# Memo 评论功能分析文档

## 1. Proto API 层支持情况

**文件：** `proto/api/v1/memo_service.proto`

已定义完整的评论接口：

| RPC 方法 | HTTP 路由 | 说明 |
|---|---|---|
| `CreateMemoComment` | `POST /api/v1/{name=memos/*}/comments` | 为 memo 创建评论 |
| `ListMemoComments` | `GET /api/v1/{name=memos/*}/comments` | 列出 memo 的所有评论 |

## 2. 实现机制

评论的本质是另一个 `Memo` 对象，通过 `MemoRelation` 与父 memo 关联，关系类型为 `COMMENT`：

```protobuf
message MemoRelation {
  enum Type {
    TYPE_UNSPECIFIED = 0;
    REFERENCE = 1;
    COMMENT = 2;  // ← 评论关系类型
  }
}
```

`Memo` 消息本身也包含 `parent` 字段（`optional string parent`），指向父 memo 的资源名。

## 3. 消息结构

- **`CreateMemoCommentRequest`**：传入父 memo 的 `name`（格式：`memos/{memo}`）和一个 `Memo` 对象作为评论内容，还可选指定 `comment_id`
- **`ListMemoCommentsResponse`**：返回评论列表（`repeated Memo memos`）、分页 token 和 `total_size`

## 4. 附加功能

- 评论支持**分页**（`page_size`、`page_token`）和**排序**（`order_by`）
- Memo 同时支持 **Reaction（表情回应）** 功能（👍、❤️ 等）

## 5. 后端结论

Go 分支的 memo 完整支持评论功能，评论以独立 Memo 形式存在，通过 `COMMENT` 类型的关系与父 memo 绑定。

---

## 6. 前端支持情况

✅ **支持**。前端完全实现了评论功能：

- **`MemoCommentSection.tsx`**：在 memo 详情页底部显示评论区，支持创建新评论（调用 `MemoEditor` 并传入 `parentMemoName`）
- **`MemoCommentListView.tsx`**：在 memo 列表卡片中展示最多 3 条评论预览，并提供"View all"链接跳转到详情页

---

## 7. 嵌套回复支持情况

❌ **不支持嵌套回复**。评论系统是**扁平结构（单层）**，不支持对评论再进行回复。

`MemoCommentSection` 渲染每条评论时使用的是普通 Memo 视图，没有递归回复入口。
