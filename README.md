# المعرض الوطني لدجاج الزينة — Backend API (Brahma Club Algeria)

Express + PostgreSQL (Neon) REST API for the National Ornamental Chicken Exhibition.

## Stack
- Node.js + Express
- PostgreSQL (Neon) via `pg`
- Auth: JWT (`jsonwebtoken`), passwords hashed with `bcryptjs`

## Setup
```bash
npm install
cp .env.example .env   # adjust if needed
npm start              # http://localhost:4000  (schema auto-creates on boot)
```

## Environment variables
| var | default | purpose |
|-----|---------|---------|
| `PORT` | `4000` | server port |
| `DATABASE_URL` | Neon connection string | PostgreSQL |
| `JWT_SECRET` | dev secret | token signing |
| `ADMIN_PHONE` | `0779452212` | admin login |
| `ADMIN_PASSWORD` | `admin123` | admin login |

## Endpoints
| method | path | auth | description |
|--------|------|------|-------------|
| GET | `/api/health` | — | DB health check |
| POST | `/api/register` | — | register participant |
| POST | `/api/login` | — | login (participant or admin) |
| GET | `/api/me` | user | current profile |
| PUT | `/api/me` | user | update own profile |
| GET | `/api/admin/participants` | admin | list (`?search=&wilaya=`) |
| GET | `/api/admin/stats` | admin | totals + per-wilaya stats |
| PUT | `/api/admin/participants/:id` | admin | edit participant |
| DELETE | `/api/admin/participants/:id` | admin | delete participant |

## Deploy (Render / Railway)
Start command: `npm start`. Set `DATABASE_URL`, `JWT_SECRET`, `ADMIN_*` env vars.
After deploying, put the public URL into the frontend's `assets/js/config.js`.
