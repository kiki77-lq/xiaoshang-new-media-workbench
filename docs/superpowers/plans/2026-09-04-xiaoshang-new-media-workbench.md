# 小商新媒体运营工作台实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保留 v24 视觉与本地 PWA 优点的基础上，构建一个以 Content 为核心、由网页和 WorkBuddy 共用 SQLite 数据的“小商的拍车日记”新媒体运营工作台。

**Architecture:** 浏览器工作台与 WorkBuddy 都调用同一个本地 Node `/api/v1` 服务；SQLite 是唯一真源，项目根 `data/` 是唯一生产数据目录。前端继续使用 Vanilla HTML/CSS/JavaScript，并把 v24 的单体文件逐步拆成页面模块、共享组件和 API 客户端。

**Tech Stack:** Node 24.x、`node:sqlite`、Vanilla JavaScript ES Modules、HTML、CSS、PWA Service Worker、Node 内置测试运行器、Playwright。

**Spec:** `docs/superpowers/specs/2026-09-04-xiaoshang-new-media-workbench-design.md`

## Global Constraints

- 项目根目录固定为 `/Users/macbook/Desktop/工作/小商的拍车日记/小商新媒体运营工作台/`。
- `references/upstream-skill-repo/` 是原作者 GitHub 完整只读证据，`references/v24-source/` 是提取后的可运行只读基准；两者都禁止修改。
- 业务开发只修改 `app/`、`scripts/`、`workbuddy/` 和新项目自己的文档。
- 真实运营数据只放在项目根 `data/`，整个目录不得进入 Git。
- 固定一个 IP“小商的拍车日记”和四个平台：抖音、视频号、小红书、微博。
- 同一条内容只能有一个 Content；四个平台状态放在四条发布记录中。
- 产品只保留 8 个主页面，禁止加入素材库、Todo、Reminder、多 IP 和账号密码。
- 老板原话写入 `inspirations.raw_text` 后永久不可修改。
- 网页与 WorkBuddy 只通过 `/api/v1` 访问数据，WorkBuddy 禁止模拟点击网页。
- 所有创建和转换接口支持 `Idempotency-Key`。
- 所有 PATCH 使用 `version` 做乐观锁。
- PWA 不缓存任何 `/api/` 响应。
- 数据迁移前必须创建并验证备份。
- 每个 PHASE 完成后停止，取得用户确认后才执行下一阶段。
- 分析与系统表名冻结为 `metric_snapshots`、`metric_values`、`metric_series_points`、`content_reviews`、`review_findings`、`report_snapshots`、`idempotency_keys`、`audit_log`，禁止创建同义重复表。

---

## 执行前统一检查

- [x] **Step 1: 核对当前分支与工作区**

Run:

```bash
cd "/Users/macbook/Desktop/工作/小商的拍车日记/小商新媒体运营工作台"
git status --short --branch
git rev-parse --show-toplevel
```

Expected:

```text
项目根指向 小商新媒体运营工作台
没有与当前阶段无关的未提交修改
```

- [x] **Step 2: 核对只读上游基线**

Run:

```bash
git -C references/upstream-skill-repo rev-parse HEAD
git -C references/upstream-skill-repo status --short
git -C references/upstream-skill-repo remote -v
diff -qr references/upstream-skill-repo/references/v24-source references/v24-source
diff -qr references/v24-source app
```

Expected:

```text
d8f8e5b2d10c193d0ea0bf3581e41cc34490e55b
工作树无修改
upstream 的 push URL 为 DISABLED
两次 diff 均无输出
```

- [x] **Step 3: 核对数据隔离**

Run:

```bash
test -d data
git check-ignore -q data
git ls-files data
```

Expected:

```text
前两个命令退出码为 0
git ls-files data 无输出
```

---

## PHASE 1：数据底座、迁移、HTTP API 与备份骨架

### 目标

建立可独立测试的 Node/SQLite 服务，不接业务页面；让所有后续模块都建立在稳定的数据目录、迁移、鉴权和错误协议上。

### Files

- Create: `app/package.json`
- Create: `app/server/index.js`
- Create: `app/server/config.js`
- Create: `app/server/http/router.js`
- Create: `app/server/http/body.js`
- Create: `app/server/http/response.js`
- Create: `app/server/http/auth.js`
- Create: `app/server/http/errors.js`
- Create: `app/server/db/connection.js`
- Create: `app/server/db/migrate.js`
- Create: `app/server/db/migrations/001_core.sql`
- Create: `app/server/openapi.yaml`
- Create: `app/server/services/backup-service.js`
- Create: `app/server/services/idempotency-service.js`
- Create: `app/server/services/optimistic-lock-service.js`
- Create: `app/server/security/secrets.js`
- Create: `app/server/repositories/audit-repository.js`
- Create: `app/tests/helpers/temp-workbench.js`
- Create: `app/tests/unit/config.test.js`
- Create: `app/tests/integration/migrations.test.js`
- Create: `app/tests/integration/health-api.test.js`
- Create: `app/tests/integration/auth-api.test.js`
- Create: `app/tests/integration/backup-service.test.js`
- Create: `app/tests/integration/foundation-services.test.js`
- Create: `app/tests/integration/security-api.test.js`
- Create: `app/tests/contract/api-envelope.test.js`
- Create: `app/tests/unit/service-worker.test.js`
- Create: `scripts/health-check.mjs`
- Modify: `app/server.js`
- Modify: `app/README.md`

### Interfaces

- Produces: `loadConfig({ projectRoot, env }) -> WorkbenchConfig`
- Produces: `openDatabase({ dbPath }) -> DatabaseSync`
- Produces: `runMigrations(db) -> { fromVersion, toVersion, appliedVersions }`
- Produces: `createWorkbenchServer({ config, db }) -> http.Server`
- Produces: `createBackup({ db, dataDir, reason, appVersion }) -> BackupManifest`
- Produces: `verifyBackup({ sqlitePath, manifestPath }) -> VerificationResult`
- Produces: `restoreBackup({ db, dbPath, dataDir, manifest, appVersion }) -> RestoreResult`
- Produces: `withIdempotency({ db, key, method, path, requestBody, execute })`
- Produces: `assertVersion({ expectedVersion, actualVersion })`
- Produces: `loadOrCreateSecrets({ dataDir })` and `rotateToken({ dataDir })`
- Consumes: project root `data/` and Node 24.x.

### Steps

- [x] **Step 1: 建立 Node 项目与命令**

Create `app/package.json` with these scripts and runtime rules:

