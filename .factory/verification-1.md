# Independent verification — FAIL

Verified 2026-08-28 against candidate commit `9e33cb48648ccb517cabe7b296733300f6e36b59` and the live URL <https://privacy-class-checkin.sociobot.in>. This is an independent verifier report for work order `privacy-class-checkin-verify-1`; product source was not modified.

## Verdict

**FAIL.** The local candidate is functional and the live frontend is byte-for-byte the candidate build, but the deployed backend does not identify itself as the candidate and the deployment does not provide the required caching policy. These are release-blocking deployment-quality failures under the acceptance contract.

## Passing evidence

- Clean candidate checkout: `HEAD` was exactly `9e33cb48648ccb517cabe7b296733300f6e36b59`; `npm ci` completed with 0 audited vulnerabilities.
- Local quality checks passed: `npm test` (TypeScript check, 3 Vitest tests, 4 Rust tests), `npm run build`, `npm run build:server`, `cargo fmt --check`, and `cargo clippy --all-targets -- -D warnings`.
- Browser E2E passed locally: `npm run test:e2e` was 6/6, covering desktop Chromium and 390×844 mobile, teacher setup, learner check-in, encrypted export, local decrypt/Ed25519 verification, legal pages, and axe serious/critical checks.
- Live end-to-end browser flow passed: created a three-token pseudonymous class, started a session, learner check-in, keyboard-capable manual Late correction, encrypted export, local decrypt/signature verification, then permanent deletion. No teacher or learner console errors occurred.
- Live API boundary/recovery exercise passed: invalid class name/empty roster/duplicate roster/retention 366/bad check-in/invalid session range all returned useful 400 errors; bad token returned 401; 20 simultaneous duplicate check-ins produced one recorded and 19 idempotent responses; close stopped check-ins; signed CSV included present and late rows; deletion made the class unavailable.
- Privacy/browser checks passed on the live page: initial-load requests stayed same-origin; no console/page errors; no location, camera, microphone, biometric, tracker, or remote-font request observed. Headers include CSP, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and a permissions policy denying camera/microphone/geolocation.
- Accessibility/responsiveness passed live: `lang=en`, title, one h1, main landmark, alt text, visible 3 px focus ring on the skip link, zero horizontal overflow at 390 px, 16 px body text, reduced-motion transition duration `0s`, axe serious/critical findings 0 on desktop and 390 px mobile. Offline reload succeeded after service-worker control.
- Candidate/live frontend match: local `dist/index.html` SHA-256 `1ccca018190be186dc793717c852c7bf7f9bdc2d9dc7ca4813139a51748e9524`; live JS SHA-256 `eca8b16c610420f65dcffe7f53717de5806681cf8986e91eb9fee236bedbd4c6`; live CSS SHA-256 `3219779ef1f3926fb5860e63e6d4cef7d7329cee9e761f187f9218f4c7239c97`. The latter two match the local candidate exactly.
- Production bundle budget passes: JS 33.46 KB raw / 11.16 KB gzip, CSS 9.85 KB raw / 3.12 KB gzip, hero WebP 95.9 KB. Lighthouse mobile (live): Performance 100, Accessibility 100, FCP 1.1 s, LCP 1.6 s, CLS 0, TBT 50 ms, 138 KiB total transfer.

## Defects

### High — deployment provenance is not configured

`GET https://privacy-class-checkin.sociobot.in/health` returned `{"buildSha":"development","status":"ok"}`, not the tested candidate SHA. The local optimized candidate binary returns the expected SHA when started with `BUILD_SHA=9e33cb48648ccb517cabe7b296733300f6e36b59`, so this is a deployment configuration failure. Static assets prove the frontend matches, but the running backend cannot be positively identified as the candidate. Set `BUILD_SHA` to the immutable deployed commit and redeploy before release.

### Medium — no cache policy for static assets

Live HTML, hashed JS/CSS, WebP, service worker, and manifest responses have no `Cache-Control` header. Lighthouse `cache-insight` scored 0 and reports 136 KiB potential savings; JS, CSS, and hero each have TTL 0. This violates the stated long-lived immutable caching requirement and makes repeat/mobile loads unnecessarily expensive. Serve hashed assets with long-lived immutable cache control; use a short revalidation policy for HTML and service worker.

### Medium — service-worker cache is not versioned per release

`frontend/public/sw.js` hard-codes `const CACHE='pcc-shell-v1'`. Offline reload passed after a warmed online load, but a frontend-only deployment does not necessarily change the worker or cache name, so old shell files can persist offline and update behavior is not reliably versioned. Derive/version the cache with the release build and retest install/update/offline reload.

## Constraints

Docker is unavailable in this verification container, so the exact `docker build` could not be run. The two Docker build stages were independently reproduced by the passing `npm run build` and `npm run build:server` commands. No repository lint script exists; the available Rust formatting/lint checks above were run.
