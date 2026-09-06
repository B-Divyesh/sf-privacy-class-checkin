# Handoff — repair 3

## Result

Repair complete. The product is deployed at <https://privacy-class-checkin.sociobot.in> and the live health response identifies implementation `beb3a9414ddd1269fc5eda4957ca842eeb92f5aa`.

- Live revision: `sf-privacy-class-checkin--0000018`
- Immutable image: `sociobotregistry.azurecr.io/sf-privacy-class-checkin@sha256:0f47e7c549da911013c9de1502e50651da6dd60de36f8fcb4639d9475c22e10b`
- Storage: `sf-privacy-class-checkin-data` mounted at `/data`
- Scale: minimum 1, maximum 1
- Documentation baseline before this handoff: `beb3a9414ddd1269fc5eda4957ca842eeb92f5aa`

## What changed

- Moved the database and generated export-signing identity to `/data`, with a local executable-directory fallback when `/data` is absent.
- Added network-filesystem-safe SQLite locking for Azure Files, an atomic pre-open startup guard, serialized migrations, empty-bootstrap recovery, and one database connection per process.
- Added per-client limits to every server route except health. The first `X-Forwarded-For` address is used; limited responses include `429` and `Retry-After`.
- Added an isolated 24-hour in-memory `/demo` workspace with 30 realistic learners, populated attendance, a persistent sample label, reset, start-real, check-in, keyboard correction, and signed export.
- Rewrote the first screen in plain words. It now names the job and teachers, shows the sample action beside setup, and states privacy, offline, and price facts.
- Added route-aware titles, history/focus handling, route announcements, robots, sitemap, canonical and social metadata, an original social card, apple-touch icon, and a styled HTTP 404.
- Preserved the $29 one-time printable-card deliverable and license restoration. The public page states that checkout registration is pending instead of linking to a dead checkout.
- Added 15 declared claims with outcome-based browser, unit, integration, privacy, offline, and persistence tests.
- Updated the Docker build to `rust:1-slim`, build arguments, non-root runtime, `/data`, and the generated build identity.
- Enlarged the phone home target and moved the original hero into Vite's fingerprinted asset pipeline.
- Added `.factory/demo.md`, `.factory/copy-audit.md`, the catalog description, billing metadata evidence, updated design provenance, README, and legal copy.

## Review finding disposition

| Review 1 finding | Disposition |
| --- | --- |
| Split live backend state | Fixed. One `/data` SQLite database is mounted on a one-replica service. A live class returned 40/40 fresh authenticated reads, remained readable after a revision restart, and returned 404 after deletion. |
| No sample sandbox | Fixed. `/demo` is one click away, isolated in an expiring in-memory workspace, populated, labelled, resettable, and discardable. |
| Incomplete rate limiting | Fixed. A live client received 30 allowed requests followed by five 429 responses with `Retry-After`; another forwarded client was unaffected. |
| State outside `/data` | Fixed. Startup logs report `durable /data`; app configuration confirms the durable share mount. |
| Broken paid checkout | Product-side behavior fixed honestly. The broken link is removed and registration pending is stated. Billing registration is still an external operator dependency. |
| Missing claims and tagged tests | Fixed. `.factory/claims.json` declares 15 claims, and all 15 exact commands passed from a fresh clone of the deployed SHA. |
| First-screen and metaphor copy | Fixed. The job, audience, sample action, and three facts are visible before scrolling. The copy audit has no over-limit or banned-word flags. |
| Missing routes and metadata | Fixed. All required routes and metadata exist; unknown paths return the designed page with HTTP 404. |
| Pinned Rust image | Fixed. The Dockerfile uses `rust:1-slim`. |
| Small mobile home target | Fixed. The brand target is at least 44 by 44 CSS pixels. |
| Unhashed hero | Fixed. The hero is emitted as a fingerprinted asset with a one-year immutable cache policy. |

Earlier build-identity, worker-versioning, signing-key, and static-cache findings remain fixed. The split-state regression is now covered by local restart/concurrent-start tests and live fresh-connection/restart checks.

## Verification

A fresh clone was checked out at `beb3a9414ddd1269fc5eda4957ca842eeb92f5aa`, followed by `npm ci`. Every `test` command in `.factory/claims.json` was run separately: 15 passed, 0 failed.

The same clean clone also passed:

```sh
npm test
npm run build
cargo fmt --check
cargo clippy -- -D warnings
npm run test:e2e
```

Results:

- TypeScript/Vitest: 3 tests passed.
- Rust: 13 tests passed, including restart persistence, concurrent startup, retention deletion, tenant isolation, one-way credentials, and rate limiting.
- Playwright: 25 passed; 1 intentional phone-only project skip.
- Build output: JavaScript 39.43 KB raw / 12.13 KB gzip; CSS 10.91 KB raw / 3.40 KB gzip; hero 95.92 KB.
- Final ACR release build passed from the source archive and produced the immutable image above.

Live checks:

- `/health` returns build `beb3a9414ddd1269fc5eda4957ca842eeb92f5aa`.
- Temporary live class: 40 fresh connections returned 40×200 and 0 other responses; the class remained readable after restart and was then deleted.
- Live allowance: 30×422 validation responses, then 5×429 with `Retry-After`; a different forwarded client received its normal 422 response.
- The one-click sample showed 30 rows and 22 present learners. It persisted across reload, reset to a new workspace, left a real-data sentinel unchanged, and discarded on “Start for real”.
- Live offline reload passed after warming `/`, `/demo`, `/privacy`, `/terms`, and `/open-export`.
- `verify-url.sh` passed title, language, landmark, image-alt, and console checks.
- Playwright axe found zero serious or critical issues on `/`, `/demo`, `/privacy`, `/terms`, `/open-export`, and the deliberate 404.
- Fresh phone and desktop contexts had one h1, no horizontal phone overflow, visible keyboard focus, reduced motion, and no valid-page console errors.
- Lighthouse mobile: Performance 100, Accessibility 100, Best Practices 100, SEO 100; FCP 1.11 s, LCP 1.56 s, CLS 0, TBT 0 ms.
- Live hashed assets return `public, max-age=31536000, immutable`; HTML and `sw.js` revalidate.

Evidence is under `/work/.evidence/`, including `live-desktop.png`, `live-phone.png`, `live-verify/`, `lighthouse-live.json`, `billing-offer.json`, and `catalog-description.txt`.

## Run locally

```sh
npm ci
npm run build
cargo run
```

Open <http://127.0.0.1:8080> or <http://127.0.0.1:8080/demo>. With no environment variables, local state is stored beside the executable. `PORT`, `DATABASE_URL`, and `EXPORT_SIGNING_KEY` are optional overrides.

## Known dependency and data note

The Sociobot billing endpoint for `privacy-class-checkin` still returns 404. `/work/.evidence/billing-offer.json` records the exact $29 one-time offer for the billing-registration operator. Printable cards remain paid and existing licenses can still be restored; checkout is not presented as available.

The pre-repair service stored state in separate container files, so those contradictory per-instance databases could not be safely merged into the new durable store. No credential or private roster value was inspected or recorded. All classes created by this repair's live verification were deleted; deliberate 404 responses are expected.