```json
{
  "name": "xiaoshang-new-media-workbench",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=24 <25"
  },
  "scripts": {
    "start": "node server/index.js",
    "test": "node --test tests/unit/*.test.js tests/integration/*.test.js tests/contract/*.test.js",
    "test:unit": "node --test tests/unit/*.test.js",
    "test:integration": "node --test tests/integration/*.test.js",
    "test:e2e": "playwright test",
    "check": "node --check server/index.js && node --check server.js && node --check sw.js"
  }
}
```

Keep `app/server.js` as a compatibility launcher:

```js
import "./server/index.js";
```

- [x] **Step 2: 先写数据目录测试**

Create `app/tests/unit/config.test.js`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { loadConfig } from "../../server/config.js";

test("default database lives in project root data directory", () => {
  const projectRoot = path.resolve("/tmp/xiaoshang-workbench");
  const config = loadConfig({ projectRoot, env: {} });
  assert.equal(config.dataDir, path.join(projectRoot, "data"));
  assert.equal(config.dbPath, path.join(projectRoot, "data", "workbench.sqlite"));
  assert.equal(config.host, "127.0.0.1");
});

test("database path cannot resolve inside app directory", () => {
  const projectRoot = path.resolve("/tmp/xiaoshang-workbench");
  assert.throws(
    () => loadConfig({
      projectRoot,
      env: { WORKBENCH_DATA_DIR: path.join(projectRoot, "app", "data") }
    }),
    /DATA_DIR_INSIDE_APP/
  );
});
```

Run:

```bash
cd app
npm test -- --test-name-pattern="database"
```

Expected: FAIL because `server/config.js` does not exist.

- [x] **Step 3: 实现配置与启动前检查**

Create `app/server/config.js` exporting:

```js
export function loadConfig({ projectRoot, env = process.env }) {
  const appDir = path.join(projectRoot, "app");
  const dataDir = path.resolve(env.WORKBENCH_DATA_DIR || path.join(projectRoot, "data"));
  if (dataDir === appDir || dataDir.startsWith(appDir + path.sep)) {
    throw new Error("DATA_DIR_INSIDE_APP");
  }
  return {
    projectRoot,
    appDir,
    dataDir,
    dbPath: path.join(dataDir, "workbench.sqlite"),
    host: env.WORKBENCH_HOST || "127.0.0.1",
    port: Number(env.WORKBENCH_PORT || 5173),
    bodyLimitBytes: 2 * 1024 * 1024
  };
}
```

Import `node:path` and validate Node major version before opening the database.

Run:

```bash
npm test -- --test-name-pattern="database"
```

Expected: PASS.

- [x] **Step 4: 先写迁移测试**

Create `app/tests/integration/migrations.test.js` with assertions for:

```js
const tables = [
  "schema_migrations",
  "platform_channels",
  "app_settings",
  "inspirations",
  "contents",
  "content_inspirations",
  "content_publications",
  "tags",
  "inspiration_tags",
  "content_tags",
  "observations",
  "observation_tags",
  "schedule_events",
  "idempotency_keys",
  "audit_log"
];

assert.deepEqual(actualTables.sort(), tables.sort());
assert.deepEqual(
  db.prepare("SELECT code FROM platform_channels ORDER BY code").all().map(row => row.code),
  ["douyin", "wechat_channels", "weibo", "xiaohongshu"]
);
assert.equal(runMigrations(db).appliedVersions.length, 0);
```

Run:

```bash
npm run test:integration
```

Expected: FAIL because migration files and runner do not exist.

- [x] **Step 5: 实现 SQLite 连接和 001 迁移**

`app/server/db/connection.js` must set:

```js
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  PRAGMA synchronous = FULL;
`);
```

`001_core.sql` must create all tables listed in the test, their indexes, the four platform seeds, and this trigger:

```sql
CREATE TRIGGER inspirations_raw_text_immutable
BEFORE UPDATE OF raw_text ON inspirations
FOR EACH ROW
WHEN NEW.raw_text <> OLD.raw_text
BEGIN
  SELECT RAISE(ABORT, 'INSPIRATION_RAW_TEXT_IMMUTABLE');
END;
```

`runMigrations` must checksum SQL files, reject checksum drift, and execute each unapplied migration in a transaction.

Run:

```bash
npm run test:integration
```

Expected: migration tests PASS.

- [x] **Step 6: 先写 HTTP、错误协议和鉴权测试**

`health-api.test.js` must assert:

```js
assert.equal(response.status, 200);
assert.equal(body.data.status, "ok");
assert.equal(body.data.database, "ok");
assert.equal(body.data.schemaVersion, 1);
assert.match(body.data.gitSha, /^[0-9a-f]{40}$/);
```

`auth-api.test.js` must assert:

```js
assert.equal(noToken.status, 401);
assert.equal(wrongToken.status, 401);
assert.equal(validToken.status, 200);
assert.equal(crossOriginCookieWrite.status, 403);
assert.equal(oversizedBody.status, 413);
```

Run:

```bash
npm run test:integration
```

Expected: FAIL because HTTP modules do not exist.

- [x] **Step 7: 实现 HTTP 基础层**

Implement these exact exports:

```js
export class HttpError extends Error {
  constructor(status, code, message, details = []) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function sendData(res, status, data, meta = {}) {}
export function sendError(res, error, requestId) {}
export async function readJson(req, limitBytes) {}
export function authenticateRequest(req, config) {}
export function createRouter() {}
```

`GET /api/v1/health` and `GET /api/v1/meta` return only non-sensitive values. The server must not set `Access-Control-Allow-Origin: *`.

In the same TDD batch, prove and implement reusable `idempotency_keys`, `audit_log`, `assertVersion`, local secret generation/rotation, request-size enforcement, path-traversal rejection and API-safe Service Worker behavior. Tests must assert real database rows and HTTP responses; no committed token fixture is allowed.

Run:

```bash
npm run test:integration
node server/index.js
```

Expected: tests PASS and startup log names the root `data/workbench.sqlite`.

- [x] **Step 8: 先写备份测试**

`backup-service.test.js` must:

```js
const manifest = await createBackup({
  db,
  dataDir,
  reason: "pre-update",
  appVersion: "0.1.0"
});
assert.equal(manifest.reason, "pre-update");
assert.match(manifest.sha256, /^[0-9a-f]{64}$/);
assert.equal((await verifyBackup(manifest)).ok, true);
```

It must also corrupt a copied backup and assert `verifyBackup(...).ok === false`.

