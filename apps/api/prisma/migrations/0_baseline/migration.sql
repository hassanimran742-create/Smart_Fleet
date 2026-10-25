-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'DISPATCHER', 'STORE_KEEPER', 'DISTRIBUTOR', 'DRIVER', 'CLIENT');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('LOGIN', 'RESET');

-- CreateEnum
CREATE TYPE "CylinderState" AS ENUM ('FULL', 'EMPTY', 'FAULTY', 'LOST');

-- CreateEnum
CREATE TYPE "CustodyType" AS ENUM ('DISTRIBUTOR', 'STORE', 'VEHICLE', 'CLIENT');

-- CreateEnum
CREATE TYPE "CylinderEventType" AS ENUM ('SCAN_IN', 'SCAN_OUT', 'DELIVERED', 'PICKED_UP_EMPTY', 'RETURNED_TO_DISTRIBUTOR', 'TRANSFER', 'MARK_FAULTY', 'MARK_LOST');

-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('ACTIVE', 'MAINTENANCE', 'RETIRED');

-- CreateEnum
CREATE TYPE "DriverAvailability" AS ENUM ('AVAILABLE', 'ON_LEAVE', 'OFF_DUTY');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'ASSIGNED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "OrderPaymentStatus" AS ENUM ('UNPAID', 'PAID_VIA_LEDGER', 'PAID_DIRECT');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'ABORTED');

