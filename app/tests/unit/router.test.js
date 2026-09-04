import assert from "node:assert/strict";
import test from "node:test";

import { ROUTES, resolveRoute } from "../../assets/js/router.js";

test("router exposes exactly the eight approved workbench routes", () => {
  assert.deepEqual(ROUTES.map(({ name, path }) => [name, path]), [
    ["home", "/"],
    ["inspirations", "/inspirations"],
    ["contents", "/contents"],
    ["calendar", "/calendar"],
    ["analytics", "/analytics"],
    ["reports", "/reports"],
    ["observations", "/observations"],
    ["settings", "/settings"]
  ]);
  assert.equal(new Set(ROUTES.map(({ path }) => path)).size, 8);
  assert.equal(ROUTES.some(({ name }) => ["todo", "reminder", "materials", "accounts"].includes(name)), false);
});

test("route resolution normalizes trailing slashes and falls back to home", () => {
  assert.equal(resolveRoute("/contents/").name, "contents");
  assert.equal(resolveRoute("/not-a-route").name, "home");
});
