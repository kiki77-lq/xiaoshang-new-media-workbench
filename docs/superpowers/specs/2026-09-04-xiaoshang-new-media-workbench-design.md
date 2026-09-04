# 小商新媒体运营工作台设计规格

> 阶段：PHASE 0
>
> 日期：2026-09-04
>
> 本文只定义产品、数据、接口、文件结构、迁移和验收方案，不包含业务功能实现。

## 1. 结论

新产品采用“复用 v24 视觉与本地 PWA 基础，重构业务模型和数据层”的方案。

- 前端继续使用 Vanilla HTML、CSS、JavaScript，避免为了换框架而推翻可复用代码。
- Node 服务与网页由同一进程提供，浏览器和 WorkBuddy 通过同一套版本化 REST API 读写同一份 SQLite 数据。
- 真实运营数据固定放在项目根目录 `data/`，代码只放在 Git 中；`git pull`、安装依赖和替换 `app/` 均不得覆盖 `data/`。
- 产品固定为一个 IP“ 小商的拍车日记”和四个平台：抖音、视频号、小红书、微博。
- 一条内容只建立一个 `content`，四个平台的发布进度放在四条 `content_publications` 中，避免同一内容复制四份。
- v24 的“多账号、待办、提醒、账号密码、选题素材库”不进入新产品；“灵感备忘、内容库、发布日历、数据看板、周月报、热点/竞品观察、设置”按新模型重构。
- PHASE 0 之后建议分 7 个开发阶段执行，每个阶段单独验收，未经确认不得自动进入下一阶段。

## 2. 已确认基线

### 2.1 目录与源码

| 项目 | 已确认状态 |
|---|---|
| 新项目根目录 | `/Users/macbook/Desktop/工作/小商的拍车日记/小商新媒体运营工作台/` |
| 上游仓库 | `https://github.com/BaiShui-xss/baishui-zmt-v24` |
| 上游分支 | `main` |
| 上游提交 | `d8f8e5b2d10c193d0ea0bf3581e41cc34490e55b` |
| 提交时间 | `2026-08-08T22:38:51+08:00` |
| 上游完整只读仓库 | `references/upstream-skill-repo/` |
| 提取后的可运行只读基准 | `references/v24-source/` |
| 独立开发副本 | `app/` |
| 复制校验 | `diff -qr` 无差异 |
| upstream push | 已设置为 `DISABLED` |

GitHub 仓库根目录本身是一个 WorkBuddy Skill 包装层。`references/upstream-skill-repo/` 永久保存这份完整证据，仓库内部真正可运行的应用已原样提取到 `references/v24-source/`。两个目录都只读；业务开发只发生在 `app/`。

### 2.2 原型

新项目已保留以下 8 张正式原型：

1. `docs/product-reference/首页.png`
2. `docs/product-reference/灵感备忘.png`
3. `docs/product-reference/内容库.png`
4. `docs/product-reference/内容排期.png`
5. `docs/product-reference/数据看板.png`
6. `docs/product-reference/周报月报.png`
7. `docs/product-reference/热点-竞品观察.png`
8. `docs/product-reference/设置.png`

历史“素材库”原型没有复制到新项目，也不进入产品导航、数据模型、API 或实施计划。

### 2.3 单条作品复盘参考

分析依据为：

`/Users/macbook/Desktop/工作/小商的拍车日记/02-实验/运营数据/小商的拍车日记 · 视频复盘报告（2026-08-08 至 08-28）.pdf`

该报告证明单条内容分析至少需要：

- 播放、点赞、评论、分享、收藏、涨粉、脱粉和净粉丝；
- 完播率、平均播放时长、2 秒跳出率、逐秒留存；
- 流量生命周期、流量来源和高互动时间段；
- 做得好的判断、问题诊断、下一条建议；
- 数据周期、数据来源、样本缺失说明；
- “观察事实、计算结果、模型推断”三种证据等级。

报告中曾因缺少单作品明细而使用“高流量日期/小时”代理 TOP 内容。新数据模型必须显式保存证据等级与计算口径，不能把代理推断显示成已确认事实。

## 3. v24 源码审计

### 3.1 技术组成

| 文件 | 规模 | 当前职责 |
|---|---:|---|
| `app/index.html` | 311 行 | 单页应用全部页面骨架、导航和弹窗 |
| `app/assets/css/style.css` | 475 行 | 视觉变量、布局、组件、移动端和 iOS 修复 |
| `app/assets/js/store.js` | 236 行 | `localStorage` 状态、种子数据、导入导出和整包同步 |
| `app/assets/js/app.js` | 1335 行 | 页面渲染、CRUD、图表、日历、报告、设置和通知 |
| `app/server.js` | 130 行 | 静态文件服务、`node:sqlite` 和 `/api/state` 整包同步 |
| `app/serve.js` | 37 行 | 零依赖静态服务器 |
| `app/sw.js` | 39 行 | PWA 外壳缓存 |
| `app/manifest.webmanifest` | 18 行 | PWA 安装配置 |
| `app/prototype.html` | 686 行 | 早期内联原型，不是正式入口 |

项目无 `package.json`、无构建步骤、无仓库内自动化测试。浏览器代码为全局变量和单文件渲染函数。

### 3.2 现有数据模型

`store.js` 把以下集合组成一个浏览器状态对象：

- `accounts`
- `memos`
- `todos`
- `reminders`
- `topics`
- `metrics`
- `reminderTypes`
- `profile`
- `settings`

