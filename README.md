# Smart_Fleet

LPG distribution logistics platform — Pakistan. Sits between LPG distributors and their end customers: zone-based stores and vehicles handle last-mile delivery, empty-cylinder returns, and inter-store rebalancing, with per-cylinder QR chain-of-custody.

## Monorepo layout

```
smart-fleet/
├── apps/
│   ├── api/          # NestJS backend (Prisma + PostgreSQL/PostGIS + Redis/BullMQ)
│   ├── admin-web/    # React + Vite operator dashboard
│   └── mobile/       # Expo RN (distributor + driver variants, single codebase)
├── packages/
│   ├── shared-types/       # Cross-app TS interfaces
│   ├── shared-utils/       # Distance, money, formatters
│   └── shared-validation/  # Zod schemas
├── infrastructure/   # docker-compose (postgis, redis, minio)
└── docs/             # ERD, dispatch algorithm, payments, RBAC, etc.
```

## Quick start

```bash
# 1. Copy env
cp .env.example .env

# 2. Install deps
npm install

# 3. Start local infrastructure (Postgres+PostGIS, Redis, MinIO)
npm run infra:up

# 4. Generate Prisma client + run migrations
cd apps/api
npx prisma migrate dev
cd ../..

# 5. Run everything
npm run dev
```

## Docs

- [Database schema (ERD)](./docs/database-schema.md)
- [Dispatch algorithm](./docs/dispatch-algorithm.md)
- [Cylinder custody](./docs/cylinder-custody.md)
- [Payments integration](./docs/payments-integration.md)
- [RBAC matrix](./docs/rbac-matrix.md)
- [Pricing matrix](./docs/pricing-matrix.md)

## Stack

NestJS · Prisma · PostgreSQL+PostGIS · Redis+BullMQ · Socket.io · React+Vite · Expo React Native · TanStack Query · Zustand · Turborepo
