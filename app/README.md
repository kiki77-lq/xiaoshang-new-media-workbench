# 小商新媒体运营工作台 · PHASE 1 数据与 API 底座

当前阶段只提供本地 Node、SQLite、`/api/v1`、安全与备份基础设施。正式业务页面尚未实现；目录中原有 v24 页面仅是开发副本，不代表新产品页面已经完成，也不得作为真实业务数据入口。

## 环境与启动

- Node：仅支持 `24.x`
- 默认监听：`127.0.0.1:5173`
- 默认数据库：项目根目录 `data/workbench.sqlite`
- API 根路径：`/api/v1`

```bash
cd "/Users/macbook/Desktop/工作/小商的拍车日记/小商新媒体运营工作台/app"
npm start
```

兼容入口仍可使用：

```bash
node server.js
```

启动顺序固定为：校验 Node → 创建数据子目录 → 安全生成/读取 Token → 打开 SQLite → 完成 migration → 开放 HTTP 端口。迁移失败时不会监听端口。

## 数据目录

真实数据只能放在项目根 `data/`：

```text
data/
├── workbench.sqlite
├── workbench.sqlite-wal
├── workbench.sqlite-shm
├── secrets.json
├── backups/
├── imports/
└── logs/
```

整个目录以及 `app/data/` 都被 Git 忽略。可用 `WORKBENCH_DATA_DIR` 指向另一个本地持久目录，但配置会拒绝任何位于 `app/` 内的路径。

`data/secrets.json` 自动以 `0600` 权限创建。Token 不会写入日志、HTTP 响应、测试 fixture 或 Git。

## SQLite

连接启动时设置：

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = FULL;
```

当前 schema 版本是 `1`。`001_core.sql` 创建核心业务关系、`idempotency_keys` 和 `audit_log`；分析与报告表按已冻结名称在后续对应 migration 中加入，不会创建同义表。

Migration 使用 SHA-256 校验和，只执行一次，并在事务内完成。已执行 SQL 被修改时启动会报 `MIGRATION_CHECKSUM_DRIFT`。

## 已实现 API

### `GET /api/v1/health`

返回进程、SQLite、schema 和 Git SHA 健康信息，不返回 Token：

```json
{
  "data": {
    "status": "ok",
    "database": "ok",
    "schemaVersion": 1,
    "gitSha": "40-character-sha"
  },
  "meta": {
    "requestId": "uuid"
  }
}
```

### `GET /api/v1/meta`

返回应用版本、schema 版本、当前 Git SHA 和固定 upstream SHA。

### `POST /api/v1/workbuddy/token/rotate`

轮换本地 Token，只返回轮换状态和时间，不返回新 Token。无浏览器 `Origin` 时必须使用：

```text
Authorization: Bearer <local-token>
```

同源浏览器写请求必须带合法 `Origin`；跨域 Origin 返回 `403 ORIGIN_FORBIDDEN`。默认 JSON 请求体上限为 2 MB，超限返回 `413 PAYLOAD_TOO_LARGE`。

## API 响应契约

成功：

```json
{
  "data": {},
  "meta": {
    "requestId": "uuid"
  }
}
```

错误：

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable message",
    "details": []
  },
  "requestId": "uuid"
}
```

后续创建/转换请求使用 `Idempotency-Key`。同一个键和同一个请求只执行一次；键被不同请求复用时返回 `IDEMPOTENCY_KEY_REUSED`。后续 PATCH 必须提交读取时的 `version`，旧版本返回 `409 VERSION_CONFLICT`。所有写操作在事务中记录 `audit_log`，敏感字段会脱敏。

完整机器可读契约见 `server/openapi.yaml`。

## 备份与恢复底座

`server/services/backup-service.js` 已提供：

- SQLite 一致性备份；
- SHA-256 清单；
- `PRAGMA integrity_check`；
- `pre-update` 和 `pre-restore` 类型；
- 临时数据库验证；
- 原子替换与失败回滚。

PHASE 1 只完成并测试服务层骨架，暂不提供正式设置页面。

## 测试与健康检查

```bash
npm test
npm run check
node ../scripts/health-check.mjs
```

测试数据库、Token 与备份均创建在操作系统临时目录，绝不使用项目根真实 `data/`。
