# Review 1 — Run a private classroom attendance check-in

Reviewed 2026-09-06 for work order `privacy-class-checkin-review-1` at <https://privacy-class-checkin.sociobot.in>.

## Verdict: FAIL

**FAIL — 11 findings, including 1 critical finding, and 15 untested public claims.** The live service loses access to newly created classes across backend requests. The required sample-data sandbox is absent. The paid checkout is also a dead link. A PASS requires zero findings and zero untested claims.

The implementation reviewed is `1c13dfe227899fe202b5cad125147bd722ebbea1`. The live image identifies itself as `49fd324e7dbde032f262f15e2d444321bc31a957`, a later report-only commit. The documentation baseline is `11a17e4df40d65284a878228dbde34e63100ea2c`. `git diff 1c13dfe..11a17e4 -- . ':!.factory/**'` is empty. Candidate-built JavaScript, CSS, service worker, and hero image are byte-identical to the live files.

## First screen before scrolling

- Job shown: record a classroom attendance signal with a rotating code and pseudonymous token.
- Audience shown: a classroom is named, but the first sentence does not plainly say that the setup action is for a teacher.
- First action shown: **Enter class code**, beside **Set up a class**.
- Required first action: **Try it with sample data**. It is absent.

The title is `Privacy Class Check-in — attendance without surveillance`. The h1 is `Know who checked in. Nothing more.` This does not name the complete job. The first screen does not show the required three short privacy, offline, and price facts.

## Findings

### Critical — class state is split between live backend instances

A class created through the public API was read 40 times over fresh HTTP/1.1 connections. Results were **13 HTTP 200 and 27 HTTP 404** with the same class ID and teacher key. Deletion returned `404, 404, 404, 404, 200`; after the successful delete, 20/20 reads returned 404.

This breaks reload, session start, manual correction, export, and deletion. It also reproduced in a fresh phone flow: setup submitted, but the populated teacher sheet could not load. The earlier verification-2 critical finding has regressed. Run one replica against the fleet-mounted SQLite volume, then prove create/read/session/export/delete across fresh connections and a restart.

### High — there is no sample-data sandbox

There is no **Try it with sample data** action. `/demo` returns the ordinary empty landing page. It has no realistic class, populated attendance output, persistent `Demo — sample data, nothing is saved` label, **Reset demo**, **Start for real**, TTL workspace, or separate storage namespace. `.factory/demo.md` is missing.

The required sample workflow cannot be tested without creating real classes. Audit classes used pseudonyms only; known classes were deleted where the correct backend could be reached. Because of the split-state defect, up to three failed setup/boundary probes may remain until their 7-day or 365-day retention deadline.

### High — backend rate limiting does not meet the public-service contract

Eighty write requests to `POST /api/classes` from one forwarded client address all returned 400; none returned 429. The only limiter is one process-wide queue on `/api/checkins`, not a per-client limiter keyed by the first `X-Forwarded-For` hop. A sequential check-in flood returned 77×400 and 33×429, but all 33 responses lacked `Retry-After`. Other API endpoints are unbounded.

Apply a per-client limiter to every server endpoint except health, use the first forwarded address, and return `429` with `Retry-After`.

### High — durable state is written outside the required `/data` mount

The runtime defaults to `sqlite://data/checkin.db?mode=rwc` under `/app`, and the Dockerfile declares `/app/data`. The work order requires SQLite and generated signing keys under the fleet-created `/data` mount. README deployment instructions also tell operators to mount `/app/data`. A replacement can therefore start with an empty database even though `/data` is durable.

Use `/data/checkin.db` and keep the generated signing key beside it, with a local fallback only when `/data` is unavailable.

### High — the paid checkout link is broken

The visible **Buy the Field kit** link points to `https://api.sociobot.in/api/v1/products/privacy-class-checkin/checkout`. It returns HTTP 404 with `{"error":"enabled factory product","status":404}`. A visitor cannot buy the advertised $29 one-time license.

