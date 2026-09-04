import assert from "node:assert/strict";
import test from "node:test";

import { buildMonthGrid, eventPresentation } from "../../assets/js/pages/calendar.js";

test("calendar builds a Monday-first six-week grid with current-month markers", () => {
  const days = buildMonthGrid(2026, 8);

  assert.equal(days.length, 42);
  assert.equal(days[0].isoDate, "2026-08-31");
  assert.equal(days[0].inCurrentMonth, false);
  assert.equal(days[1].isoDate, "2026-09-01");
  assert.equal(days[1].inCurrentMonth, true);
  assert.equal(days[41].isoDate, "2026-10-11");
});

test("calendar maps publish shoot and pending events to red blue and purple tones", () => {
  assert.deepEqual(eventPresentation("publish"), { label: "发布", tone: "danger" });
  assert.deepEqual(eventPresentation("shoot"), { label: "拍摄 / 项目安排", tone: "info" });
  assert.deepEqual(eventPresentation("pending"), { label: "待确认", tone: "pending" });
});