Run:

```bash
npm run test:integration
```

Expected: FAIL before the service exists.

- [x] **Step 9: 实现一致性备份骨架**

Use SQLite backup or `VACUUM INTO` to write `data/backups/<timestamp>-<reason>.sqlite`. Write a neighboring JSON manifest containing:

```json
{
  "reason": "pre-update",
  "appVersion": "0.1.0",
  "schemaVersion": 1,
  "sha256": "64-character lowercase hex digest",
  "createdAt": "UTC ISO 8601 timestamp"
}
```

Verification must check file hash and `PRAGMA integrity_check`.

Run:

```bash
npm run test:integration
```

Expected: all PHASE 1 tests PASS.

- [x] **Step 10: 更新 API 契约和运行说明**

Document `/api/v1/health`, `/api/v1/meta`, success/error envelopes, bearer authentication, Origin rules, body limits and data directory in:

- `app/server/openapi.yaml`
- `app/README.md`

Run:

```bash
rg -n "/api/v1/health|VERSION_CONFLICT|Idempotency-Key|WORKBENCH_DATA_DIR" app/server/openapi.yaml app/README.md
```

Expected: every term is present.

- [x] **Step 11: Commit**

```bash
git add app/package.json app/server app/tests app/server.js app/README.md scripts/health-check.mjs
git commit -m "feat: build local data and api foundation"
```

### PHASE 1 验收

- `npm test` 全部通过；
- 服务默认只监听 `127.0.0.1`；
- 数据库位于项目根 `data/`；
- 迁移可重复运行且不会重复执行；
- 备份有 SHA-256 和完整性检查；
- 无任何业务页面实现；
- 完成后停止并等待用户确认。

---

## PHASE 2：设计系统、共享壳、8 页导航与 API 客户端

### 目标

把 v24 的可复用视觉拆成稳定共享组件，建立 8 个正式页面的路由与空态；不接入核心业务 CRUD。

### Files

- Create: `app/assets/css/tokens.css`
- Create: `app/assets/css/base.css`
- Create: `app/assets/css/layout.css`
- Create: `app/assets/css/components.css`
- Create: `app/assets/css/responsive.css`
- Create: `app/assets/css/pages/home.css`
- Create: `app/assets/css/pages/inspirations.css`
- Create: `app/assets/css/pages/contents.css`
- Create: `app/assets/css/pages/calendar.css`
- Create: `app/assets/css/pages/analytics.css`
- Create: `app/assets/css/pages/reports.css`
- Create: `app/assets/css/pages/observations.css`
- Create: `app/assets/css/pages/settings.css`
- Create: `app/assets/js/main.js`
- Create: `app/assets/js/router.js`
- Create: `app/assets/js/api/client.js`
- Create: `app/assets/js/shared/dom.js`
- Create: `app/assets/js/shared/format.js`
- Create: `app/assets/js/shared/forms.js`
- Create: `app/assets/js/components/shell.js`
- Create: `app/assets/js/components/modal.js`
- Create: `app/assets/js/components/toast.js`
- Create: `app/assets/js/components/chart.js`
- Create: `app/assets/js/pages/home.js`
- Create: `app/assets/js/pages/inspirations.js`
- Create: `app/assets/js/pages/contents.js`
- Create: `app/assets/js/pages/calendar.js`
- Create: `app/assets/js/pages/analytics.js`
- Create: `app/assets/js/pages/reports.js`
- Create: `app/assets/js/pages/observations.js`
- Create: `app/assets/js/pages/settings.js`
- Create: `app/playwright.config.js`
- Create: `app/tests/e2e/navigation.spec.js`
- Create: `app/tests/unit/router.test.js`
- Create: `app/tests/unit/service-worker.test.js`
- Modify: `app/index.html`
- Modify: `app/manifest.webmanifest`
- Modify: `app/sw.js`
- Delete: `app/prototype.html`
- Delete: `app/open.html`
- Delete after replacement: `app/assets/js/store.js`
- Delete after replacement: `app/assets/js/app.js`
- Delete after CSS parity: `app/assets/css/style.css`

### Interfaces

- Consumes: `/api/v1/meta` and `/api/v1/health` from PHASE 1.
- Produces: `navigate(routeName)`, `registerRoute({ name, path, render })`.
- Produces: `api.request(path, { method, body, version, idempotencyKey })`.
- Produces: shared `openModal`, `closeModal`, `showToast`, `renderChart`.

### Steps

- [ ] **Step 1: 写 8 页导航测试**

Create `app/tests/e2e/navigation.spec.js`:

```js
import { test, expect } from "@playwright/test";

const pages = [
  ["首页", "home"],
  ["灵感备忘", "inspirations"],
  ["内容库", "contents"],
  ["发布日历", "calendar"],
  ["数据看板", "analytics"],
  ["周报 / 月报", "reports"],
  ["热点 / 竞品观察", "observations"],
  ["设置", "settings"]
];

for (const [label, route] of pages) {
  test(`opens ${label}`, async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: label }).click();
    await expect(page.locator("main")).toHaveAttribute("data-page", route);
    await expect(page.getByRole("heading", { name: label })).toBeVisible();
  });
}

test("removed modules are absent", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("素材库", { exact: true })).toHaveCount(0);
  await expect(page.getByText("待办事项", { exact: true })).toHaveCount(0);
  await expect(page.getByText("提醒事项", { exact: true })).toHaveCount(0);
});
```

Run:

```bash
npm run test:e2e
```

Expected: FAIL against the v24 navigation.

- [ ] **Step 2: 拆分视觉变量和共享样式**

Move v24 reusable rules into the CSS files listed above. `tokens.css` must expose:

```css
:root {
  --bg: #030609;
  --panel: #0b1116;
  --panel-2: #101820;
  --panel-3: #17212a;
  --border: #24313a;
  --text: #f4f7f9;
  --muted: #8b98a3;
  --accent: #13c8f5;
  --success: #24d69a;
  --warning: #f5a623;
  --danger: #ff4d5f;
  --pending: #9a6bff;
  --radius-card: 16px;
  --radius-control: 10px;
}
```

Retain the v24 iOS date input and modal overflow fixes in `responsive.css`.

- [ ] **Step 3: 实现共享壳与路由**

`router.js` must register exactly:

```js
export const ROUTES = Object.freeze([
  { name: "home", path: "/" },
  { name: "inspirations", path: "/inspirations" },
  { name: "contents", path: "/contents" },
  { name: "calendar", path: "/calendar" },
  { name: "analytics", path: "/analytics" },
  { name: "reports", path: "/reports" },
  { name: "observations", path: "/observations" },
  { name: "settings", path: "/settings" }
]);
```

