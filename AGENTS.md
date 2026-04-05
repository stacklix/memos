# memos — Agent 说明

面向在本仓库中协作的 AI / 自动化代理的简要约定。

## 项目是什么

- **memos**：后端为 [Hono](https://hono.dev/)（REST API），前端为 **`web/`** 下的 React + Vite SPA；构建产物集中在 **`dist/`**：**`dist/public/`**（Vite）、**`dist/server/`**（Node 用 `tsc`），由 Worker 或 Node 同进程提供静态站。
- **双部署目标**：
  - **Cloudflare Workers**：入口 `server/worker.ts`，配置 `wrangler.jsonc`；`/healthz` 与 `/api/*` 由 Worker 内 Hono 处理，其余请求交给 **Static Assets**（目录 **`dist/public/`**），`run_worker_first: true`。**D1 表结构**由 **`wrangler d1 migrations apply`** 维护，Worker **不在请求路径里**执行 SQL 迁移。
  - **Node.js**：入口 `server/node.ts`；启动时对 **`migrations/`** 下按名的 **`NNNN_*.sql`** 依次执行未应用的脚本（见 **`server/db/migrate.ts`**、`server/lib/initial-migration-sql.ts`）。新增迁移**只加 SQL 文件**即可，不必改 TS。可选环境变量 **`MEMOS_MIGRATIONS_DIR`** 指向迁移目录。
- **命名说明**：根目录 **`server/`** 是本仓库的 **TypeScript（Hono）后端**。对照 **`golang`** 分支上的 Go 实现时，文档里的 **`server/`** 指该分支里的 **Go 服务端源码树**（例如 `git show golang:server/...`），与当前 `master` 下的 TypeScript `server/` 不是同一目录。

## 与 Go 参考实现（`golang` 分支）的接口契约

- 本仓库的 **`golang` 分支** 承载与上游 [usememos/memos](https://github.com/usememos/memos) 保持一致的 **Go 原始实现**（含 `proto/`、Go `server/`、`store/` 等），是 **HTTP/gRPC 与 proto 定义的权威参考**。
- **除 `golang` 以外的任意分支**（含 **`master`** 上的 TypeScript/Hono、`web/`、特性分支等）在 **新增或改动对外 API** 时，都必须 **对照 `golang` 分支**：查阅 **`proto/`** 与 Go **`server/router/api/v1/`** 等处的行为，使路径、方法、请求/响应 JSON（字段名、嵌套结构、proto JSON 映射）、`update_mask` / `FieldMask` 路径以及可选字段与 **`null`** 等语义与参考实现一致，避免私自分叉接口。
- 日常协作的 **规范 Git 远程** 仍以本仓库 **`stacklix/memos`** 为准；做契约比对时使用本仓库 **`golang`** 分支（例如 `git show golang:proto/...`），无需改以其他随意 fork 为准。

### API 调整与 `golang` 不一致时的处理（代理必读）

在拟对 **HTTP 方法、路径、请求体/查询参数、响应 JSON 形状或语义** 做任何修改前，须先与 **`golang` 分支** 中的契约比对（优先 **`golang:proto/`** 的 `*.proto`、`google.api.http` 注解，以及 **`golang:proto/gen/openapi.yaml`**；必要时对照 Go **`server/router/api/v1/`** 行为）。

- **若与 `golang` 一致**：可按同一契约实现或修正 TypeScript/Hono（及必要的 `web/`、`tests/`）。
- **若拟议修改与 `golang` 不一致**（例如路径/方法不同、字段名或类型不同、多删改公开字段、与 proto JSON 映射不符）：**不得直接改代码**。应向 **用户** 说明差异点（当前契约 vs 拟议行为）、影响面（客户端、兼容性），并 **等待用户明确确认**（例如同意刻意分叉、或先改 proto/Go 再跟 TS）后，再按确认结果修改。

未获用户确认前，代理仅可做只读调查、对比与建议文案，不实施会偏离 `golang` 契约的 API 变更。

## `dist/`、`web/` 与构建

| 目录 | 角色 |
|------|------|
| **`web/`** | 前端**源码**：React、Vite 配置（`vite.config.mts`）、组件与路由。开发时 Vite 默认监听 **3001**，并把 `/api`、`/healthz` 代理到后端（默认 `http://localhost:3000`，可用环境变量 `DEV_PROXY_SERVER` 覆盖）。 |
| **`dist/public/`** | 前端**构建产物**：`vite build` 的 `outDir`（`../dist/public`，`emptyOutDir: true`）。含 `index.html`、带 hash 的 `assets/*` 等。**不要**手改；改 UI 请编辑 `web/` 后重新构建。 |
| **`dist/server/`** | **Node 后端编译产物**：`npm run build:node`（`tsconfig.build.json` 的 `outDir`），入口 **`dist/server/node.js`**。不含 Worker 专用文件。 |

根目录 `npm run build:web` 会安装 `web` 依赖并构建到 `dist/public/`；`npm run build:node` 编译到 `dist/server/`；`npm run build` 两者顺序执行。部署 Worker 或跑编译版 Node 前，若前端有变更，应先有最新的 `dist/public/`。

## 目录结构

| 路径 | 说明 |
|------|------|
| `server/app.ts` | 组装共享应用：`GET /healthz`、`/api/v1/*`。 |
| `server/routes/v1/` | HTTP API v1 路由（`index.ts` 聚合子模块）。 |
| `server/worker.ts` | Workers 入口；非 API 请求 `env.ASSETS.fetch` 回源 `dist/public/`。 |
| `server/node.ts` | Node 监听与静态文件服务（`dist/public/`，见源码内路径解析）。 |
| `server/types/bindings.ts` | Worker `Bindings`（`ASSETS`、`MEMOS_DB` 等）。 |
| `web/` | React + Vite 前端源码。 |
| `dist/public/` | Vite 构建输出；Worker Static Assets 与 Node 静态根目录。 |
| `dist/server/` | `tsc` 输出的 Node 后端（不含 `worker.ts` 等）。 |
| `migrations/` | D1 / SQLite 的 SQL 源文件（**唯一真相源**）；Node 启动时按 `NNNN_*.sql` 迁移；D1 用 **`npm run db:migrate:d1:local` / `:remote`** 或 Wrangler 等价命令。 |
| `server/lib/initial-migration-sql.ts` | 解析 Node 使用的 **`migrations/`** 目录（`MEMOS_MIGRATIONS_DIR` 或相对 `server` / `dist/server`）。 |
| `scripts/migrate-db.ts` | 可选：**`npm run db:migrate:sqlite`** 只迁移、不启 HTTP（与 `node.ts` 内迁移逻辑一致）。 |

## 常用命令

- **数据库 npm 脚本**：`db:<动作>:<存储>` — 动作为 `migrate` / `empty` / `clear`；存储为 `sqlite`（Node `memos.sqlite`）或 `d1:local` / `d1:remote`（仅 `migrate` 使用 `remote`）。
- `npm run dev`：`concurrently` 同启 `dev:node`、`dev:web` 与 `scripts/print-dev-urls-when-ready.mjs`；Node 子进程启动时**自动**跑 SQLite 初始化。
- `npm run db:migrate:sqlite`：可选；仅对 **`memos.sqlite`** 执行迁移、不启动服务（CI / 运维）。
- `npm run db:empty:sqlite`：清空本地 SQLite **数据**、**保留**表结构与 `schema_migrations` 版本行（先停 `dev:node`）；非交互加 `-- --yes`。
- `npm run db:clear:sqlite`：删除本地 **`memos.sqlite` 文件**（先停 `dev:node`）；下次启动 Node 会**自动**再迁移（需能定位 `0001_initial.sql`）。
- `npm run dev:node`：本地 Node 后端（tsx watch，默认 **3000**）。
- `npm run dev:web`：Vite 开发服务器（**3001**，代理 API 到 3000）。
- `npm run db:migrate:d1:local`：仅对**本地** D1 应用 `migrations/`（`wrangler d1 migrations apply memos --local`）。
- `npm run db:migrate:d1:remote`：对**远程** D1 应用迁移（生产前确认库名与账号；等价 `wrangler d1 migrations apply memos --remote`）。
- `npm run db:empty:d1:local`：清空**本地** D1 业务表数据、保留表结构（`scripts/d1-empty-local-data.sql`）；先停 `wrangler dev`。
- `npm run db:clear:d1:local`：删除 **`.wrangler/state`**（本地 D1 与其它 Wrangler 开发态持久化）；先停 `wrangler dev`；可加 `-- --yes`。
- `npm run dev:worker`：若 `dist/public` 缺失或早于 `web/` 源码则先 `build:web`，再 **`npm run db:migrate:d1:local`**，再 Wrangler 本地 Worker。
- `npm run build:web`：构建前端到 `dist/public/`。
- `npm run build:node`：编译后端到 `dist/server/`。
- `npm run build`：`build:web` 后 `build:node`。
- `npm run start:node`：运行 `dist/server/node.js`。
- `npm run typecheck`：根目录 TypeScript 检查。
- `npm run deploy:worker`：部署 Worker（需已登录 Cloudflare）。

## 实现约定

- **API** 挂在 **`/api/v1`** 下（路径以 `/api/` 开头由 Worker / Node 统一交给 Hono），避免与静态资源冲突。
- **ESM**：根目录 `package.json` 为 `"type": "module"`；后端源码中 `import` 使用 **`.js` 后缀** 指向编译后的模块名（配合 `NodeNext`）。
- **Worker 静态资源**：使用 `c.env.ASSETS.fetch`（或等价 `env.ASSETS.fetch`），勿依赖已弃用的 `hono/cloudflare-workers` `serveStatic`。
- **仅 Node 构建**：`tsconfig.build.json` 不包含 `worker.ts`；Worker 由 Wrangler 单独打包。

## 修改时注意

- 改 Worker 绑定或资源目录时同步更新 `wrangler.jsonc` 与 `server/types/bindings.ts`。
- 新增环境变量：Node 用 `process.env`；Worker 用 Wrangler `vars` / Secrets，并在类型中体现。
