-- inc3_refills_dayend (docs/pilot/DATA_MODEL.md §5). Generated with the repo's new-migration flow
-- (prisma migrate diff --script from the Increment 2 schema, test/helpers/fixtures/schema.inc2.prisma, to
-- prisma/schema.prisma), then hand-edited in this order: (1) pre-check, (2) the generated DDL unchanged,
-- (3) backfills, (4) CHECK constraints.
-- The file runs as ONE transaction: if any statement fails, nothing is applied.
--
-- The values ADDED to existing enums in (2) (CylinderEventType.FILLED and ADJUSTED,
-- CylinderEventSource.DAY_END_FIX, AlertType.DAY_END_SUBMITTED) are not used as literals in this file:
-- Postgres refuses a new enum value before it is committed (55P04). Values of the enums CREATED in (2)
-- (FillingOrderCylinderStatus, DayCloseStatus, DayClosePlace, DayCloseDiff) are fine to use.
-- DAY_END_FIX needs no CHECK of its own: inc2's cylinder_events_reason_chk already requires a reason for
-- every source other than SCAN, TYPED and REGISTRATION.
--
-- No money: nothing here touches distributors.advance_balance_paisa or ledger_entries. Every backfill is
-- safe to re-run (WHERE ... IS NULL; the counter only goes up) and safe on an empty database.

-- (1) PRE-CHECK [hand edit]: no refill in flight. A refill that is not PENDING and not finished
--     (COMPLETED, CANCELLED, or the legacy FAILED) was started under the Inc 1 count steps, which the
--     Increment 3 apps no longer offer: from now on every refill step is a QR scan.
DO $$
DECLARE bad text; total int;
BEGIN
  SELECT count(*) INTO total FROM filling_orders WHERE status NOT IN ('PENDING', 'COMPLETED', 'CANCELLED', 'FAILED');
  IF total > 0 THEN
    SELECT string_agg(label, ', ' ORDER BY n) INTO bad FROM (
      SELECT d.code || ' ' || f.id::text || ' (' || f.status::text || ')' AS label,
             row_number() OVER (ORDER BY f.created_at, f.id) AS n
      FROM filling_orders f JOIN distributors d ON d.id = f.distributor_id
      WHERE f.status NOT IN ('PENDING', 'COMPLETED', 'CANCELLED', 'FAILED')) x WHERE n <= 20;
    IF total > 20 THEN bad := bad || ' and ' || (total - 20) || ' more'; END IF;
    RAISE EXCEPTION 'MIGRATION_BLOCKED inc3: refills in progress (%). Finish each refill with the Increment 2 apps first (the driver''s steps up to Returned, then the office''s Mark complete; a refill not yet picked up may instead be cancelled by its shop), run "prisma migrate resolve --rolled-back 20261024021613_inc3_refills_dayend", then deploy again.', bad;
  END IF;
END $$;

-- (2) GENERATED DDL (unchanged)
-- CreateEnum
CREATE TYPE "FillingOrderCylinderStatus" AS ENUM ('PICKED_UP', 'FILLED', 'RETURNED');

-- CreateEnum
CREATE TYPE "DayCloseStatus" AS ENUM ('OPEN', 'SUBMITTED', 'APPROVED');

-- CreateEnum
CREATE TYPE "DayClosePlace" AS ENUM ('STORE', 'VAN', 'CUSTOMER', 'NOT_FOUND');