`shell.js` renders the fixed product name, eight links, global search and page outlet. Each page module returns a heading and a clear empty state.

- [ ] **Step 4: 写并实现 API 客户端测试**

`router.test.js` must assert all paths are unique and no removed route exists. Add client tests for:

```js
await api.request("/inspirations", {
  method: "POST",
  body: { rawText: "老板原话" },
  idempotencyKey: "message-123"
});
```

Expected request headers:

```text
Content-Type: application/json
Idempotency-Key: message-123
```

For PATCH with `version: 3`, the body must include `"version":3`. A `409` response must become an `ApiError` with code `VERSION_CONFLICT`.

- [ ] **Step 5: 重写 Service Worker 缓存边界**

`service-worker.test.js` must assert:

```js
assert.match(source, /url\.pathname\.startsWith\("\/api\/"\)/);
assert.match(source, /fetch\(request\)/);
assert.doesNotMatch(staticAssets.join("\n"), /\/api\//);
```

`sw.js` behavior:

```js
if (url.pathname.startsWith("/api/")) {
  event.respondWith(fetch(event.request));
  return;
}
```

Static navigation may use cache fallback; API must be network-only.

- [ ] **Step 6: 更新 HTML 和 PWA 元数据**

`index.html` loads ES Modules and split CSS. `manifest.webmanifest` uses:

```json
{
  "name": "小商的拍车日记｜新媒体运营工作台",
  "short_name": "小商工作台",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#030609",
  "theme_color": "#030609"
}
```

- [ ] **Step 7: 删除已被替换的 v24 运行文件**

Only after the new shell, routes, styles and tests pass, remove:

```text
app/prototype.html
app/open.html
app/assets/js/store.js
app/assets/js/app.js
app/assets/css/style.css
```

The untouched originals remain available in `references/v24-source/`.

- [ ] **Step 8: 运行测试与视觉基线**

Run:

```bash
npm test
npm run test:e2e
```

Capture screenshots at:

```text
1440x1080 desktop
390x844 mobile
```

Compare desktop home shell to `docs/product-reference/首页.png`.

- [ ] **Step 9: Commit**

```bash
git add app/index.html app/manifest.webmanifest app/sw.js app/assets app/tests app/playwright.config.js
git add -u app
git commit -m "feat: establish eight-page workbench shell"
```

### PHASE 2 验收

- 8 个且仅 8 个页面可导航；
- “素材库、待办事项、提醒事项、多账号”不出现；
- 首页视觉使用黑/中性深灰/青色；
- API 请求不被 Service Worker 缓存；
- 桌面与移动导航测试通过；
- 页面只有空态和共享壳，不实现核心业务；
- 完成后停止并等待用户确认。

---

## PHASE 3：灵感、内容与首页核心闭环

### 目标

完成“老板原话 → 灵感 → Content → 四平台记录”的核心闭环，并让首页读取真实聚合数据。

### Files

- Create: `app/server/repositories/tag-repository.js`
- Create: `app/server/repositories/inspiration-repository.js`
- Create: `app/server/repositories/content-repository.js`
- Create: `app/server/services/inspiration-service.js`
- Create: `app/server/services/content-service.js`
- Create: `app/server/services/dashboard-service.js`
- Create: `app/server/routes/inspirations.js`
- Create: `app/server/routes/contents.js`
- Create: `app/server/routes/dashboard.js`
- Create: `app/tests/unit/inspiration-service.test.js`
- Create: `app/tests/integration/inspiration-api.test.js`
- Create: `app/tests/integration/content-api.test.js`
- Create: `app/tests/e2e/inspiration-content-flow.spec.js`
- Modify: `app/server/index.js`
- Modify: `app/server/openapi.yaml`
- Modify: `app/assets/js/pages/inspirations.js`
- Modify: `app/assets/js/pages/contents.js`
- Modify: `app/assets/js/pages/home.js`
- Modify: `app/assets/css/pages/inspirations.css`
- Modify: `app/assets/css/pages/contents.css`
- Modify: `app/assets/css/pages/home.css`

### Interfaces

- Produces: `createInspiration(input, context)`.
- Produces: `updateInspiration(id, input, expectedVersion, context)`.
- Produces: `convertInspiration(id, input, context)`.
- Produces: `createContent(input, context)`.
- Produces: `getDashboard(range, context)`.
- Consumes: PHASE 1 database, router, auth, idempotency and audit services.

### Steps

- [ ] **Step 1: 写老板原话不可修改测试**

```js
test("rawText remains immutable", async () => {
  const created = await createInspiration({
    rawText: "拍一条凯迪拉克夜景的片子",
    summaryTitle: "凯迪拉克夜景拍摄灵感",
    sourceType: "workbuddy"
  }, context);
  await assert.rejects(
    updateInspiration(created.id, {
      rawText: "被 AI 改写后的句子",
      version: created.version
    }, created.version, context),
    error => error.code === "INSPIRATION_RAW_TEXT_IMMUTABLE"
  );
});
```

Run:

```bash
npm test -- --test-name-pattern="rawText"
```

Expected: FAIL before service implementation.

- [ ] **Step 2: 写转换幂等与四平台唯一测试**

```js
const first = await convertInspiration(inspiration.id, {
  title: "凯迪拉克 XT5 夜景",
  contentType: "organic"
}, { ...context, idempotencyKey: "wechat-message-88" });

const retry = await convertInspiration(inspiration.id, {
  title: "凯迪拉克 XT5 夜景",
  contentType: "organic"
}, { ...context, idempotencyKey: "wechat-message-88" });

assert.equal(retry.id, first.id);
assert.equal(countRows("contents"), 1);
assert.equal(countRows("content_publications"), 4);
assert.equal(countDistinctPlatformRows(first.id), 4);
assert.equal(loadInspiration(inspiration.id).status, "converted");
assert.equal(loadInspiration(inspiration.id).rawText, "拍一条凯迪拉克夜景的片子");
```

Run:

```bash
npm run test:integration
```

Expected: FAIL before repository and service implementation.

- [ ] **Step 3: 实现灵感仓储和服务**

Validate:

```js
const inspirationInput = {
  rawText: nonEmptyString,
  summaryTitle: nonEmptyString,
  brand: optionalString,
  vehicleModel: optionalString,
  sourceType: oneOf("wechat", "workbuddy", "manual", "hotspot", "other"),
  sourcePlatform: optionalString,
  sourceUrl: optionalUrl,
  pinned: boolean,
  tags: stringArray
};
```