默认持久化位置是浏览器 `localStorage` 的 `ops-workbench-v2`。可选同步后端只把整个状态对象序列化到 SQLite 的一行：

```sql
CREATE TABLE kv(
  key TEXT PRIMARY KEY,
  value TEXT,
  updatedAt INTEGER
);
```

现有 API 只有：

- `GET /api/ping`
- `GET /api/state`
- `POST /api/state`

冲突策略为整包状态的 last-write-wins。任意一端的旧状态都可能覆盖另一端刚写入的数据，无法支持可靠的 WorkBuddy 细粒度操作。

### 3.3 本地验证结果

在当前机器 Node `v24.13.0` 下完成以下只读/临时验证：

- `node --check assets/js/store.js`：通过；
- `node --check assets/js/app.js`：通过；
- `node --check server.js`：通过；
- `node --check serve.js`：通过；
- `node --check sw.js`：通过；
- 临时目录启动 `node --experimental-sqlite server.js 41873`：成功；
- `GET /api/ping`：返回 `{"sync":true}`；
- `GET /api/state`：成功；
- `POST /api/state` 后再次读取：成功；
- `GET /`：HTTP 200；
- 测试数据库只生成在临时目录，没有写入项目 `data/`。

### 3.4 可直接复用

| 复用项 | 复用方式 |
|---|---|
| 黑色、中性深灰、青色强调的视觉变量 | 保留颜色、圆角、边框、阴影和高密度布局参数 |
| 侧栏、顶栏、卡片、筛选芯片、弹窗、Toast | 拆成共享组件后继续使用 |
| 桌面优先与 `860px` 移动端断点 | 继续作为第一版响应式基线 |
| iOS 日期输入修复 | 保留 `appearance:none`、`min-width:0` 和弹窗溢出约束 |
| 月历日期计算与单日详情交互 | 改为读取 `schedule_events`，不再混入待办和提醒 |
| SVG 图表绘制思路 | 提取为图表组件，扩展为趋势、留存和生命周期图 |
| Markdown 复制与下载 | 用于周报/月报导出 |
| JSON 备份交互 | 保留用户心智，底层改为 SQLite 一致性备份 |
| PWA manifest、图标和离线外壳 | 保留；Service Worker 必须排除 `/api/` |
| Node 静态服务与 `node:sqlite` 可行性 | 作为新服务的起点，不复用整包状态接口 |

### 3.5 明确删除

以下能力不进入新产品：

- 多独立 IP / 多账号管理；
- 账号密码和账号备注字段；
- Todo；
- Reminder；
- 浏览器系统通知和自定义提醒类型；
- 旧“选题素材库”及历史“素材库”概念；
- 首次启动种子演示数据；
- 任意云端同步地址和 15 秒整包轮询；
- CloudStudio 固定公网地址、二维码打开页和旧部署说明；
- 整包清空全部数据的危险入口；
- 依赖账号删除而级联删除全部业务数据的逻辑。

### 3.6 必须重构

| 模块 | v24 问题 | 新设计 |
|---|---|---|
| `store.js` | 浏览器全量状态是真源 | 浏览器只缓存查询结果，SQLite 是唯一真源 |
| `server.js` | 单表单行 JSON、无鉴权、无请求大小限制、无字段校验 | 版本化 REST API、结构化表、验证、鉴权、事务、幂等 |
| `app.js` | 1335 行单体文件 | 按页面、共享组件、API 客户端拆分 |
| `index.html` | 写死旧 8 模块 | 改为新产品 8 页面与固定单 IP |
| 日历 | 混合 Todo、Reminder、发布 | 只显示拍摄、发布、待确认 |
| 数据看板 | 仅账号级 4 个指标 | 平台总览 + 单条作品复盘 + 数据证据等级 |
| 周/月报 | 汇总 Todo、Reminder、Topic、Memo | 汇总灵感、内容、发布、数据、热点 |
| 同步 | last-write-wins 整包覆盖 | 行级 CRUD、乐观锁、幂等键、审计日志 |
| CSV | `split(",")`，不能正确处理引号、换行和 Excel | 统一导入流水线、字段映射、逐行校验和错误报告 |
| Service Worker | 缓存所有 GET，可能缓存 `/api/state` | 仅缓存静态外壳，所有 `/api/` 使用 network-only |
| 静态服务 | 路径前缀判断不够严格 | `path.resolve` 后校验目录边界并阻止目录穿越 |
| 数据升级 | 无 schema 版本和迁移 | 事务迁移、升级前备份、扩展/收缩策略 |

## 4. 产品信息架构

### 4.1 固定导航

| 顺序 | 页面 | 核心目标 |
|---:|---|---|
| 01 | 首页 / 总览 | 看本月内容、制作中、今日待发布、需要处理、四平台矩阵、最新分发和热点摘要 |
| 02 | 灵感备忘 | 保留老板原话，AI 补充摘要和标签，可幂等转为内容 |
| 03 | 内容库 | 一条内容统一管理，下面展示四个平台独立状态 |
| 04 | 发布日历 | 月历显示拍摄、发布、待确认，不承载任务和会议 |
| 05 | 数据看板 | 平台总览与单条作品复盘 |
| 06 | 周报 / 月报 | 聚合灵感、内容、发布、数据和热点，复制或导出 Markdown |
| 07 | 热点 / 竞品观察 | 热点筛选、竞品观察、收入灵感闭环 |
| 08 | 设置 | WorkBuddy、备份恢复、平台基础配置、关键词、版本与更新 |

