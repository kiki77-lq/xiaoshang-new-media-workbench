import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

const pages = [
  ["首页", "home", "/"],
  ["热点 / 竞品观察", "observations", "/observations"],
  ["灵感备忘", "inspirations", "/inspirations"],
  ["内容库", "contents", "/contents"],
  ["发布日历", "calendar", "/calendar"],
  ["数据看板", "analytics", "/analytics"],
  ["周报 / 月报", "reports", "/reports"],
  ["设置", "settings", "/settings"]
];
const artifactRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../artifacts/phase-2");

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

test("desktop 1440x900 opens all eight pages without console errors", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = trackErrors(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "打开导航" })).toBeHidden();

  for (const [label, route, url] of pages) {
    await page.getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${url === "/" ? "/$" : `${url}$`}`));
    await expect(page.locator("main")).toHaveAttribute("data-page", route);
    await expect(page.getByRole("heading", { level: 1, name: label, exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: path.join(artifactRoot, "desktop", `${route}.png`), fullPage: true });
  }

  await expect(page.getByText("Todo", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Reminder", { exact: true })).toHaveCount(0);
  await expect(page.getByText("素材库", { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("mobile 390x844 keeps every page usable and the sidebar collapsible", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = trackErrors(page);

  for (const [label, route, url] of pages) {
    await page.goto(url);
    await expect(page.locator("main")).toHaveAttribute("data-page", route);
    await expect(page.getByRole("heading", { level: 1, name: label, exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: path.join(artifactRoot, "mobile", `${route}.png`), fullPage: true });
  }

  await page.goto("/");
  await expect(page.getByRole("button", { name: "打开导航" })).toBeVisible();
  await page.getByRole("button", { name: "打开导航" }).click();
  await expect(page.locator("#sidebar")).toHaveClass(/is-open/);
  await expect(page.getByRole("link", { name: "设置", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("calendar day detail modal stays inside the mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/calendar");
  await page.locator("[data-calendar-day]").first().click();
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();
  const box = await modal.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.y + box.height).toBeLessThanOrEqual(844);
});

test("settings renders live health and meta values", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByText("本地服务正常", { exact: true })).toBeVisible();
  await expect(page.getByText("0.1.0", { exact: true })).toBeVisible();
  await expect(page.getByText("ok", { exact: true })).toBeVisible();
});