Updates may change summary, brand, model, source metadata, pin, status and tags. They may not change `rawText`.

- [ ] **Step 4: 实现 Content 仓储和转换事务**

`createContent` inserts one content and exactly four rows:

```js
const platformCodes = [
  "douyin",
  "wechat_channels",
  "xiaohongshu",
  "weibo"
];
```

`convertInspiration` must wrap these actions in one transaction:

1. load and version-check inspiration;
2. create content;
3. create four publication rows;
4. insert `content_inspirations`;
5. update inspiration status and `converted_content_id`;
6. record audit log;
7. store idempotent response.

- [ ] **Step 5: 实现 REST 路由**

Implement and document:

```text
GET    /api/v1/inspirations
POST   /api/v1/inspirations
GET    /api/v1/inspirations/:id
PATCH  /api/v1/inspirations/:id
POST   /api/v1/inspirations/:id/convert
GET    /api/v1/contents
POST   /api/v1/contents
GET    /api/v1/contents/:id
PATCH  /api/v1/contents/:id
GET    /api/v1/dashboard
```

API integration tests must cover `400`, `401`, `404`, `409` and successful idempotent retry.

- [ ] **Step 6: 实现灵感和内容页面**

`inspirations.js` renders:

- raw text;
- AI summary title;
- brand/model/tags/source/time/status;
- pin;
- “转为内容”；
- converted Content link.

`contents.js` renders one content row with four platform statuses. It must never render the same Content four times.

- [ ] **Step 7: 实现首页聚合**

`GET /dashboard` returns:

```json
{
  "monthContentCount": 0,
  "producingCount": 0,
  "todayPublishCount": 0,
  "needsAttentionCount": 0,
  "platforms": [],
  "recentContents": [],
  "hotspotSummary": []
}
```

The empty arrays above are valid empty-state values; production responses contain database records.

- [ ] **Step 8: 写浏览器闭环测试**

`inspiration-content-flow.spec.js` must:

1. create a WorkBuddy-sourced inspiration;
2. assert raw text is visible;
3. convert it to Content;
4. assert the inspiration remains visible as converted;
5. open Content detail;
6. assert exactly four platform rows;
7. reload and confirm persistence.

Run:

```bash
npm test
npm run test:e2e
```

Expected: all PHASE 3 tests PASS.

- [ ] **Step 9: Commit**

```bash
git add app/server app/assets app/tests
git commit -m "feat: add inspiration to content workflow"
```

### PHASE 3 验收

- 老板原话数据库层与服务层都不可修改；
- 转内容重试不产生重复 Content；
- 每个 Content 恰好四条平台记录；
- 首页和两个页面只读取 API；
- SQLite 中的数据在重启后仍存在；
- 完成后停止并等待用户确认。

---

## PHASE 4：平台发布状态与发布日历

### 目标

让同一 Content 在四个平台拥有独立状态和日期，并以月历呈现拍摄、发布、待确认三类事件。

### Files

- Create: `app/server/repositories/publication-repository.js`
- Create: `app/server/repositories/calendar-repository.js`
- Create: `app/server/services/publication-service.js`
- Create: `app/server/services/calendar-service.js`
- Create: `app/server/routes/calendar-events.js`
- Create: `app/tests/unit/calendar-colors.test.js`
- Create: `app/tests/integration/publication-api.test.js`
- Create: `app/tests/integration/calendar-api.test.js`
- Create: `app/tests/e2e/calendar-flow.spec.js`
- Modify: `app/server/routes/contents.js`
- Modify: `app/server/index.js`
- Modify: `app/server/openapi.yaml`
- Modify: `app/assets/js/pages/contents.js`
- Modify: `app/assets/js/pages/calendar.js`
- Modify: `app/assets/js/components/modal.js`
- Modify: `app/assets/css/pages/contents.css`
- Modify: `app/assets/css/pages/calendar.css`

### Interfaces

- Produces: `updatePublication(contentId, platformCode, input, expectedVersion, context)`.
- Produces: `createCalendarEvent(input, context)`.
- Produces: `listCalendarEvents({ from, to, eventType })`.
- Consumes: Content and four platform records from PHASE 3.

### Steps

- [ ] **Step 1: 写平台状态独立测试**

```js
await updatePublication(content.id, "douyin", {
  status: "published",
  publishedAt: "2026-09-10T12:00:00.000Z",
  publishedUrl: "https://example.invalid/douyin/1",
  version: douyin.version
}, douyin.version, context);

assert.equal(loadPublication(content.id, "douyin").status, "published");
assert.equal(loadPublication(content.id, "xiaohongshu").status, "not_started");
assert.equal(countRows("contents"), 1);
```

- [ ] **Step 2: 写发布事件约束测试**

```js
assert.throws(
  () => createCalendarEvent({
    eventType: "publish",
    title: "发布 XT5",
    startsAt: "2026-09-11T12:00:00.000Z"
  }, context),
  /PUBLICATION_REQUIRED/
);
```

Also assert the API rejects event types `todo`, `reminder` and `meeting`.

- [ ] **Step 3: 实现发布状态 API**

Implement:

```text
PATCH /api/v1/contents/:id/publications/:platformCode
```

Allowed platform status transitions:

```text
not_started → preparing → producing → ready → scheduled → published
```

Backward transitions require `reason` and produce an audit log entry.

- [ ] **Step 4: 实现日历事务规则**

Creating or updating a publish event must update the matching publication:

```js
publication.status = "scheduled";
publication.scheduledAt = event.startsAt;
```

Deleting a future publish event clears `scheduledAt` only when no other active publish event references that publication.

- [ ] **Step 5: 实现月历 UI**

Use exact semantic colors:

```js
export const CALENDAR_COLORS = Object.freeze({
  publish: "#ff4d5f",
  shoot: "#2f8cff",
  pending_confirmation: "#9a6bff"
});
```

The calendar request always sends an explicit `from` and `to`. The UI displays platform badges only for publish events.

- [ ] **Step 6: 写端到端测试**

The test creates one Content and schedules:

```text
抖音：2026-09-12
视频号：2026-09-13
小红书：2026-09-15
微博：未排期
拍摄：2026-09-09
待确认：2026-09-10
```

Assertions:

- one Content in Content Library;
- three publish events on different dates;
- one blue shoot event;
- one purple pending event;
- no Todo or Reminder labels.

