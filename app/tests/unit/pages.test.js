import assert from "node:assert/strict";
import test from "node:test";

import { PAGE_DEFINITIONS } from "../../assets/js/pages/index.js";

test("all eight approved pages have independently registered renderers", () => {
  assert.deepEqual(PAGE_DEFINITIONS.map(({ name, title }) => [name, title]), [
    ["home", "首页"],
    ["inspirations", "灵感备忘"],
    ["contents", "内容库"],
    ["calendar", "发布日历"],
    ["analytics", "数据看板"],
    ["reports", "周报 / 月报"],
    ["observations", "热点 / 竞品观察"],
    ["settings", "设置"]
  ]);

  for (const page of PAGE_DEFINITIONS) {
    assert.equal(typeof page.render, "function");
    const html = page.render({ now: new Date("2026-09-04T12:00:00+08:00") });
    assert.match(html, new RegExp(`<h1[^>]*>${page.title.replace(" / ", " \/ ")}</h1>`));
  }
});
