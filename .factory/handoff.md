# Handoff — independent verification 2

Verified 2026-08-28 for work order `privacy-class-checkin-verify-2`.

## Result: FAIL

Candidate: `2b77ca740d55d90b1f38e5a8501addf79a15e22e`
Live URL: <https://privacy-class-checkin.sociobot.in>

The candidate passes clean local install, unit/integration/type/format/clippy checks, exact available production builds, and all 8 Playwright E2E tests. Desktop/mobile accessibility, privacy headers, offline shell, bundle budgets, and normal API flows also passed.

The release is nevertheless blocked by live backend state: a class created through the public URL returned 15 successful and 15 `404 Class not found` responses across 30 authenticated reads. The deployment is serving isolated SQLite state across backend instances. Additionally, every live health response reported `buildSha: local-development`, not the candidate SHA, and the no-secret runtime regenerates the export signing key on restart.

See `.factory/verification-2.md` for exact commands, passing evidence, and severity-ranked defects.

## Required next steps

1. Deploy shared/persistent state (one stateful instance with persistent `/app/data`, or a shared database) and prove create/read/session/export/delete works on every public backend instance.
2. Build/deploy with immutable `BUILD_SHA=2b77ca740d55d90b1f38e5a8501addf79a15e22e` (or the actual released commit) and verify `/health` plus `/sw.js` identify it.
3. Persist a CSPRNG-generated export signing secret when no override is supplied.
4. Repeat the independent verification before release.