Run:

```bash
npm test
npm run test:e2e
```

- [ ] **Step 7: Commit**

```bash
git add app/server app/assets app/tests
git commit -m "feat: add platform scheduling calendar"
```

### PHASE 4 验收

- 一个 Content 仍只计数一次；
- 四个平台状态与日期互不覆盖；
- 日历只显示拍摄、发布、待确认；
- 颜色与原型一致；
- 平台排期与日历事件事务一致；
- 完成后停止并等待用户确认。

---

## PHASE 5：统一数据导入、数据总览与单条作品复盘

### 目标

让手工、CSV、Excel、WorkBuddy 和未来官方 API 共用同一数据模型，并完成平台总览与单条作品复盘。

### Files

- Create: `app/server/db/migrations/002_analytics.sql`
- Create: `app/server/repositories/metric-repository.js`
- Create: `app/server/repositories/review-repository.js`
- Create: `app/server/services/ingestion-service.js`
- Create: `app/server/services/analytics-service.js`
- Create: `app/server/services/review-service.js`
- Create: `app/server/routes/ingestion-runs.js`
- Create: `app/server/routes/analytics.js`
- Create: `app/server/routes/reviews.js`
- Create: `app/tests/fixtures/metrics-valid.csv`
- Create: `app/tests/fixtures/metrics-partial.csv`
- Create: `app/tests/unit/metric-normalization.test.js`
- Create: `app/tests/integration/ingestion-api.test.js`
- Create: `app/tests/integration/review-api.test.js`
- Create: `app/tests/e2e/analytics-review.spec.js`
- Modify: `app/package.json`
- Modify: `app/package-lock.json`
- Modify: `app/server/index.js`
- Modify: `app/server/openapi.yaml`
- Modify: `app/assets/js/pages/analytics.js`
- Modify: `app/assets/js/components/chart.js`
- Modify: `app/assets/css/pages/analytics.css`

### Interfaces

- Produces: `importMetrics({ sourceType, sourceName, rows }, context)`.
- Produces: `getAnalyticsOverview({ from, to, platformCode })`.
- Produces: `createContentReview(contentId, input, context)`.
- Consumes: platforms, publications and Content from earlier phases.

### Steps

- [ ] **Step 1: 安装文件解析依赖并锁定版本**

Run:

```bash
cd app
npm install csv-parse xlsx
npm install --save-dev @playwright/test
```

Commit the generated `package-lock.json`. Production installation later uses `npm ci`.

- [ ] **Step 2: 写统一归一化测试**

```js
const normalized = normalizeMetricRow({
  platform: "抖音",
  contentId: "content-1",
  periodStart: "2026-08-08",
  periodEnd: "2026-08-28",
  views: "33959000",
  completionRate: "1.33%",
  evidenceLevel: "observed"
});

assert.equal(normalized.platformCode, "douyin");
assert.equal(normalized.values.views.valueNumber, 33959000);
assert.equal(normalized.values.completion_rate.valueNumber, 0.0133);
assert.equal(normalized.values.completion_rate.unit, "ratio");
```

Reject unknown evidence levels and percentages outside `0..1` after normalization.

- [ ] **Step 3: 实现 002 迁移**

Create:

```text
ingestion_runs
metric_snapshots
metric_values
metric_series_points
content_reviews
review_findings
```

Add indexes for:

```text
metric_snapshots(platform_id, period_end)
metric_snapshots(publication_id, period_end)
metric_values(snapshot_id, metric_key)
metric_series_points(snapshot_id, series_key, position)
content_reviews(content_id, generated_at)
```

- [ ] **Step 4: 写部分失败导入测试**

Given a file with three rows:

```text
row 1 valid
row 2 unknown platform
row 3 valid
```

Assert:

```js
assert.equal(run.status, "partial_failure");
assert.equal(run.rowsTotal, 3);
assert.equal(run.rowsImported, 2);
assert.equal(run.rowsRejected, 1);
assert.equal(loadMetricSnapshots(run.id).length, 2);
assert.equal(run.errors[0].rowNumber, 2);
```

Retrying the same WorkBuddy idempotency key must return the same ingestion run.

- [ ] **Step 5: 实现统一导入流水线**

Adapters produce the same canonical object:

```js
{
  platformCode,
  publicationId,
  periodStart,
  periodEnd,
  capturedAt,
  sourceReference,
  values: [
    {
      metricKey,
      valueNumber,
      unit,
      evidenceLevel,
      calculationNote
    }
  ],
  series: [
    {
      seriesKey,
      position,
      label,
      valueNumber,
      unit,
      evidenceLevel
    }
  ]
}
```

Manual, CSV, Excel and WorkBuddy inputs call the same validator and repository transaction.

- [ ] **Step 6: 实现数据总览**

`GET /api/v1/analytics/overview?from=<date>&to=<date>` returns:

- total views/reads;
- Content count;
- best Content;
- net followers;
- four platform cards;
- Content ranking;
- views, likes, comments and follower trends;
- latest data timestamp;
- data completeness summary.

All aggregate calculations must be tested with fixed fixtures.

- [ ] **Step 7: 实现单条作品复盘**

`POST /api/v1/contents/:id/reviews` validates:

```js
{
  periodStart,
  periodEnd,
  summary,
  dataQuality: oneOf("complete", "partial", "proxy_based"),
  generatedBy: oneOf("human", "workbuddy", "ai"),
  findings: [
    {
      findingType,
      title,
      body,
      evidenceLevel,
      evidence: {
        metricKeys: [],
        snapshotIds: [],
        seriesRanges: []
      },
      sortOrder
    }
  ]
}
```

Inferred findings require non-empty evidence and an explanatory note.

- [ ] **Step 8: 实现图表和复盘页面**

`chart.js` supports:

```text
trend line
retention curve
traffic lifecycle
engagement timeline
traffic source bars
```

The page always displays source, period, updated time and evidence badges. `proxy_based` reviews show a visible warning.

- [ ] **Step 9: 运行完整测试**

Run:

```bash
npm test
npm run test:e2e
```

Expected:

- CSV and Excel fixtures import;
- partial failure reports exact row numbers;
- manual and WorkBuddy data produce the same database shape;
- review evidence labels render;
- no platform API is required.

- [ ] **Step 10: Commit**

```bash
git add app/package.json app/package-lock.json app/server app/assets app/tests
git commit -m "feat: add analytics ingestion and content reviews"
```

### PHASE 5 验收