-- CreateEnum
CREATE TYPE "TripStopType" AS ENUM ('STORE_PICKUP', 'DELIVERY', 'RETURN_DROPOFF');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('REQUESTED', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentProviderName" AS ENUM ('JAZZCASH', 'EASYPAISA', 'BANK_MANUAL', 'CASH');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('CREDIT_TOPUP', 'DEBIT_ORDER', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "DistributorStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('PENDING', 'VERIFIED', 'FLAGGED');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('DISPATCH_NO_CANDIDATE', 'LOW_STOCK', 'ORDER_STUCK_PENDING', 'DRIVER_OFFLINE_WHILE_ON_TRIP', 'PAYMENT_FAILED', 'RECONCILIATION_MISMATCH', 'CYLINDER_LOST', 'DISTRIBUTOR_BALANCE_LOW', 'DISTRIBUTOR_CREDIT_OVER', 'STORE_STOCK_LOW', 'SPECIAL_CLIENT', 'OTHER');

-- CreateEnum
CREATE TYPE "AlertRuleKind" AS ENUM ('DISTRIBUTOR_BALANCE_LOW', 'DISTRIBUTOR_CREDIT_OVER', 'STORE_STOCK_LOW', 'SPECIAL_CLIENT');

-- CreateEnum
CREATE TYPE "AccessoryCategory" AS ENUM ('PIPE', 'CONNECTOR', 'REGULATOR', 'VALVE', 'BURNER', 'HOSE', 'ADAPTER', 'VAPORISER', 'OTHER');

-- CreateEnum
CREATE TYPE "AccessoryMovementReason" AS ENUM ('RECEIPT', 'SALE', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT', 'DAMAGE_LOSS');

-- CreateEnum
CREATE TYPE "FillingOrderStatus" AS ENUM ('PENDING', 'ASSIGNED', 'EMPTIES_PICKED', 'AT_STATION', 'FILLED', 'RETURNED', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "FillingServiceType" AS ENUM ('OUR_SERVICE', 'DIY');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('FOOD', 'UTILITIES', 'LABOUR', 'FUEL', 'MAINTENANCE', 'RENT', 'OFFICE', 'TRAVEL', 'EQUIPMENT', 'OTHER');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING',
    "cnic" TEXT,
    "profile_picture_url" TEXT,
    "cnic_encrypted" BYTEA,
    "cnic_index" CHAR(64),
    "password_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_codes" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "parent_id" UUID,
    "revoked_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "distributors" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "business_name" TEXT NOT NULL,
    "home_store_id" UUID,
    "advance_balance_paisa" BIGINT NOT NULL DEFAULT 0,
    "status" "DistributorStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "distributors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drivers" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "licence_no" TEXT NOT NULL,
    "current_vehicle_id" UUID,
    "current_zone_id" UUID,
    "current_location" geometry(Point,4326),
    "current_location_updated_at" TIMESTAMP(3),
    "is_online" BOOLEAN NOT NULL DEFAULT false,
    "availability" "DriverAvailability" NOT NULL DEFAULT 'AVAILABLE',
    "leave_start" TIMESTAMP(3),
    "leave_end" TIMESTAMP(3),
    "leave_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_shifts" (
    "id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "driver_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cities" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "country_code" TEXT NOT NULL DEFAULT 'PK',

    CONSTRAINT "cities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zones" (
    "id" UUID NOT NULL,
    "city_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "polygon" geometry(MultiPolygon,4326) NOT NULL,
    "centroid" geometry(Point,4326),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stores" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "zone_id" UUID NOT NULL,
    "address" TEXT NOT NULL,
    "location" geometry(Point,4326) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL,
    "plate_no" TEXT NOT NULL,
    "capacity_units" INTEGER NOT NULL,
    "home_zone_id" UUID NOT NULL,
    "status" "VehicleStatus" NOT NULL DEFAULT 'ACTIVE',
    "current_odometer_km" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL,
    "distributor_id" UUID NOT NULL,
    "user_id" UUID,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT,
    "area" TEXT,
    "city" TEXT,
    "credit_limit_paisa" BIGINT NOT NULL DEFAULT 0,
    "priority" INTEGER NOT NULL DEFAULT 3,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_addresses" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "location" geometry(Point,4326) NOT NULL,

    CONSTRAINT "client_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cylinder_types" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "weight_kg" DECIMAL(6,2) NOT NULL,
    "capacity_units" INTEGER NOT NULL,

    CONSTRAINT "cylinder_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cylinders" (
    "id" UUID NOT NULL,
    "serial" TEXT NOT NULL,
    "qr_code" TEXT NOT NULL,
    "distributor_id" UUID NOT NULL,
    "cylinder_type_id" UUID NOT NULL,
    "state" "CylinderState" NOT NULL DEFAULT 'EMPTY',
    "custody_type" "CustodyType" NOT NULL,
    "custody_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cylinders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cylinder_events" (
    "id" UUID NOT NULL,
    "cylinder_id" UUID NOT NULL,
    "event_type" "CylinderEventType" NOT NULL,
    "from_custody_type" "CustodyType",
    "from_custody_id" UUID,
    "to_custody_type" "CustodyType",
    "to_custody_id" UUID,
    "actor_user_id" UUID NOT NULL,
    "photo_url" TEXT,
    "location" geometry(Point,4326),
    "trip_id" UUID,
    "order_id" UUID,
    "transfer_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cylinder_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_lots" (
    "id" UUID NOT NULL,
    "holder_type" "CustodyType" NOT NULL,
    "holder_id" UUID NOT NULL,
    "distributor_id" UUID NOT NULL,
    "cylinder_type_id" UUID NOT NULL,
    "state" "CylinderState" NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfers" (
    "id" UUID NOT NULL,
    "from_store_id" UUID NOT NULL,
    "to_store_id" UUID NOT NULL,
    "vehicle_id" UUID,
    "driver_id" UUID,
    "scheduled_for" TIMESTAMP(3),
    "notes" TEXT,
    "status" "TransferStatus" NOT NULL DEFAULT 'REQUESTED',
    "requested_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_lines" (
    "id" UUID NOT NULL,
    "transfer_id" UUID NOT NULL,
    "cylinder_id" UUID NOT NULL,

    CONSTRAINT "transfer_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_rules" (
    "id" UUID NOT NULL,
    "city_id" UUID NOT NULL,
    "origin_zone_id" UUID NOT NULL,
    "dest_zone_id" UUID NOT NULL,
    "cylinder_type_id" UUID NOT NULL,
    "base_paisa" BIGINT NOT NULL,
    "per_unit_paisa" BIGINT NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_until" TIMESTAMP(3),

    CONSTRAINT "pricing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "distributor_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "delivery_address" geometry(Point,4326) NOT NULL,
    "delivery_address_label" TEXT NOT NULL,
    "dest_zone_id" UUID NOT NULL,
    "origin_store_id" UUID,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "payment_status" "OrderPaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "delivery_fee_paisa" BIGINT NOT NULL DEFAULT 0,
    "scheduled_window_start" TIMESTAMP(3),
    "scheduled_window_end" TIMESTAMP(3),
    "trip_id" UUID,
    "cancellation_reason" TEXT,
    "client_confirmed_at" TIMESTAMP(3),
    "empties_handed_over_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_lines" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "cylinder_type_id" UUID NOT NULL,
    "full_count" INTEGER NOT NULL,
    "expected_return_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trips" (
    "id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "origin_store_id" UUID NOT NULL,
    "status" "TripStatus" NOT NULL DEFAULT 'PLANNED',
    "planned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_stops" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "order_id" UUID,
    "seq" INTEGER NOT NULL,
    "stop_type" "TripStopType" NOT NULL,
    "location" geometry(Point,4326) NOT NULL,
    "eta_at" TIMESTAMP(3),
    "arrived_at" TIMESTAMP(3),
    "departed_at" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "trip_stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "distributor_id" UUID NOT NULL,
    "amount_paisa" BIGINT NOT NULL,
    "provider" "PaymentProviderName" NOT NULL,
    "provider_txn_id" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "proof_url" TEXT,
    "verified_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "distributor_id" UUID NOT NULL,
    "entry_type" "LedgerEntryType" NOT NULL,
    "amount_paisa" BIGINT NOT NULL,
    "balance_after_paisa" BIGINT NOT NULL,
    "payment_id" UUID,
    "order_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliations" (
    "id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "for_date" DATE NOT NULL,
    "expected_cash_paisa" BIGINT NOT NULL,
    "submitted_cash_paisa" BIGINT NOT NULL,
    "cylinders_delivered" INTEGER NOT NULL,
    "cylinders_returned" INTEGER NOT NULL,
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'PENDING',
    "verified_by_user_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" UUID NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" UUID,
    "reporter_user_id" UUID NOT NULL,
    "assignee_user_id" UUID,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "priority" INTEGER NOT NULL DEFAULT 3,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" UUID,
    "diff" JSONB,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_rules" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "rule_kind" "AlertRuleKind" NOT NULL,
    "threshold" BIGINT NOT NULL DEFAULT 0,
    "resource_id" UUID,
    "cylinder_type_id" UUID,
    "severity" "AlertSeverity" NOT NULL DEFAULT 'WARNING',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_triggered_at" TIMESTAMP(3),

    CONSTRAINT "alert_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" UUID NOT NULL,
    "alert_type" "AlertType" NOT NULL,
    "severity" "AlertSeverity" NOT NULL DEFAULT 'WARNING',
    "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "resource_type" TEXT,
    "resource_id" UUID,
    "context" JSONB,
    "acknowledged_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expo_push_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expo_push_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accessories" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "AccessoryCategory" NOT NULL,
    "unit" TEXT NOT NULL,
    "default_price_paisa" BIGINT NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accessories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accessory_stock" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "accessory_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "unit_price_paisa" BIGINT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accessory_stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accessory_movements" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "accessory_id" UUID NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" "AccessoryMovementReason" NOT NULL,
    "note" TEXT,
    "actor_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accessory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "filling_stations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "location" geometry(Point,4326) NOT NULL,
    "price_per_cylinder_paisa" BIGINT NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "filling_stations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "filling_orders" (
    "id" UUID NOT NULL,
    "distributor_id" UUID NOT NULL,
    "filling_station_id" UUID,
    "cylinder_type_id" UUID NOT NULL,
    "service_type" "FillingServiceType" NOT NULL DEFAULT 'OUR_SERVICE',
    "own_station_name" TEXT,
    "own_station_address" TEXT,
    "own_station_notes" TEXT,
    "requested_count" INTEGER NOT NULL,
    "picked_up_empty_count" INTEGER,
    "filled_count" INTEGER,
    "price_per_cylinder_paisa" BIGINT NOT NULL,
    "total_cost_paisa" BIGINT NOT NULL DEFAULT 0,
    "status" "FillingOrderStatus" NOT NULL DEFAULT 'PENDING',
    "assigned_driver_id" UUID,
    "assigned_vehicle_id" UUID,
    "pickup_store_id" UUID,
    "cancellation_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "filling_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "amount_paisa" BIGINT NOT NULL,
    "expense_date" DATE NOT NULL,
    "receipt_url" TEXT,
    "recorded_by_user_id" UUID NOT NULL,
    "vendor" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_refills" (
    "id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "litres" DECIMAL(8,2) NOT NULL,
    "cost_paisa" BIGINT NOT NULL,
    "odometer_km" INTEGER NOT NULL,
    "fuel_station" TEXT,
    "receipt_url" TEXT,
    "notes" TEXT,
    "refill_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fuel_refills_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "otp_codes_phone_created_at_idx" ON "otp_codes"("phone", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "distributors_user_id_key" ON "distributors"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_user_id_key" ON "drivers"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_licence_no_key" ON "drivers"("licence_no");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_current_vehicle_id_key" ON "drivers"("current_vehicle_id");

-- CreateIndex
CREATE INDEX "drivers_is_online_idx" ON "drivers"("is_online");

-- CreateIndex
CREATE INDEX "drivers_availability_idx" ON "drivers"("availability");

-- CreateIndex
CREATE INDEX "driver_shifts_driver_id_started_at_idx" ON "driver_shifts"("driver_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_plate_no_key" ON "vehicles"("plate_no");

-- CreateIndex
CREATE UNIQUE INDEX "clients_user_id_key" ON "clients"("user_id");

-- CreateIndex
CREATE INDEX "clients_distributor_id_idx" ON "clients"("distributor_id");

-- CreateIndex
CREATE INDEX "clients_distributor_id_phone_idx" ON "clients"("distributor_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "cylinder_types_code_key" ON "cylinder_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "cylinders_serial_key" ON "cylinders"("serial");

-- CreateIndex
CREATE UNIQUE INDEX "cylinders_qr_code_key" ON "cylinders"("qr_code");

-- CreateIndex
CREATE INDEX "cylinders_distributor_id_cylinder_type_id_state_custody_typ_idx" ON "cylinders"("distributor_id", "cylinder_type_id", "state", "custody_type");

-- CreateIndex
CREATE INDEX "cylinder_events_cylinder_id_created_at_idx" ON "cylinder_events"("cylinder_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_lots_holder_type_holder_id_distributor_id_cylinde_key" ON "inventory_lots"("holder_type", "holder_id", "distributor_id", "cylinder_type_id", "state");

-- CreateIndex
CREATE INDEX "transfers_driver_id_status_idx" ON "transfers"("driver_id", "status");

-- CreateIndex
CREATE INDEX "transfers_scheduled_for_idx" ON "transfers"("scheduled_for");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_lines_transfer_id_cylinder_id_key" ON "transfer_lines"("transfer_id", "cylinder_id");

-- CreateIndex
CREATE UNIQUE INDEX "pricing_rules_city_id_origin_zone_id_dest_zone_id_cylinder__key" ON "pricing_rules"("city_id", "origin_zone_id", "dest_zone_id", "cylinder_type_id", "effective_from");

-- CreateIndex
CREATE INDEX "orders_distributor_id_status_idx" ON "orders"("distributor_id", "status");

-- CreateIndex
CREATE INDEX "orders_status_created_at_idx" ON "orders"("status", "created_at");

-- CreateIndex
CREATE INDEX "trips_driver_id_status_idx" ON "trips"("driver_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "trip_stops_trip_id_seq_key" ON "trip_stops"("trip_id", "seq");

-- CreateIndex
CREATE INDEX "payments_distributor_id_created_at_idx" ON "payments"("distributor_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_provider_txn_id_key" ON "payments"("provider", "provider_txn_id");

-- CreateIndex
CREATE INDEX "ledger_entries_distributor_id_created_at_idx" ON "ledger_entries"("distributor_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliations_driver_id_for_date_key" ON "reconciliations"("driver_id", "for_date");

-- CreateIndex
CREATE INDEX "support_tickets_status_priority_idx" ON "support_tickets"("status", "priority");

-- CreateIndex
CREATE INDEX "audit_logs_resource_type_resource_id_idx" ON "audit_logs"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "alert_rules_is_active_rule_kind_idx" ON "alert_rules"("is_active", "rule_kind");

-- CreateIndex
CREATE INDEX "alerts_status_severity_created_at_idx" ON "alerts"("status", "severity", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "expo_push_tokens_token_key" ON "expo_push_tokens"("token");

-- CreateIndex
CREATE INDEX "expo_push_tokens_user_id_idx" ON "expo_push_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "accessories_code_key" ON "accessories"("code");

-- CreateIndex
CREATE INDEX "accessory_stock_store_id_idx" ON "accessory_stock"("store_id");

-- CreateIndex
CREATE UNIQUE INDEX "accessory_stock_store_id_accessory_id_key" ON "accessory_stock"("store_id", "accessory_id");

-- CreateIndex
CREATE INDEX "accessory_movements_store_id_created_at_idx" ON "accessory_movements"("store_id", "created_at");

-- CreateIndex
CREATE INDEX "accessory_movements_accessory_id_created_at_idx" ON "accessory_movements"("accessory_id", "created_at");

-- CreateIndex
CREATE INDEX "filling_orders_assigned_driver_id_status_idx" ON "filling_orders"("assigned_driver_id", "status");

-- CreateIndex
CREATE INDEX "filling_orders_status_created_at_idx" ON "filling_orders"("status", "created_at");

-- CreateIndex
CREATE INDEX "expenses_expense_date_idx" ON "expenses"("expense_date");

-- CreateIndex
CREATE INDEX "expenses_category_expense_date_idx" ON "expenses"("category", "expense_date");

-- CreateIndex
CREATE INDEX "fuel_refills_vehicle_id_refill_at_idx" ON "fuel_refills"("vehicle_id", "refill_at");

-- CreateIndex
CREATE INDEX "fuel_refills_driver_id_refill_at_idx" ON "fuel_refills"("driver_id", "refill_at");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distributors" ADD CONSTRAINT "distributors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distributors" ADD CONSTRAINT "distributors_home_store_id_fkey" FOREIGN KEY ("home_store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_current_vehicle_id_fkey" FOREIGN KEY ("current_vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_current_zone_id_fkey" FOREIGN KEY ("current_zone_id") REFERENCES "zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_shifts" ADD CONSTRAINT "driver_shifts_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zones" ADD CONSTRAINT "zones_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_home_zone_id_fkey" FOREIGN KEY ("home_zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_distributor_id_fkey" FOREIGN KEY ("distributor_id") REFERENCES "distributors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_addresses" ADD CONSTRAINT "client_addresses_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cylinders" ADD CONSTRAINT "cylinders_distributor_id_fkey" FOREIGN KEY ("distributor_id") REFERENCES "distributors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cylinders" ADD CONSTRAINT "cylinders_cylinder_type_id_fkey" FOREIGN KEY ("cylinder_type_id") REFERENCES "cylinder_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cylinder_events" ADD CONSTRAINT "cylinder_events_cylinder_id_fkey" FOREIGN KEY ("cylinder_id") REFERENCES "cylinders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cylinder_events" ADD CONSTRAINT "cylinder_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_from_store_id_fkey" FOREIGN KEY ("from_store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_to_store_id_fkey" FOREIGN KEY ("to_store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_lines" ADD CONSTRAINT "transfer_lines_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_lines" ADD CONSTRAINT "transfer_lines_cylinder_id_fkey" FOREIGN KEY ("cylinder_id") REFERENCES "cylinders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_origin_zone_id_fkey" FOREIGN KEY ("origin_zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_dest_zone_id_fkey" FOREIGN KEY ("dest_zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_cylinder_type_id_fkey" FOREIGN KEY ("cylinder_type_id") REFERENCES "cylinder_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_distributor_id_fkey" FOREIGN KEY ("distributor_id") REFERENCES "distributors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_dest_zone_id_fkey" FOREIGN KEY ("dest_zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_origin_store_id_fkey" FOREIGN KEY ("origin_store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_cylinder_type_id_fkey" FOREIGN KEY ("cylinder_type_id") REFERENCES "cylinder_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_origin_store_id_fkey" FOREIGN KEY ("origin_store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_distributor_id_fkey" FOREIGN KEY ("distributor_id") REFERENCES "distributors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_distributor_id_fkey" FOREIGN KEY ("distributor_id") REFERENCES "distributors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_verified_by_user_id_fkey" FOREIGN KEY ("verified_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accessory_stock" ADD CONSTRAINT "accessory_stock_accessory_id_fkey" FOREIGN KEY ("accessory_id") REFERENCES "accessories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accessory_movements" ADD CONSTRAINT "accessory_movements_accessory_id_fkey" FOREIGN KEY ("accessory_id") REFERENCES "accessories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "filling_orders" ADD CONSTRAINT "filling_orders_distributor_id_fkey" FOREIGN KEY ("distributor_id") REFERENCES "distributors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "filling_orders" ADD CONSTRAINT "filling_orders_filling_station_id_fkey" FOREIGN KEY ("filling_station_id") REFERENCES "filling_stations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "filling_orders" ADD CONSTRAINT "filling_orders_cylinder_type_id_fkey" FOREIGN KEY ("cylinder_type_id") REFERENCES "cylinder_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "filling_orders" ADD CONSTRAINT "filling_orders_assigned_driver_id_fkey" FOREIGN KEY ("assigned_driver_id") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "filling_orders" ADD CONSTRAINT "filling_orders_assigned_vehicle_id_fkey" FOREIGN KEY ("assigned_vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "filling_orders" ADD CONSTRAINT "filling_orders_pickup_store_id_fkey" FOREIGN KEY ("pickup_store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_refills" ADD CONSTRAINT "fuel_refills_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_refills" ADD CONSTRAINT "fuel_refills_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

