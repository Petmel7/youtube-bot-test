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
- each AI reservation is identified by the reservation ledger entry's `reservationKey`
- settlement entries must reference the exact reservation they finalize or release

## Lifecycle

1. Estimate maximum AI operation cost from backend prompt/comment inputs and configured max output tokens.
2. Atomically reserve credits before calling Gemini and create an immutable `RESERVATION` ledger entry.
3. Execute the AI provider operation.
4. Record actual provider usage metadata in `aiusage`.
5. Calculate actual credit cost from provider usage metadata.
6. Finalize the exact reservation by creating immutable `DEBIT` and `RELEASE` ledger entries. The `RELEASE` entry is also the settlement marker when unused credits are zero.
7. On provider failure, release the exact reservation and do not debit credits.

If usage metadata is missing or finalization fails, the operation is marked for accounting recovery and must not be treated as fully successful billing.

The wallet ledger is the financial source of truth. `aiusage` stores reconciliation metadata such as reservation, debit, and release keys so a retry can recognize an existing reservation, complete a missing finalization from recorded usage, release a failed provider operation, or reconcile a finalized wallet charge without debiting twice.

## Development Credits

Development/test credit grants must use `WalletService.grantDevelopmentCredits`, which creates an auditable `CREDIT` ledger transaction. Do not mutate wallet balances directly and do not add public credit-granting endpoints.

## Concurrency Strategy

Wallet changes use atomic MongoDB updates and short database transactions for reservation, finalization, release, and ledger creation. No database transaction is held open while Gemini is running.

## Phase 3A Payment Foundation

Phase 3A defines backend-owned payment intent and package-pricing primitives only. It does not perform blockchain verification, RPC calls, wallet balance credits, payment settlement, routes, controllers, frontend wallet UI, reconciliation workers, or refunds.

The approved MVP payment rail is Base Mainnet native USDC:

- chain ID: `8453`
- token: native USDC
- token decimals: `6`
- treasury address: backend configuration only

Users may choose a server-defined package, but the frontend must not provide financial facts such as chain ID, token address, token decimals, recipient, token amount, USD value, credit amount, confirmation count, or payment status.

Each `PaymentIntent` stores an immutable snapshot of the selected package and payment configuration. The snapshot includes the package ID, credit amount, USD minor units, ERC-20 base-unit token amount as a canonical decimal string, pricing version, chain ID, token address, token decimals, and recipient address. Future verification and settlement must use this stored snapshot rather than current package configuration.

Payment intent creation is idempotent by authenticated `userId + idempotencyKey`. Token base-unit amounts are stored as decimal strings and must not be calculated with JavaScript floating-point arithmetic.

## Phase 3B Payment Verification

Phase 3B adds backend-only Base Mainnet USDC verification. Blockchain access is isolated behind `src/services/payments/evmProvider.js`, and payment verification lives in `src/services/payments/paymentVerifier.js`.

The verifier checks the configured Base chain ID `8453`, the Base native USDC contract `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, and the frozen `PaymentIntent` snapshot. It validates ERC-20 `Transfer(address indexed from, address indexed to, uint256 value)` logs emitted by the configured USDC contract instead of using `transaction.to` as the recipient. Amount comparisons use exact `BigInt` base-unit values.

Confirmation count uses the application policy `max(0, currentBlock - receipt.blockNumber + 1)` and compares it to `PAYMENT_CONFIRMATIONS`. This threshold is an application confirmation policy, not a protocol-finality guarantee.

The verifier is side-effect free: it does not settle payment intents, credit wallets, create `WalletTransaction` records, run reconciliation, or perform live RPC calls in tests.

## Phase 3C Payment Settlement

Phase 3C settles only a persisted, already-verified `PaymentIntent`. It does not call Base RPC or `ethers` inside settlement. Blockchain verification ends before settlement begins.

Settlement runs in one MongoDB transaction and enforces:

```text
one verified PaymentIntent
  =
one WalletTransaction(type=CREDIT)
  =
one Wallet.balance increment
```

The deterministic payment CREDIT idempotency key is `payment:${paymentIntentId}:credit`. Payment ledger rows also store immutable `paymentIntentId`, `chainId`, and `txHash`, with payment-specific unique partial indexes for one CREDIT per payment intent and one CREDIT per blockchain transaction.

Settlement credits only the frozen `PaymentIntent.creditAmount`. For `CONFIRMED_OVERPAID`, the excess token base units are stored as `overpaidAmountBaseUnits` metadata and do not mint extra credits. `Wallet.reserved` is not changed by payment settlement.