- 五种来源共享一个归一化入口；
- 首版不依赖官方 API；
- 原始、派生、推断数据可区分；
- 单条作品具备指标、曲线、优点、问题和建议；
- 部分失败可追踪且重试不重复；
- 完成后停止并等待用户确认。

---

## PHASE 6：周月报、热点竞品、设置与完整备份恢复

### 目标

完成剩余业务闭环，并把备份、恢复、版本和 WorkBuddy 连接状态做成可操作的设置页。

### Files

- Create: `app/server/db/migrations/003_audit_and_reports.sql`
- Create: `app/server/repositories/observation-repository.js`
- Create: `app/server/repositories/report-repository.js`
- Create: `app/server/repositories/settings-repository.js`
- Create: `app/server/services/observation-service.js`
- Create: `app/server/services/report-service.js`
- Create: `app/server/services/restore-service.js`
- Create: `app/server/routes/observations.js`
- Create: `app/server/routes/reports.js`
- Create: `app/server/routes/settings.js`
- Create: `app/server/routes/backups.js`
- Create: `app/tests/integration/observation-convert.test.js`
- Create: `app/tests/integration/report-snapshot.test.js`
- Create: `app/tests/integration/restore-service.test.js`
- Create: `app/tests/e2e/report-observation-settings.spec.js`
- Modify: `app/server/index.js`
- Modify: `app/server/openapi.yaml`
- Modify: `app/assets/js/pages/reports.js`
- Modify: `app/assets/js/pages/observations.js`
- Modify: `app/assets/js/pages/settings.js`
- Modify: `app/assets/css/pages/reports.css`
- Modify: `app/assets/css/pages/observations.css`
- Modify: `app/assets/css/pages/settings.css`
- Create: `scripts/backup-local.sh`
- Create: `scripts/restore-local.sh`

### Interfaces

- Produces: `convertObservationToInspiration(id, input, context)`.
- Produces: `generateReport({ periodType, periodStart, periodEnd }, context)`.
- Produces: `restoreBackup({ backupId, actor, confirmation }, context)`.
- Consumes: inspiration, content, calendar, metrics, reviews and backup service.

### Steps

- [ ] **Step 1: 写热点转灵感幂等测试**

```js
const first = await convertObservationToInspiration(observation.id, {
  summaryTitle: "沃尔沃安全实验室选题"
}, { ...context, idempotencyKey: "observation-7" });

const retry = await convertObservationToInspiration(observation.id, {
  summaryTitle: "沃尔沃安全实验室选题"
}, { ...context, idempotencyKey: "observation-7" });

assert.equal(first.id, retry.id);
assert.equal(countRows("inspirations"), 1);
assert.equal(loadObservation(observation.id).status, "converted");
assert.equal(loadObservation(observation.id).convertedInspirationId, first.id);
```

- [ ] **Step 2: 实现热点与竞品 API/UI**

Implement:

```text
GET   /api/v1/observations
POST  /api/v1/observations
PATCH /api/v1/observations/:id
POST  /api/v1/observations/:id/convert
```

The UI has two tabs, “热点雷达”和“竞品观察”. V1 only accepts manual or WorkBuddy candidates.

- [ ] **Step 3: 写报告快照测试**

```js
const report = await generateReport({
  periodType: "week",
  periodStart: "2026-08-31T00:00:00.000Z",
  periodEnd: "2026-09-06T23:59:59.999Z"
}, context);

assert.match(report.markdown, /新增灵感/);
assert.match(report.markdown, /新增内容/);
assert.match(report.markdown, /已发布内容/);
assert.match(report.markdown, /四平台表现/);
assert.match(report.markdown, /下一周期建议/);
assert.equal(loadReport(report.id).markdown, report.markdown);
```

After changing source data, the saved report text must remain unchanged.

- [ ] **Step 4: 实现周报/月报服务和页面**

Reports aggregate:

```text
inspirations
contents
content_publications
schedule_events
metric_snapshots
metric_values
observations
content_reviews
```

Preview does not write. `POST /reports` stores a snapshot. Copy and Markdown export use the stored snapshot.

- [ ] **Step 5: 写恢复保护测试**

The test must:

1. create current data;
2. create a valid backup;
3. change current data;
4. call restore;
5. assert a `pre-restore` backup exists;
6. assert restored data matches the selected backup;
7. corrupt another backup and assert restore refuses it;
8. assert the current database remains readable after refusal.

- [ ] **Step 6: 实现完整恢复流程**

`restoreBackup` executes:

```text
verify manifest SHA-256
open temporary copy
PRAGMA integrity_check
verify supported schema version
create pre-restore backup
block writes
close active database
atomically replace database
reopen and run health check
unblock writes
```

If the final health check fails, restore the `pre-restore` backup and return `RESTORE_ROLLED_BACK`.

- [ ] **Step 7: 实现设置页**

Settings displays:

- WorkBuddy connection status and last request time;
- backup list with verification state;
- restore action with explicit confirmation;
- four platform basic settings without credentials;
- hotspot keywords;
- current app version;
- Git SHA;
- schema version;
- update check result.

The page must not expose the bearer token value after initial generation.

- [ ] **Step 8: 运行测试与恢复演练**

Run:

```bash
npm test
npm run test:e2e
bash scripts/backup-local.sh --reason manual-test
bash scripts/restore-local.sh --verify-only latest
```

Expected: all tests PASS and verify-only does not alter the live database.

- [ ] **Step 9: Commit**

```bash
git add app/server app/assets app/tests scripts
git commit -m "feat: add reports observations and safe restore"
```

### PHASE 6 验收

- 热点收入灵感不会重复；
- 周报/月报包含五类业务数据并保存快照；
- 设置页不保存账号密码；
- 备份可校验，坏备份不可恢复；
- 恢复前有保护备份，失败自动回滚；
- 完成后停止并等待用户确认。

---

## PHASE 7：WorkBuddy Skill、安装更新回滚与全量验收

### 目标

让老板通过 WorkBuddy 完成“记、找、改、看”，并验证 GitHub 更新不会覆盖真实数据。

### Files

- Create: `workbuddy/SKILL.md`
- Create: `workbuddy/scripts/workbench-client.mjs`
- Create: `workbuddy/tests/client-contract.test.js`
- Create: `scripts/install-local.sh`
- Create: `scripts/update-local.sh`
- Create: `scripts/rollback-code.sh`
- Create: `scripts/preflight.mjs`
- Create: `app/tests/contract/workbuddy-api.test.js`
- Create: `app/tests/integration/update-data-survival.test.js`
- Create: `app/tests/e2e/full-journey.spec.js`
- Create: `docs/operations/install-and-update.md`
- Create: `docs/operations/backup-and-restore.md`
- Create: `docs/operations/workbuddy-usage.md`
- Modify: `app/server/http/auth.js`
- Modify: `app/server/routes/settings.js`
- Modify: `app/server/openapi.yaml`
- Modify: `app/README.md`
- Modify: project root `README.md`

