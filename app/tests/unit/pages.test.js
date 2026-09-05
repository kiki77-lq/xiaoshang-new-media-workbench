import assert from "node:assert/strict";
import test from "node:test";

import { PAGE_DEFINITIONS } from "../../assets/js/pages/index.js";
import { renderContents } from "../../assets/js/pages/contents.js";
import { renderHome } from "../../assets/js/pages/home.js";
import { renderInspirations } from "../../assets/js/pages/inspirations.js";

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

test("core-loop pages render persisted API data without treating it as fixture content", () => {
  const inspirationHtml = renderInspirations({ data: { items: [{
    id: "idea-1", rawText: "老板原话 <不可覆盖>", summaryTitle: "XT5 选题", isFallbackTitle: false,
    brand: "凯迪拉克", vehicleModel: "XT5", sourcePlatform: null, sourceUrl: null,
    pinned: true, status: "converted", convertedContentId: "content-1", tags: ["豪华车"], version: 2,
    createdAt: "2026-09-05T01:00:00.000Z"
  }], total: 1 } });
  assert.match(inspirationHtml, /data-inspiration-id="idea-1"/);
  assert.match(inspirationHtml, /老板原话 &lt;不可覆盖&gt;/);
  assert.match(inspirationHtml, /已转内容/);

  const contentHtml = renderContents({ data: { items: [{
    id: "content-1", title: "凯迪拉克 XT5", contentType: "commercial", status: "preparing",
    brand: "凯迪拉克", vehicleModel: "XT5", summary: null, notes: null, tags: ["豪华车"],
    sourceInspirationIds: ["idea-1"], version: 1, createdAt: "2026-09-05T01:00:00.000Z",
    publications: ["抖音", "视频号", "小红书", "微博"].map((platformName, index) => ({
      platformCode: ["douyin", "wechat_channels", "xiaohongshu", "weibo"][index], platformName, status: "not_started"
    }))
  }], total: 1 } });
  assert.match(contentHtml, /data-content-row="content-1"/);
  assert.equal((contentHtml.match(/data-publication-platform/g) || []).length, 4);

  const homeHtml = renderHome({ data: {
    monthContentCount: 1, producingCount: 0, todayPublishCount: 0, attentionCount: 0,
    platforms: [], hotspotSummary: [], recentContents: [{
      id: "content-1", title: "凯迪拉克 XT5", contentType: "commercial", status: "preparing",
      publications: []
    }]
  } });
  assert.match(homeHtml, /data-metric="month-content-count"/);
  assert.match(homeHtml, /<strong>1<\/strong>/);
  assert.match(homeHtml, /data-recent-content="content-1"/);
});
