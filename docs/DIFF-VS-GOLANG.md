# 当前分支 vs `golang` 分支差异清单
> 对照基线：当前工作区（`master`） vs `golang@f403f8c03c1186d7d4b7a6f2e03d7bca6ffcec21`（2026-04-06）。

---

## 1) 前端页面差异（`web/`）


| 页面/功能                             | 差异                                                                      |
| --------------------------------- | ----------------------------------------------------------------------- |
| Memo 列表/探索/归档/用户页                 | `filter` 语义为子集实现，复杂表达式与 `golang` 不完全兼容                                  |
| Memo 详情与附件相关能力                    | 主要剩余差异为附件过滤语法仍是子集实现（已在顶层附件与 memo 附件链路统一同一子集规则，仍非完整 CEL）                 |
| SSO 登录回调                          | `AuthCallback` 页面仍在代码中，但路由已移除；`signin.ssoCredentials` 为 `UNIMPLEMENTED` |
| SSO 管理                            | `SSOSection` 已从设置页移除；IdP 前端能力未接入                                        |
| 实时刷新（SSE）                         | 前端有实时预期，但后端缺少 `/api/v1/sse`                                             |


---

## 2) 后端结构差异（`server/routes/v1` 对照 `golang`）

### 2.1 路由/服务覆盖差异


| 分类                     | 差异                                                                    |
| ---------------------- | --------------------------------------------------------------------- |
| Identity Provider（IdP） | 缺少 `/api/v1/identity-providers*` 等价路由                                 |
| SSO 登录分支               | `POST /api/v1/auth/signin` 的 `ssoCredentials` 未实现（返回 `UNIMPLEMENTED`） |
| SSE                    | 缺少 `/api/v1/sse` 等价能力                                                 |
| MCP                    | 缺少 `server/router/mcp/*` 等价路由能力                                       |


### 2.2 已有路由的语义差异


| 模块            | 差异                                                                                        |
| ------------- | ----------------------------------------------------------------------------------------- |
| Memo 查询过滤     | `server/lib/memo-filter.ts` 为子集实现，复杂 CEL 表达式不完全兼容                                         |
| Attachment 存储 | 仍与 `golang` 不一致的点：附件 `filter` 仍非完整 CEL 编译语义（当前只支持常用子集）；EXIF 目前仅对 JPEG 做去除（`golang` 覆盖面更广） |
| Instance 存储设置 | 当前 `GET /instance/settings/STORAGE` 额外返回 `supportedStorageTypes` 并按运行时动态裁剪可选项，且支持 `R2`；`golang` 为固定 enum（`DATABASE/LOCAL/S3`）且无该动态字段 |


---

## 3) 数据库设计差异

### 3.1 表结构差异（`migrations/0001_initial.sql` vs `store/migration/sqlite/LATEST.sql`）


| 项目                  | 差异                                   |
| ------------------- | ------------------------------------ |
| `schema_migrations` | 仅当前分支存在（用于 Node 递增迁移）；`golang` 基线无此表 |


### 3.2 迁移机制差异（实现层）


| 项目          | 差异                                                                                            |
| ----------- | --------------------------------------------------------------------------------------------- |
| SQLite 演进方式 | `golang` 以 `store/migration/sqlite/*` + `LATEST.sql` 为迁移体系；当前分支以 `migrations/NNNN_*.sql` 递增执行 |
| 迁移版本记录      | 当前分支显式写入 `schema_migrations`（`0001` 插入版本 1）；`golang` 不依赖该表                                    |


---

## 4) 对外资源依赖差异（运行时 / 部署侧）


| 资源依赖       | 差异                                                                                     |
| ---------- | -------------------------------------------------------------------------------------- |
| 前端静态资源托管   | `golang` 走内置 fileserver；当前分支走 Worker `ASSETS` / Node 本地静态目录                            |
| 主数据库运行时    | `golang` 为单一运行时形态；当前分支为 Node（SQLite）+ Worker（D1）双后端                                    |
| 对象存储链路     | `golang` 以 S3 链路为主；当前分支支持 `DB/LOCAL/S3/R2`，跨后端行为仍需继续用 golden 用例验证（特别是 filter 与图像处理覆盖面） |
| 实时通道       | `golang` 有 SSE；当前分支缺失 SSE 路由                                                           |
| 外部 IdP/SSO | `golang` 有完整 IdP + SSO；当前分支未接入                                                         |
| MCP 对外接口   | `golang` 有 `mcp/*`；当前分支无等价接口                                                           |
| 邮件通知外部服务   | `NOTIFICATION` 设置项已可读写；评论通知 webhook + SMTP 邮件投递链路已形成 |


