# Billing Foundation

Phase 2 uses integer `AI_CREDIT` accounting. Wallet balances are not USD floats; one AI reply attempt is priced by a backend-controlled flat cost:

- `AI_REPLY_CREDIT_COST` defaults to `10`

Gemini token usage is still recorded for observability, but prompt/output token counts do not determine the charged credits by default. The legacy token-rate settings may remain configured as non-negative integers for compatibility with older calculations:

- `AI_PROMPT_TOKEN_CREDIT_RATE` defaults to `0`
- `AI_OUTPUT_TOKEN_CREDIT_RATE` defaults to `0`
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

1. Estimate AI operation cost from the configured flat reply cost and keep token estimates as metadata.
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

Phase 3I moves payment package configuration to business pricing only. `PAYMENT_PACKAGES_JSON` entries contain `packageId`, `creditAmount`, and `expectedUsdAmountMinor`; they must not contain `expectedTokenAmountBaseUnits`. At intent creation time, the backend calculates and freezes the token amount from the selected payment method's token decimals, assuming supported stablecoins price at `1 USD = 1 token`. For example, `expectedUsdAmountMinor: 1000` becomes `10000000` base units for a 6-decimal stablecoin and `10000000000000000000` base units for an 18-decimal stablecoin.

Phase 3J adds production EVM USDC payment methods through `PAYMENT_METHODS_JSON`: `ethereum-mainnet-usdc` for Circle native USDC on Ethereum mainnet and `bnb-mainnet-usdc` for Binance-Peg USDC on BNB Chain. Do not label the BNB Chain token as native Circle USDC. A production dotenv value may enable both methods as a single-line JSON array such as `[{"id":"ethereum-mainnet-usdc","enabled":true,"rpcUrl":"https://YOUR_ETHEREUM_RPC","treasuryAddress":"0xYOUR_TREASURY"},{"id":"bnb-mainnet-usdc","enabled":true,"rpcUrl":"https://bsc-dataseed.bnbchain.org","treasuryAddress":"0xYOUR_TREASURY"}]`.

For development smoke testing, `bnb-testnet-usdc` enables the BSC testnet USDC token at `0x64544969ed7ebf5f083679233325356ebe738930` with 18 decimals. It is non-production only and requires `ALLOW_TESTNET_PAYMENTS=true`. A Base Sepolia plus BNB testnet smoke `PAYMENT_METHODS_JSON` value can be `[{"id":"base-sepolia-usdc","enabled":true,"rpcUrl":"https://base-sepolia.drpc.org","treasuryAddress":"0xYOUR_TREASURY"},{"id":"bnb-testnet-usdc","enabled":true,"rpcUrl":"https://data-seed-prebsc-1-s1.binance.org:8545","treasuryAddress":"0xYOUR_TREASURY"}]`.

Phase 3K adds production EVM USDT payment methods: `ethereum-mainnet-usdt` for Tether native USDT on Ethereum mainnet and `bnb-mainnet-usdt` for Binance-Peg USDT on BNB Chain. Ethereum USDT uses an older ERC-20 implementation whose `transfer` does not return a boolean, so client transaction submission must use the transaction hash and backend receipt/log verification rather than relying on a return value. A production USDC+USDT dotenv value can be `[{"id":"ethereum-mainnet-usdc","enabled":true,"rpcUrl":"https://YOUR_ETHEREUM_RPC","treasuryAddress":"0xYOUR_TREASURY"},{"id":"ethereum-mainnet-usdt","enabled":true,"rpcUrl":"https://YOUR_ETHEREUM_RPC","treasuryAddress":"0xYOUR_TREASURY"},{"id":"bnb-mainnet-usdc","enabled":true,"rpcUrl":"https://bsc-dataseed.bnbchain.org","treasuryAddress":"0xYOUR_TREASURY"},{"id":"bnb-mainnet-usdt","enabled":true,"rpcUrl":"https://bsc-dataseed.bnbchain.org","treasuryAddress":"0xYOUR_TREASURY"}]`.

For development smoke testing, `bnb-testnet-usdt` enables the BSC testnet USDT token at `0x668a9fdc6c6790985ef03ebefeb72d8a0ef652d5` with 18 decimals. This is a smoke-only testnet method, not canonical Tether issuance. It is non-production only and requires `ALLOW_TESTNET_PAYMENTS=true`. A Base Sepolia plus BNB USDC/USDT testnet smoke value can be `[{"id":"base-sepolia-usdc","enabled":true,"rpcUrl":"https://base-sepolia.drpc.org","treasuryAddress":"0xYOUR_TREASURY"},{"id":"bnb-testnet-usdc","enabled":true,"rpcUrl":"https://data-seed-prebsc-1-s1.binance.org:8545","treasuryAddress":"0xYOUR_TREASURY"},{"id":"bnb-testnet-usdt","enabled":true,"rpcUrl":"https://data-seed-prebsc-1-s1.binance.org:8545","treasuryAddress":"0xYOUR_TREASURY"}]`.

