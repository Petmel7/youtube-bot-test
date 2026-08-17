# Project Instructions

This repository contains a YouTube comment bot with a React frontend and an Express/MongoDB backend. These instructions are the architectural contract for future Codex work in this repo.

Always inspect the relevant existing implementation before changing code. Preserve current behavior unless the task explicitly changes it. Do not commit, push, install packages, modify secrets, or perform destructive database operations unless the user explicitly requests it.

## Stack

Backend:
- Runtime: Node.js `22.x` via `bot-backend/package.json` engines.
- Package manager: npm.
- HTTP server: Express.
- Database: MongoDB with Mongoose.
- Authentication: Passport with `passport-google-oauth20`.
- Sessions: `express-session` with `connect-mongo`.
- Google/YouTube APIs: `googleapis` plus native `fetch` for some YouTube REST calls.
- AI: Gemini via `@google/generative-ai`, isolated behind the current `src/services/ai` provider boundary.
- Tests: Node's built-in `node --test`.
- Development: `nodemon` through `npm run dev`.

Frontend:
- React `19.x`.
- Create React App / `react-scripts`.
- Routing: `react-router-dom`.
- HTTP client: centralized `fetch` wrapper in `bot-frontend/src/services/api.js`.
- State: React local state, contexts, and custom hooks. No Redux/Zustand.
- Styling: CSS and CSS modules.
- i18n: `i18next` / `react-i18next`.

Planned technologies such as queues, billing ledgers, crypto payments, and blockchain providers are not currently implemented.

## Repository Structure

- `bot-backend/server.js`: backend entrypoint and Express wiring.
- `bot-backend/src/config`: environment, CORS, MongoDB, Passport, sessions, validation.
- `bot-backend/src/routes`: Express route definitions.
- `bot-backend/src/controllers`: thin HTTP controllers.
- `bot-backend/src/services`: business workflows and external API orchestration.
- `bot-backend/src/services/ai`: AI provider abstraction, Gemini provider, usage recording.
- `bot-backend/src/models`: Mongoose models.
- `bot-backend/src/middleware`: auth, admin, CSRF-style write header, async/error handling.
- `bot-backend/src/utils`: DTOs, validators, errors, environment helpers.
- `bot-backend/test`: backend tests.
- `bot-frontend/src/pages`: route-level React pages.
- `bot-frontend/src/components`: reusable UI components.
- `bot-frontend/src/hooks`: reusable React behavior.
- `bot-frontend/src/services`: frontend API/domain service calls.
- `bot-frontend/src/context`: React context providers.

Use the simplest structure that preserves separation of concerns. Introduce a new layer only when it has a real responsibility.

## Architecture

Preferred dependency direction:

```text
HTTP/UI
  -> routes/controllers/pages/components
  -> services/use cases/hooks
  -> models/repositories/providers/API clients
  -> infrastructure/config
```

Backend features should normally flow:

```text
route -> controller -> service/use case -> model/provider
```

Frontend features should normally flow:

```text
component/page -> hook/service -> API client -> backend
```

Lower-level modules MUST NOT import higher-level HTTP/UI concerns. Avoid circular dependencies. Frontend MUST NOT import backend modules, and backend MUST NOT depend on frontend implementation.

## Backend Rules

Controllers and route handlers MUST remain thin. They may parse and validate input, rely on authentication middleware, call services, and map service results to HTTP responses.

Controllers MUST NOT contain complex workflows, MongoDB query logic, Gemini SDK calls, YouTube orchestration, payment logic, retry algorithms, or long-running work.

Services own business logic and workflows such as bot execution, authentication business rules, YouTube operations, AI generation, and future quota/billing rules. Services SHOULD be reusable independently from Express handlers and MUST NOT depend on Express `req`/`res` objects.

Database access belongs in Mongoose models or focused data-access modules. Do not put MongoDB queries in React components, controllers, or unrelated utilities.

External APIs MUST be isolated behind provider/service boundaries when SDK details would otherwise leak into business logic.

## Frontend Rules

React components should primarily handle rendering, local UI state, and user interaction.

Components MUST NOT perform direct MongoDB access, direct external provider SDK calls, payment verification, complex backend workflows, or duplicated API logic.

API communication SHOULD go through `bot-frontend/src/services/api.js` or a focused service module that uses it. Reusable React behavior belongs in hooks. Shared non-UI logic belongs in services or utilities.

Do not introduce Redux, Zustand, or another state library unless the project explicitly adopts it for a real state-management need.

## Database Rules

MongoDB access is backend-only. Do not expose raw MongoDB documents directly to the frontend when a DTO/response mapper is appropriate.

Production/application database names MUST be explicit. The app MUST NOT rely on MongoDB's implicit `test` database in production.

Validate data at application boundaries. Use indexes for real query patterns. Use timestamps where operational history matters. Preserve idempotency for duplicate-prone operations.

Avoid unbounded arrays and documents that grow without a clear maximum. Use atomic database operations for counters, balances, ledgers, and idempotent writes.

Never modify production data manually without an explicit migration or maintenance procedure. Structural data changes require an idempotent migration plan, validation, and rollback/recovery thinking.

Current MongoDB models include `users`, `userprompts`, `botruns`, `sessions`, and `aiusage`.

## AI / Gemini Rules

Current AI flow:

```text
youtubeService -> aiProvider -> GeminiProvider -> Gemini SDK
```

Gemini API keys are backend-only. Business workflows MUST use the AI provider boundary rather than calling the Gemini SDK directly.

AI usage metadata must be captured server-side from provider/API responses. Never accept token usage, cost, model, or billing claims from the frontend.

`aiusage` is for accounting metadata only. It MUST NOT store API keys, OAuth tokens, full prompts, full viewer comments, or generated reply text. Token counts must be `null` when the provider does not return them; do not fabricate token usage.

