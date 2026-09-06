# Review 2 — Record class attendance without tracking

Reviewed 2026-09-06 for work order `privacy-class-checkin-review-2` at <https://privacy-class-checkin.sociobot.in>.

## Verdict: PASS

**PASS — zero findings and zero untested public claims.** A teacher can create a pseudonymous class, run a rotating-code session, receive a learner check-in, make a manual correction, export a signed record for browser-side encryption, and delete the class. The live product makes its limit clear: a check-in is not proof of identity or physical presence.

The implementation reviewed is `beb3a9414ddd1269fc5eda4957ca842eeb92f5aa`. The checkout and documentation baseline is `1ff02e428ea3032269e1c7b443b6540efa724877`. The intervening changes are only `.factory/handoff.md` and `.factory/verification-4.md`; application source is unchanged. Live `/health` reports `4171d0e0a2fe467b1a10e20e286792cce6e51d7b`, the previous documentation-build SHA, also with application source unchanged from the implementation candidate.

## First screen before scrolling

Fresh desktop and 390 × 844 phone browsers showed:

- Job: **Record class attendance without tracking**.
- Audience: teachers running small classes.
- First action: **Try it with sample data**. The adjacent text says it opens a filled 30-learner class and saves nothing.

All three facts were visible on the phone before scrolling: no names, location, biometrics, or analytics; saved pages reopen offline while live check-ins need a connection; core check-in is free and printable cards cost $29 once. The fact list ended at 777 CSS px in the 844 px viewport. Desktop and phone first-screen evidence is in `/work/.evidence/review-2/`.

## Fresh checkout and declared claims

A new no-local clone of this repository at `1ff02e428ea3032269e1c7b443b6540efa724877` was created, then `npm ci` completed with 0 reported vulnerabilities. These quality commands passed:

```sh
npm test
npm run build
npm run build:server
cargo fmt --check
cargo clippy --all-targets -- -D warnings
npm run test:e2e
```

`npm test` passed TypeScript, 3 Vitest tests, and 13 Rust tests. The production build produced `dist/`; its initial JavaScript is 39,436 bytes raw and CSS is 10,917 bytes raw. The complete browser suite passed **25 tests**, with **1 intentional phone-project skip**.

All exact commands declared in `.factory/claims.json` were run independently and passed. Therefore **15/15 passed, 0 failed, 0 untested**:

| Claim | Result |
| --- | --- |
| demo-sandbox | Passed |
| class-checkin | Passed |
| data-minimization | Passed |
| one-way-credentials | Passed |
| rotating-code | Passed |
| encrypted-export | Passed |
| signed-export | Passed |
| manual-correction | Passed |
| retention-delete | Passed |
| offline-shell | Passed |
| cache-policy | Passed |
| paid-license | Passed |
| tenant-isolation | Passed |
| rate-limit | Passed |
| restart-persistence | Passed |

Command logs are retained in `/work/.evidence/review-2/claim-*.log`; the clean quality-command logs are alongside them.

## Live checks

- The one-click `/demo` sandbox had 30 populated realistic learner rows and 22 present entries. The persistent **Demo — sample data, nothing is saved** label survived reload. A sample check-in, keyboard status correction, and **Reset demo** worked; reset produced a new workspace. The demo made same-origin requests only.
- A temporary live class completed start `201`, session detail `200`, invalid-token check-in `401`, valid check-in `200`, close `200`, and post-close check-in `404`. The two temporary classes were deleted with `200` responses.
- A second class key received `401` against the first class. Forty authenticated reads of the first class, sent with `Connection: close`, were all `200`.
- One forwarded client received 30 validation `422` responses and then 8 `429` responses, each with `Retry-After: 9`. A different forwarded client retained its normal `422` response.
- `/health` returned `200`, `no-store`, and the live build identity above. The file-backed persistence and generated signing-identity restart claim passed in the fresh checkout.
- `/`, `/demo`, `/privacy`, `/terms`, `/open-export`, `/robots.txt`, and `/sitemap.xml` returned `200` with expected content types and cache policy. The designed unknown route returned HTTP `404`, with its own title, h1, main landmark, and zero serious or critical axe findings. That deliberate 404 is expected, not a defect.
- Each public page had `lang="en"`, its required route title, exactly one h1, and a main landmark. Axe found zero serious or critical violations on all five public routes and the 404 page. Valid public routes had no console or page errors. The browser logs an expected failed-resource message when deliberately loading the 404 response; it was classified as expected behavior.
- Keyboard Tab first reached the skip link with a 3 px focus outline. In reduced-motion mode, scroll behavior was `auto` and button transitions were `0s`. The phone page had no horizontal overflow.
- After a service-worker warm-up, `/privacy` reopened offline and displayed its offline notice. Demo request capture found only `https://privacy-class-checkin.sociobot.in`; response policy denied camera, microphone, and geolocation.

Live evidence is retained in `/work/.evidence/review-2/live-api.json`, `live-accessibility.json`, and the desktop/phone screenshots. No production roster identifiers, teacher keys, learner tokens, or credentials are recorded.

## Earlier findings

| Earlier finding | Current disposition |
| --- | --- |
| Split backend state | Fixed. 40/40 authenticated live reads returned 200; both temporary verification classes were deleted. |
| Missing or unsafe demo | Fixed. The isolated one-click demo is populated, labelled, reload-persistent, resettable, and confined to its sample workspace. |
| Missing per-client rate limits / Retry-After | Fixed. Live limits used the forwarded client address and returned 429 with Retry-After without affecting another client. |
| SQLite/signing state outside durable storage | Fixed. The declared file-backed restart-persistence claim passed; the Dockerfile uses `/data`. |
| Broken checkout link | Fixed honestly. Checkout is not offered while registration is pending; this is not presented as a purchasable path. |
| Missing claim inventory or untested claims | Fixed. Every one of the 15 declared commands passed from a clean checkout. |
| First-screen and metaphor copy | Fixed. The job, audience, sample action, and three facts are direct and visible before scroll. |
| Missing route metadata, legal routes, and designed 404 | Fixed. The public/legal/export routes and deliberate 404 passed live checks. |
| Pinned Rust image | Fixed. The Dockerfile uses `rust:1-slim`. |
| Small phone home target | Fixed. Phone E2E and live layout checks passed. |
| Unhashed hero cache policy | Fixed. The built hero is fingerprinted (`botanical-checkin-hero-D1OmLLWf.webp`). |

## Evidence

The evidence directory is `/work/.evidence/review-2/`. This report is copied to `/work/.evidence/qa-report.md`; the matching machine result is `/work/.evidence/qa-result.json`.
