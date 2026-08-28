# Handoff — Privacy Class Check-in

Completed 2026-08-28 for work order `privacy-class-checkin-build-1`.

## What was built

- Complete teacher flow: create a pseudonymous roster, issue unrecoverable high-entropy tokens, retain a private recovery link, start/close sessions, display a 90-second rotating code, see live totals, make keyboard-accessible manual corrections, browse recent sessions, and delete the class immediately.
- Complete learner flow: enter the current six-digit code and private roster token from any browser, with useful validation, repeat-check-in handling, offline notice, and no account/device permissions.
- SQLite backend in Rust/axum with parameterized queries, cascading deletion, hourly/boot retention cleanup, one-way token and teacher-key hashes, bounded request bodies, a bounded check-in attempt window, same-origin serving, structured logs, secure headers, `/health`, and graceful SIGINT/SIGTERM shutdown.
- Signed present/late/absent CSVs using Ed25519. Recommended exports are encrypted locally with AES-256-GCM and PBKDF2-SHA256 (210,000 rounds). `/open-export` decrypts and verifies `.pcc` files entirely in the browser; neither file nor passphrase is uploaded. A clearly warned plaintext fallback remains for interoperability.
- Optional $29 one-time Sociobot Field kit license for printable specimen token cards. Checkout/verification use pilot billing off production and production billing only on the canonical host; results are cached for one day, restore-by-token is available, and the free experience never waits on verification. No core, export, safety, or accessibility feature is gated.
- Original botanical field-guide visual system and generated hero plate, with source, review, prompt, and provenance in `.factory/design.md` and `assets/src/`.
- Responsive 390 px layout, keyboard focus treatment, reduced-motion policy, offline shell/service worker, empty/loading/error states, `/privacy`, `/terms`, README, MIT license, and non-root multi-stage container packaging.

## Verification performed

- `npm test`: passed — TypeScript strict check, 3 frontend unit tests, 4 Rust tests including a full create/start/check-in/correct/export/close/delete API flow.
- `npm run build`: passed; output is `dist/index.html`. Initial bundle: 33.46 KB JS raw (11.16 KB gzip), 9.85 KB CSS raw (3.12 KB gzip), 94 KB hero WebP.
- `cargo build --release`: passed.
- `npm run test:e2e`: 6/6 passed on desktop Chromium and a 390 × 844 mobile Chromium profile. The flow includes encrypted export download, local decryption, and Ed25519 verification.
- Axe via Playwright: no serious or critical violations on desktop or mobile.
- `/opt/fleet/lib/verify-url.sh`: HTTP 200, 578 ms local network-idle load, title/lang/one h1/main/alt checks present, no console or page errors. Its simple hidden-content check reports the labeled “Verify license” button inside a closed `<details>` as hidden text; Axe reports no naming violation.
- Lighthouse mobile: Performance 99, Accessibility 100, Best Practices 100, SEO 100; LCP 1.9 s, CLS 0, TBT 0 ms.
- Load smoke: 100 concurrent `/health` requests, 100/100 HTTP 200 in 425 ms (about 235 requests/s locally).
- Manual screenshots reviewed at desktop and 390 px: no clipping, overlap, or horizontal overflow observed.
- `npm audit`: 0 dependency vulnerabilities.

## Run and deploy

See `README.md`. Production must supply a persistent `/app/data` volume, a stable high-entropy `EXPORT_SIGNING_KEY`, and preferably `BUILD_SHA`. The exact frontend build command is `npm run build`; the deployment artifact is the root `Dockerfile` on port 8080.

## Known gaps and next steps

- Docker is not installed in this worker, so `docker build` could not be executed locally. The frontend production build and optimized Rust binary were built independently and pass; the multi-stage Dockerfile uses those same commands and runs as UID 10001.
- The factory still needs to register the `privacy-class-checkin` production/test product and price with the Sociobot billing service before checkout can complete.
- The in-process attempt limiter intentionally resets on restart and is global to this small single-tenant service. Put an additional rate limit at the deployment edge if the service becomes broadly multi-tenant.
- A device and token check-in is intentionally not identity or location proof. This limitation is repeated in the product, privacy notice, terms, and README.
