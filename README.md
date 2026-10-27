# Korean Flashcards

A Quizlet-style flashcard app for studying Korean with spaced repetition. It's a
**Progressive Web App**: it runs in any browser, installs to an iPhone home screen
and opens full-screen, and works fully offline. A small FastAPI backend syncs decks
and progress between your devices. It's single-user: one password, no accounts.

```
frontend/   Vite + React + TypeScript + Tailwind PWA (Dexie/IndexedDB, offline-first)
backend/    FastAPI + SQLAlchemy 2 + Alembic (Postgres in prod, SQLite for dev)
docker-compose.yml   backend + Postgres for local development
render.yaml          optional Render blueprint for the backend
.github/workflows/   optional GitHub Pages deploy for the frontend
```

## How it works

- **Spaced repetition** ([`frontend/src/lib/scheduler.ts`](frontend/src/lib/scheduler.ts)) is a
  simplified SM-2, written as pure functions with unit tests. After each card you rate it
  **Again / Hard / Good / Easy**:
  - New cards go through short learning steps (1 min, 10 min) and are shown again later in the
    same session before they graduate to a 1-day interval. *Easy* skips straight to 4 days.
  - Review cards grow their interval: *Hard* ×1.2, *Good* ×ease, *Easy* ×ease×1.3. The ease
    factor starts at 2.5, drops by 0.15 on *Hard*, rises by 0.15 on *Easy*, and never goes below 1.3.
  - *Again* on a learned card counts a lapse, lowers ease by 0.2, and sends the card to
    relearning. It comes back 3 cards later in the session and stays until you get it right.
    (Again during *initial* learning just restarts the steps and doesn't count as a lapse,
    so brand-new words don't get flagged as "struggling" on their first day.)
  - Each session shows due cards first (most overdue, then lowest ease), then up to the
    deck's daily limit of new cards (default 20).
- **Offline-first.** All data lives in IndexedDB. Every change is written locally first and
  queued in an outbox. The sync engine pushes the outbox and pulls server changes when the
  app opens, every minute while it's visible, when the connection comes back, and shortly
  after each local change.
- **Conflicts** are resolved per record by last-write-wins on `updated_at`. Deletes are soft
  (`deleted_at`) so they sync like edits. Reviews are an append-only log, which also powers
  the stats. The pull cursor uses the server's clock, so a device with a wrong clock can't
  hide changes.
- **Korean text.** Everything is normalized to Unicode NFC before saving and when searching.
  Enter and keyboard shortcuts are ignored while the IME is composing a syllable (including
  Safari's `keyCode 229` quirk). The font is Noto Sans KR, cached by the service worker for
  offline use. Audio uses the Web Speech API (`ko-KR`), and the button is hidden if the device
  has no Korean voice.

---

## Local development

Prerequisites: **Node 20+**, **Python 3.12+**, and optionally Docker.

### 1. Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
cp .env.example .env
python scripts/hash_password.py    # type your password, paste the two lines it prints into .env
alembic upgrade head               # creates flashcards.db (SQLite)
python dev.py                      # http://localhost:8000  (docs at /docs)
```

**Or, with Postgres in Docker** (after creating `backend/.env` as above):

```bash
docker compose up --build
```

Compose runs Postgres and the API on port 8000 and applies migrations on start.
`DATABASE_URL` from `.env` is overridden to point at the compose database.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev                        # http://localhost:5173
```

The frontend calls `http://localhost:8000` by default. To use another API URL, create
`frontend/.env.local` with `VITE_API_URL=http://localhost:9000`.

Sign in with your password. On a brand-new account a sample deck, "Korean basics"
(16 beginner words), is added so you can try studying right away.

> **Testing on your phone over Wi-Fi:** run `npm run dev -- --host` and open
> `http://<your-computer-ip>:5173`. Set `VITE_API_URL=http://<your-computer-ip>:8000` and add
> that origin to `CORS_ORIGINS`. Service workers and home-screen install need HTTPS, so test
> those on the deployed site.

## Generating the password hash

```bash
cd backend
python scripts/hash_password.py
```

The script asks for the password twice (input is hidden) and prints:

```
APP_PASSWORD_HASH='$argon2id$v=19$m=65536,t=3,p=4$...'
JWT_SECRET='...random...'
```

Keep the **single quotes** in `.env` files so the `$` characters aren't treated as variables.
On hosting dashboards, paste the value *without* the quotes. bcrypt hashes (`$2b$...`) also work.
Only the hash is stored; the plain-text password never is.

Changing `JWT_SECRET` logs out every device. To change the password, generate a new hash and
redeploy. Existing logins stay valid until their tokens expire (90 days), so also rotate
`JWT_SECRET` if you want to force everyone to sign in again.

## Running tests

```bash
cd backend && pytest          # login, tokens, rate limiting, CORS, sync push/pull, conflicts, validation, migrations
cd frontend && npm test       # scheduler, session queue, sync/merge logic, import parsing, backups
```

## Environment variables

### Backend (`backend/.env`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `APP_PASSWORD_HASH` | yes | | argon2 or bcrypt hash of your password (see above) |
| `JWT_SECRET` | yes | | Random string, at least 32 characters |
| `JWT_EXPIRE_DAYS` | | `90` | How long a login lasts on a device |
| `DATABASE_URL` | | `sqlite:///./flashcards.db` | `postgres://` and `postgresql://` URLs are accepted as-is |
| `CORS_ORIGINS` | | `http://localhost:5173` | Comma-separated frontend origin(s), no trailing slash |
| `LOGIN_RATE_LIMIT` | | `5` | Login attempts allowed per IP per window |
| `LOGIN_RATE_WINDOW_SECONDS` | | `60` | Rate-limit window |
| `PORT` | | `8000` | Port in the Docker image (most hosts set this for you) |

### Frontend (build time)

| Variable | Default | Description |
|---|---|---|
| `VITE_API_URL` | `http://localhost:8000` | Backend URL, no trailing slash. Must be `https://` in production |
| `BASE_PATH` | `/` | Set when serving from a sub-path, e.g. `/korean-flashcards/` on GitHub Pages |

## Deployment

You need two things: the **backend container plus a Postgres database**, and the
**frontend as a static site on HTTPS**. Deploy the backend first so you have its URL.

### Quick deploy: this repo on Neon + Render + GitHub Pages

A concrete, free, start-to-finish walkthrough for `davyn1/flashcard-app`. You need your
GitHub account plus two free sign-ups (**Neon** and **Render** — no credit card). The
frontend's public URL will be **https://davyn1.github.io/flashcard-app/**, so its origin
(what the backend must allow for CORS) is `https://davyn1.github.io`.

1. **Password hash (local, one command).** Generate `APP_PASSWORD_HASH` as described under
   [Generating the password hash](#generating-the-password-hash). Keep the printed
   `APP_PASSWORD_HASH='...'` line handy — you'll paste it into Render in step 3. Your
   plain-text password never leaves your machine. (Ignore the `JWT_SECRET` line; Render
   generates that one.)
2. **Database — Neon.** Sign up at <https://neon.tech> ("Continue with GitHub" is quickest),
   create a project (any name, nearest region), and copy its **connection string** — it
   looks like `postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require`. This becomes
   `DATABASE_URL`.
3. **Backend — Render.** Sign up at <https://render.com>, then **New → Blueprint** and select
   this repo. Render reads [`render.yaml`](render.yaml) and prompts for the three variables
   marked `sync: false`:
   - `DATABASE_URL` — the Neon string from step 2
   - `APP_PASSWORD_HASH` — the hash from step 1, pasted **without** the surrounding quotes
   - `CORS_ORIGINS` — `https://davyn1.github.io`

   `JWT_SECRET` is generated for you. Click **Apply**, then wait for the first deploy to
   finish (a few minutes). Copy the service URL, e.g.
   `https://korean-flashcards-api.onrender.com`.
4. **Check the backend.** Open `<backend-url>/health` — it should return `{"ok":true}`.
   `<backend-url>/docs` shows the interactive API.
5. **Frontend — GitHub Pages.**
   - Repo **Settings → Pages → Source: GitHub Actions**.
   - Repo **Settings → Secrets and variables → Actions → Variables → New repository
     variable**: name `VITE_API_URL`, value your backend URL from step 3 (no trailing slash).
   - Build and publish: **Actions → "Deploy frontend to GitHub Pages" → Run workflow**
     (or push any change under `frontend/`). The workflow runs the tests, builds with the
     correct `BASE_PATH`, and deploys. [The workflow](.github/workflows/deploy-frontend.yml)
     reads `VITE_API_URL` at build time, so set the variable *before* running it.
6. **Open it.** Go to <https://davyn1.github.io/flashcard-app/> and sign in with your
   password. On first sign-in a sample "Korean basics" deck (16 words) is added so you can
   study right away.

> **Heads-up:** Render's free backend sleeps after ~15 min idle, so the first sync after a
> break takes ~30–50s to wake. The app is offline-first, so studying is never blocked — only
> that first reconnect is slow. If you outgrow it, the same frontend also works on **Vercel**
> (import the repo, set **Root Directory** to `frontend`, add `VITE_API_URL`).

The generic, host-agnostic options below cover the same three pieces in more detail.

### Database (Neon or Supabase, free tier)

Create a project and copy its connection string, for example
`postgresql://user:pass@ep-xyz.neon.tech/neondb?sslmode=require`. That string becomes
`DATABASE_URL`. Migrations run automatically every time the container starts.

### Backend (any container host)

The image is built from [`backend/Dockerfile`](backend/Dockerfile). It runs
`alembic upgrade head` and then uvicorn on `$PORT`.

- **Render:** New → Blueprint and select this repo (it uses [`render.yaml`](render.yaml)), or
  New → Web Service → Docker with root directory `backend`. Set `DATABASE_URL`,
  `APP_PASSWORD_HASH` and `CORS_ORIGINS` (`JWT_SECRET` is generated for you). Health check: `/health`.
- **Fly.io:** `cd backend && fly launch` (it detects the Dockerfile), then
  `fly secrets set DATABASE_URL=... APP_PASSWORD_HASH='...' JWT_SECRET=... CORS_ORIGINS=https://your-frontend`.
- **Railway / AWS App Runner:** point the service at `backend/Dockerfile` and set the same variables.

Set `CORS_ORIGINS` to your frontend's exact origin, e.g. `https://you.github.io` or
`https://flashcards.netlify.app`, with no path and no trailing slash.

> The login rate limiter is in memory, which is fine for a single instance. If you scale to
> several instances, each one keeps its own count.

### Frontend (static site, HTTPS)

Build with `VITE_API_URL` set to your backend URL:

- **Vercel:** import the repo, set **Root Directory** to `frontend` (Vite is auto-detected) and
  add the env var `VITE_API_URL`. [`frontend/vercel.json`](frontend/vercel.json) sets cache headers.
- **Netlify:** set **Base directory** to `frontend`. Build settings come from
  [`frontend/netlify.toml`](frontend/netlify.toml). Add `VITE_API_URL` under Environment variables.
- **GitHub Pages:** in Settings → Pages, set Source to **GitHub Actions**. Add a repository
  variable `VITE_API_URL` (Settings → Secrets and variables → Actions → Variables) and push to
  `main`. [The workflow](.github/workflows/deploy-frontend.yml) runs the tests, builds with the
  right `BASE_PATH`, and deploys.

The app uses hash URLs (`/#/deck/...`), so no server rewrite rules are needed on any host.
When you deploy a new version, open the app once and it updates itself in the background.

## Add it to your iPhone home screen

1. Open the deployed frontend URL in **Safari** (it must be Safari, and the site must be HTTPS).
2. Tap the **Share** button (the square with an arrow pointing up).
3. Scroll down and tap **Add to Home Screen**, then **Add**.
4. Open **Flashcards** from your home screen. It runs full-screen without Safari's address bar.
5. Sign in once. The login lasts 90 days on that device.

Studying works with no connection, and progress syncs the next time you're online. If your
login expires while you're offline, keep studying. The app asks for your password only when
it next tries to sync.

**Korean audio on iPhone:** iOS includes Korean voices. If the speaker button doesn't appear,
go to Settings → Accessibility → Spoken Content → Voices → Korean and download a voice.

## Using the app

- **Decks:** create from the home screen. Rename, change study direction, set new cards per
  day, turn on auto-play audio, or delete from the deck's ⚙ screen.
- **Study direction:** Korean → English, English → Korean, or both. With *both*, each direction
  is scheduled as its own card.
- **Creating cards:** open a deck and tap ➕ to add a card. The front is Korean, the back is
  English, and notes are for example sentences, grammar or romanization. In the editor, Enter
  moves from Korean to English, and Enter again saves and starts the next card, so you can add
  a run of cards without touching the mouse.
- **Importing data — bulk paste:** on a deck, choose **Import** and paste one card per line as
  `front<TAB>back` (copying from a spreadsheet gives tabs), `front - back`, comma, or a custom
  separator. A third column becomes the notes. Great for pasting a vocabulary list straight
  from a spreadsheet or textbook.
- **Importing data — restore a backup:** Settings → **Import JSON** loads a file exported from
  this app (see **Backups** below). It merges by last-write-wins and never deletes anything, so
  it's safe to run against an existing library or to move your data to a new device.
- **Reading Korean:** Korean text renders in Noto Sans KR, cached by the service worker so it
  looks right offline. Tap the 🔊 speaker on a card to hear it read aloud (Web Speech, `ko-KR`),
  or turn on auto-play audio per deck in the deck's ⚙ screen. The speaker is hidden on devices
  with no Korean voice installed — on iPhone, add one under Settings → Accessibility → Spoken
  Content → Voices → Korean. Put romanization in a card's notes if you want a reading aid while
  you learn the script.
- **Studying:** tap the card or press **Space** to flip, then tap a rating or press **1–4**.
  **Esc** ends the session.
- **Stats** (📊 on a deck): cards by state (new / learning / mature, where mature means an
  interval of 21+ days), reviews per day for the last 30 days, and struggling cards
  (3+ lapses or ease ≤ 2.0).
- **Backups:** Settings → Export JSON / Import JSON. Importing merges by last-write-wins and
  never deletes anything.
- **Icons:** placeholders are in `frontend/public/icons/`. Replace them with your own files
  using the same names and sizes (192, 512, 512 maskable with the art inside the central 80%,
  and a 180×180 `apple-touch-icon.png`), or edit and rerun `npm run icons`.

## API

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/login` | | `{ "password": "..." }` → `{ token, expires_at }`. Rate-limited |
| `GET` | `/auth/check` | ✓ | Checks that a token is valid |
| `POST` | `/sync/push` | ✓ | `{ decks, cards, card_states, reviews }` (up to 5000 each) → `{ accepted, ignored, server_time }` |
| `GET` | `/sync/pull?since=<ms>` | ✓ | Everything changed since the cursor, plus a new `server_time` cursor |
| `GET` | `/health` | | Liveness check |

All timestamps are milliseconds since the Unix epoch. Interactive docs are at `/docs`.