### 4.2 核心闭环

```text
热点/竞品观察
    ↓ 收入灵感
灵感备忘（老板原话不可改）
    ↓ 转为内容
内容库（唯一 Content）
    ↓ 为四个平台分别排期
发布日历 / 四平台发布状态
    ↓ 导入运营数据
数据看板 / 单条作品复盘
    ↓ 周期聚合
周报 / 月报
```

### 4.3 页面行为约束

#### 首页

- “本月内容”按 `contents.created_at` 和当前月份统计；
- “制作中”来自 `contents.status = producing`；
- “今日待发布”来自当天 `schedule_events.event_type = publish`；
- “需要处理”只统计待确认事件、失败导入和需要人工确认的数据，不引入 Todo；
- 平台矩阵固定四个平台，不允许用户新增第五个平台；
- 最新内容分发展示一条内容及其四个平台状态；
- 热点雷达只展示摘要，详情进入第 07 页。

#### 灵感备忘

- `raw_text` 保存老板原话并由数据库触发器阻止更新；
- AI 只写 `summary_title`、品牌、车型、标签和结构化补充；
- “转为内容”在一个事务中创建 Content、建立关联并把灵感标记为已转内容；
- 同一幂等键重试时返回同一 Content，不创建重复记录；
- 转换后灵感仍保留，可回看原始表达。

#### 内容库

- 内容类型固定为“纯享”和“商单”；
- 总体状态固定为“准备中、制作中、待发布、已发布”；
- 新建内容时自动生成四个平台发布记录；
- 平台发布记录可分别保存状态、排期、发布时间、作品链接和平台作品 ID；
- 任何列表和统计按 Content 去重，不按平台发布记录重复计数。

#### 发布日历

- 月历颜色固定为：红色发布、蓝色拍摄/项目安排、紫色待确认；
- 发布事件可关联具体平台发布记录；
- 同一 Content 可在四个平台拥有不同发布时间；
- 不展示 Todo、Reminder、会议和通用项目任务。

#### 数据看板

- 总览聚合平台级与内容级快照；
- 单条复盘必须显示数据周期、来源、更新时间和证据等级；
- 留存、流量生命周期、互动时间段等曲线以序列点存储；
- AI 结论与原始指标分表保存，任何推断必须带证据引用；
- 第一版允许手动、CSV、Excel 和 WorkBuddy 导入；官方 API 作为同一导入接口的未来适配器。

#### 周报 / 月报

- 报告生成时保存一份快照，避免后来数据变化导致历史报告悄悄变化；
- 报告包含范围、生成时间、指标更新时间和数据缺口；
- 支持复制和 Markdown 下载；
- AI 结论必须引用本周期的指标或事件，不生成无法追溯的断言。

#### 热点 / 竞品观察

- `kind` 区分热点和竞品；
- 状态固定为“待判断、已收入灵感、已忽略”；
- “收入灵感”必须事务化并写入关联 ID；
- V1 只接收人工或 WorkBuddy 搜索形成的候选，不建设大规模爬虫。

#### 设置

- 不保存平台账号密码；
- WorkBuddy 只显示连接状态、最近请求时间和令牌轮换入口；
- 备份恢复操作必须显示备份时间、应用版本、数据库版本和校验结果；
- 恢复前自动生成当前数据的保护性备份；
- 更新检查只比较代码版本，不下载或替换 `data/`。

## 5. 视觉规格

### 5.1 视觉基准

- 背景：纯黑或接近纯黑；
- 面板：中性深灰，不使用蓝紫渐变背景；
- 主强调色：青色；
- 状态色：成功绿、警告橙、危险红、待确认紫；
- 卡片：圆角、细边框、高信息密度；
- 桌面端优先，主内容宽度充分利用大屏；
- 移动端在后续阶段适配，不牺牲桌面端的信息密度。

### 5.2 建议设计变量

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

这些变量以首页原型为主，v24 的中性深灰层级和移动端修复继续复用。实际页面实现前应先建立截图基准，再逐页做视觉回归。

## 6. 推荐技术架构

### 6.1 总体结构

```text
浏览器工作台 ───────┐
                    ├── HTTP/JSON ── Node 本地服务 ── SQLite
WorkBuddy Skill ────┘                      │
                                          ├── data/backups/
CSV / Excel / 手工 / API 适配器 ──────────└── data/imports/
```

- SQLite 是唯一真实数据源；
- 网页不再直接维护业务真源；
- WorkBuddy 不模拟点击网页；
- 网页和 WorkBuddy 都只调用 `/api/v1`；
- 服务默认监听 `127.0.0.1`，避免把真实数据暴露到局域网；
- PWA 只缓存静态外壳，不缓存 API 响应；
- 默认运行时固定为 Node 24.x，启动时检查版本和 SQLite 能力。

### 6.2 运行时数据目录

```text
data/
├── workbench.sqlite
├── workbench.sqlite-wal
├── workbench.sqlite-shm
├── secrets.json
├── backups/
│   ├── 2026-09-04T120000Z-pre-update.sqlite
│   └── 2026-09-04T120000Z-pre-update.json
├── imports/
└── logs/
```

