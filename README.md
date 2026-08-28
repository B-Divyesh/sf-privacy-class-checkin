# Privacy Class Check-in

A deliberately minimal classroom attendance signal for teachers who do not want biometrics, location tracking, student accounts, or a surveillance product. Teachers issue pseudonymous one-time roster tokens, show a rotating session code, make accessible manual corrections, and download a signed CSV encrypted locally in the browser.

It is intended for small classes. A check-in shows that someone had a current code and valid token; it is **not proof of identity or physical presence**.

## What is included

- Rust/axum service and SQLite persistence, with token/key hashing and automatic retention cleanup
- Fast Vite + TypeScript frontend for learner and teacher flows
- 90-second rotating session codes and explicit present/late/absent status
- Manual keyboard-friendly fallback and Ed25519-signed CSV exports
- Browser-side AES-256-GCM export encryption (PBKDF2-SHA256, 210,000 rounds), plus a local-only decrypt-and-verify tool
- Optional $29 one-time Sociobot license for printable token cards; all core and accessibility features are free
- Offline shell notice, privacy and terms pages, responsive 390 px layout

## Develop

Requirements: Node 22+, Rust 1.88+, and SQLite runtime support.

```sh
npm ci
npm run build
DATABASE_URL='sqlite://data/checkin.db?mode=rwc' EXPORT_SIGNING_KEY='development-only-key' cargo run
```

Open `http://localhost:8080`. For frontend hot reload, run `npm run dev` in a second terminal; Vite proxies `/api` to port 8080.

Configuration is environment-only:

- `PORT` — HTTP port, default `8080`
- `DATABASE_URL` — SQLite URL, default `sqlite://data/checkin.db?mode=rwc`
- `EXPORT_SIGNING_KEY` — stable private input used to derive the Ed25519 export key; set a long deployment secret
- `BUILD_SHA` — returned by `/health`
- `DIST_DIR` — built frontend location, default `dist`

## Test and build

```sh
npm test             # frontend unit + Rust unit/integration tests
npm run build        # reproducible frontend output in dist/
npm run test:e2e     # Chromium desktop + mobile flow
docker build --build-arg BUILD_SHA="$(git rev-parse HEAD)" -t privacy-class-checkin .
docker run --rm -p 8080:8080 -e EXPORT_SIGNING_KEY='replace-me' -v checkin-data:/app/data privacy-class-checkin
```

The container runs as UID 10001, exposes port 8080, serves frontend and API from one origin, and stores SQLite data under `/app/data`.

## Privacy and security notes

No analytics, third-party scripts, remote fonts, location, biometrics, or device fingerprints are used. Roster tokens and teacher keys are stored only as SHA-256 hashes server-side; readable copies exist only in the teacher's browser. Check-in attempts are bounded, request bodies are limited, and same-origin security headers deny camera, microphone, geolocation, framing, and foreign scripts. See `/privacy` and `/terms` in the app for the user-facing policies.

## Deploy

The factory deploys the root `Dockerfile`. Provide persistent `/app/data`, a stable `EXPORT_SIGNING_KEY`, and the immutable commit as Docker build argument `BUILD_SHA`; it is returned by `/health` and versions the offline shell cache. Hashed `/assets/*` responses are immutable for one year, while HTML, the manifest, and `/sw.js` revalidate on each request. Do not place a CDN in front of `/api` that caches responses. The canonical URL is <https://privacy-class-checkin.sociobot.in>.

MIT licensed. See [LICENSE](LICENSE).
