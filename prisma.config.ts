import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Multi-file schema: one file per domain under prisma/schema (ARCHITECTURE §5).
// Migrations run as the OWNER role; the application role never does (research R-5).
export default defineConfig({
  schema: 'prisma/schema',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env['DATABASE_URL_OWNER'] ?? '',
  },
});
