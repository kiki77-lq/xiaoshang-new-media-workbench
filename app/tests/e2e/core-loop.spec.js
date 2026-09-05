import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

const artifactRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../artifacts/phase-3");
const rawText = "XT5那个可以从老美豪华车历史开始讲";
const summaryTitle = "凯迪拉克 XT5：美式豪华历史";

function trackErrors(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function expectNoHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width);
}

test.beforeAll(() => {
  fs.mkdirSync(path.join(artifactRoot, "desktop"), { recursive: true });
  fs.mkdirSync(path.join(artifactRoot, "mobile"), { recursive: true });
});

test("real browser persists inspiration, converts once, and updates content and dashboard", async ({ page, request }) => {
  const errors = trackErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.locator('[data-metric="month-content-count"] strong')).toHaveText("0");

  await page.getByRole("link", { name: "灵感备忘", exact: true }).click();
  await page.getByRole("button", { name: "＋ 新增灵感", exact: true }).click();
  const createDialog = page.getByRole("dialog", { name: "新增灵感" });
  await createDialog.getByLabel("老板原始表达").fill(rawText);
  await createDialog.getByLabel("整理标题").fill(summaryTitle);
  await createDialog.getByLabel("品牌").fill("凯迪拉克");
  await createDialog.getByLabel("车型").fill("XT5");
  await createDialog.getByLabel("标签").fill("凯迪拉克, 豪华车");
  await createDialog.getByRole("button", { name: "保存灵感", exact: true }).click();

  const inspirationCard = page.locator("[data-inspiration-id]").filter({ hasText: summaryTitle });
  await expect(inspirationCard).toBeVisible();
  await page.reload();
  await expect(page.locator("[data-inspiration-id]").filter({ hasText: summaryTitle })).toBeVisible();

  await page.getByRole("button", { name: `编辑灵感 ${summaryTitle}` }).click();
  const editDialog = page.getByRole("dialog", { name: "编辑灵感" });
  await expect(editDialog.getByLabel("老板原始表达")).toBeDisabled();
  const inspirationId = await editDialog.locator("form").getAttribute("data-inspiration-id");
  const inspirationVersion = Number(await editDialog.locator("form").getAttribute("data-version"));
  const immutableResponse = await request.patch(`/api/v1/inspirations/${inspirationId}`, {
    headers: { Origin: "http://127.0.0.1:4173", "Content-Type": "application/json" },
    data: { rawText: "试图覆盖老板原话", version: inspirationVersion }
  });
  expect(immutableResponse.status()).toBe(400);
  expect((await immutableResponse.json()).error.code).toBe("INSPIRATION_RAW_TEXT_IMMUTABLE");
  await editDialog.getByRole("button", { name: "关闭" }).click();

  await page.getByRole("button", { name: `转为内容 ${summaryTitle}` }).click();
  const convertDialog = page.getByRole("dialog", { name: "转为内容" });
  await convertDialog.getByLabel("内容类型").selectOption("commercial");
  await convertDialog.getByRole("button", { name: "确认转为内容", exact: true }).click();
  const convertedCard = page.locator("[data-inspiration-id]").filter({ hasText: summaryTitle });
  await expect(convertedCard.getByText("已转内容", { exact: true })).toBeVisible();
  await expect(convertedCard.getByRole("link", { name: "查看关联内容" })).toBeVisible();
  await page.screenshot({ path: path.join(artifactRoot, "desktop", "inspirations.png"), fullPage: true });

  await page.getByRole("link", { name: "内容库", exact: true }).click();
  await expect(page.locator("[data-content-row]")).toHaveCount(1);
  await expect(page.getByText("凯迪拉克 XT5", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "查看内容 凯迪拉克 XT5" }).click();
  const detailDialog = page.getByRole("dialog", { name: "查看内容" });
  const publications = detailDialog.locator("[data-publication-platform]");
  await expect(publications).toHaveCount(4);
  expect(await publications.allTextContents()).toEqual(["抖音未开始", "视频号未开始", "小红书未开始", "微博未开始"]);
  await detailDialog.locator("footer").getByRole("button", { name: "关闭" }).click();
  await page.screenshot({ path: path.join(artifactRoot, "desktop", "contents.png"), fullPage: true });

  const convertedInspiration = await request.get(`/api/v1/inspirations/${inspirationId}`);
  const converted = (await convertedInspiration.json()).data;
  const duplicate = await request.post(`/api/v1/inspirations/${inspirationId}/convert`, {
    headers: {
      Origin: "http://127.0.0.1:4173",
      "Content-Type": "application/json",
      "Idempotency-Key": "browser-business-guard-second-key"
    },
    data: { title: "凯迪拉克 XT5", contentType: "commercial", version: converted.version }
  });
  expect(duplicate.status()).toBe(200);
  expect((await duplicate.json()).data.alreadyConverted).toBe(true);
  const contents = await (await request.get("/api/v1/contents")).json();
  expect(contents.data.items).toHaveLength(1);
  expect(contents.data.items[0].publications).toHaveLength(4);
  expect(new Set(contents.data.items[0].publications.map(({ platformCode }) => platformCode)).size).toBe(4);

  await page.getByRole("link", { name: "首页", exact: true }).click();
  await expect(page.locator('[data-metric="month-content-count"] strong')).toHaveText("1");
  await expect(page.locator("[data-recent-content]").filter({ hasText: "凯迪拉克 XT5" })).toBeVisible();
  await page.reload();
  await expect(page.locator('[data-metric="month-content-count"] strong')).toHaveText("1");
  await expect(page.locator("[data-recent-content]").filter({ hasText: "凯迪拉克 XT5" })).toBeVisible();
  await page.screenshot({ path: path.join(artifactRoot, "desktop", "home.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  for (const [route, name] of [["/", "home"], ["/inspirations", "inspirations"], ["/contents", "contents"]]) {
    await page.goto(route);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: path.join(artifactRoot, "mobile", `${name}.png`), fullPage: true });
  }

  expect(errors).toEqual([]);
});

test("content library can directly create, edit, search and filter content", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/contents");
  await page.getByRole("button", { name: "＋ 新增内容", exact: true }).click();
  const createDialog = page.getByRole("dialog", { name: "新增内容" });
  await createDialog.getByLabel("内容标题").fill("宝马 M3 纯享片");
  await createDialog.getByLabel("内容类型").selectOption("organic");
  await createDialog.getByLabel("整体状态").selectOption("producing");
  await createDialog.getByLabel("品牌").fill("宝马");
  await createDialog.getByLabel("车型").fill("M3");
  await createDialog.getByLabel("标签").fill("宝马，性能车");
  await createDialog.getByRole("button", { name: "创建内容", exact: true }).click();

  const row = page.locator("[data-content-row]").filter({ hasText: "宝马 M3 纯享片" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "编辑内容 宝马 M3 纯享片" }).click();
  const editDialog = page.getByRole("dialog", { name: "编辑内容" });
  await editDialog.getByLabel("内容标题").fill("宝马 M3 赛道纯享");
  await editDialog.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(page.locator("[data-content-row]").filter({ hasText: "宝马 M3 赛道纯享" })).toBeVisible();

  const search = page.locator("[data-content-search]");
  await search.fill("宝马 M3");
  await search.press("Enter");
  await expect(page.locator("[data-content-row]")).toHaveCount(1);
  await page.getByRole("button", { name: "纯享", exact: true }).click();
  await expect(page.locator("[data-content-row]")).toHaveCount(1);
  expect(errors).toEqual([]);
});