### Interfaces

- Produces: `workbench-client.mjs remember|find|change|view`.
- Produces: `install-local.sh`, `update-local.sh`, `rollback-code.sh`.
- Consumes: stable `/api/v1`, `data/secrets.json`, Git repository and Node 24.x.

### Steps

- [ ] **Step 1: 写 WorkBuddy 契约测试**

`workbuddy-api.test.js` must cover:

```js
const remembered = await client.remember({
  rawText: "老板原话：周五拍高山",
  summaryTitle: "高山周五拍摄灵感",
  idempotencyKey: "wechat-thread-1-message-9"
});

assert.equal(remembered.rawText, "老板原话：周五拍高山");
assert.match(remembered.id, /^[0-9a-f-]{36}$/);

const found = await client.find({ query: "高山" });
assert.equal(found.items[0].id, remembered.id);
```

Also cover `401`, `409`, timeout retry and duplicate idempotency key.

- [ ] **Step 2: 实现 WorkBuddy 客户端**

CLI commands:

```text
node workbuddy/scripts/workbench-client.mjs remember --json '<payload>'
node workbuddy/scripts/workbench-client.mjs find --query '高山'
node workbuddy/scripts/workbench-client.mjs change --type content --id '<uuid>' --json '<payload>'
node workbuddy/scripts/workbench-client.mjs view --name dashboard
```

The client reads:

```text
WORKBENCH_API_URL default http://127.0.0.1:5173/api/v1
token from project root data/secrets.json
```

It prints one JSON object to stdout and sends diagnostics to stderr. It never logs the token.

- [ ] **Step 3: 编写 WorkBuddy Skill**

`workbuddy/SKILL.md` must map:

```text
记 → remember
找 → find
改 → change
看 → view
```

For ambiguous destructive changes, the Skill asks for confirmation. For successful writes, it reports entity type, ID and key fields. It never claims success before receiving a 2xx API response.

- [ ] **Step 4: 写更新不丢数据测试**

The test creates a temporary Git repository with:

```text
release A code
data/workbench.sqlite containing one inspiration
release B code
```

After running `update-local.sh`, assert:

```js
assert.equal(loadInspirationCount(dataDir), 1);
assert.equal(fs.existsSync(path.join(dataDir, "secrets.json")), true);
assert.equal(gitTrackedFiles.some(file => file.startsWith("data/")), false);
assert.equal(health.appVersion, "release-b");
```

Run the update a second time and assert no duplicate migration or backup corruption.

- [ ] **Step 5: 实现安装脚本**

`install-local.sh` executes in this order:

```text
verify project root
verify Node major version 24
npm ci in app/
create data directories without overwriting existing files
run migrations
generate token only if data/secrets.json is absent
start service
run health check
print local URL and WorkBuddy installation path
```

- [ ] **Step 6: 实现更新脚本**

`update-local.sh` executes:

```text
verify data/ is ignored and untracked
record current Git SHA
git fetch origin
git pull --ff-only
create and verify pre-update backup
npm ci
run migrations
restart service
run /api/v1/health
verify app version, schema version and Git SHA
```

If health fails, call `rollback-code.sh` with the recorded SHA. Database migrations follow the expand/contract rule, so the previous release remains compatible.

- [ ] **Step 7: 实现代码回滚**

`rollback-code.sh` may change tracked code only. It must:

```text
stop service
checkout the previously recorded release SHA
npm ci
restart service
run health check
leave data/ untouched
```

Database restore is a separate explicit command and is not automatically coupled to ordinary code rollback.

- [ ] **Step 8: 写完整用户旅程测试**

`full-journey.spec.js` must run:

1. WorkBuddy creates an inspiration with original wording;
2. web UI finds it;
3. WorkBuddy converts it to Content;
4. web UI shows one Content and four platform rows;
5. web UI schedules different dates;
6. WorkBuddy imports metrics;
7. web UI opens a single-content review;
8. report snapshot is generated and downloaded;
9. hotspot converts to inspiration;
10. backup verifies;
11. simulated update completes;
12. all original entity IDs and data still exist.

- [ ] **Step 9: 运行发布前验证**

Run:

```bash
cd app
npm test
npm run test:e2e
node ../workbuddy/tests/client-contract.test.js
node ../scripts/preflight.mjs
node ../scripts/health-check.mjs
```

Run desktop and mobile visual checks against all 8 files in `docs/product-reference/`.

- [ ] **Step 10: 编写操作文档**

The three operation documents must contain exact commands for:

- first install;
- normal update;
- failed update rollback;
- manual backup;
- verify-only restore check;
- explicit restore;
- token rotation;
- WorkBuddy “记、找、改、看” examples.

- [ ] **Step 11: Commit**

```bash
git add workbuddy scripts app/tests app/server app/README.md README.md docs/operations
git commit -m "feat: add workbuddy integration and safe updater"
```

### PHASE 7 验收

- WorkBuddy 四类操作全部通过真实 API；
- 重试不产生重复数据；
- 安装、更新、代码回滚均不修改 `data/`；
- 备份恢复与迁移演练通过；
- 8 页面桌面和移动端回归通过；
- 完整用户旅程通过；
- 完成后停止，等待是否发布到 GitHub 的单独授权。

---

## 计划自检清单

- [ ] 7 个开发阶段都有明确目标、文件、测试、验收和提交点。
- [ ] 所有主页面都被至少一个阶段覆盖。
- [ ] 所有数据表都被迁移阶段覆盖。
- [ ] 所有 API 端点都被实现阶段和契约测试覆盖。
- [ ] 老板原话不可修改有数据库、服务和端到端三层验证。
- [ ] Content 与四平台关系有唯一约束和重试验证。
- [ ] CSV、Excel、手工、WorkBuddy、未来 API 共享数据归一化边界。
- [ ] GitHub 更新不覆盖 `data/` 有自动化演练。
- [ ] 备份、校验、恢复和回滚有失败路径测试。
- [ ] 取消的模块没有进入任何实施阶段。
- [ ] 每个阶段结束后都要求停止并等待用户确认。
