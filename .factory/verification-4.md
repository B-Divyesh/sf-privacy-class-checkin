# Independent verification 4 — Record class attendance without tracking

Verified 2026-09-06 for work order `privacy-class-checkin-verify-4` at <https://privacy-class-checkin.sociobot.in>.

## Verdict: PASS

**PASS — zero findings and zero untested public claims.** The real job works: a teacher can create a pseudonymous class, run a rotating-code session, receive a learner check-in, correct a status, export a signed record for browser-side encryption, and delete the class. The page clearly says that a check-in is not proof of identity or physical presence.

The implementation reviewed is `beb3a9414ddd1269fc5eda4957ca842eeb92f5aa`. The documentation commit is `4171d0e0a2fe467b1a10e20e286792cce6e51d7b`. The only difference between them is `.factory/handoff.md`; application source is identical. Live `/health` identifies the documentation-build SHA `4171d0e0a2fe467b1a10e20e286792cce6e51d7b`. Building the implementation-identical source with that `BUILD_SHA` reproduced the live JavaScript and worker byte-for-byte.

## First screen

Before scrolling in fresh desktop and 390 × 844 phone contexts:

- Job: **Record class attendance without tracking**.
- Audience: teachers running small classes.
- First action: **Try it with sample data**; the adjacent text says it opens a filled 30-learner class and saves nothing.

The three facts are visible before scrolling on the phone (fact list ends at 777 CSS px in an 844 px viewport): no names/location/biometrics/analytics, saved pages reopen offline while live check-ins need a connection, and core check-in is free while printable cards cost $29 once.

## Fresh-checkout quality gates

A new clone of the repository at `4171d0e0a2fe467b1a10e20e286792cce6e51d7b` was used. `npm ci` completed with 0 reported vulnerabilities.

- `npm test`: passed — TypeScript, 3 Vitest tests, and 13 Rust tests.
- `npm run build`: passed and produced `dist/` (39.43 KB JavaScript raw / 12.13 KB gzip; 10.91 KB CSS raw / 3.40 KB gzip; 95.92 KB hero).
- `npm run build:server`: passed.
- `cargo fmt --check`: passed.
- `cargo clippy --all-targets -- -D warnings`: passed.
- `npm run test:e2e`: passed — 25 passed, 1 intentional phone-only-project skip.

Every command declared in `.factory/claims.json` was run separately and passed: 8 browser demo claims, 6 Rust backend/persistence claims, and the encryption unit claim. Therefore: **15/15 claims passed; 0 failed; 0 untested.**

## Live product checks

- Fresh desktop and phone pages had `lang="en"`, a title, one `h1`, a `main` landmark, no page or console errors, and no phone horizontal overflow. The phone first screen met the content requirement above.
- The one-click `/demo` sample showed 30 realistic roster rows and 22 present entries. Its persistent `Demo — sample data, nothing is saved` label remained through reload; reset changed the workspace ID; real-data browser keys were absent. The demo's observed requests were same-origin only.
- The product flow passed against the live backend: create `201`, start session `201`, session detail `200`, valid check-in `200`, manual correction `200`, close `200`, deleted class `200`, then a read returned `404` as expected. Invalid input returned `400`, a wrong token `401`, and a closed-session check-in `404`. In a fresh live phone demo, a roster status changed with the keyboard and showed `Sample status changed.`.
- Tenant isolation passed: a second class's teacher key received `401` for the first class. Forty authenticated fresh reads of the first class returned 40 × `200`.
- Live request allowance passed: one forwarded client received 30 validation responses then 8 × `429`, every limited response had `Retry-After: 9`; another forwarded client still received its normal `422` validation response.
- Restart persistence is covered by the independently run declared file-backed database/signing-identity claim, which passed. The prior live restart result recorded in the handoff was inspected; no persistence regression is indicated.
- Public routes `/`, `/demo`, `/privacy`, `/terms`, and `/open-export` each had their required route title, one `h1`, and a main landmark. A warmed service-worker-controlled phone context reopened `/privacy` offline and showed its offline notice. Reduced motion set scroll behavior to `auto`.
- The designed unknown route returned HTTP `404` with the expected title, heading, and route home. This deliberate 404 is not a defect. All discovered same-origin links returned `200`; the remaining links are the disclosed source link and `mailto:` privacy contact.
- Playwright axe found zero serious or critical violations on the live desktop and phone demo checks. The browser flow and all valid public routes had no console errors.
- Live headers include CSP, `nosniff`, `DENY` framing, no-referrer policy, and camera/microphone/geolocation denial. No third-party request, remote font, analytics request, or media/location permission request was observed in the demo flow.
- Live health returned `200` with `Cache-Control: no-store`. Fingerprinted live JavaScript and the worker matched a local production build made from the reviewed application source with the live documentation SHA supplied as `BUILD_SHA`.

## Earlier finding disposition

| Earlier finding | Current disposition |
| --- | --- |
| Split backend state | Fixed: 40/40 live authenticated reads returned 200; the temporary class was deleted. |
| Missing demo sandbox | Fixed: `/demo` is populated, labelled, reload-persistent, resettable, and isolated from real browser data. |
| Missing per-client limits / Retry-After | Fixed: live allowance returned 429 and Retry-After, without blocking another forwarded client. |
| SQLite/signing state outside durable storage | Fixed by the file-backed persistence claim and the prior live restart evidence. |
| Broken checkout link | Disclosed correctly: registration is pending and checkout is not offered. This external registration dependency is not presented as an available purchase path. |
| Undeclared or untested claims | Fixed: all 15 declared commands passed independently. |
| First-screen / metaphor copy | Fixed: job, teacher audience, sample action, and three facts are visible before scrolling; current copy is direct. |
| Missing routes, metadata, and designed 404 | Fixed: tested on live routes and deliberate HTTP 404. |
| Pinned Rust image | Fixed in the reviewed Dockerfile (`rust:1-slim`). |
| Small phone wordmark target | Fixed by the passing phone E2E target check. |
| Unhashed hero cache policy | Fixed: the reviewed build emits the hero as `botanical-checkin-hero-D1OmLLWf.webp`; live assets are fingerprinted. |

## Evidence

Screenshots: `/work/.evidence/verification-4-live-desktop.png` and `/work/.evidence/verification-4-live-phone.png`.

No production roster identifiers, teacher keys, learner tokens, or credentials are recorded. All real classes created for this verification were deleted.
