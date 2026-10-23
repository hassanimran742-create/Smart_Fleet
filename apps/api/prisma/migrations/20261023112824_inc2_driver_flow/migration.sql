-- inc2_driver_flow (docs/pilot/DATA_MODEL.md §4). Generated with the repo's new-migration flow
-- (prisma migrate diff --script from the inc1b schema to prisma/schema.prisma: inc1b ships in the same
-- release, just before it), then hand-edited in this order: (1) pre-check, (2) the generated DDL
-- unchanged, (3) backfills, (4) CHECK constraints.
-- The file runs as ONE transaction: if any statement fails, nothing is applied.
--
-- The values ADDED to existing enums in (2) (CylinderState.PART_FILLED, CylinderEventType.REGISTERED,
-- AlertType.CUSTOMER_PROBLEM and VAN_NOT_EMPTY) are not used as literals in this file: Postgres refuses a
-- new enum value before it is committed (55P04), so the return-state CHECK compares ::text. Values of the
-- enums CREATED in (2) are fine to use.
--
-- Every backfill is safe to re-run (WHERE ... IS NULL; counters only go up) and safe on an empty database.

-- (1) PRE-CHECK [hand edit]: no run in progress. A run started under the Inc 1 rules can't be finished
--     under the Inc 2 ones: a hand-over now needs a load scan on the same run, and the van must be empty.
DO $$
DECLARE bad text; total int;
BEGIN
  SELECT count(*) INTO total FROM trips WHERE status = 'IN_PROGRESS';
  IF total > 0 THEN
    SELECT string_agg(label, ', ' ORDER BY n) INTO bad FROM (
      SELECT t.id::text || ' (' || COALESCE(v.plate_no, 'no van') || ')' AS label,
             row_number() OVER (ORDER BY t.planned_at, t.id) AS n
      FROM trips t LEFT JOIN vehicles v ON v.id = t.vehicle_id WHERE t.status = 'IN_PROGRESS') x WHERE n <= 20;
    IF total > 20 THEN bad := bad || ' and ' || (total - 20) || ' more'; END IF;
    RAISE EXCEPTION 'MIGRATION_BLOCKED inc2: runs in progress (%). Finish each run with the Increment 1 apps first (every order on it delivered, cancelled or could not deliver, then the driver finishes the trip), run "prisma migrate resolve --rolled-back 20261023112824_inc2_driver_flow", then deploy again.', bad;
  END IF;
END $$;

-- (2) GENERATED DDL (unchanged)
-- CreateEnum
CREATE TYPE "CylinderEventSource" AS ENUM ('SCAN', 'TYPED', 'MANUAL', 'REGISTRATION');

-- CreateEnum
CREATE TYPE "StopCylinderDirection" AS ENUM ('GIVEN', 'TAKEN_BACK');

