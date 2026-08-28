# Independent verification — FAIL

Verified on 2026-08-28 against candidate commit `2b77ca740d55d90b1f38e5a8501addf79a15e22e` and <https://privacy-class-checkin.sociobot.in> for work order `privacy-class-checkin-verify-2`. Product source was not modified. Testing used a fresh detached checkout at that exact SHA.

## Verdict

**FAIL.** The candidate builds and its local product flows work, but the live backend is not a coherent persistent service. A just-created class was readable only half the time behind the public URL. The deployment also identifies itself as `local-development`, rather than the candidate SHA. Both are release blockers.

## Quality gates and local evidence

- Fresh install: `npm ci` passed; `npm audit --omit=dev --audit-level=high` reported 0 vulnerabilities.
- `npm test` passed: TypeScript check, 3 Vitest tests, 5 Rust tests, and release-worker output test.
- `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings` passed. No separate repository lint script exists.
- Exact available production stages passed: `npm run build` emitted `dist/`; `npm run build:server` emitted the optimized Rust binary. Docker is not installed in this verifier container, so the Docker wrapper itself could not be run.
- `npm run test:e2e` passed **8/8**: desktop and 390 x 844 mobile release/cache checks, teacher setup, learner check-in, browser-encrypted signed export and local verification, legal routes, and axe serious/critical checks.
- Bundle budget passes: JS 33,467 B raw / 11,038 B gzip; CSS 9,853 B raw / 3,137 B gzip; hero WebP 95,928 B. Initial JavaScript is well below 200 KB and CSS below 50 KB.

## Product, privacy, and accessibility checks

- Live API exercise passed when requests reached the same backend state: invalid class/session/check-in input produced specific 400/401/404 recovery messages; 20 simultaneous duplicate check-ins returned 20 HTTP 200 responses with exactly 1 `recorded:true` and 19 idempotent `recorded:false`; manual Late correction, signed CSV export (including Late and Absent rows), close, and permanent deletion all worked.
- Live browser exercise created a class, started a rotating code, submitted a learner token, downloaded an encrypted export, and showed the visible `Check-in recorded.` result without console or page errors. The UI invalid-class error recovered correctly to successful class creation.
- Desktop and 390 px browser checks passed: `lang=en`, one `h1`, `main`, 16 px body text, no horizontal overflow, keyboard Tab reaches the visible 3 px skip-link focus, and reduced-motion transition duration is `0s`.
- Playwright axe found 0 serious/critical violations on live desktop and mobile. `npx @axe-core/cli` itself could not start its Selenium Chrome session in this container; the Playwright axe audit completed successfully instead.
- Service-worker control and offline reload passed after warming the live shell. No initial-load console/page errors occurred.
- Initial live navigation made only same-origin requests (HTML, JS, CSS, hero). There are no remote fonts, analytics, location/camera/microphone requests, or tracker requests. CSP restricts resources to self (with the documented Sociobot billing API connection exception); permissions policy denies camera, microphone, and geolocation. `nosniff`, `DENY` framing, and `no-referrer` are present.
- Live cache policy is correct for HTML/worker/manifest (`no-cache`), API and health (`no-store`), and hashed JS/CSS (`public, max-age=31536000, immutable`). The un-hashed 95.9 KB hero is `no-cache`; this is a performance improvement opportunity but not the release blocker.

## Deployment comparison

- Candidate source differs from the preceding repair SHA only in `.factory/handoff.md`; the application source is unchanged.
- Local default-build JS, CSS, and hero SHA-256 values exactly match the live artifacts: JS `eca8b16c610420f65dcffe7f53717de5806681cf8986e91eb9fee236bedbd4c6`, CSS `3219779ef1f3926fb5860e63e6d4cef7d7329cee9e761f187f9218f4c7239c97`, hero `591897e0a4d7865ff15635122000718af93f8dc47c033a8a8b77897174b00048`.
- However, 10 independent live `GET /health` responses all returned `{"buildSha":"local-development","status":"ok"}` and `/sw.js` declares `pcc-shell-local-development`. This is not the immutable candidate identity and cannot prove the live backend/image is the candidate release.

## Defects

### Critical — live class data is split between backend instances

Created class `fddfe820-a76a-4185-b78f-2516024b7ab1` with a valid teacher key, then made 30 sequential authenticated `GET /api/classes/<id>` requests through the public URL. Results were exactly **15 HTTP 200** responses containing the class and **15 HTTP 404** responses containing `{"error":"Class not found."}`. A subsequent delete succeeded, proving that one backend instance retained the class while another did not.

This makes teacher reload, session start, manual correction, export, and deletion nondeterministic. It violates the required backend persistence boundary and the core attendance job. Deploy one stateful instance with a persistent `/app/data` volume, or move the shared data to a managed/shared database; then repeat an inter-instance create/read/session/export/delete test with at least 30 requests.

### High — deployment build identity is not the tested candidate

The candidate is `2b77ca740d55d90b1f38e5a8501addf79a15e22e`, yet every live health response and the live worker report `local-development`. Build the deployed image with `--build-arg BUILD_SHA=2b77ca740d55d90b1f38e5a8501addf79a15e22e` (or the released immutable source SHA), deploy it, and verify `/health` plus the worker cache name after rollout.

### High — default runtime signing key is regenerated on restart

The mandatory runtime configuration contract requires a generated secret to persist when no secret env var is supplied. Starting the optimized server twice with only `PORT` set preserved the SQLite class/session but changed the exported Ed25519 public key (`public_key_stable=false`). Source also generates `EXPORT_SIGNING_KEY` in memory whenever unset. Persist a CSPRNG-generated signing secret alongside the database (with restrictive permissions) and log whether it was generated or supplied, without exposing it. This also prevents inconsistent signing identity across replacement instances.

## Required re-verification

After deployment repair, rerun the clean-checkout tests, health/worker identity check, and a 30-request authenticated persistence probe across the public URL. Do not mark this release PASS until all reads of a newly created class return 200 and the live build identity is immutable and matches the release.
