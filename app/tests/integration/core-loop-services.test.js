import assert from "node:assert/strict";
import test from "node:test";

import { openDatabase } from "../../server/db/connection.js";
import { runMigrations } from "../../server/db/migrate.js";
import { listContents, updateContentRecord } from "../../server/repositories/content-repository.js";
import { updateInspirationRecord } from "../../server/repositories/inspiration-repository.js";
import { createInspiration } from "../../server/services/inspiration-service.js";
import { convertInspiration } from "../../server/services/inspiration-service.js";
import { createContent, updateContent } from "../../server/services/content-service.js";
import { getDashboard } from "../../server/services/dashboard-service.js";
import { createTempWorkbench } from "../helpers/temp-workbench.js";

function setup(t, now = "2026-09-05T03:00:00.000Z") {
  const paths = createTempWorkbench(t, "xiaoshang-core-loop-");
  const db = openDatabase({ dbPath: paths.dbPath });
  t.after(() => db.close());
  runMigrations(db);
  return { db, actor: "web", requestId: "request-integration", now };
}

test("direct content creation atomically creates exactly four unique platform publications", async (t) => {
  const context = { ...setup(t), idempotencyKey: "create-content-1" };
  const content = await createContent({
    title: "凯迪拉克 XT5",
    contentType: "commercial",
    status: "preparing",
    tags: [" 凯迪拉克 ", "凯迪拉克"]
  }, context);

  assert.deepEqual(content.publications.map(({ platformCode }) => platformCode), [
    "douyin", "wechat_channels", "xiaohongshu", "weibo"
  ]);
  assert.equal(context.db.prepare("SELECT count(*) AS count FROM content_publications WHERE content_id = ?").get(content.id).count, 4);
  assert.equal(listContents(context.db).length, 1);
  assert.equal(listContents(context.db)[0].id, content.id);
  assert.throws(() => context.db.prepare(`
    INSERT INTO content_publications(id, content_id, platform_id, status, created_at, updated_at, version)
    VALUES ('duplicate', ?, 'platform-douyin', 'not_started', ?, ?, 1)
  `).run(content.id, context.now, context.now), /UNIQUE constraint failed/);
});

test("disabled platform channels still receive one publication row", async (t) => {
  const context = { ...setup(t), idempotencyKey: "disabled-platform-content" };
  context.db.prepare("UPDATE platform_channels SET enabled = 0 WHERE code = 'weibo'").run();
  const content = await createContent({ title: "四平台完整记录", contentType: "organic" }, context);
  assert.deepEqual(content.publications.map(({ platformCode }) => platformCode), [
    "douyin", "wechat_channels", "xiaohongshu", "weibo"
  ]);
});

test("repository updates require the expected version in the SQL predicate", async (t) => {
  const context = { ...setup(t), idempotencyKey: "atomic-version-source" };
  const inspiration = await createInspiration({ rawText: "原话" }, context);
  const content = await createContent({ title: "原内容", contentType: "organic" }, {
    ...context, idempotencyKey: "atomic-version-content"
  });

  assert.equal(updateInspirationRecord(context.db, inspiration.id, { pinned: true }, context.now, 99).changes, 0);
  assert.equal(updateContentRecord(context.db, content.id, { title: "不应更新" }, context.now, 99).changes, 0);
  assert.equal(context.db.prepare("SELECT pinned FROM inspirations WHERE id = ?").get(inspiration.id).pinned, 0);
  assert.equal(context.db.prepare("SELECT title FROM contents WHERE id = ?").get(content.id).title, "原内容");
});

test("content update uses optimistic locking", async (t) => {
  const context = { ...setup(t), idempotencyKey: "create-content-version" };
  const created = await createContent({ title: "原内容", contentType: "organic" }, context);
  const updated = await updateContent(created.id, { status: "producing", title: "拍摄中内容" }, {
    ...context,
    idempotencyKey: undefined,
    expectedVersion: created.version
  });

  assert.equal(updated.status, "producing");
  assert.equal(updated.version, 2);
  await assert.rejects(
    () => updateContent(created.id, { status: "ready" }, { ...context, idempotencyKey: undefined, expectedVersion: 1 }),
    (error) => error.status === 409 && error.code === "VERSION_CONFLICT"
  );
});

test("inspiration conversion is idempotent and retains one content with four publications", async (t) => {
  const base = setup(t);
  const inspiration = await createInspiration({
    rawText: "拍一条凯迪拉克夜景的片子",
    summaryTitle: "凯迪拉克 XT5 夜景",
    sourceType: "workbuddy",
    tags: ["凯迪拉克"]
  }, { ...base, idempotencyKey: "create-for-convert" });
  const conversionContext = { ...base, idempotencyKey: "wechat-message-88", expectedVersion: inspiration.version };

  const first = await convertInspiration(inspiration.id, {
    title: "凯迪拉克 XT5 夜景",
    contentType: "organic"
  }, conversionContext);
  const retry = await convertInspiration(inspiration.id, {
    title: "凯迪拉克 XT5 夜景",
    contentType: "organic"
  }, conversionContext);

  assert.equal(retry.content.id, first.content.id);
  assert.equal(retry.idempotencyReplayed, true);
  assert.equal(base.db.prepare("SELECT count(*) AS count FROM contents").get().count, 1);
  assert.equal(base.db.prepare("SELECT count(*) AS count FROM content_publications").get().count, 4);
  assert.equal(base.db.prepare("SELECT count(DISTINCT platform_id) AS count FROM content_publications").get().count, 4);
  const stored = base.db.prepare("SELECT raw_text, status, converted_content_id FROM inspirations WHERE id = ?").get(inspiration.id);
  assert.equal(stored.raw_text, "拍一条凯迪拉克夜景的片子");
  assert.equal(stored.status, "converted");
  assert.equal(stored.converted_content_id, first.content.id);
});