-- CreateEnum
CREATE TYPE "ConfirmationStatus" AS ENUM ('PENDING', 'ANSWERED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ConfirmationResponse" AS ENUM ('YES', 'PARTLY', 'NO', 'OTHER');

-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('SMS', 'WHATSAPP', 'SHARE_LINK');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED');

-- AlterEnum
ALTER TYPE "CylinderState" ADD VALUE 'PART_FILLED';

-- AlterEnum
ALTER TYPE "CylinderEventType" ADD VALUE 'REGISTERED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AlertType" ADD VALUE 'CUSTOMER_PROBLEM';
ALTER TYPE "AlertType" ADD VALUE 'VAN_NOT_EMPTY';

-- AlterTable
ALTER TABLE "cylinders" ADD COLUMN     "last_event_id" UUID,
ADD COLUMN     "short_no" INTEGER;

-- AlterTable
ALTER TABLE "cylinder_events" ADD COLUMN     "client_scan_id" UUID,
ADD COLUMN     "from_state" "CylinderState",
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "source" "CylinderEventSource" NOT NULL DEFAULT 'SCAN',
ADD COLUMN     "to_state" "CylinderState",
ADD COLUMN     "trip_stop_id" UUID;

-- AlterTable
ALTER TABLE "trips" ADD COLUMN     "leftover_reason" TEXT;

-- AlterTable
ALTER TABLE "alerts" ADD COLUMN     "distributor_id" UUID,
ADD COLUMN     "resolution_note" VARCHAR(300),
ADD COLUMN     "resolved_by_user_id" UUID;

-- CreateTable
CREATE TABLE "stop_cylinders" (
    "id" UUID NOT NULL,
    "trip_stop_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "cylinder_id" UUID NOT NULL,
    "cylinder_type_id" UUID NOT NULL,
    "direction" "StopCylinderDirection" NOT NULL,
    "return_state" "CylinderState",
    "event_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stop_cylinders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stop_unlabelled_returns" (
    "id" UUID NOT NULL,
    "trip_stop_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "cylinder_type_id" UUID NOT NULL,
    "state" "CylinderState" NOT NULL,
    "count" INTEGER NOT NULL,
    "recorded_by_user_id" UUID NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stop_unlabelled_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_confirmations" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "distributor_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "token_version" INTEGER NOT NULL DEFAULT 1,
    "last_new_link_key" UUID,
    "status" "ConfirmationStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "phone_e164" TEXT,
    "snapshot" JSONB NOT NULL,
    "response" "ConfirmationResponse",
    "comment" VARCHAR(300),
    "responded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbound_messages" (
    "id" UUID NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "provider" TEXT NOT NULL,
    "to_phone_e164" TEXT,
    "template_key" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "body_redacted" VARCHAR(320) NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'QUEUED',
    "provider_message_id" TEXT,
    "error_code" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "confirmation_id" UUID,
    "token_version" INTEGER,
    "order_id" UUID,
    "distributor_id" UUID,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),

    CONSTRAINT "outbound_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stop_cylinders_event_id_key" ON "stop_cylinders"("event_id");

-- CreateIndex
CREATE INDEX "stop_cylinders_order_id_direction_idx" ON "stop_cylinders"("order_id", "direction");

-- CreateIndex
CREATE INDEX "stop_cylinders_cylinder_id_idx" ON "stop_cylinders"("cylinder_id");

-- CreateIndex
CREATE UNIQUE INDEX "stop_cylinders_trip_stop_id_cylinder_id_key" ON "stop_cylinders"("trip_stop_id", "cylinder_id");

-- CreateIndex
CREATE UNIQUE INDEX "stop_unlabelled_returns_trip_stop_id_cylinder_type_id_state_key" ON "stop_unlabelled_returns"("trip_stop_id", "cylinder_type_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_confirmations_order_id_key" ON "delivery_confirmations"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_confirmations_token_hash_key" ON "delivery_confirmations"("token_hash");

-- CreateIndex
CREATE INDEX "delivery_confirmations_status_expires_at_idx" ON "delivery_confirmations"("status", "expires_at");

-- CreateIndex
CREATE INDEX "delivery_confirmations_distributor_id_created_at_idx" ON "delivery_confirmations"("distributor_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "outbound_messages_idempotency_key_key" ON "outbound_messages"("idempotency_key");

-- CreateIndex
CREATE INDEX "outbound_messages_status_created_at_idx" ON "outbound_messages"("status", "created_at");

-- CreateIndex
CREATE INDEX "outbound_messages_order_id_created_at_idx" ON "outbound_messages"("order_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "cylinders_last_event_id_key" ON "cylinders"("last_event_id");

-- CreateIndex
CREATE INDEX "cylinders_custody_type_custody_id_idx" ON "cylinders"("custody_type", "custody_id");

-- CreateIndex
CREATE UNIQUE INDEX "cylinders_distributor_id_short_no_key" ON "cylinders"("distributor_id", "short_no");

-- CreateIndex
CREATE INDEX "cylinder_events_trip_id_idx" ON "cylinder_events"("trip_id");

-- CreateIndex
CREATE INDEX "cylinder_events_order_id_idx" ON "cylinder_events"("order_id");

-- CreateIndex
CREATE INDEX "cylinder_events_created_at_idx" ON "cylinder_events"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "cylinder_events_actor_user_id_client_scan_id_key" ON "cylinder_events"("actor_user_id", "client_scan_id");

-- CreateIndex
CREATE INDEX "alerts_distributor_id_status_created_at_idx" ON "alerts"("distributor_id", "status", "created_at");

-- AddForeignKey
ALTER TABLE "cylinders" ADD CONSTRAINT "cylinders_last_event_id_fkey" FOREIGN KEY ("last_event_id") REFERENCES "cylinder_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cylinder_events" ADD CONSTRAINT "cylinder_events_trip_stop_id_fkey" FOREIGN KEY ("trip_stop_id") REFERENCES "trip_stops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stop_cylinders" ADD CONSTRAINT "stop_cylinders_trip_stop_id_fkey" FOREIGN KEY ("trip_stop_id") REFERENCES "trip_stops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stop_cylinders" ADD CONSTRAINT "stop_cylinders_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stop_cylinders" ADD CONSTRAINT "stop_cylinders_cylinder_id_fkey" FOREIGN KEY ("cylinder_id") REFERENCES "cylinders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stop_cylinders" ADD CONSTRAINT "stop_cylinders_cylinder_type_id_fkey" FOREIGN KEY ("cylinder_type_id") REFERENCES "cylinder_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stop_cylinders" ADD CONSTRAINT "stop_cylinders_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "cylinder_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stop_unlabelled_returns" ADD CONSTRAINT "stop_unlabelled_returns_trip_stop_id_fkey" FOREIGN KEY ("trip_stop_id") REFERENCES "trip_stops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stop_unlabelled_returns" ADD CONSTRAINT "stop_unlabelled_returns_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stop_unlabelled_returns" ADD CONSTRAINT "stop_unlabelled_returns_cylinder_type_id_fkey" FOREIGN KEY ("cylinder_type_id") REFERENCES "cylinder_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_confirmations" ADD CONSTRAINT "delivery_confirmations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_confirmation_id_fkey" FOREIGN KEY ("confirmation_id") REFERENCES "delivery_confirmations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- (3) BACKFILLS [hand edit], in the DATA_MODEL §4.4 order.

-- 3.1 last_event_id: the cylinder's newest event (by created_at, then id), only where that event ended at
--     the cylinder's current holder. Otherwise it stays NULL, and the cylinder must be scanned into the
--     store before it can go out again (no IN, no OUT).
UPDATE cylinders c SET last_event_id = e.id
FROM (SELECT DISTINCT ON (cylinder_id) id, cylinder_id, to_custody_type, to_custody_id
      FROM cylinder_events ORDER BY cylinder_id, created_at DESC, id DESC) e
WHERE e.cylinder_id = c.id AND c.last_event_id IS NULL
  AND e.to_custody_type = c.custody_type AND e.to_custody_id = c.custody_id;

-- 3.2 short_no: 1, 2, 3... per distributor by (created_at, id), continuing after the highest number and
--     the counter where some are already set; then next_cylinder_no = max + 1 (it only ever goes up).
--     Labels are reprinted to show the number, written AG-C0042.
UPDATE cylinders c SET short_no = x.base + x.rn
FROM (SELECT c2.id,
             row_number() OVER (PARTITION BY c2.distributor_id ORDER BY c2.created_at, c2.id) AS rn,
             GREATEST(COALESCE((SELECT max(m.short_no) FROM cylinders m WHERE m.distributor_id = c2.distributor_id), 0),
                      d.next_cylinder_no - 1) AS base
      FROM cylinders c2 JOIN distributors d ON d.id = c2.distributor_id
      WHERE c2.short_no IS NULL) x
WHERE c.id = x.id AND c.short_no IS NULL;

UPDATE distributors d SET next_cylinder_no = m.next
FROM (SELECT distributor_id, max(short_no) + 1 AS next FROM cylinders WHERE short_no IS NOT NULL GROUP BY distributor_id) m
WHERE m.distributor_id = d.id AND d.next_cylinder_no < m.next;

-- (4) CHECK CONSTRAINTS [hand edit]. Prisma never diffs CHECKs, so later migrations keep them.
--     PART_FILLED is new in this file, hence ::text in the first one. [changed from DATA_MODEL §4.4] It
--     also says `return_state IS NOT NULL` for TAKEN_BACK: a CHECK passes when its expression is NULL, so
--     without it a taken-back row with no return state would get through.
ALTER TABLE stop_cylinders ADD CONSTRAINT stop_cylinders_return_state_chk CHECK (
     (direction = 'GIVEN' AND return_state IS NULL)
  OR (direction = 'TAKEN_BACK' AND return_state IS NOT NULL AND return_state::text IN ('EMPTY', 'PART_FILLED', 'FULL')));
ALTER TABLE cylinder_events ADD CONSTRAINT cylinder_events_reason_chk CHECK (source IN ('SCAN', 'TYPED', 'REGISTRATION') OR reason IS NOT NULL);
ALTER TABLE stop_unlabelled_returns ADD CONSTRAINT stop_unlabelled_returns_count_chk CHECK (count > 0);
ALTER TABLE delivery_confirmations ADD CONSTRAINT delivery_confirmations_answer_chk CHECK ((status = 'ANSWERED') = (response IS NOT NULL));
