import assert from "node:assert/strict";
import test from "node:test";

import { openDatabase } from "../../server/db/connection.js";
import { runMigrations } from "../../server/db/migrate.js";
import { createInspiration, updateInspiration } from "../../server/services/inspiration-service.js";
import { createTempWorkbench } from "../helpers/temp-workbench.js";

function setup(t) {
  const paths = createTempWorkbench(t, "xiaoshang-inspiration-service-");
  const db = openDatabase({ dbPath: paths.dbPath });
  t.after(() => db.close());
  runMigrations(db);
  return {
    db,
    actor: "web",
    requestId: "request-unit",
    now: "2026-09-05T02:00:00.000Z"
  };
}

test("inspiration creation preserves raw text, marks fallback title, and normalizes tags", async (t) => {
  const context = { ...setup(t), idempotencyKey: "create-inspiration-1" };
  const created = await createInspiration({
    rawText: "  XT5那个可以从老美豪华车历史开始讲  ",
    sourceType: "manual",
    tags: [" 凯迪拉克 ", "凯迪拉克  ", " 美式   豪华 "]
  }, context);

  assert.equal(created.rawText, "XT5那个可以从老美豪华车历史开始讲");
  assert.equal(created.summaryTitle, "XT5那个可以从老美豪华车历史开始讲");
  assert.equal(created.isFallbackTitle, true);
  assert.deepEqual(created.tags, ["凯迪拉克", "美式 豪华"]);
  assert.equal(context.db.prepare("SELECT count(*) AS count FROM tags").get().count, 2);
});

test("same inspiration idempotency key creates one row", async (t) => {
  const context = { ...setup(t), idempotencyKey: "create-inspiration-retry" };
  const input = { rawText: "同一个请求", summaryTitle: "同一个请求", sourceType: "manual" };

  const first = await createInspiration(input, context);
  const retry = await createInspiration(input, context);

  assert.equal(retry.id, first.id);
  assert.equal(retry.idempotencyReplayed, true);
  assert.equal(context.db.prepare("SELECT count(*) AS count FROM inspirations").get().count, 1);
});

test("rawText remains immutable in service updates", async (t) => {
  const context = { ...setup(t), idempotencyKey: "create-inspiration-immutable" };
  const created = await createInspiration({
    rawText: "拍一条凯迪拉克夜景的片子",
    summaryTitle: "凯迪拉克夜景拍摄灵感",
    sourceType: "workbuddy"
  }, context);

  await assert.rejects(
    () => updateInspiration(created.id, {
      rawText: "被 AI 改写后的句子",
      version: created.version
    }, { ...context, idempotencyKey: undefined }),
    (error) => error.status === 400 && error.code === "INSPIRATION_RAW_TEXT_IMMUTABLE"
  );
  assert.equal(context.db.prepare("SELECT raw_text FROM inspirations WHERE id = ?").get(created.id).raw_text, "拍一条凯迪拉克夜景的片子");
});

test("inspiration update increments version and rejects a stale version", async (t) => {
  const context = { ...setup(t), idempotencyKey: "create-inspiration-version" };
  const created = await createInspiration({ rawText: "原话", sourceType: "manual" }, context);
  const updated = await updateInspiration(created.id, {
    summaryTitle: "人工整理标题",
    brand: "凯迪拉克",
    tags: [" XT5 "]
  }, { ...context, idempotencyKey: undefined, expectedVersion: created.version });

  assert.equal(updated.version, 2);
  assert.equal(updated.summaryTitle, "人工整理标题");
  assert.equal(updated.isFallbackTitle, false);
  assert.deepEqual(updated.tags, ["XT5"]);
  await assert.rejects(
    () => updateInspiration(created.id, { pinned: true }, { ...context, idempotencyKey: undefined, expectedVersion: 1 }),
    (error) => error.status === 409 && error.code === "VERSION_CONFLICT"
  );
});