- 整个 `data/` 已被项目根 `.gitignore` 忽略；
- `secrets.json` 文件权限设为当前用户可读写；
- `app/` 内禁止创建生产数据库；
- 默认数据目录由项目根推导，也允许通过 `WORKBENCH_DATA_DIR` 指向其他本地持久路径；
- 更新脚本只操作 Git 跟踪文件，不复制、清空或覆盖 `data/`。

### 6.3 SQLite 连接要求

启动时执行：

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = FULL;
```

写操作全部使用事务。每次启动先执行迁移，再开放 HTTP 端口。迁移失败时服务不启动，保留升级前备份。

## 7. 最终数据模型

所有 ID 使用 `crypto.randomUUID()` 生成的 UUID 文本；时间使用 UTC ISO 8601；布尔值在 SQLite 中使用 `0/1`；所有业务表包含 `created_at`、`updated_at` 和 `version`。

分析与系统基础实体命名冻结为：`metric_snapshots`、`metric_values`、`metric_series_points`、`content_reviews`、`review_findings`、`report_snapshots`、`idempotency_keys`、`audit_log`。不得另建 `metric_definitions`、`metric_series`、`reports`、`audit_events` 等意义重复的表。

### 7.1 基础配置

#### `schema_migrations`

| 字段 | 类型 | 约束 |
|---|---|---|
| `version` | INTEGER | 主键 |
| `name` | TEXT | 非空 |
| `checksum` | TEXT | 非空 |
| `applied_at` | TEXT | 非空 |

#### `platform_channels`

| 字段 | 类型 | 约束 |
|---|---|---|
| `id` | TEXT | 主键 |
| `code` | TEXT | 唯一，固定为 `douyin`、`wechat_channels`、`xiaohongshu`、`weibo` |
| `display_name` | TEXT | 非空 |
| `handle` | TEXT | 可空 |
| `profile_url` | TEXT | 可空 |
| `enabled` | INTEGER | 非空，默认 1 |
| `last_metric_at` | TEXT | 可空 |

该表只保存基础配置，不保存账号密码、Cookie 或平台 Token。

#### `app_settings`

| 字段 | 类型 | 约束 |
|---|---|---|
| `key` | TEXT | 主键 |
| `value_json` | TEXT | 非空、必须是合法 JSON |
| `updated_at` | TEXT | 非空 |

允许的设置键由服务端白名单控制，例如热点关键词、备份保留数量和界面偏好。

### 7.2 灵感与内容

#### `inspirations`

| 字段 | 类型 | 约束 |
|---|---|---|
| `id` | TEXT | 主键 |
| `raw_text` | TEXT | 非空、创建后不可修改 |
| `summary_title` | TEXT | 非空 |
| `brand` | TEXT | 可空 |
| `vehicle_model` | TEXT | 可空 |
| `source_type` | TEXT | `wechat`、`workbuddy`、`manual`、`hotspot`、`other` |
| `source_platform` | TEXT | 可空 |
| `source_url` | TEXT | 可空 |
| `pinned` | INTEGER | 非空，默认 0 |
| `status` | TEXT | `inbox`、`organized`、`converted`、`archived` |
| `converted_content_id` | TEXT | 可空，外键到 `contents.id` |
| `created_at` | TEXT | 非空 |
| `updated_at` | TEXT | 非空 |
| `version` | INTEGER | 非空，默认 1 |

数据库触发器拒绝更新 `raw_text`。服务端同样拒绝包含不同 `rawText` 的 PATCH 请求。

#### `contents`

| 字段 | 类型 | 约束 |
|---|---|---|
| `id` | TEXT | 主键 |
| `title` | TEXT | 非空 |
| `content_type` | TEXT | `organic` 或 `commercial` |
| `status` | TEXT | `preparing`、`producing`、`ready`、`published` |
| `brand` | TEXT | 可空 |
| `vehicle_model` | TEXT | 可空 |
| `summary` | TEXT | 可空 |
| `notes` | TEXT | 可空 |
| `created_at` | TEXT | 非空 |
| `updated_at` | TEXT | 非空 |
| `version` | INTEGER | 非空，默认 1 |

#### `content_inspirations`

| 字段 | 类型 | 约束 |
|---|---|---|
| `content_id` | TEXT | 外键，联合主键 |
| `inspiration_id` | TEXT | 外键，联合主键 |
| `relation_type` | TEXT | 默认 `source` |

该关联允许一条内容吸收多条灵感，同时保留每条老板原话。

#### `content_publications`

| 字段 | 类型 | 约束 |
|---|---|---|
| `id` | TEXT | 主键 |
| `content_id` | TEXT | 非空，外键 |
| `platform_id` | TEXT | 非空，外键 |
| `status` | TEXT | `not_started`、`preparing`、`producing`、`ready`、`scheduled`、`published` |
| `scheduled_at` | TEXT | 可空 |
| `published_at` | TEXT | 可空 |
| `platform_content_id` | TEXT | 可空 |
| `published_url` | TEXT | 可空 |
| `created_at` | TEXT | 非空 |
| `updated_at` | TEXT | 非空 |
| `version` | INTEGER | 非空，默认 1 |

唯一约束：`UNIQUE(content_id, platform_id)`。创建 Content 时必须在同一事务中创建四条平台记录。

### 7.3 标签

#### `tags`

| 字段 | 类型 | 约束 |
|---|---|---|
| `id` | TEXT | 主键 |
| `name` | TEXT | 非空 |
| `normalized_name` | TEXT | 唯一、非空 |

关联表：

- `inspiration_tags(inspiration_id, tag_id)`；
- `content_tags(content_id, tag_id)`；
- `observation_tags(observation_id, tag_id)`。

三个关联表都使用联合主键并启用外键级联删除。

### 7.4 日历

#### `schedule_events`

| 字段 | 类型 | 约束 |
|---|---|---|
| `id` | TEXT | 主键 |
| `content_id` | TEXT | 可空，外键 |
| `publication_id` | TEXT | 发布事件时可关联平台发布记录 |
| `event_type` | TEXT | `shoot`、`publish`、`pending_confirmation` |
| `status` | TEXT | `planned`、`confirmed`、`completed`、`cancelled` |
| `title` | TEXT | 非空 |
| `starts_at` | TEXT | 非空 |
| `ends_at` | TEXT | 可空 |
| `notes` | TEXT | 可空 |
| `created_at` | TEXT | 非空 |
| `updated_at` | TEXT | 非空 |
| `version` | INTEGER | 非空，默认 1 |

当 `event_type = publish` 时必须存在 `publication_id`。发布排期更新时同步更新对应 `content_publications.scheduled_at`。

### 7.5 热点与竞品

#### `observations`

| 字段 | 类型 | 约束 |
|---|---|---|
| `id` | TEXT | 主键 |
| `kind` | TEXT | `hotspot` 或 `competitor` |
| `title` | TEXT | 非空 |
| `ai_summary` | TEXT | 可空 |
| `competitor_name` | TEXT | 竞品观察时可填 |
| `brand` | TEXT | 可空 |
| `vehicle_model` | TEXT | 可空 |
| `source_url` | TEXT | 非空 |
| `source_platform` | TEXT | 非空 |
| `discovered_at` | TEXT | 非空 |
| `heat_score` | REAL | 可空 |
| `heat_delta` | REAL | 可空 |
| `worth_reason` | TEXT | 非空 |
| `status` | TEXT | `pending`、`converted`、`ignored` |
| `converted_inspiration_id` | TEXT | 可空，外键 |
| `created_at` | TEXT | 非空 |
| `updated_at` | TEXT | 非空 |
| `version` | INTEGER | 非空，默认 1 |

### 7.6 数据导入与指标

#### `ingestion_runs`

| 字段 | 类型 | 约束 |
|---|---|---|
| `id` | TEXT | 主键 |
| `source_type` | TEXT | `manual`、`csv`、`excel`、`workbuddy`、`official_api` |
| `source_name` | TEXT | 文件名或调用方名称 |
| `status` | TEXT | `received`、`validated`、`imported`、`partial_failure`、`failed` |
| `rows_total` | INTEGER | 非空 |
| `rows_imported` | INTEGER | 非空 |
| `rows_rejected` | INTEGER | 非空 |
| `error_json` | TEXT | 可空 |
| `started_at` | TEXT | 非空 |
| `completed_at` | TEXT | 可空 |

#### `metric_snapshots`

| 字段 | 类型 | 约束 |
|---|---|---|
| `id` | TEXT | 主键 |
| `platform_id` | TEXT | 平台级快照时非空 |
| `publication_id` | TEXT | 单作品快照时非空 |
| `ingestion_run_id` | TEXT | 非空，外键 |
| `period_start` | TEXT | 非空 |
| `period_end` | TEXT | 非空 |
| `captured_at` | TEXT | 非空 |
| `source_reference` | TEXT | 可空 |
| `notes` | TEXT | 可空 |

`platform_id` 与 `publication_id` 必须且只能有一个非空。

#### `metric_values`

| 字段 | 类型 | 约束 |
|---|---|---|
| `id` | TEXT | 主键 |
| `snapshot_id` | TEXT | 非空，外键 |
| `metric_key` | TEXT | 非空 |
| `value_number` | REAL | 非空 |
| `unit` | TEXT | `count`、`ratio`、`seconds` |
| `evidence_level` | TEXT | `observed`、`derived`、`inferred` |
| `calculation_note` | TEXT | 推导或推断时非空 |

首批标准指标键：

- `views`
- `likes`
- `comments`
- `shares`
- `saves`
- `followers_total`
- `followers_gained`
- `followers_lost`
- `net_followers`
- `completion_rate`
- `two_second_bounce_rate`
- `five_second_retention_rate`
- `average_watch_seconds`

#### `metric_series_points`

| 字段 | 类型 | 约束 |
|---|---|---|
| `id` | TEXT | 主键 |
| `snapshot_id` | TEXT | 非空，外键 |
| `series_key` | TEXT | `traffic_lifecycle`、`retention`、`engagement_timeline`、`traffic_source` |
| `position` | REAL | 秒数、日期序号或排序值 |
| `label` | TEXT | 显示标签 |
| `value_number` | REAL | 非空 |
| `unit` | TEXT | 非空 |
| `evidence_level` | TEXT | `observed`、`derived`、`inferred` |

### 7.7 单条作品复盘

#### `content_reviews`

| 字段 | 类型 | 约束 |
|---|---|---|
| `id` | TEXT | 主键 |
| `content_id` | TEXT | 非空，外键 |
| `platform_id` | TEXT | 可空 |
| `period_start` | TEXT | 非空 |
| `period_end` | TEXT | 非空 |
| `summary` | TEXT | 非空 |
| `data_quality` | TEXT | `complete`、`partial`、`proxy_based` |
| `generated_by` | TEXT | `human`、`workbuddy`、`ai` |
| `generated_at` | TEXT | 非空 |

#### `review_findings`

| 字段 | 类型 | 约束 |
|---|---|---|
| `id` | TEXT | 主键 |
| `review_id` | TEXT | 非空，外键 |
| `finding_type` | TEXT | `strength`、`issue`、`recommendation`、`high_engagement_segment` |
| `title` | TEXT | 非空 |
| `body` | TEXT | 非空 |
| `evidence_level` | TEXT | `observed`、`derived`、`inferred` |
| `evidence_json` | TEXT | 引用指标键、快照 ID 或序列范围 |
| `sort_order` | INTEGER | 非空 |

### 7.8 报告、幂等与审计

#### `report_snapshots`

保存 `week` 或 `month` 报告的起止时间、Markdown、数据更新时间、生成方式和生成时间。相同周期可保存多次生成结果，但每次都有独立 ID。

#### `idempotency_keys`

保存请求键、HTTP 方法、路径、请求摘要、响应状态、响应 JSON 和过期时间。创建灵感、转内容、收入灵感、创建内容和导入数据必须支持幂等重试。

#### `audit_log`

保存调用方 `web`、`workbuddy`、`system`，动作、实体类型、实体 ID、请求 ID、变更前后摘要和发生时间。日志不保存令牌，不复制大段原始文件。

## 8. API 边界

### 8.1 通用约定

- 根路径：`/api/v1`；
- JSON 字段使用 camelCase，数据库字段使用 snake_case；
- 成功响应：`{"data": ..., "meta": ...}`；
- 错误响应：`{"error":{"code":"VALIDATION_ERROR","message":"...","details":[]},"requestId":"..."}`；
- 列表使用 `limit` 和 `cursor`；
- PATCH 请求携带当前 `version`，版本不一致返回 `409 VERSION_CONFLICT`；
- 创建和转换请求支持 `Idempotency-Key`；
- 请求体默认上限 2 MB，文件导入使用单独上限；
- 所有写请求记录审计日志。

### 8.2 浏览器与 WorkBuddy 鉴权

- 服务默认仅监听 `127.0.0.1`；
- 浏览器通过同源页面访问 API，不开放跨域；
- Cookie 写请求必须验证 `Origin`；
- WorkBuddy 使用 `Authorization: Bearer <local-token>`；
- Token 只存在 `data/secrets.json`，不写入 Git、日志或报告；
- 设置页允许轮换 Token，轮换后旧 Token 立即失效；
- `/api/v1/health` 只返回非敏感健康信息。

### 8.3 端点

| 方法与路径 | 用途 |
|---|---|
| `GET /api/v1/health` | 进程、数据库和 schema 健康 |
| `GET /api/v1/meta` | 应用版本、上游 SHA、数据库版本 |
| `GET /api/v1/dashboard` | 首页聚合 |
| `GET /api/v1/search?q=` | 跨灵感、内容、热点搜索 |
| `GET /api/v1/inspirations` | 查询灵感 |
| `POST /api/v1/inspirations` | 新增灵感，保存老板原话 |
| `GET /api/v1/inspirations/:id` | 灵感详情 |
| `PATCH /api/v1/inspirations/:id` | 更新摘要、标签、状态，不允许修改原话 |
| `POST /api/v1/inspirations/:id/convert` | 事务化转为 Content |
| `GET /api/v1/contents` | 内容库列表 |
| `POST /api/v1/contents` | 新增 Content 并创建四平台记录 |
| `GET /api/v1/contents/:id` | 内容与四平台状态 |
| `PATCH /api/v1/contents/:id` | 更新内容总体字段 |
| `PATCH /api/v1/contents/:id/publications/:platformCode` | 更新单平台状态与日期 |
| `GET /api/v1/calendar-events` | 查询日期范围内事件 |
| `POST /api/v1/calendar-events` | 新增拍摄、发布或待确认事件 |
| `PATCH /api/v1/calendar-events/:id` | 修改事件 |
| `DELETE /api/v1/calendar-events/:id` | 删除事件并记录审计 |
| `POST /api/v1/ingestion-runs` | 导入手工、CSV、Excel、WorkBuddy 或 API 数据 |
| `GET /api/v1/ingestion-runs/:id` | 查看导入结果与错误行 |
| `GET /api/v1/analytics/overview` | 平台总览与趋势 |
| `GET /api/v1/contents/:id/reviews` | 单条作品复盘 |
| `POST /api/v1/contents/:id/reviews` | 保存复盘与证据 |
| `GET /api/v1/reports/preview` | 生成周报/月报预览 |
| `POST /api/v1/reports` | 固化报告快照 |
| `GET /api/v1/reports/:id/markdown` | 导出 Markdown |
| `GET /api/v1/observations` | 热点与竞品观察列表 |
| `POST /api/v1/observations` | 新增候选 |
| `PATCH /api/v1/observations/:id` | 更新判断状态 |
| `POST /api/v1/observations/:id/convert` | 事务化收入灵感 |
| `GET /api/v1/settings` | 非敏感设置 |
| `PATCH /api/v1/settings` | 更新白名单设置 |
| `GET /api/v1/backups` | 备份列表及校验状态 |
| `POST /api/v1/backups` | 创建一致性备份 |
| `POST /api/v1/backups/:id/verify` | 在临时数据库中验证 |
| `POST /api/v1/backups/:id/restore` | 保护性备份后恢复 |
| `POST /api/v1/workbuddy/token/rotate` | 轮换本地令牌 |

## 9. WorkBuddy 边界

WorkBuddy Skill 只负责把老板自然语言转换成 API 调用，不直接读写 SQLite，也不操作浏览器 DOM。

| 老板意图 | WorkBuddy 动作 |
|---|---|
| 记 | 创建灵感、内容、排期或指标导入 |
| 找 | 调用搜索、灵感列表、内容详情或历史报告 |
| 改 | 带 `version` 更新状态、排期和结构化字段 |
| 看 | 查询首页、数据看板、报告和热点摘要 |

新增灵感时 WorkBuddy 必须把老板完整原话写入 `rawText`，AI 整理结果写入其他字段。每次写操作生成稳定幂等键；若网络重试，服务端返回第一次创建的实体。

WorkBuddy 的确认话术必须包含：

- 操作是否成功；
- 新建或修改的实体 ID；
- 关键字段；
- 若失败，给出可恢复的错误原因；
- 不把“计划调用成功”描述成“数据已经写入”。

## 10. 目标文件结构

```text
小商新媒体运营工作台/
├── .gitignore
├── README.md
├── app/
│   ├── package.json
│   ├── index.html
│   ├── manifest.webmanifest
│   ├── sw.js
│   ├── assets/
│   │   ├── icons/
│   │   ├── css/
│   │   │   ├── tokens.css
│   │   │   ├── base.css
│   │   │   ├── layout.css
│   │   │   ├── components.css
│   │   │   ├── responsive.css
│   │   │   └── pages/
│   │   │       ├── home.css
│   │   │       ├── inspirations.css
│   │   │       ├── contents.css
│   │   │       ├── calendar.css
│   │   │       ├── analytics.css
│   │   │       ├── reports.css
│   │   │       ├── observations.css
│   │   │       └── settings.css
│   │   └── js/
│   │       ├── main.js
│   │       ├── router.js
│   │       ├── api/client.js
│   │       ├── shared/dom.js
│   │       ├── shared/format.js
│   │       ├── shared/forms.js
│   │       ├── components/shell.js
│   │       ├── components/modal.js
│   │       ├── components/toast.js
│   │       ├── components/chart.js
│   │       └── pages/
│   │           ├── home.js
│   │           ├── inspirations.js
│   │           ├── contents.js
│   │           ├── calendar.js
│   │           ├── analytics.js
│   │           ├── reports.js
│   │           ├── observations.js
│   │           └── settings.js
│   ├── server/
│   │   ├── index.js
│   │   ├── config.js
│   │   ├── http/
│   │   │   ├── router.js
│   │   │   ├── body.js
│   │   │   ├── response.js
│   │   │   ├── auth.js
│   │   │   └── errors.js
│   │   ├── db/
│   │   │   ├── connection.js
│   │   │   ├── migrate.js
│   │   │   └── migrations/
│   │   │       ├── 001_core.sql
│   │   │       ├── 002_analytics.sql
│   │   │       └── 003_audit_and_reports.sql
│   │   ├── repositories/
│   │   ├── services/
│   │   └── routes/
│   └── tests/
│       ├── unit/
│       ├── integration/
│       ├── contract/
│       ├── e2e/
│       └── fixtures/
├── data/
├── docs/
│   ├── product-reference/
│   └── superpowers/
│       ├── specs/
│       └── plans/
├── references/
│   ├── V24_BASELINE.md
│   ├── upstream-skill-repo/
│   └── v24-source/
├── scripts/
│   ├── install-local.sh
│   ├── update-local.sh
│   ├── backup-local.sh
│   ├── restore-local.sh
│   └── health-check.mjs
└── workbuddy/
    ├── SKILL.md
    └── scripts/workbench-client.mjs
