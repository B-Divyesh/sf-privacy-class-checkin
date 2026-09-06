# Privacy Class Check-in

Privacy Class Check-in helps a teacher record attendance with rotating codes and pseudonymous roster tokens. It does not ask learners for names, accounts, location, biometrics, camera access, or microphone access.

A check-in shows that someone used a current code and valid token. It does not prove identity or physical presence.

Try the isolated sample at <https://privacy-class-checkin.sociobot.in/demo>. It opens a filled 30-learner class without writing to the real SQLite database.

## What teachers can do

- Create a class with 1–60 pseudonyms and choose a retention period.
- Issue one-time readable roster tokens and save a private recovery link.
- Start a session with a rotating six-digit code.
- Make keyboard-accessible present, late, or absent corrections.
- Download an Ed25519-signed CSV encrypted in the browser.
- Delete a class and its related records immediately.

The free core includes check-in, correction, export, deletion, and accessibility features. A $29 one-time license adds printable token cards. Billing registration is pending, so checkout is not currently available. Existing license holders can restore a token in the app.

## Run locally

Requirements: Node 22 or later, the current stable Rust toolchain, and SQLite runtime support.

```sh
npm ci
npm run build
cargo run
```

Open <http://localhost:8080>. The server starts with no required environment variables. It uses `/data/checkin.db` when `/data` exists. Otherwise, it creates a `data` directory beside the server binary.

For frontend hot reload, run `npm run dev` in another terminal. Vite proxies `/api` and `/health` to port 8080.

Optional configuration:

- `PORT` — HTTP port; default `8080`.
- `DATABASE_URL` — overrides the SQLite file URL.
- `EXPORT_SIGNING_KEY` — overrides the generated, persisted export-signing secret.
- `BUILD_SHA` — release identity returned by `/health`.
- `DIST_DIR` — built frontend directory; default `dist`.

## Test and build

From a clean checkout:

```sh
npm ci
npm test
npm run build
npm run build:server
npm run test:e2e
cargo fmt --check
cargo clippy --all-targets -- -D warnings
```

Public claims and their exact commands are listed in [`.factory/claims.json`](.factory/claims.json). Run the complete browser claim suite with:

```sh
npm run test:claims
```

The backend claim checks are included in `npm test`. The browser suite covers desktop Chromium, a 390×844 phone viewport, the demo, legal routes, keyboard use, offline reload, exports, and automated accessibility checks.

For a 100-request local allowance smoke test:

```sh
seq 1 100 | xargs -P20 -I{} curl -sS -o /dev/null -w '%{http_code}\n' \
  -H 'content-type: application/json' -H 'x-forwarded-for: 198.51.100.20' \
  -d '{}' http://127.0.0.1:8080/api/classes
```

The result includes `429` responses with `Retry-After`. A different forwarded client address retains its own allowance.

## Privacy and storage

Teacher keys and roster tokens are stored as SHA-256 hashes. Readable copies are returned only during setup and remain in the teacher's browser if saved there. The server stores the class label, pseudonyms, session times, attendance marks, and correction source.

The browser encrypts the default export with AES-256-GCM. It derives the key with PBKDF2-SHA256 and 210,000 rounds. The export and passphrase stay in the browser. Public pages work after a service-worker warm-up; live API actions require a connection.

See `/privacy` and `/terms` for the user-facing policies. There are no analytics, third-party scripts, or remote fonts.

## Deploy

The factory builds the root `Dockerfile`. The image runs as UID 10001 on `PORT`, defaults to `/data/checkin.db`, and persists its generated signing key beside that database. Deploy exactly one replica with the fleet-managed `/data` volume. Do not use ephemeral multi-replica storage for SQLite.

Pass the source commit as `BUILD_SHA`. `/health` returns that identity. Fingerprinted assets use a one-year immutable cache; pages, the manifest, and the service worker revalidate.

The canonical production URL is <https://privacy-class-checkin.sociobot.in>.

MIT licensed. See [LICENSE](LICENSE).