Enable the product in the Sociobot billing service or remove the purchase offer until checkout works.

### Medium — public claims have no claim file or tagged sandbox tests

`.factory/claims.json` is missing and no test contains an `@claim:` tag. There are no declared claim commands to run. Incidental unit or end-to-end coverage does not satisfy the required one-claim/one-sandbox-test contract.

The 15 untested claim families are:

1. A class can check in within two minutes.
2. Codes rotate every 90 seconds and stop after closing a session.
3. No location, biometric, camera, microphone, device fingerprint, account, analytics, or background tracking data is collected.
4. Roster tokens and teacher keys are stored only as one-way hashes.
5. Issued tokens appear once and cannot be recovered from the server.
6. Teacher recovery links and readable tokens stay only on the teacher device.
7. The default export uses AES-256-GCM and PBKDF2-SHA256 with 210,000 rounds.
8. Export files and passphrases never leave the browser and are not stored.
9. CSV exports are signed and can be opened and verified locally.
10. Manual correction is keyboard accessible and is labelled in the export.
11. Retention cleanup and immediate class deletion remove all retained class data.
12. The offline shell remains usable and updates safely between releases.
13. Hashed assets cache for one year while HTML, manifest, and worker revalidate.
14. The $29 license is one-time, verifies at most daily, and unlocks printable cards while core functions stay free.
15. Check-in attempts are bounded without blocking unrelated clients.

Create the claim inventory and one clean-demo tagged test per claim. Remove or correct claims that cannot be proved.

### Medium — first-screen and page copy do not follow the plain-words contract

The h1 does not name the job, the audience is implicit, the sample action is absent, and the three short facts are absent. Copy includes metaphor and mood labels such as `A smaller claim, by design`, `Field note`, `Three marks in the notebook`, `field sheet`, `field kit`, and `Plate 01`. `.factory/copy-audit.md` is missing.

Use a job title such as `Record class attendance without tracking`, name teachers in the next sentence, add the sample action and three facts, and replace metaphor headings with task names.

### Medium — required routes and site metadata are missing

- An unknown path returns the landing page with HTTP 200. There is no designed 404 response.
- `/robots.txt` and `/sitemap.xml` both return the HTML app shell with HTTP 200. Lighthouse reports 18 robots syntax errors.
- Canonical, Open Graph, Twitter card, social image, and apple-touch metadata are absent.
- The footer omits `Built by Param Factory` and a version/build ID.
- Full-page links handle routes; there is no history-based route focus move or polite route announcement.
- The external source link does not say that it leaves the site.

Add the real routes and metadata, a styled 404 with a way home, and the standard route and footer behavior.

### Medium — the Docker build does not follow the required Rust image contract

The Dockerfile uses `rust:1.88-bookworm`. The backend contract requires a moving stable base such as `rust:1-slim` and forbids pinning a Rust minor. Docker is not installed in this review container, so the documented Docker wrapper could not be executed. The exact frontend and release-server build stages passed with the installed Rust 1.98 toolchain.

### Low — the mobile home link is smaller than the touch target minimum

At 390 px, the wordmark text is hidden and the remaining home link measures about 30×34 CSS px. Required targets are at least 44×44 px. Other controls passed the size check; inline text links were treated as text-link exceptions.

### Low — the previous hero cache issue remains

`/botanical-checkin-hero.webp` is 95,928 bytes, has no content hash, and still returns `Cache-Control: no-cache`. Hashed JS and CSS correctly return one-year immutable caching. This is the minor issue recorded by verification 3 and is still present.

## Checks that passed

### Clean checkout and builds

- `npm ci`: passed; 55 packages installed and 0 vulnerabilities reported.
- `npm test`: passed; TypeScript check, 3 Vitest tests, 6 Rust tests, and the release-cache test.
- `npm run build`: passed and produced `dist/`.
- `npm run build:server`: passed.
- `npm run test:e2e`: passed 8/8 on desktop Chromium and 390×844 mobile.
- `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings`: passed.
- Standalone `npx @axe-core/cli` could not find a Selenium Chrome binary. Playwright axe using the supplied Chromium completed on all public routes with zero serious or critical violations.

