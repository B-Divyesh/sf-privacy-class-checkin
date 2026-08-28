# Independent verification 3 — PASS

Verified 2026-08-28 for work order `privacy-class-checkin-verify-3`.

- Candidate and `origin/main`: `49fd324e7dbde032f262f15e2d444321bc31a957`
- Public URL: <https://privacy-class-checkin.sociobot.in>
- Product source was not changed. This report and the handoff are the only changes.

## Verdict

**PASS.** The candidate fulfils the brief's smallest useful product: a teacher can create a pseudonymous class, start a rotating-code session, receive an idempotent learner check-in, make manual marks, export a signed CSV for browser-side encryption, and delete retained data. It explicitly does not claim identity or physical-presence proof and makes no location, biometric, account, or tracking requests.

The deployment-only blockers in verification 2 no longer reproduce. The public backend is coherent and identifies itself as this exact candidate.

## Clean-checkout quality gates

- `npm ci` passed (55 packages installed; `npm audit` reported 0 vulnerabilities).
- `npm test` passed: TypeScript `--noEmit`, 3 Vitest tests, 6 Rust tests, and the release-cache output test. Rust coverage includes complete class/session/check-in/export/delete, token normalization, CSV formula escaping, cache policy, and persisted generated signing keys.
- `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings` passed. There is no separate lint script.
- `npm run build` passed and produced `dist/`; `npm run build:server` passed and produced the optimized server binary.
- `npm run test:e2e` passed **8/8** in desktop Chromium and 390 x 844 mobile: release/cache policy, teacher-to-learner check-in, encrypted signed export and browser verification, legal routes, and axe serious/critical checks.
- Docker is unavailable in this verifier container, so the Docker wrapper itself could not be run locally. The exact frontend/server production stages passed, and the public image serves byte-identical candidate output.

## Functional and backend evidence

Public API probe created a three-pseudonym class, started a session, submitted a valid check-in, applied a manual Late mark, downloaded a signed export, closed the session, and permanently deleted the class.

- Invalid class name, empty or 61-entry roster, and retention `0`: each returned 400 with a specific recovery message.
- Missing teacher key: 401; invalid session parameters/current-session collision: 400/409; malformed code: 400; wrong roster token: 401; post-close check-in: 404.
- Twenty concurrent submissions of the same valid learner token produced 20 HTTP 200 results: exactly 1 `recorded:true`, 19 idempotent `recorded:false`.
- Thirty concurrent authenticated reads of the newly created class returned **30/30 HTTP 200**, followed by 404 after deletion. This re-tests the former split-persistence release blocker.
- Export had a valid Ed25519 signed-export envelope and CSV injection protection (a pseudonym beginning `=formula` was exported as text).
- An isolated release-binary boot with no configured key generated a mode-`0600` sibling key file; after restart it logged `signing_key_source: persisted` and produced the same public signing key. No secret value was logged.

## Deployment identity and parity

- Ten independent `GET /health` responses returned `{"buildSha":"49fd324e7dbde032f262f15e2d444321bc31a957","status":"ok"}`.
- Public `/sw.js` declares `pcc-shell-49fd324e7dbde032f262f15e2d444321bc31a957`.
- Local candidate production output exactly matched public SHA-256 values:
  - JS `eca8b16c610420f65dcffe7f53717de5806681cf8986e91eb9fee236bedbd4c6`
  - CSS `3219779ef1f3926fb5860e63e6d4cef7d7329cee9e761f187f9218f4c7239c97`
  - hero WebP `591897e0a4d7865ff15635122000718af93f8dc47c033a8a8b77897174b00048`
  - worker `16d52dda49d970f4185185a11df04dfa64fe55acb1fbd7137081ecda787501d8`

## Browser, accessibility, privacy, and performance

- Live desktop: `lang=en`, one h1, one main landmark, no serious/critical axe violations. Keyboard Tab reaches the skip link with a visible 3 px focus ring. `prefers-reduced-motion` reduces button transitions to `0s`.
- Live 390 px privacy page: one h1, 16 px body text, no horizontal overflow (`scrollWidth=clientWidth=390`), no console errors, and zero serious/critical axe violations.
- After service-worker warm-up, the live page was controlled by `/sw.js`; an offline reload retained an h1 with no console errors.
- Fresh live navigation made same-origin initial requests only. There are no third-party fonts, analytics, tracker, camera, microphone, geolocation, biometric, or device-fingerprint requests. CSP permits self plus only the documented Sociobot billing API connection; permissions policy denies camera/microphone/geolocation. `nosniff`, `DENY` framing, and `no-referrer` are present.
- Cache policy: API/health `no-store`; document, manifest, and worker `no-cache`; hashed JS/CSS `public, max-age=31536000, immutable`. The un-hashed 95,928 B hero is `no-cache`, which is non-blocking but less cache-efficient than a hashed asset.
- Budget: JS 33,467 B raw / 11,033 B gzip; CSS 9,853 B raw / 3,131 B gzip; hero 95,928 B. All are within the stated budgets.
- Lighthouse 13 was attempted twice with the preinstalled Chromium. The collector could not complete in this root container (`Unable to connect to Chrome`, then tab crash), so no numeric Lighthouse score is claimed. Playwright axe, responsive, console, offline, and bundle checks above completed.

## Defects by severity

No release-blocking, high, medium, or low product defects found.

Non-blocking verifier-environment limitations: Docker CLI is unavailable and standalone Lighthouse Chromium crashes. Neither obscures the deployed candidate identity or its byte-level artifact parity.
