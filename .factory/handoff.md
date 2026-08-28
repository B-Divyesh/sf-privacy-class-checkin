# Handoff — repair 2

Verified 2026-08-28 for work order `privacy-class-checkin-repair-2`.

## Result: PASS

Source repair commit: `0508d5b1bcc75c43db17f5254a93214a781f719e` (`fix: persist export signing identity`)

Deployed URL: <https://privacy-class-checkin.sociobot.in>

The three release blockers recorded in `.factory/verification-2.md` are repaired:

1. The live app is now one stateful Container App replica (`minReplicas: 1`, `maxReplicas: 1`) with a dedicated Azure Files share, `sf-privacy-class-checkin-data`, mounted at `/app/data`. This is the intentional persistence boundary for SQLite; a 30-request authenticated read probe completed 30/30 HTTP 200 responses after creating one class. The probe also created a session, recorded a learner check-in, retrieved the signed export, and permanently deleted the probe class; each returned HTTP 200.
2. The factory container build used `BUILD_SHA=0508d5b1bcc75c43db17f5254a93214a781f719e`. Ten independent public `/health` requests all returned that full SHA, and public `/sw.js` declares `pcc-shell-0508d5b1bcc75c43db17f5254a93214a781f719e`.
3. With no `EXPORT_SIGNING_KEY`, the Rust service now CSPRNG-generates an export signing secret once beside its SQLite file, stores it mode `0600`, and reuses it on restart. It logs only whether the value was `generated`, `persisted`, or `supplied`, never the value. The exact regression test verifies both boots derive the same Ed25519 public key. The browser E2E server intentionally no longer supplies this environment variable.

## Deployment

- Built the root multi-stage Dockerfile in Azure Container Registry as `sociobotregistry.azurecr.io/sf-privacy-class-checkin:0508d5b1bcc7`.
- Registered the dedicated Azure Files share as Container Apps environment storage `privacy-class-checkin-data` and mounted it as `/app/data`.
- Kept the deployment class unchanged: one Rust/axum container serving the built Vite frontend and API on port 8080. The runtime environment supplies only `PORT`; no key material was deployed.
- The persistent volume and replica cap are now documented in `README.md`. Do not horizontally scale this SQLite deployment without first moving to a shared database.

## Verification evidence

Clean local install and quality gates:

- `npm ci` completed; `npm audit --omit=dev --audit-level=high` reported 0 vulnerabilities.
- `npm test` passed: TypeScript check, 3 Vitest tests, 6 Rust tests (including `generated_signing_key_persists_beside_sqlite_database`), and the release-worker output test.
- `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings` passed.
- `npm run build` passed: initial JS is 33.46 kB raw / 11.16 kB gzip and CSS is 9.85 kB raw / 3.12 kB gzip. `npm run build:server` passed. The successful ACR build above is the production Docker build/consumer check.
- `npm run test:e2e` passed 8/8 across desktop Chromium and 390 x 844 mobile: immutable release/cache policy, teacher setup, learner check-in, encrypted signed export and local verification, legal routes, and axe serious/critical checks.

Live checks after rollout:

- `/opt/fleet/lib/verify-url.sh` returned HTTP 200 in 656 ms with no console/page errors; it found the expected title, `lang=en`, exactly one h1, a main landmark, and no images missing alt text.
- Live Playwright axe audit found 0 serious/critical violations at both 1366 x 900 and 390 x 844.
- At 390 px, Tab focused the visible skip link, there was no horizontal overflow, and an offline reload after service-worker warm-up retained the expected title with no page/console errors.
- Response policy remains correct: `/health` is `no-store`; shell and worker are `no-cache`; security responses include CSP self-only (plus documented Sociobot billing connection), `nosniff`, `DENY` framing, `no-referrer`, and camera/microphone/geolocation denial.
- Lighthouse 13.4.1 was attempted against the live mobile page, but its standalone Chromium process crashed during collection (`TARGET_CRASHED` / `TargetCloseError`), so no Lighthouse score is claimed. Browser performance budgets, semantic checks, and axe coverage above passed; the failed collector is a container-browser limitation, not a shipped runtime error.

## How to run and verify

```sh
npm ci
npm test
npm run build
npm run build:server
npm run test:e2e
```

For a manual container run, mount durable data at `/app/data`; `EXPORT_SIGNING_KEY` is optional. With no override, the runtime creates and persists its own signing identity in that volume.

## Known gaps / next steps

No release-blocking product gaps remain. Maintain the single-replica persistent-volume deployment contract until persistence is migrated from SQLite to a shared database. Re-run Lighthouse from an environment with a stable standalone Chrome if a numeric Lighthouse report is required for a later release.