Future billing/credits must be backend-controlled and built on audited usage records, not frontend claims.

## Security

MUST NOT:
- Commit secrets or `.env` files.
- Expose API keys, OAuth tokens, cookies, session contents, or payment secrets to frontend code or logs.
- Return credentials in API responses.
- Trust frontend-provided authorization, identity, pricing, token usage, payment amount, transaction status, chain ID, or blockchain recipient.

MUST:
- Enforce authorization server-side.
- Validate and sanitize external input.
- Treat YouTube comments and user prompts as untrusted input.
- Treat prompt injection as untrusted content, not application instructions.
- Verify payments and blockchain transactions independently on the backend when payment features exist.

OAuth/provider tokens are sensitive credentials and require careful handling, future encryption, and eventual separation from general user profile data.

## API Rules

REST endpoints should be resource/use-case oriented and use consistent response shapes.

Validate input at API boundaries. Do not trust client-provided user IDs when identity can be derived from the authenticated session.

Mutating operations SHOULD consider idempotency. Long-running operations SHOULD return an operation/run identifier rather than keeping the HTTP request open.

Do not expose internal database or provider implementation details unnecessarily.

## Error Handling

Use the existing `AppError` helpers and centralized error handler for known application errors.

Services should throw meaningful application/domain errors. Controllers should let known errors flow to the error handler unless they need specific response mapping.

Do not expose stack traces, raw provider responses, secrets, prompts, comments, or credentials to clients. Avoid `try/catch` blocks that only rethrow unchanged errors. Never silently swallow errors; if best-effort work fails, log safe operational metadata only.

Distinguish validation, authentication, authorization, conflict, rate-limit, provider, and internal errors where practical.

## Configuration

Environment-specific configuration belongs in environment variables and config modules. Secrets MUST NOT be hardcoded.

Load configuration centrally through `bot-backend/src/config/config.js` and validate required variables at startup with `validateEnv`. Avoid reading `process.env` throughout arbitrary business logic when a centralized config value exists.

Safe defaults are acceptable only for non-secret operational settings. Never commit `.env`.

## Testing

For backend business logic, add focused tests for success paths, failure paths, edge cases, authorization boundaries, and idempotency where relevant.

For AI integrations, do not require live Gemini API calls by default. Mock/stub provider boundaries and test provider failures, timeouts, retries, malformed responses, and usage metadata.

For database changes, test indexes/query behavior when practical and use controlled test data. Migrations should be reversible or have documented recovery.

For payment/blockchain features, never use real funds in automated tests. Use controlled fixtures or testnets when appropriate.

Run the relevant tests after changes. If no lint script exists, state that rather than inventing one.

## Background Jobs

Current technical debt: bot execution still uses in-process background work via `setImmediate`.

Before significant production scale, long-running bot execution SHOULD move to durable jobs/workers. Future jobs must be idempotent, observable, survive process restarts, use bounded retries with exponential backoff and jitter, and apply external API rate limits.

Do not introduce Redis, BullMQ, worker processes, or queues unless the task explicitly targets that phase.

## Planned Architecture

Billing/Web3/payment features are not currently implemented.

When billing is introduced:
- Backend owns balances and accounting.
- Wallet balances are derived from immutable ledger transactions.
- Payment intents must be idempotent.
- Transaction hashes must be unique.
- Chain ID, token contract, recipient, amount, and confirmations must be verified server-side.
- Crypto payments should use a stable accounting unit such as USD-denominated credits.
- Blockchain/payment SDKs such as `ethers.js` belong in backend provider/infrastructure modules, not React components or controllers.
- Financial records should be append-only where possible.
- Refunds must be explicit ledger transactions.
- Payment reconciliation must be possible.

Do not implement billing, wallets, crypto payments, subscriptions, credits, queues, or worker infrastructure unless explicitly requested.

## Technical Debt

Known current debt:
- MongoDB currently uses the implicit `test` database when the URI has no explicit database path.
- OAuth tokens are stored inside `users` and need security hardening, encryption, or separation.
- `botruns.results` is embedded and may need normalization into `botrunresults`.
- Botrun retention/archival is not defined.
- Bot execution uses in-process `setImmediate`; no durable queue exists.
- Gemini usage is now tracked, but billing, quotas, and cost accounting are not implemented.
- Gemini retry/timeout behavior is basic and needs future hardening.
- No centralized billing/credit ledger exists.
- No blockchain payment implementation exists.

These items are not permission to fix them opportunistically. Address them only when the current task targets them.

## Code Quality

Prefer simple, readable code that follows existing CommonJS, Express, Mongoose, and React conventions.

Use meaningful names and focused functions. Avoid premature abstraction and duplicated business rules. Do not add dependencies without clear justification. Prefer official APIs and maintained libraries.

Documentation is preferred over excessive inline comments. Comments should explain why, not what.

## Change Workflow

For every non-trivial change:

1. Inspect the existing implementation and git status.
2. Identify affected layers and ownership.
3. Preserve existing behavior unless explicitly changing it.
4. Make the smallest coherent change.
5. Add/update tests where practical.
6. Verify the affected feature.
7. Review the git diff.
8. Report files changed and verification performed.

Before implementing a feature, decide:

1. What layer owns this responsibility?
2. Is it transport, business, persistence, or infrastructure logic?
3. Can it be tested independently?
4. Does it introduce a dependency?
5. Does it require a database migration?
6. Does it need idempotency?
7. Does it handle secrets or sensitive data?
8. Does it create external API cost?
9. Can it run safely under concurrent users?
10. Does it need durable background work?

Never silently modify unrelated code. Never perform destructive database operations without explicit approval. Do not commit or push unless explicitly requested.
