# Billing Foundation

Phase 2 uses integer `AI_CREDIT` accounting. Wallet balances are not USD floats; provider/model pricing is represented by backend-controlled integer token rates:

- `AI_PROMPT_TOKEN_CREDIT_RATE`
- `AI_OUTPUT_TOKEN_CREDIT_RATE`
- `AI_ESTIMATED_INPUT_CHARS_PER_TOKEN`

## Wallet Invariants

- `balance >= 0`
- `reserved >= 0`
- `reserved <= balance`
- `available = balance - reserved`
- each accounting operation has a unique deterministic idempotency key
- ledger records are historical accounting records and must not be updated or deleted

## Lifecycle

1. Estimate maximum AI operation cost from backend prompt/comment inputs and configured max output tokens.
2. Atomically reserve credits before calling Gemini.
3. Execute the AI provider operation.
4. Record actual provider usage metadata in `aiusage`.
5. Calculate actual credit cost from provider usage metadata.
6. Finalize the debit and release unused reservation credits.
7. On provider failure, release the full reservation and do not debit credits.

If usage metadata is missing or finalization fails, the operation is marked for accounting recovery and must not be treated as fully successful billing.

## Development Credits

Development/test credit grants must use `WalletService.grantDevelopmentCredits`, which creates an auditable `CREDIT` ledger transaction. Do not mutate wallet balances directly and do not add public credit-granting endpoints.

## Concurrency Strategy

Wallet changes use atomic MongoDB updates and short database transactions for reservation, finalization, release, and ledger creation. No database transaction is held open while Gemini is running.
