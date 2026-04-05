# memos

本项目是开源备忘录应用 **[memos](https://github.com/usememos/memos)**（上游为 Go 服务端 + React 前端）的 **JavaScript / TypeScript** 实现：后端基于 [Hono](https://hono.dev/) 提供 REST API（`/api/v1`），前端为 **React + Vite** 单页应用。可使用 **Node.js**（本地 SQLite）或 **Cloudflare Workers**（D1 + Static Assets）部署。

## 仓库结构


| 路径               | 说明                                                                                                                                                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/`        | 后端源码：Hono 应用、数据库适配、Worker / Node 入口                                                                                                                                                                                                                 |
| `web/`           | 前端源码（React、Vite）                                                                                                                                                                                                                                    |
| `dist/`          | **构建产物根目录**（默认不提交）：见下表                                                                                                                                                                                                                              |
| `migrations/`    | 编号 SQL：**文件名**须为 `**NNNN_描述.sql`**（四位数字前缀，如 `0001_initial.sql`）。**Node** 启动时按名字顺序应用尚未记录的版本；**D1** 用 `wrangler d1 migrations apply`；`**npm run dev:worker`** 会先对本地 D1 执行 `wrangler d1 migrations apply memos --local`。新增迁移一般**只加文件**，不必改 TypeScript。 |
| `wrangler.jsonc` | Cloudflare Worker、D1、静态资源目录（`dist/public`）                                                                                                                                                                                                          |


`**dist/` 内部分区**


| 路径             | 来源                                                 | 用途                                       |
| -------------- | -------------------------------------------------- | ---------------------------------------- |
| `dist/public/` | `npm run build:web`（Vite `outDir: ../dist/public`） | SPA 静态文件；Node 与 Worker 均以此为静态根           |
| `dist/server/` | `npm run build:node`（`tsc`）                        | Node 可执行的后端 JS（入口 `dist/server/node.js`） |


一键构建前后端：`npm run build`（等同先 `build:web` 再 `build:node`）。日常只改 UI 时用 `build:web` 即可。根目录若仍有历史遗留的 `public/`，可删除以免与 `dist/public/` 混淆；`tsx` 跑 `server/node.ts` 时会优先使用已构建的 `dist/public/`。

## 环境要求

- **根目录 / 后端**：建议 Node 18+（与 `package.json` 中 dev 依赖一致即可）。
- **前端 `web/`**：`package.json` 声明 `engines.node >= 24`；开发/构建前请使用满足要求的 Node 版本。
- **Worker 本地/部署**：安装根目录依赖后可用 `npx wrangler`；需要 Cloudflare 账号与（线上）**D1** 数据库。

## 本地开发流程

后端有两种运行形态：**Node + 本地 SQLite**（日常最省事）与 **Wrangler + D1**（行为接近线上 Worker）。


| 形态         | 命令                                   | 数据库                             | 典型用途                   |
| ---------- | ------------------------------------ | ------------------------------- | ---------------------- |
| **Node**   | `npm run dev:node`                   | `data/memos.sqlite`（启动时自动建表/迁移） | 改 API、本地快速调试           |
| **Worker** | `npm run dev:worker`（按需 `build:web`） | Wrangler 本地 D1                  | 验证 Worker 路由、D1、静态资源组合 |


共用的前置步骤：

```bash
npm install
```

### 形态 A：Node + SQLite（推荐日常）

1. **推荐：一条命令同时起后端 + Vite（改前后端都能尽快生效）**
  ```bash
   npm run dev
  ```
   终端里并行跑 **api**、**web** 以及 **urls**（就绪后单独打印一块**强调 Vite 前端地址**的提示，含本机与局域网 URL）。日常请在浏览器打开 **[http://localhost:3001](http://localhost:3001)**；Vite 把 `/api`、`/healthz` 代理到默认 **[http://localhost:3000](http://localhost:3000)**（后端端口不是 3000 时，可在 `web/` 侧用环境变量 `DEV_PROXY_SERVER` 等覆盖，见 `web/vite.config.mts`；若改了 Vite 端口，可设 `MEMOS_DEV_WEB_PORT` / `MEMOS_DEV_API_PORT` 与 `scripts/print-dev-urls-when-ready.mjs` 保持一致）。
  - **改 `web/`**：走 Vite **HMR**，保存后界面通常立即更新，无需先 `build:web`。
  - **改 `server/`**：`tsx watch` 会在保存后**自动重启** Node，下一轮请求即用新后端代码，无需先 `build:node`。
   首次若还没装过前端依赖，需先执行 `npm --prefix web install`（或先跑过一次 `npm run build:web`）。
2. **也可以分两个终端**（与上面等价）：`npm run dev:node` + `npm run dev:web`，同样访问 **[http://localhost:3001](http://localhost:3001)**。
3. **（可选）单端口、贴近线上**：先 `npm run build:web`，再只跑 `npm run dev:node`，浏览器访问 **[http://localhost:3000](http://localhost:3000)**（API 与 `dist/public/` 同一进程，类似 `start:node`）。**没有 Vite**，不适合日常改 UI，只适合核对「构建产物 + API」是否与线上一致；改 `web/` 后需重新 `build:web` 再刷新。

说明：线上 Node 是 **同一进程** 提供 API 与 `dist/public/`；日常开发用 3001 + Vite 是为了前端免全量构建、并保留 HMR。

**清空表数据、保留库文件与表结构（SQLite）**：先停 `dev:node`，执行 `**npm run db:empty:sqlite`**（交互确认；非交互加 `-- --yes`）。会 `DELETE` 除 `schema_migrations` 外的所有应用表数据并 `VACUUM`，**不删** `memos.sqlite`。下次启动仍视为已迁移版本，无需重跑建表 SQL。

**删除整个本地开发库文件**：`npm run db:clear:sqlite` 会删掉 `**DATA_DIR`**（默认 `data/`）下的 `memos.sqlite` 及 `-wal`/`-shm`。下次启动 Node 会**自动**再应用 `migrations/` 下尚未执行的 `**NNNN_*.sql`**。仅针对 Node；Worker 本地 D1 不在此脚本范围内。

### 形态 B：Cloudflare Worker（本地）

与线上相同：`server/worker.ts` 处理 `/healthz` 与 `/api/*`，其余走 `**dist/public/**` 的 Static Assets（见 `wrangler.jsonc` 的 `assets.directory`）。Worker 本地不会像 Vite 那样跑前端 dev server，因此依赖已构建的静态文件。

1. **（首次）登录 Cloudflare**：
  ```bash
   npx wrangler login
  ```
2. **（可选）单独初始化本地 D1**：与下面 `dev:worker` 里自动执行的一步相同。
  ```bash
   npm run db:migrate:d1:local
  ```
   等价于 `wrangler d1 migrations apply memos --local`（数据库名 `**memos**` 须与 `wrangler.jsonc` 里 `database_name` 一致）。
3. **启动本地 Worker**（`scripts/ensure-web-build-for-worker.mjs` 会在 `**dist/public` 不存在或比 `web/` 源码旧** 时才跑 `npm run build:web`，否则跳过以加快启动；需要强制全量构建时可先手动 `npm run build:web`）。`npm run dev:worker` 会在 `**wrangler dev` 之前**执行 `**npm run db:migrate:d1:local`**。
  ```bash
   npm run dev:worker
  ```

1. 
  ```bash
  dev:worker
  ```

按终端提示访问 Wrangler 给出的本地 URL。若修改了 `wrangler.jsonc` 中的 D1 `database_id`，需与你在 Cloudflare 上创建的数据库一致（本地开发常用占位或测试库）。

### 常用开发命令速查

数据库相关脚本统一为 **`db:<动作>:<存储>`**：动作为 **`migrate`**（应用迁移）、**`empty`**（删业务数据、保留表结构）、**`clear`**（删库文件或本地 Wrangler 持久化）；存储为 **`sqlite`**（Node 下 `DATA_DIR/memos.sqlite`）或 **`d1:local`** / **`d1:remote`**（仅 **`migrate`** 使用 **`remote`**）。


| 目的                                                 | 命令                                                                |
| -------------------------------------------------- | ----------------------------------------------------------------- |
| **日常开发（后端 + Vite 同启）**                             | `npm run dev`                                                     |
| **仅起 Node 后端**（`tsx watch`，默认 3000）                  | `npm run dev:node`                                                |
| **仅起 Vite 前端**（默认 3001，代理 API）                     | `npm run dev:web`                                                 |
| **本地 Worker**（按需 `build:web`、先 `db:migrate:d1:local`） | `npm run dev:worker`                                              |
| **仅迁移 SQLite、不启动 HTTP**                            | `npm run db:migrate:sqlite`（与启动时迁移逻辑相同）                           |
| **清空数据、保留 SQLite 结构**（先停 `dev:node`）               | `npm run db:empty:sqlite`（可加 `-- --yes`）                          |
| **删除 SQLite 文件**（先停 `dev:node`）                    | `npm run db:clear:sqlite`（可加 `-- --yes`）                          |
| **仅对本地 D1 跑迁移**（不启 Worker）                         | `npm run db:migrate:d1:local`                                     |
| **对远程 D1 跑迁移**（⚠️ 生产库，需已 `wrangler login`）         | `npm run db:migrate:d1:remote`                                    |
| **清空本地 D1 表数据、保留表结构**（先停 `wrangler dev`）           | `npm run db:empty:d1:local`（执行 `scripts/d1-empty-local-data.sql`） |
| **删除本地 Wrangler 持久化**（含本地 D1 文件；先停 `wrangler dev`） | `npm run db:clear:d1:local`（可加 `-- --yes`）                        |
| 前端构建 → `dist/public/`                              | `npm run build:web`                                               |
| 后端编译 → `dist/server/`                              | `npm run build:node`                                              |
| 前后端一次构建                                            | `npm run build`                                                   |
| **运行编译后的 Node 服务**（需先有 `dist/server/` 与 `dist/public/`） | `npm run start:node`                                              |
| **部署 Worker 到 Cloudflare**（需已 `wrangler login`）        | `npm run deploy:worker`                                           |
| TypeScript 检查                                      | `npm run typecheck`                                               |
| 单元测试（单次）                                            | `npm test`                                                        |
| 单元测试（监听）                                            | `npm run test:watch`                                              |


### 环境变量（Node 后端，节选）


| 变量                     | 说明                                                                      |
| ---------------------- | ----------------------------------------------------------------------- |
| `PORT`                 | 监听端口，默认 `3000`                                                          |
| `MEMOS_STATIC_ROOT`    | 静态根目录覆盖（默认按运行方式解析 `dist/public/` 或兼容旧 `public/`）                        |
| `DATA_DIR`             | SQLite 数据目录，默认仓库下 `data/`                                               |
| `MEMOS_MIGRATIONS_DIR` | （可选）迁移目录的**绝对路径**（内含 `NNNN_*.sql`）。发布时若不能把 `migrations/` 放在默认相对位置，请设置此项 |
| `MEMOS_INSTANCE_URL`   | 实例对外 URL，默认 `http://localhost:<PORT>`                                   |
| `MEMOS_VERSION`        | 实例版本字符串                                                                 |
| `MEMOS_DEMO`           | 设为 `1` 时使用固定 demo JWT 密钥（与 Go demo 模式对齐）                                |


### 添加新的 SQL 迁移（Node 与 D1）

- 在 `**migrations/`** 下新增文件，命名 `**NNNN_简短描述.sql**`（`NNNN` 为四位数字，且与文件内写入的 `**schema_migrations` 版本号**一致，例如 `0002_add_foo.sql` 对应 `INSERT … VALUES (2)`）。
- **不必改 TypeScript**；Node 启动与 `npm run db:migrate:sqlite` 会按文件名排序，仅执行「当前库 `MAX(version)` 尚未达到该前缀数字」的脚本。
- **D1**：同一目录由 Wrangler 管理；本地用 `**npm run db:migrate:d1:local`** 或随 `**npm run dev:worker**` 自动执行；线上用 `**npm run db:migrate:d1:remote**`（或 Wrangler 文档中的等价命令，注意确认目标库）。

## 线上发布流程

发布前在同一环境执行 `**npm run build**` 或至少 `**npm run build:web**`，保证 `**dist/public/**` 与当前 `web/` 一致；发布 Node 时还需 `**npm run build:node**`。再按目标二选一（或两者都维护）。

### 发布到 Node.js

1. **构建**
  ```bash
   npm run build
  ```
   或分步：`npm run build:web` 与 `npm run build:node`。
2. **拷贝到服务器**（或 CI 产物）：至少包含 `**dist/public/`**、`**dist/server/**`、`**migrations/**`，以及生产依赖（例如在发布目录执行 `npm ci --omit=dev`，或携带完整 `node_modules`）。仓库根的其他源码不必上机。
3. **启动**
  ```bash
   npm run start:node
  ```
   实际等价于 `node dist/server/node.js`。按需配置 `PORT`、`DATA_DIR`、`MEMOS_INSTANCE_URL` 等（见上表）。数据库为 **SQLite**；进程启动时会扫描 `**migrations/NNNN_*.sql`**（默认相对 `dist/server` 为 `../../migrations/`）并应用未记录的版本。若线上目录布局不同，设置 `**MEMOS_MIGRATIONS_DIR**`。
4. **对外访问**：单服务即可同时提供 **静态页面** 与 `**/api/*`**。

### 发布到 Cloudflare Workers

1. **准备 `wrangler.jsonc`**：填写真实的 D1 `**database_id**`、Worker 名称、`vars` / Secrets（如后续接入 `MEMOS_DEMO` 等）。`assets.directory` 当前为 `**./dist/public**`，部署前须已执行 `build:web`。
2. **构建前端**
  ```bash
   npm run build:web
  ```
3. **（首次或迁移有更新）对远程 D1 执行迁移**（数据库名与 `wrangler.jsonc` 里 `database_name` 一致，当前为 `memos`）：
  ```bash
   npm run db:migrate:d1:remote
  ```
4. **登录并部署 Worker + 静态资源**
  ```bash
   npx wrangler login   # 若尚未登录
   npm run deploy:worker
  ```
5. **行为摘要**：`/healthz` 与 `/api/*` 由 Worker 内 Hono + **D1** 处理；其余路径由 `**dist/public/`** 对应的 Static Assets 响应（`run_worker_first: true`）。

### Node 与 Worker 对照


| 项目   | Node                                     | Cloudflare Workers                    |
| ---- | ---------------------------------------- | ------------------------------------- |
| 入口文件 | `server/node.ts` → `dist/server/node.js` | `server/worker.ts`（Wrangler 打包）       |
| 静态资源 | 读磁盘 `**dist/public/**`                   | 上传 `**dist/public/**` 为 Static Assets |
| 数据库  | SQLite（`better-sqlite3`）                 | D1                                    |
| 前端构建 | `npm run build:web` → `**dist/public/**` | 同上                                    |


## 协议与规范

API 与 proto 契约以本仓库 `**origin/master**` 上的 `proto/`、**Go 树中的** `server/`、`plugin/` 为准（与根目录本项目的 TypeScript `**server/`** 不是同一套文件；后者是 Hono 实现）。协作说明见 [AGENTS.md](./AGENTS.md)。