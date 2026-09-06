# Handoff — review 1

## Result: FAIL

Reviewed 2026-09-06 against implementation `1c13dfe227899fe202b5cad125147bd722ebbea1`, documentation baseline `11a17e4df40d65284a878228dbde34e63100ea2c`, live image identity `49fd324e7dbde032f262f15e2d444321bc31a957`, and <https://privacy-class-checkin.sociobot.in>.

The result is **FAIL with 11 findings and 15 untested public claims**. The critical blocker is split live class state: 40 fresh authenticated reads of one new class returned 13×200 and 27×404. Deletion needed five attempts to reach the backend holding the class. The sample sandbox is absent, endpoint rate limiting is incomplete, `/data` is not used, and paid checkout returns 404.

No product code was changed. See `.factory/review-1.md` for full findings, evidence, and earlier-finding dispositions.

## Verification run

```sh
npm ci
npm test
npm run build
npm run build:server
npm run test:e2e
cargo fmt --check
cargo clippy --all-targets -- -D warnings
```

All commands above passed. `verify-url.sh` passed its title/lang/main/alt/console checks. Playwright axe found no violations on `/`, `/privacy`, `/terms`, `/open-export`, and the current unknown-path fallback. The standalone axe CLI could not locate its Selenium Chrome binary. Lighthouse completed with 100 performance, 100 accessibility, 100 best practices, and 92 SEO.

## Repair order

1. Restore one coherent, durable SQLite service on the fleet `/data` mount and prove fresh-connection and restart persistence.
2. Add the isolated one-click sample workspace, persistent sample label, reset, start-real action, `.factory/demo.md`, and tagged claim tests.
3. Apply per-forwarded-IP limits to every server endpoint with `429` and `Retry-After`.
4. Repair or remove the $29 checkout offer.
5. Add the real 404, robots, sitemap, metadata, footer build identity, route focus behavior, plain first-screen copy, and copy audit.
6. Use a supported moving Rust base, enlarge the mobile home target, and fingerprint/cache the hero.

## Review data note

The reviewer used pseudonyms only and deleted every audit class for which the correct backend was reachable. Because split persistence returned 404 during cleanup, up to three failed setup/boundary probes may remain until their configured 7-day or 365-day retention deadline. No credential is included in this handoff or report.
