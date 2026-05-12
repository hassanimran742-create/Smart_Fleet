# Payments Integration

## Providers (v1)
- **JazzCash Mobile Account & MWALLET** (Merchant API)
- **Easypaisa MA** (Merchant API)
- **Bank transfer** — manual proof-of-payment upload + operator verification
- **Cash** — driver collects, recorded at delivery, reconciled end-of-day

All flow through a `PaymentProvider` interface so a new gateway is one file + DI binding.

## Ledger model
Every distributor has a running `advance_balance_paisa`. Every payment **credits** the ledger; every delivered order **debits** it. Source of truth = `ledger_entries` (append-only); `distributors.advance_balance_paisa` is the cached sum.

```
top up via JazzCash 5000 PKR  → ledger_entry +500000 paisa, CREDIT_TOPUP
deliver order, fee 250 PKR    → ledger_entry  −25000 paisa, DEBIT_ORDER
```

Negative balances allowed only with admin-set credit limit.

## JazzCash MWALLET flow (sandbox & prod)

```
1. distributor taps "Top up via JazzCash" → POST /payments/topup {provider:JAZZCASH, amount}
2. API creates Payment(PENDING, provider_txn_id=local-uuid, amount)
3. API redirects mobile to JazzCash hosted checkout URL with HMAC-signed payload:
     pp_MerchantID, pp_Password, pp_TxnRefNo (our local-uuid),
     pp_Amount (in paisa), pp_TxnCurrency=PKR, pp_TxnDateTime,
     pp_BillReference, pp_Description, pp_ReturnURL, pp_SecureHash
   pp_SecureHash = HMAC-SHA256(integritySalt, sorted-pp_-fields-concatenated)
4. User completes auth on JazzCash; provider redirects back to pp_ReturnURL
5. JazzCash also calls IPN webhook → POST /payments/webhook/jazzcash
6. API verifies pp_SecureHash, idempotency check on pp_TxnRefNo
7. On SUCCESS: ledger_entry CREDIT_TOPUP, payment.status=SUCCESS
8. On FAILED: payment.status=FAILED
```

## Easypaisa flow
Similar to JazzCash. Field names differ (`storeId`, `orderRefNum`, `merchantHashedReq`). Implementation lives in `EasypaisaProvider`.

## Webhook idempotency
- Webhook handler: `payments.handleProviderCallback(provider, payload)`.
- Idempotency key: `(provider, provider_txn_id)`. UNIQUE constraint on `payments` table.
- If a duplicate webhook arrives, respond 200 OK with the existing payment's result — never double-credit.

## Manual bank transfer
```
distributor uploads receipt photo + bank ref → Payment(PENDING, provider=BANK_MANUAL, proof_url)
operator reviews on admin-web → marks SUCCESS or FAILED with note
on SUCCESS → ledger_entry CREDIT_TOPUP
```

## Cash at delivery
- Driver marks order DELIVERED with `payment_method=CASH` and amount.
- `payment` record created with provider=CASH, status=SUCCESS, recorded by driver.
- End-of-day reconciliation matches sum(cash payments) against `submitted_cash_paisa`.

## Webhook security
- Verify provider signature (HMAC).
- IP allowlist where provider publishes IPs.
- Replay protection via UNIQUE constraint + timestamp check (reject events older than 24h).

## Reconciliation cron
Daily 02:00 PKT, `payments.reconciliationCron`:
1. Pull yesterday's settled txns from each provider's settlement API.
2. Match against local SUCCESS payments by `provider_txn_id`.
3. Flag mismatches in `support_tickets` for ops.

## PCI / compliance
We never hold card data — JazzCash/Easypaisa handle it on their hosted pages. We only persist:
- `provider`, `provider_txn_id`, `amount_paisa`, `status`, last-4 if returned, `created_at`.
No PAN, no CVV, no card token.

## Onboarding paperwork — critical path
- **JazzCash Business merchant account** — apply ASAP (4–8 weeks).
- **Easypaisa MA merchant** — same. Both need: SECP/FBR registration, bank account, KYC of directors.
- Track in `support_tickets` or external Jira; do **not** code-block on this — implement the provider class against sandbox credentials first.
