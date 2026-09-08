// T019 — a stand-in for the generated database client, so the type-aware fixtures resolve.
// The real client is generated from the schema, and the schema has no models until T055-T063.
// `api/table-ownership` (R-API-6) has to resolve the query target against the ownership
// manifest, which it cannot do against `any`; this declaration gives it a type to resolve
// while the generator has nothing to emit. Delegate names follow Prisma's own convention —
// the camelCased model name — so `payment` is the manifest's `payments` table.
declare module '@prisma/client' {
  interface ModelDelegate {
    findMany(args?: unknown): Promise<unknown[]>;
    findUnique(args: unknown): Promise<unknown>;
    create(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
  }

  export class PrismaClient {
    readonly enrollment: ModelDelegate;
    readonly slotHold: ModelDelegate;
    readonly payment: ModelDelegate;
    readonly paymentEvent: ModelDelegate;
  }
}