For Ethereum testnet smoke testing, `ethereum-sepolia-usdt` enables the Sepolia token at `0x7169d38820dfd117c3fa1f22a697dba58d90ba06` with 6 decimals. This is a smoke-only Sepolia test token, not documented here as official Tether issuance, and it requires `ALLOW_TESTNET_PAYMENTS=true` outside production. A single-line dotenv value can be `[{"id":"ethereum-sepolia-usdt","enabled":true,"rpcUrl":"https://YOUR_ETHEREUM_SEPOLIA_RPC","treasuryAddress":"0xYOUR_TREASURY"}]`.

## Phase 3L Payment Configuration Hardening

Payment methods are backend-owned and whitelist-based. `PAYMENT_METHODS_JSON` is the preferred multi-method configuration surface and, when present, takes precedence over legacy single-method `PAYMENT_NETWORK`, `PAYMENT_CHAIN_ID`, `PAYMENT_RPC_URL`, and `PAYMENT_TOKEN_ADDRESS` values. Legacy config remains a compatibility path for the Base USDC methods only.

Enabled methods must match the whitelist exactly for namespace, network identity, token or mint address, token symbol, token decimals, asset type, and asset provenance. Environment config may enable a method and provide method-specific `rpcUrl`, `treasuryAddress`, and confirmations, but it must not redefine token identity. Production accepts production methods only. Testnet and smoke methods require `ALLOW_TESTNET_PAYMENTS=true` and a local non-production `NODE_ENV`.

Public payment method DTOs intentionally omit RPC URLs and internal env details. They expose display and wallet-transfer fields only: id, name, namespace, network, CAIP network id, enabled/testnet/smoke indicators, and token or mint metadata. Existing `PaymentIntent` documents keep immutable snapshots, so later config changes must not alter verification, settlement, recipient, amount, payer, pricing, or credit expectations for already-created intents. New `PaymentIntent` snapshots intentionally omit payment method `rpcUrl`; verification resolves provider RPC endpoints from current server-side config while still checking the frozen non-secret payment identity fields from the intent.

## Phase 3O Admin Payment Config Change Workflow

Admin payment config changes are staged proposals, not direct live edits. The environment whitelist remains the maximum allowed payment surface: admins can only change `enabled`, `treasuryAddress`, and `confirmations` for methods already present in the validated server environment. They cannot add arbitrary method IDs, networks, chain IDs, token or mint addresses, decimals, asset provenance, or RPC URLs.

RPC URLs and any provider credentials remain environment-managed and are not stored or returned by the admin workflow. Proposal previews and audit records use safe method summaries only.

The proposal lifecycle is:

```text
PENDING_CONFIRMATION
  -> exact phrase confirmation
  -> APPROVED in non-production
  -> PENDING_APPROVAL in production
  -> second distinct admin approval in production
  -> APPROVED
  -> transactional activation
  -> ACTIVATED
```

Proposals may also be rejected, cancelled, or expire before activation. Activation writes a new `PaymentConfigActive` version and an audit record in the same MongoDB transaction. The active runtime config is built by overlaying those safe active fields onto the current environment methods, so removing a method from env config fails closed.

Activated changes affect only future `PaymentIntent` creation. Existing `PaymentIntent` snapshots are immutable and keep their original recipient, confirmations, token identity, amount, pricing, and payer binding for verification and settlement. Emergency rollback should be performed by creating and activating a new proposal that restores the previous safe values; secret/RPC rollback remains an environment/deploy operation.

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

`PaymentIntent.creditedTransactionId` is write-once: settlement may assign it from `null` to the payment CREDIT transaction, but normal model updates must not replace, null, or unset it after assignment.

Payment CREDIT ledger snapshots must reflect the wallet mutation's serialized balance transition: `balanceAfter = balanceBefore + amount`. The balance increment uses atomic `$inc`; settlement does not overwrite or recalculate `reserved`.

The gated real-MongoDB settlement integration test requires `PAYMENT_SETTLEMENT_INTEGRATION_MONGO_URI` to point at an explicit test/integration database backed by a transaction-capable topology. Normal `npm test` skips this live integration coverage when the variable is not configured.

## Phase 3D Payment API Lifecycle

Authenticated users create payment intents with `POST /api/payments/intents`. The request supplies a backend package ID plus an opaque `Idempotency-Key`; pricing, token amount, credit amount, chain, token contract, recipient, expiry, and pricing version all come from backend configuration and the stored package snapshot.

Clients read lifecycle state with `GET /api/payments/intents/:id`. Lookups are scoped to the authenticated user, so one user cannot read or verify another user's intent.

After sending Base USDC, the client submits only the canonical transaction hash to `POST /api/payments/intents/:id/verify`. The backend stores the hash on the user's intent, runs the verifier, persists verifier-derived metadata, maps the result into the existing `PaymentIntent` statuses, and calls settlement only for `CONFIRMED` or `CONFIRMED_OVERPAID`.

Insufficient confirmations remain `CONFIRMING`; underpaid and rejected payments do not settle. Successful settlement credits exactly the frozen `PaymentIntent.creditAmount`, and overpayment remains metadata only.

Payment verify throttling runs before provider/RPC verification. The middleware supports an injected shared throttle store interface, but the default store is process-local in memory. Multi-instance production deployments should wire this interface to MongoDB, Redis, or another shared TTL-capable store before relying on the limit as a fleet-wide RPC quota control.