```

`references/v24-source/` 继续保持只读。上面的目标结构由后续阶段逐步实现，PHASE 0 不创建业务模块文件。

## 11. 数据迁移、备份与恢复

### 11.1 迁移

- SQL 迁移文件进入 Git；
- 每个迁移文件包含固定版本和校验和；
- 同一迁移只允许执行一次；
- 迁移在事务中执行；
- 删除列、重命名列和改变含义采用“扩展 → 双读/回填 → 收缩”三步，至少跨两个发布版本；
- 最近一个旧版本必须能读取新数据库，保证代码回滚不要求数据库逆迁移；
- 迁移前自动创建 `pre-update` 备份。

### 11.2 备份

- 使用 SQLite 在线备份能力或 `VACUUM INTO` 生成一致性副本；
- 每份备份同时写 JSON 清单：应用版本、schema 版本、创建原因、文件大小和 SHA-256；
- 默认保留最近 30 份，用户手动备份不自动删除；
- 备份完成后运行 `PRAGMA integrity_check`；
- 备份失败时更新流程停止。

### 11.3 恢复

1. 校验备份清单与 SHA-256；
2. 在临时目录打开副本并运行 `PRAGMA integrity_check`；
3. 检查 schema 版本是否受当前代码支持；
4. 自动创建当前数据库的 `pre-restore` 保护备份；
5. 停止写请求；
6. 原子替换数据库；
7. 启动服务并执行健康检查；
8. 健康检查失败时恢复 `pre-restore` 备份。

## 12. GitHub 到老板电脑的更新方式

老板电脑第一次安装：

```text
WorkBuddy 执行安装 Skill
→ clone 我们自己的项目仓库
→ 检查 Node 24
→ npm ci
→ 初始化 data/
→ 运行迁移
→ 生成本地 WorkBuddy Token
→ 启动服务
→ 调用 /api/v1/health
```

后续更新：

```text
WorkBuddy 执行 update-local.sh
→ 记录当前代码 SHA
→ git fetch + git pull --ff-only
→ 创建 pre-update SQLite 备份
→ npm ci
→ 执行迁移
→ 重启服务
→ 健康检查
→ 成功则保留新版本
→ 失败则回退代码 SHA，并使用兼容迁移或保护备份恢复
```

更新脚本必须断言：

- `data/` 不受 Git 跟踪；
- 更新前后数据库文件仍存在；
- 数据库 inode/文件哈希变化只能来自备份或迁移步骤；
- `secrets.json` 未进入 Git；
- 健康响应中的应用版本、schema 版本和 Git SHA 与预期一致。

## 13. 测试策略

### 13.1 单元测试

- 状态机转换；
- 灵感原话不可修改；
- 灵感转内容幂等；
- Content 自动创建四个平台记录；
- 平台状态与总体状态规则；
- 日历颜色和事件类型映射；
- 指标单位、证据等级和派生公式；
- 报告周期边界；
- 文件路径和数据目录解析。

### 13.2 集成测试

- 每个测试使用独立临时 SQLite；
- 迁移从空库执行；
- API CRUD、事务、外键、乐观锁和幂等；
- CSV/Excel 部分失败不污染已验证数据；
- 备份、校验、恢复；
- Token 认证、Origin 和请求大小限制；
- Service Worker 不缓存 API。

### 13.3 契约测试

- 固定 OpenAPI/JSON 示例；
- WorkBuddy 的“记、找、改、看”请求与响应；
- 错误码和重试行为；
- 老板原话字段；
- 版本冲突和幂等返回。

### 13.4 浏览器端到端测试

- 8 个导航入口；
- 灵感新增、转内容、原灵感保留；
- 内容四平台状态；
- 同一内容四平台不同发布日期；
- 月历红/蓝/紫事件；
- 手工与文件数据导入；
- 单条作品复盘图表；
- 报告复制与 Markdown 下载；
- 热点收入灵感；
- 备份与恢复确认流程；
- 桌面宽屏和移动视口；
- iOS 日期输入回归。

### 13.5 升级演练

使用含真实结构但不含真实业务数据的夹具数据库验证：

- 从上一 schema 版本升级；
- 更新前备份可恢复；
- 代码回滚后数据仍可读；
- Git 更新不会删除 `data/`；
- 重复运行更新脚本不会重复迁移或重复创建数据。

## 14. 开发阶段

| 阶段 | 范围 | 主要验收 |
|---:|---|---|
| PHASE 1 | Node/SQLite/API 基础、迁移、鉴权、备份骨架 | 临时库通过迁移；健康接口、备份和数据隔离通过 |
| PHASE 2 | 视觉系统、共享壳、8 页导航、API 客户端 | 8 页空态与原型视觉基线通过 |
| PHASE 3 | 灵感、内容、首页核心闭环 | 原话不可改；转内容幂等；四平台记录唯一 |
| PHASE 4 | 发布日历与平台发布状态 | 四平台可独立排期；月历只含三类事件 |
| PHASE 5 | 数据导入、总览、单条作品复盘 | 手工/CSV/Excel/WorkBuddy 进入统一指标模型 |
| PHASE 6 | 周月报、热点竞品、设置、完整备份恢复 | 两个闭环和报告快照通过；恢复演练通过 |
| PHASE 7 | WorkBuddy Skill、安装更新、回滚、全量验收 | “记找改看”契约、升级不丢数据、桌面/移动回归通过 |

每一阶段完成后停止，由用户验收后再进入下一阶段。

## 15. 最大风险

### 风险 1：从“账号中心”改成“内容中心”时误复用旧数据模型

v24 的核心外键是 `accountId`，新产品的核心关系是 `Content → 四个平台发布记录`。若只改页面文案，会继续制造四份内容和错误统计。控制措施是先完成规范化 schema 与 API，再接页面。

### 风险 2：本地更新覆盖或破坏老板真实数据

代码和数据库若继续放在 `app/` 同一更新边界内，复制或更新代码可能覆盖数据库。控制措施是根目录独立 `data/`、Git 忽略、更新前备份、事务迁移、健康检查和可演练回滚。

### 风险 3：WorkBuddy 重试造成重复灵感、重复内容或重复排期

聊天入口可能因网络或模型重试重复调用。控制措施是所有创建/转换 API 支持 `Idempotency-Key`，转换操作使用事务和唯一约束，确认结果必须返回实体 ID。

## 16. PHASE 0 验收标准

- GitHub 当前源码已 clone；
- 上游 SHA 与远端 `main` 一致；
- `upstream` push 被禁用；
- `references/v24-source/` 工作树干净；
- `app/` 与上游真正的 v24 应用源码字节一致；
- `data/` 存在且被 Git 忽略；
- 新项目只包含 8 张正式原型，不包含素材库；
- v24 语法与临时 SQLite 冒烟测试通过；
- 本设计规格和对应实施计划均为中文；
- 两份文档包含具体路径、数据模型、API、测试、迁移、备份和更新流程；
- 两份文档不包含未决占位内容；
- 未开始任何 PHASE 1 业务页面或功能实现。
