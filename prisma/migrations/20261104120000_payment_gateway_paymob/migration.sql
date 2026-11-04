-- B32, T056 of specs/003-booking/tasks.md (FR-371, R-221): the real gateway's member of
-- `payment_gateway`, so a `payments` row can name Paymob. Members are permanent (R-API-9). Written as
-- `prisma migrate diff --from-config-datasource --to-schema prisma/schema --script` generates an
-- added enum value.

-- AlterEnum
ALTER TYPE "payment_gateway" ADD VALUE 'paymob';
