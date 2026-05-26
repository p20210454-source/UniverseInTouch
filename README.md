# UniverseInTouch

UniverseInTouch — academic paper blog with Express + SQLite backend.

## Run

```bash
npm install
cp .env.example .env   # set ADMIN_PASSWORD and SESSION_SECRET (quote values that contain #)
npm start
```

The server **will not start** until `ADMIN_PASSWORD` is set to a non-default value. In production, `SESSION_SECRET` (32+ chars) is also required.

The server loads `.env` automatically on startup.

Open [http://localhost:3000](http://localhost:3000)

**Admin:** open the sidebar (⚙ Admin), sign in with username `admin` (or `ADMIN_USERNAME`) and your `ADMIN_PASSWORD`.

## Security

- Signed session cookies (`SESSION_SECRET`) + CSRF on all write/admin APIs
- Login lockout after repeated failures; sessions invalidated on new login
- Public reads return **published** papers only
- Rate limits on login, auth status, writes, views, and newsletter (bounded memory)
- View counts deduplicated per IP per paper (24h)
- CSP: `script-src 'self'`; HSTS in production; CORS allowlist
- Set `TRUST_PROXY=1` only behind a trusted reverse proxy
- Static files from `public/` only; settings sanitized on save
- HTML escaped in the UI; papers sanitized with DOMPurify on write

Copy `.env.example` to `.env` and set `ADMIN_PASSWORD` and `SESSION_SECRET` before deploying.

## API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/login` | — | Admin sign-in |
| POST | `/api/auth/logout` | — | Sign out |
| GET | `/api/auth/me` | — | Session status |
| GET | `/api/papers` | — | Published papers |
| GET | `/api/admin/dashboard` | ✓ | Admin dashboard stats & activity |
| GET | `/api/admin/papers` | ✓ | All papers |
| GET | `/api/papers/browse` | — | Browse/search |
| POST/PUT/DELETE | `/api/papers` | ✓ | Create/update/delete |
| PUT | `/api/settings` | ✓ | Site settings |
| POST | `/api/categories` | ✓ | Add category |
| POST | `/api/subscribers` | — | Newsletter (rate limited) |

Database: `database.sqlite` (not web-accessible).
