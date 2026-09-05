# PHASE 4 checkpoint

Scope: Task 1 only; direct work on `codex/v1-continuous`; baseline `eddddb12bb0b624ac300e927f8a57aacf6f893da`. No subagents, GitHub writes, PHASE 5+, real `data/`, references or historical project access.

## Baseline

- `cd app && npm test`: 68/68 PASS (Node v24.13.0).
- Working tree initially clean. Read task brief, design constraints and old PHASE 4 plan (955–1135).
- Explicit user instructions override older plan commit wording and brief auto-advance: stop after PHASE 4, commit `feat: build publication calendar workflow` only after all checks pass.

## Decisions

- Existing v2 schema supports this phase; no migration 003 needed. 001/002 remain immutable. Services serialize coupled calendar/publication changes in `BEGIN IMMEDIATE`, reject a second active publication event, and bump both affected versions.
- Forward status jumps supported (matching the plan's direct publish example). Every backward transition requires a nonblank reason in the audit. Deleting/cancelling a scheduled publication is also a backward transition and requires a reason.
- Event type and content/publication links are immutable after creation. Published history (also recognized by `publishedAt` after reasoned status regression) cannot be erased/rescheduled. Publish completion is recorded through the publication API, not by marking a schedule complete without actual publication evidence.
- Startup will create and verify a pre-migration SQLite backup whenever migrations are pending, including an empty v0 database. Current v2 startup needs no migration/backup.
- All tests use disposable temporary databases. New E2E specs will run their own isolated server so existing global-count assertions remain valid.

## TDD / verification in progress

- Backend/calendar, safety-ignore, startup-backup and SW upgrade tests written before implementation. Red/green outcomes will be recorded here.

### Backend RED → GREEN

- RED command: `cd app && node --disable-warning=ExperimentalWarning --test tests/integration/publication-api.test.js tests/integration/calendar-api.test.js tests/integration/startup-backup.test.js tests/unit/data-isolation.test.js tests/unit/service-worker.test.js`.
- First RED: 18 tests, 4 pass / 14 fail. Missing calendar/publication routes returned 404; dashboard remained zero; pending v0/v1 startup created zero backups; global secret/sidecar paths were not ignored; SW deleted the new cache instead of the old cache.
- Improved the test helper to assert the missing route's 200 status before dereferencing its response, and the ignore test to compare actual `git check-ignore` results without a child-process exception. Re-ran and observed assertion failures for those same missing behaviors.
- GREEN after implementation: same command, 18/18 PASS. Forced SQLite audit-trigger failures demonstrate atomic rollback of calendar rows, publication versions/dates, audit rows and idempotency records, followed by a successful same-key retry.
- Subsequent verification adds cancellation/replacement, concurrent competing schedules, exact half-open range edges, content-side schedule clearing, end-time protection and failed-startup backup preservation. `npm test`: 91/91 PASS at this checkpoint.

### Frontend / contract RED → GREEN

- `node --test tests/contract/phase4-openapi.test.js`: RED on missing publication/calendar operations, then GREEN with full Phase 4 inputs, responses, errors and synchronization contracts.
- `node --test tests/unit/calendar-colors.test.js`: RED on missing persisted calendar content and exact semantic colors, then GREEN.
- Shanghai tests initially verified pure conversion helpers, then a stronger grid/year/month assertion reproduced the real machine-TZ bug: heading January 2027 but grid still December 2026 under UTC/Los Angeles. After converting grid/month selection to explicit Shanghai dates and UTC calendar arithmetic, all zone tests passed.
- Browser RED: `npm run test:e2e -- tests/e2e/calendar-flow.spec.js --grep 'desktop:|trap keyboard' --max-failures=2`, two expected failures: missing `编辑抖音发布` and `＋ 新增安排` controls.
- Added modal keyboard/focus isolation assertion; RED showed `.workspace.inert === false`, then implemented background inert state with focus trapping/restoration. Dialog-specific locators resolve repeated sidebar/day-detail buttons without weakening assertions.
- Browser GREEN: `npm run test:e2e -- tests/e2e/calendar-flow.spec.js --max-failures=1`: 3/3 PASS (42.4s). Desktop/mobile flows use their own temporary servers; existing shared-suite Content count assertions are unchanged.
- A provisional requirement that all modal actions be immediately visible failed at mobile height. Controller clarified that scrolling the dialog is the intended interaction. Replaced it with the correct, stricter reachability check: scroll the action into view and assert the full button lies within both the dialog and viewport. No responsive CSS change was made for this non-defect.

### Visual / safety evidence

- Controller reports real root `data/` metadata empty (0 entries); implementation never opens or writes it. All DB fixtures are under OS temp directories via test helpers or explicit Playwright `WORKBENCH_DATA_DIR`.
- Self-reviewed real Chromium screenshots using `view_image`: desktop calendar, desktop contents, mobile calendar and mobile event editor. Colors and independent dates are correct; no horizontal overflow. Final screenshots wait for `.toast` count 0; page screenshots are full-page at fixed viewports, modal screenshots viewport-only.
- `git diff --check` PASS; `git diff eddddb1 -- app/server/db/migrations/001_core.sql app/server/db/migrations/002_inspiration_title_origin.sql` empty; `git ls-files data app/data` empty. These are Git-only checks, not runtime-data reads.
- `.superpowers/sdd/` ignores its orchestration reports; final task report will be written there locally. Screenshots remain ignored under `artifacts/phase-4/`.
- Final visual regression RED: native datetime control exceeded its desktop column (right edge 729 vs allowed 713.5). Added a focused real Chromium assertion; a scoped minimum/maximum input width constraint fixed it. Focused test: 1/1 PASS.

## PHASE 4 PASS

- Full Node suite: **91/91 PASS**, zero failed/skipped. Also **91/91 PASS** with `TZ=UTC` and with `TZ=America/Los_Angeles`.
- Syntax checks: `npm run check` PASS; `git diff --check` PASS.
- Final `npm run test:e2e`: **10/10 PASS (46.4s)**, including all original 6 E2E tests unchanged and 4 new isolated Phase 4 tests.
- Publication transaction PASS; calendar transaction PASS; audited version-checked deletes and reasoned backward transitions PASS; forced audit-failure rollback and idempotent retry PASS.
- Desktop 1440×900 PASS; mobile 390×844 PASS. Normal full workflows assert **console errors 0 / uncaught page errors 0**. Separate intentional stale-version test confirms the expected 409 and user-visible recovery.
- `view_image` inspected the final desktop/mobile event and publication editor captures after the width fix. Footer buttons are visible after legitimate dialog scrolling, within both dialog and viewport. Page captures begin at scroll top; all 10 Phase 4 screenshots are clean of transient toasts and remain ignored.
- 001/002 unchanged; no 003. No tracked runtime data and no real runtime data access. Controller's read-only preflight reported root data metadata empty; all implementation tests operated in temporary directories.
- Full report: `.superpowers/sdd/v1-mission-plan/task-1-report.md` (intentionally ignored orchestration artifact).
- All phase checks passed before the authorized local commit `feat: build publication calendar workflow`. Keep `codex/v1-continuous` and the workspace for independent controller review; no GitHub writes and no advancement to PHASE 5.

## Independent review minor fix — reject null calendar statuses

- Controller approved core PHASE 4 and requested only this nonnullable-status correction. Default `planned` is now applied only for a create request with status undefined; explicit null on POST/PATCH returns HTTP 400. PATCH omission preserves the existing status.
- Regression tests capture confirmed event status/version, all event rows, content/publication state, audit count and idempotency count before rejection and assert all remain unchanged. A corrected POST reuses the rejected key successfully; a notes-only PATCH preserves confirmed and increments version once.
- Scope: local calendar validation only, no shared enum refactor, migration, UI, runner-warning or tall-calendar changes. Tests use existing temporary-data helpers and isolated browser servers; no real data access.

Fresh command evidence (run from `app/`):

1. RED before implementation:
   `node --disable-warning=ExperimentalWarning --test --test-name-pattern='rejects explicit null status' tests/integration/calendar-api.test.js`
   Output: `tests 2; pass 0; fail 2`, exit 1. POST assertion `201 !== 400`; PATCH assertion `200 !== 400`.
2. GREEN after implementation, same command:
   Output: `tests 2; pass 2; fail 0; skipped 0`, exit 0.
3. Covering calendar/publication/timezone/OpenAPI suite:
   `node --disable-warning=ExperimentalWarning --test tests/integration/calendar-api.test.js tests/integration/publication-api.test.js tests/unit/calendar.test.js tests/unit/calendar-colors.test.js tests/unit/shanghai-time.test.js tests/contract/phase4-openapi.test.js`
   Output: `tests 22; pass 22; fail 0; skipped 0`, exit 0.
4. `npm test`: output `tests 93; pass 93; fail 0; skipped 0`, exit 0.
5. `node --check server/services/calendar-service.js && node --check tests/integration/calendar-api.test.js && npm run check && git diff --check`: exit 0.
6. `npm run test:e2e`: output `10 passed (46.5s)`, exit 0. Fresh real Chromium desktop 1440×900/mobile 390×844 suite includes normal-workflow console/page-error zero assertions, dialog reachability and isolated temporary servers.

All requested fresh checks passed before the local follow-up commit `fix: reject null calendar statuses`. Existing runner warnings and tall-calendar final-QA notes remain nonblocking and untouched. Stop here for controller review; no PHASE 5 advancement.
