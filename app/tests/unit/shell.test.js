import assert from "node:assert/strict";
import test from "node:test";

import { renderNavigation } from "../../assets/js/components/shell.js";

test("sidebar renders eight links and one active destination", () => {
  const html = renderNavigation("calendar");
  const links = html.match(/<a\b/g) || [];

  assert.equal(links.length, 8);
  assert.match(html, /href="\/calendar"[^>]*aria-current="page"/);
  assert.doesNotMatch(html, /Todo|Reminder|素材库|多 IP|账号密码/);
});
