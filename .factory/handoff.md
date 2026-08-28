# Handoff — Privacy Class Check-in repair

Completed 2026-08-28 for work order `privacy-class-checkin-repair-1`.

## Result

The three independent-verifier release blockers in `.factory/verification-1.md` are repaired and deployed. Repair commit: `568bf6d95e6a00ec34d70d1edaac01509bf03bcb`; image: `sociobotregistry.azurecr.io/sf-privacy-class-checkin:568bf6d95e6a`; public URL: <https://privacy-class-checkin.sociobot.in>.

- `/health` now returns `{"buildSha":"568bf6d95e6a00ec34d70d1edaac01509bf03bcb","status":"ok"}`.
- The Docker `BUILD_SHA` build argument is carried into the runtime health response and the Vite-generated worker. The deployed worker declares `pcc-shell-568bf6d95e6a00ec34d70d1edaac01509bf03bcb`, so each release invalidates the prior `pcc-shell-*` cache.
- The Rust response-policy middleware returns `no-store` for `/api/*` and `/health`, `no-cache` for HTML fallbacks, manifest, and `/sw.js`, and `public, max-age=31536000, immutable` for Vite-hashed `/assets/*` files. Live checks confirmed all three policies.
- The generated worker precaches the four app routes, hero art, and the exact hashed JS/CSS files for its release; it deletes only prior `pcc-shell-*` caches during activation. Live desktop and 390 px mobile checks confirmed service-worker control and successful offline reload.

The researched brief, UI, privacy posture, routes, data model, and working teacher/learner behavior are unchanged.

## Regression coverage added

- Rust integration regression: exact health SHA plus API/HTML/worker/hashed-asset cache policy headers.
- Release-output test: a `BUILD_SHA=qa-regression` frontend build must emit a versioned worker and precache every hashed shell file.
- Playwright desktop and 390 px regression: exact `/health` SHA, API no-store, immutable module cache policy, revalidating worker, and generated worker cache name.

## Verification evidence

- Clean install: `npm ci` completed; `npm audit` reported 0 vulnerabilities.
- `npm test`: passed — TypeScript strict check, 3 Vitest tests, 5 Rust unit/integration tests, then the release-output cache test.
- `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings`: passed.
- `npm run build`: passed; output is `dist/index.html`. Initial JS is 33.47 KB raw / 11.16 KB gzip, CSS 9.85 KB raw / 3.12 KB gzip, and the hero WebP is 95.9 KB.
- `npm run build:server`: passed optimized Rust build.
- `npm run test:e2e`: 8/8 passed across Chromium desktop and 390 × 844 mobile, including the original teacher/learner encrypted-export flow, keyboard-capable teacher controls, legal routes, Axe serious/critical checks, and the new release/cache assertions.
- ACR container build `ch8w`: succeeded from the committed source with `--build-arg BUILD_SHA=568bf6d95e6a00ec34d70d1edaac01509bf03bcb`; deployment used that exact prebuilt image through `/opt/fleet/lib/deploy-container.sh`.
- Live response policy: HTML `no-cache`; `/assets/index-BRLrQH3F.js` `public, max-age=31536000, immutable`; `/sw.js` `no-cache`; `/api/classes` (405) `no-store`; live health SHA matches the repair commit.
- `/opt/fleet/lib/verify-url.sh` passed: HTTPS 200, 615 ms local network-idle load, title/lang/one h1/main/image alt checks, and no console/page errors. Its simple unlabeled-button heuristic sees one intentionally hidden control in a closed disclosure; live Axe found zero serious or critical violations.
- Live Playwright desktop and mobile: no console errors, zero serious/critical Axe findings, visible 3 px skip-link focus, no horizontal overflow at 390 px, service-worker control, and offline reload retained title, one h1, and main landmark.
- Privacy live smoke: initial resource requests were same-origin only (3 resources); CSP, no-referrer, nosniff, DENY frame, and denied camera/microphone/geolocation headers remain present. No analytics, third-party font/script, location, camera, or microphone request was made.
- Live mobile Lighthouse report: Performance 100, Accessibility 100, Best Practices 100, SEO 92; LCP 0.2 s, CLS 0, TBT 0 ms. Chrome emitted a post-report BFCache tab-crash warning, but the completed JSON report was written successfully.
- Live load smoke: 100 concurrent `/health` requests, 100 HTTP 200 responses in about 2.7 seconds.

## Run and deploy

```sh
npm ci
npm test
npm run test:e2e
npm run build
npm run build:server
docker build --build-arg BUILD_SHA="$(git rev-parse HEAD)" -t privacy-class-checkin .
```

The root Dockerfile remains the artifact and deployment class: Vite frontend plus Rust/axum and SQLite in one non-root container on port 8080. Set a persistent `/app/data` mount, a stable high-entropy `EXPORT_SIGNING_KEY`, and the immutable `BUILD_SHA` build argument in any production deployment.

## Known gaps / next steps

- Docker is not installed in this worker, so the local Docker command was not run. The cloud ACR build succeeded using the same Dockerfile; local frontend and optimized Rust stages also passed independently.
- The current factory container-app template supplies only `PORT`; before accepting durable classroom data, the factory must add a persistent `/app/data` mount and stable `EXPORT_SIGNING_KEY`. Without them, SQLite data and export-signing continuity do not survive a container replacement.
- The factory still needs to register the production/test billing product before Sociobot checkout can complete.
- The in-process check-in limiter resets on restart and is global to this small single-tenant service. Add edge rate limiting for broader multi-tenant use.
- A device and token check-in is intentionally not proof of identity or physical presence; this limitation remains explicit in the product, privacy notice, terms, and README.
