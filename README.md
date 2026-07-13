# Horizon Property Manager — Backend API

NestJS 10 · TypeScript · PostgreSQL · Prisma · JWT · Swagger

## Stack

| Layer | Technology |
|---|---|
| Framework | NestJS 10 + TypeScript (strict) |
| Database | PostgreSQL 15+ via Prisma |
| Auth | JWT access (15m) + refresh tokens (7d) + Argon2id |
| Docs | Swagger at `/api/docs` |
| Validation | class-validator + class-transformer |
| Security | Helmet, CORS, rate limiting (@nestjs/throttler) |

## Prerequisites

- Node.js 20+
- Docker (for local Postgres)
- npm

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy and configure environment
cp .env.example .env
# Edit .env — set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET (min 32 chars each)

# 3. Start Postgres
docker-compose up -d

# 4. Run migrations and seed
npx prisma migrate dev --name init
npx prisma db seed

# 5. Start development server
npm run start:dev
```

After startup:
- API base: `http://localhost:3000/api/v1`
- Swagger UI: `http://localhost:3000/api/docs`
- Health check: `http://localhost:3000/api/health`

## Environment Variables

See `.env.example` for all required variables. The app **refuses to start** if any are missing/invalid (Joi validation at startup).

Key variables:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/horizon_pm
JWT_ACCESS_SECRET=<min-32-char-random-string>
JWT_REFRESH_SECRET=<different-min-32-char-random-string>
CORS_ORIGIN=http://localhost:3001
```

## Seed Accounts

After running `npx prisma db seed`:

| Role | Email | Password (env) |
|---|---|---|
| Manager | manager@horizonpm.com | SEED_MANAGER_PASSWORD |
| Secretary | secretary@horizonpm.com | SEED_SECRETARY_PASSWORD |

## API Endpoints

### Authentication (`/api/v1/auth`)
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/login` | Public | Login → access + refresh tokens |
| POST | `/refresh` | Refresh token | Rotate tokens |
| POST | `/logout` | JWT | Invalidate refresh token |
| GET | `/me` | JWT | Get own profile |
| PATCH | `/change-password` | JWT | Change own password |

### Users (`/api/v1/users`) — Manager only
| Method | Endpoint | Description |
|---|---|---|
| GET | `/` | List all users |
| GET | `/:id` | Get user by ID |
| POST | `/` | Create user |
| PATCH | `/:id` | Update user |
| DELETE | `/:id` | Deactivate user (soft delete) |

### Buildings (`/api/v1/buildings`)
| Method | Endpoint | Roles | Description |
|---|---|---|---|
| GET | `/` | Manager, Secretary | List (paginated + search + filter + sort) |
| GET | `/:id` | Manager, Secretary | Get by ID |
| POST | `/` | Manager | Create |
| PATCH | `/:id` | Manager | Update |
| DELETE | `/:id` | Manager | Soft delete |

### Health
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | DB + memory status |

## Query Parameters (GET /buildings)

| Param | Type | Default | Description |
|---|---|---|---|
| page | number | 1 | Page number |
| limit | number | 10 | Items per page (max 100) |
| search | string | — | Search by name or code |
| buildingType | enum | — | RESIDENTIAL, COMMERCIAL, MIXED_USE |
| sortBy | enum | createdAt | name, code, createdAt |
| sortOrder | asc/desc | desc | Sort direction |

## Response Format

All responses follow this envelope:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Request successful",
  "data": { ... },
  "timestamp": "2026-01-01T00:00:00.000Z",
  "path": "/api/v1/buildings"
}
```

Errors include `"success": false` and optionally an `"errors"` array.

## Scripts

```bash
npm run start:dev        # Dev with hot-reload
npm run build            # Production build
npm run test             # Unit tests
npm run test:cov         # Unit tests with coverage
npm run test:e2e         # E2E tests (requires DB)
npm run lint             # Lint + auto-fix
npm run prisma:migrate   # Run DB migrations
npm run prisma:seed      # Seed DB
npm run prisma:studio    # Prisma Studio GUI
```

## Security

- Passwords hashed with Argon2id (memoryCost: 65536, iterations: 3, parallelism: 4)
- JWT secrets loaded from env only — never hardcoded
- Refresh tokens stored as Argon2 hashes in DB (revocable)
- Rate limiting: 100 req/min globally, 5 req/min on `/auth/login`
- Helmet security headers on all responses
- CORS restricted to `CORS_ORIGIN` env variable
- Sensitive fields (passwords, tokens) never appear in logs or responses

## Role Permissions

| Endpoint group | MANAGER | SECRETARY |
|---|---|---|
| Auth endpoints | All | All |
| Users CRUD | Full | None |
| Buildings (read) | Yes | Yes |
| Buildings (write) | Yes | No |
