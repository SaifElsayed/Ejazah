-- B46 (specs/005-certification/tasks.md, the note under T006; the owner's Q5 (c) and the review's
-- refinement of 2026-11-17; data-model.md; ERD §15 rule 58): the credential's riwaya and tariq as
-- printed on the certificate (FR-IJAZAH-2), frozen on the request at send and on the ijazah at
-- approval, as the two printed names are (ADR 0019 D1). The tariq is NULL when the credential names
-- none: an approved credential's tariq is optional (`credential-review.service.ts:81`).
--
-- `ijazah_requests` holds no row. `ijazahs` holds no real ijazah in any database (no code path
-- issued one before T007), but test databases hold signed-off `probe-` rows a DB spec commits and
-- cannot delete (DELETE is revoked, `20261007000100_roles_and_privileges`). So `ijazahs`' NOT NULL
-- column is added with a default of '' that is dropped at once, and its two checks are NOT VALID:
-- they refuse '' on every row written from now on and leave the backfilled probes alone.

-- AlterTable
ALTER TABLE "ijazah_requests" ADD COLUMN     "riwaya_printed" TEXT NOT NULL,
ADD COLUMN     "tariq_printed" TEXT;

-- AlterTable
ALTER TABLE "ijazahs" ADD COLUMN     "riwaya_printed" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "tariq_printed" TEXT;
ALTER TABLE "ijazahs" ALTER COLUMN "riwaya_printed" DROP DEFAULT;

-- Rule 58: a printed riwaya is never empty, and a printed tariq is either absent or not empty.
ALTER TABLE "ijazah_requests" ADD CONSTRAINT "ijazah_requests_riwaya_printed_check"
    CHECK ("riwaya_printed" <> '');
ALTER TABLE "ijazah_requests" ADD CONSTRAINT "ijazah_requests_tariq_printed_check"
    CHECK ("tariq_printed" IS NULL OR "tariq_printed" <> '');
ALTER TABLE "ijazahs" ADD CONSTRAINT "ijazahs_riwaya_printed_check"
    CHECK ("riwaya_printed" <> '') NOT VALID;
ALTER TABLE "ijazahs" ADD CONSTRAINT "ijazahs_tariq_printed_check"
    CHECK ("tariq_printed" IS NULL OR "tariq_printed" <> '') NOT VALID;