test("already converted business guard returns existing content for a new idempotency key", async (t) => {
  const base = setup(t);
  const inspiration = await createInspiration({ rawText: "只转换一次", sourceType: "manual" }, {
    ...base,
    idempotencyKey: "create-business-guard"
  });
  const first = await convertInspiration(inspiration.id, { title: "唯一内容", contentType: "commercial" }, {
    ...base,
    idempotencyKey: "convert-first",
    expectedVersion: 1
  });
  const second = await convertInspiration(inspiration.id, { title: "不应创建", contentType: "organic" }, {
    ...base,
    idempotencyKey: "convert-second",
    expectedVersion: 2
  });

  assert.equal(second.alreadyConverted, true);
  assert.equal(second.content.id, first.content.id);
  assert.equal(base.db.prepare("SELECT count(*) AS count FROM contents").get().count, 1);
  assert.equal(base.db.prepare("SELECT count(*) AS count FROM content_publications").get().count, 4);
});

test("fallback title provenance survives conversion", async (t) => {
  const base = setup(t);
  const inspiration = await createInspiration({ rawText: "没有人工整理标题" }, {
    ...base, idempotencyKey: "fallback-source"
  });
  const converted = await convertInspiration(inspiration.id, { contentType: "organic" }, {
    ...base, idempotencyKey: "fallback-convert", expectedVersion: inspiration.version
  });
  assert.equal(converted.inspiration.status, "converted");
  assert.equal(converted.inspiration.isFallbackTitle, true);
});

test("failed conversion rolls back content, relations, publications, inspiration state, and audit", async (t) => {
  const base = setup(t);
  const inspiration = await createInspiration({ rawText: "事务回滚", sourceType: "manual" }, {
    ...base,
    idempotencyKey: "create-rollback"
  });
  base.db.prepare("DELETE FROM platform_channels WHERE code = 'weibo'").run();
  const auditBefore = base.db.prepare("SELECT count(*) AS count FROM audit_log").get().count;

  await assert.rejects(
    () => convertInspiration(inspiration.id, { title: "不能落库", contentType: "organic" }, {
      ...base,
      idempotencyKey: "convert-rollback",
      expectedVersion: 1
    }),
    (error) => error.code === "PLATFORM_CHANNELS_INCOMPLETE"
  );
  assert.equal(base.db.prepare("SELECT count(*) AS count FROM contents").get().count, 0);
  assert.equal(base.db.prepare("SELECT count(*) AS count FROM content_publications").get().count, 0);
  assert.equal(base.db.prepare("SELECT count(*) AS count FROM content_inspirations").get().count, 0);
  const stored = base.db.prepare("SELECT status, converted_content_id FROM inspirations WHERE id = ?").get(inspiration.id);
  assert.equal(stored.status, "inbox");
  assert.equal(stored.converted_content_id, null);
  assert.equal(base.db.prepare("SELECT count(*) AS count FROM audit_log").get().count, auditBefore);
});

test("dashboard aggregates contents once instead of once per publication", async (t) => {
  const base = setup(t, "2026-09-05T04:00:00.000Z");
  const first = await createContent({ title: "本月制作中", contentType: "organic", status: "producing" }, {
    ...base,
    idempotencyKey: "dashboard-current-1"
  });
  await createContent({ title: "本月准备中", contentType: "commercial", status: "preparing" }, {
    ...base,
    idempotencyKey: "dashboard-current-2",
    now: "2026-09-05T04:00:01.000Z"
  });
  await createContent({ title: "上月内容", contentType: "organic", status: "producing" }, {
    ...base,
    idempotencyKey: "dashboard-previous",
    now: "2026-08-31T10:00:00.000Z"
  });

  const dashboard = getDashboard({ db: base.db, now: "2026-09-05T04:00:00.000Z" });
  assert.equal(dashboard.monthContentCount, 2);
  assert.equal(dashboard.producingCount, 2);
  assert.equal(dashboard.recentContents.length, 3);
  assert.equal(dashboard.recentContents[0].id === first.id, false);
  assert.equal(dashboard.recentContents.every((content) => content.publications.length === 4), true);
  assert.equal(new Set(dashboard.recentContents.map(({ id }) => id)).size, 3);
  assert.deepEqual(dashboard.hotspotSummary, []);
  assert.equal(dashboard.todayPublishCount, 0);
  assert.equal(dashboard.needsAttentionCount, 0);
});
