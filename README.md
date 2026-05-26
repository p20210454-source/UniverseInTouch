# CosmoCause

CosmoCause — academic paper blog with Express + SQLite backend.

## Run

```bash
npm install
cp .env.example .env   # edit ADMIN_PASSWORD (quote values that contain #)
npm start
```

The server loads `.env` automatically on startup.

Open [http://localhost:3000](http://localhost:3000)

**Admin:** open the sidebar (⚙ Admin), sign in with username `admin` (or `ADMIN_USERNAME`) and your `ADMIN_PASSWORD`.

## Security

- Session cookie auth for all write/admin APIs
- Public reads return **published** papers only
- Rate limits on login, writes, views, and newsletter signup
- CSP, CORS allowlist, static files served from `public/` only
- HTML output uses safe CSS class maps (no raw DB values in attributes)

Copy `.env.example` to `.env` and set `ADMIN_PASSWORD` before deploying.

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