-- CreateEnum
CREATE TYPE "DayCloseDiff" AS ENUM ('MATCH', 'PLACE_DIFFERS', 'STATE_DIFFERS', 'PLACE_AND_STATE_DIFFER', 'UNKNOWN_CYLINDER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CylinderEventType" ADD VALUE 'FILLED';
ALTER TYPE "CylinderEventType" ADD VALUE 'ADJUSTED';

-- AlterEnum
ALTER TYPE "CylinderEventSource" ADD VALUE 'DAY_END_FIX';

-- AlterEnum
ALTER TYPE "AlertType" ADD VALUE 'DAY_END_SUBMITTED';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "is_test" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "distributors" ADD COLUMN     "is_test" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN     "is_test" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "cylinder_events" ADD COLUMN     "filling_order_id" UUID;

-- AlterTable
ALTER TABLE "filling_orders" ADD COLUMN     "cancelled_at" TIMESTAMP(3),
ADD COLUMN     "cancelled_by_user_id" UUID,
ADD COLUMN     "client_request_id" UUID,
ADD COLUMN     "picked_up_at" TIMESTAMP(3),
ADD COLUMN     "refill_no" INTEGER;

-- CreateTable
CREATE TABLE "filling_order_cylinders" (
    "id" UUID NOT NULL,
    "filling_order_id" UUID NOT NULL,
    "cylinder_id" UUID NOT NULL,
    "status" "FillingOrderCylinderStatus" NOT NULL DEFAULT 'PICKED_UP',
    "state_at_pickup" "CylinderState" NOT NULL,
    "picked_up_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "filled_at" TIMESTAMP(3),
    "returned_at" TIMESTAMP(3),

    CONSTRAINT "filling_order_cylinders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "day_closes" (
    "id" UUID NOT NULL,
    "distributor_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "status" "DayCloseStatus" NOT NULL DEFAULT 'OPEN',
    "sheet_snapshot_at" TIMESTAMP(3),
    "sheet_file_id" UUID,
    "upload_file_id" UUID,
    "upload_version" INTEGER NOT NULL DEFAULT 0,
    "uploaded_at" TIMESTAMP(3),
    "uploaded_by_user_id" UUID,
    "submitted_at" TIMESTAMP(3),
    "approved_at" TIMESTAMP(3),
    "approved_by_user_id" UUID,
    "sent_back_reason" TEXT,
    "sent_back_at" TIMESTAMP(3),
    "reopen_reason" TEXT,
    "reopened_at" TIMESTAMP(3),
    "locked_at" TIMESTAMP(3),
    "totals" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "day_closes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "day_close_lines" (
    "id" UUID NOT NULL,
    "day_close_id" UUID NOT NULL,
    "cylinder_id" UUID,
    "sheet_key" TEXT NOT NULL,
    "cylinder_type_id" UUID,
    "system_place" "DayClosePlace",
    "system_holder_id" UUID,
    "system_state" "CylinderState",
    "system_last_event_id" UUID,
    "reported_place" "DayClosePlace",
    "reported_state" "CylinderState",
    "reason_code" TEXT,
    "note" TEXT,
    "diff" "DayCloseDiff" NOT NULL DEFAULT 'MATCH',
    "applied_event_id" UUID,
    "skipped_moved_at" TIMESTAMP(3),

    CONSTRAINT "day_close_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "filling_order_cylinders_cylinder_id_idx" ON "filling_order_cylinders"("cylinder_id");

-- CreateIndex
CREATE UNIQUE INDEX "filling_order_cylinders_filling_order_id_cylinder_id_key" ON "filling_order_cylinders"("filling_order_id", "cylinder_id");

-- CreateIndex
CREATE INDEX "day_closes_status_business_date_idx" ON "day_closes"("status", "business_date");

-- CreateIndex
CREATE UNIQUE INDEX "day_closes_distributor_id_business_date_key" ON "day_closes"("distributor_id", "business_date");

-- CreateIndex
CREATE UNIQUE INDEX "day_close_lines_applied_event_id_key" ON "day_close_lines"("applied_event_id");

-- CreateIndex
CREATE INDEX "day_close_lines_day_close_id_diff_idx" ON "day_close_lines"("day_close_id", "diff");

-- CreateIndex
CREATE INDEX "day_close_lines_cylinder_id_idx" ON "day_close_lines"("cylinder_id");

-- CreateIndex
CREATE UNIQUE INDEX "day_close_lines_day_close_id_sheet_key_key" ON "day_close_lines"("day_close_id", "sheet_key");

-- CreateIndex
CREATE INDEX "cylinder_events_filling_order_id_idx" ON "cylinder_events"("filling_order_id");

-- CreateIndex
CREATE INDEX "filling_orders_distributor_id_created_at_idx" ON "filling_orders"("distributor_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "filling_orders_distributor_id_refill_no_key" ON "filling_orders"("distributor_id", "refill_no");

-- CreateIndex
CREATE UNIQUE INDEX "filling_orders_distributor_id_client_request_id_key" ON "filling_orders"("distributor_id", "client_request_id");

-- AddForeignKey
ALTER TABLE "cylinder_events" ADD CONSTRAINT "cylinder_events_filling_order_id_fkey" FOREIGN KEY ("filling_order_id") REFERENCES "filling_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "filling_order_cylinders" ADD CONSTRAINT "filling_order_cylinders_filling_order_id_fkey" FOREIGN KEY ("filling_order_id") REFERENCES "filling_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "filling_order_cylinders" ADD CONSTRAINT "filling_order_cylinders_cylinder_id_fkey" FOREIGN KEY ("cylinder_id") REFERENCES "cylinders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "day_closes" ADD CONSTRAINT "day_closes_distributor_id_fkey" FOREIGN KEY ("distributor_id") REFERENCES "distributors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "day_closes" ADD CONSTRAINT "day_closes_sheet_file_id_fkey" FOREIGN KEY ("sheet_file_id") REFERENCES "stored_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "day_closes" ADD CONSTRAINT "day_closes_upload_file_id_fkey" FOREIGN KEY ("upload_file_id") REFERENCES "stored_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "day_close_lines" ADD CONSTRAINT "day_close_lines_day_close_id_fkey" FOREIGN KEY ("day_close_id") REFERENCES "day_closes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "day_close_lines" ADD CONSTRAINT "day_close_lines_cylinder_id_fkey" FOREIGN KEY ("cylinder_id") REFERENCES "cylinders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "day_close_lines" ADD CONSTRAINT "day_close_lines_cylinder_type_id_fkey" FOREIGN KEY ("cylinder_type_id") REFERENCES "cylinder_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "day_close_lines" ADD CONSTRAINT "day_close_lines_applied_event_id_fkey" FOREIGN KEY ("applied_event_id") REFERENCES "cylinder_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- (3) BACKFILLS [hand edit], in the DATA_MODEL §5.4 order.

-- 3.1 refill_no: 1, 2, 3... per distributor by (created_at, id), continuing after the highest number and
--     the counter where some are already set; then next_refill_no = max + 1 (it only ever goes up). The
--     refills show as AG-R001, AG-R002... (formatNo REFILL).
UPDATE filling_orders f SET refill_no = x.base + x.rn
FROM (SELECT f2.id,
             row_number() OVER (PARTITION BY f2.distributor_id ORDER BY f2.created_at, f2.id) AS rn,
             GREATEST(COALESCE((SELECT max(m.refill_no) FROM filling_orders m WHERE m.distributor_id = f2.distributor_id), 0),
                      d.next_refill_no - 1) AS base
      FROM filling_orders f2 JOIN distributors d ON d.id = f2.distributor_id
      WHERE f2.refill_no IS NULL) x
WHERE f.id = x.id AND f.refill_no IS NULL;

UPDATE distributors d SET next_refill_no = m.next
FROM (SELECT distributor_id, max(refill_no) + 1 AS next FROM filling_orders WHERE refill_no IS NOT NULL GROUP BY distributor_id) m
WHERE m.distributor_id = d.id AND d.next_refill_no < m.next;

-- 3.2 cancelled_at for refills cancelled before this release: the best time there is, updated_at (the
--     Inc 1 cancel was the row's last change). Who cancelled stays NULL: the audit row refill.cancel names them.
UPDATE filling_orders SET cancelled_at = updated_at WHERE status = 'CANCELLED' AND cancelled_at IS NULL;

-- (4) CHECK CONSTRAINTS [hand edit]. Prisma never diffs CHECKs, so later migrations keep them.
--     NOT VALID only on the old refill table, whose existing rows might break it; the new tables are
--     empty, so their checks are validated.
-- At least one cylinder per refill; the maximum (refill.maxCylinders, 30) is a setting, enforced in code.
ALTER TABLE filling_orders ADD CONSTRAINT filling_orders_count_chk CHECK (requested_count > 0) NOT VALID;
-- A refill picks up empty or part-filled cylinders only.
ALTER TABLE filling_order_cylinders ADD CONSTRAINT foc_pickup_state_chk CHECK (state_at_pickup::text IN ('EMPTY', 'PART_FILLED'));
-- The line's status matches its timestamps: PICKED_UP has neither, FILLED has filled_at, RETURNED (the
-- store's receive scan) has returned_at, filled or not.
ALTER TABLE filling_order_cylinders ADD CONSTRAINT foc_steps_chk CHECK (
     (status = 'PICKED_UP' AND filled_at IS NULL AND returned_at IS NULL)
  OR (status = 'FILLED' AND filled_at IS NOT NULL AND returned_at IS NULL)
  OR (status = 'RETURNED' AND returned_at IS NOT NULL));
-- A day is locked exactly while it is APPROVED.
ALTER TABLE day_closes ADD CONSTRAINT day_closes_locked_chk CHECK ((status = 'APPROVED') = (locked_at IS NOT NULL));
-- Only an extra number the app doesn't know has no cylinder.
ALTER TABLE day_close_lines ADD CONSTRAINT dcl_unknown_chk CHECK ((diff = 'UNKNOWN_CYLINDER') = (cylinder_id IS NULL));