### Normal, invalid, boundary, and recovery paths

- Class creation, session start, one learner check-in, manual Late correction, signed CSV output, close, and deletion work when requests reach the same backend state.
- Twenty duplicate check-ins returned 20×200 with exactly one `recorded:true` and 19 idempotent results.
- Wrong or missing teacher keys and cross-class keys returned 401. This passed the class isolation check.
- Invalid class name, empty or duplicate roster, invalid retention, invalid session bounds, malformed code, wrong token, concurrent session, and post-close check-in returned useful 400/401/404/409 errors.
- Maximum class name, 60-entry roster, and 365-day retention were accepted. An 81-character name, 61-entry roster, and 41-character pseudonym were rejected.
- CSV formula input was escaped. A local generated signing key had mode 0600, remained stable after restart, and the class remained readable after restart.

### Browser, accessibility, privacy, and offline behavior

- Fresh desktop and phone contexts were used. Both had `lang=en`, one h1, header/nav/main/footer landmarks, 16 px body text, no horizontal overflow, no console or page errors, and zero axe violations.
- Tab first reaches the skip link with a 3 px blue focus ring. A roster status was changed with keyboard arrows and saved as `manual`.
- Reduced motion makes button transitions `0s`. Text enlarged to 200% without page-level horizontal overflow.
- Initial navigation requested only same-origin HTML, JS, CSS, and the product image. No analytics, third-party font/script, camera, microphone, location, or fingerprint request was observed.
- Security headers include CSP, `nosniff`, `DENY` framing, `no-referrer`, and a permissions policy denying camera, microphone, and geolocation.
- After service-worker control, `/`, `/privacy`, `/terms`, and `/open-export` reloaded offline. The offline notice appeared on subsequent routes.
- Privacy and terms pages have route titles, one h1, ordered headings, responsive layout, and working home/legal links. The privacy page supplies a deletion/privacy email link.

### Performance and live parity

- Lighthouse 13 mobile: Performance 100, Accessibility 100, Best Practices 100, SEO 92; FCP 1.1 s, LCP 1.6 s, CLS 0, TBT 60 ms, total transfer 138 KiB. The SEO loss is the invalid HTML response at `/robots.txt`.
- JS is 33,467 bytes raw / about 11.2 KB gzip; CSS is 9,853 bytes raw / about 3.1 KB gzip; hero is 95,928 bytes.
- Twenty fresh `/health` requests all returned build `49fd324e7dbde032f262f15e2d444321bc31a957`.
- Local/live SHA-256 matches: JS `eca8b16c…c6`, CSS `3219779e…c97`, worker `16d52dda…1d8`, hero `591897e0…048`.

## Earlier findings

| Earlier finding | Current disposition |
| --- | --- |
| Verification 1: build identity missing | Fixed. Health and worker carry `49fd324…`, and artifacts match. |
| Verification 1: static cache policy missing | Fixed for hashed JS/CSS. The un-hashed hero remains a Low finding. |
| Verification 1: worker cache not release-versioned | Fixed. Worker cache is `pcc-shell-49fd324…`. |
| Verification 2: split backend persistence | **Regressed.** Fresh connections returned 13×200 and 27×404. |
| Verification 2: signing key changes after restart | Fixed locally. Key file stayed mode 0600 and stable across restart. |
| Verification 3: un-hashed hero revalidates | Still present as a Low finding. |
| Verification 3: Lighthouse unavailable | Resolved for this review; Lighthouse completed. |
| Verification 3: Docker unavailable | Still a review-environment limitation; source inspection found the pinned-image defect. |

## Evidence

Screenshots, the live URL check, and Lighthouse JSON are under `/work/.evidence/`. This report is copied to `/work/.evidence/qa-report.md`; the machine result is `/work/.evidence/qa-result.json`.
