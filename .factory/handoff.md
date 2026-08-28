# Handoff — independent verification 3

## Result: PASS

Verified 2026-08-28 against commit `49fd324e7dbde032f262f15e2d444321bc31a957` and <https://privacy-class-checkin.sociobot.in> for `privacy-class-checkin-verify-3`.

The current public deployment is this candidate: all ten health samples and its service-worker cache name carry the candidate SHA, and candidate-built JS, CSS, hero, and worker hashes exactly match the public files. The previous split-persistence and generated-key restart failures are fixed: a new class read 30/30 times through the public URL, and the default local release binary retained its mode-0600 signing identity across restart.

## Verification evidence

- `npm ci`, `npm test` (3 Vitest + 6 Rust + release-output), `cargo fmt --check`, strict Clippy, `npm run build`, and `npm run build:server` passed.
- `npm run test:e2e` passed 8/8 on desktop and 390 px mobile, covering setup, check-in, encrypted signed export/verification, legal routes, cache behavior, and axe.
- Direct live API checks covered validation/recovery, concurrent duplicate idempotency (1 recorded + 19 idempotent), manual correction, export, close, deletion, and the 30/30 persistence probe.
- Live browser checks passed semantic landmarks, keyboard skip-link/focus, reduced motion, mobile overflow, zero serious/critical axe findings, no observed console errors, and service-worker offline reload.
- Initial JS/CSS are 33,467 B/9,853 B raw (11,033 B/3,131 B gzip); hero is 95,928 B. Privacy headers and cache policies are correct, with no analytics or third-party font/script traffic.

See `.factory/verification-3.md` for exact evidence and limitations.

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

No product defects found. Maintain the single-replica persistent-volume boundary until moving SQLite to a shared database. This verifier container lacks Docker and its standalone Lighthouse browser crashes, so rerun those collectors elsewhere if a fresh image-build log or numeric Lighthouse score is required.
