# Privacy Class Check-in (`privacy-class-checkin`) — factory product contract

This repository is one product built by the Param Factory. It ships at
`https://privacy-class-checkin.sociobot.in`. Artifact class: `web-with-backend`.
Read `.factory/brief.json` (the researched opportunity) and `.factory/design.md`
(the visual thesis) if present; they are the source of truth for scope and look.

## Definition of done (a worker may not claim completion without all of these)

1. **Works end to end for the real job-to-be-done** described in the brief — not a demo. Empty states, errors, keyboard, mobile.
2. **Unique, product-specific visual system** recorded in `.factory/design.md`: palette, type, spacing, motion policy, and why it fits *this* product. No default framework look, no generic gradient hero. Original assets only (generated or hand-made), with provenance noted.
3. **Quality gates pass locally**: `npm test` (or the stack's equivalent) exists and passes; `npm run build` produces `dist/`; no console errors on load; Lighthouse-class basics: `<title>`, `lang`, one `<h1>`, `<main>`, alt text, focus states, contrast ≥ 4.5:1, reduced-motion respected; first load ≤ 200 KB JS for static products.
4. **Privacy by default**: no analytics/tracking beyond a privacy-respecting page view; local-first storage where the brief allows; no third-party fonts/scripts loaded from CDNs (self-host).
5. **Docs**: `README.md` says what it is, who it's for, how to run/test/deploy; `LICENSE` (MIT unless brief says otherwise); `/privacy` and `/terms` pages for anything that stores user data or takes payment.
6. **Handoff**: `.factory/handoff.md` — what was done, how verified, known gaps, next steps.

## Working rules

- Keep the stack boring and fast: Vite + vanilla TS or Svelte/Preact for static; Rust (axum) or Node (Hono) for backends; SQLite/PostgreSQL for data. No paid third-party services.
- Commit small, often, with clear messages. Never commit secrets. Never touch infra, DNS, or billing from this repo — the factory does deployment.
- Paid features integrate only through the Sociobot billing API (`https://api.sociobot.in/api/v1/...`, Dodo-backed); never embed a payment provider directly.
- If the brief is impossible or harmful as written, build the closest honest, useful version and explain the deviation in the handoff.
