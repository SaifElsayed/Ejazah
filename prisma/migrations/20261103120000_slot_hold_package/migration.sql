-- B29, T036 of specs/003-booking/tasks.md (the owner's decision of 2026-11-03): a hold records the
-- package it was placed for and that package's session count at that moment. `checkout.pay` names
-- the hold alone, while a teacher may have several packages of the slot's length; and Pay refuses a
-- package whose session count changed since the hold's overlap check ran on it (FR-351). Generated
-- by `prisma migrate diff --from-config-datasource --to-schema prisma/schema --script` against a
-- database holding every migration before it, then extended by hand: the columns are added
-- nullable, filled for the rows already held from the enrollment each is linked to, then made NOT
-- NULL. A hold with no enrollment cannot be filled, so the NOT NULL refuses it: such rows are
-- cleared by hand before this runs (the owner's decision of 2026-11-03).

-- AlterTable
ALTER TABLE "slot_holds" ADD COLUMN     "package_id" UUID,
ADD COLUMN     "session_count" INTEGER;

-- Hand-written: the rows already held take their enrollment's package and snapshot count.
UPDATE "slot_holds" AS h
   SET "package_id" = e."package_id",
       "session_count" = e."snapshot_session_count"
  FROM "enrollments" AS e
 WHERE e."id" = h."enrollment_id";

ALTER TABLE "slot_holds" ALTER COLUMN "package_id" SET NOT NULL,
ALTER COLUMN "session_count" SET NOT NULL;

-- CreateIndex
CREATE INDEX "slot_holds_package_id_idx" ON "slot_holds"("package_id");

-- AddForeignKey
ALTER TABLE "slot_holds" ADD CONSTRAINT "slot_holds_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
