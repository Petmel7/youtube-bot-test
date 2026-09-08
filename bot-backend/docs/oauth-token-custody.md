# OAuth Token Custody

OAuth token fields on `users.tokens` are excluded from default Mongoose queries and should only be loaded through the auth token service boundary.

Production must set `OAUTH_TOKEN_ENCRYPTION_KEY` to a base64-encoded 32-byte key. New Google OAuth logins and refreshed access tokens are stored with AES-256-GCM using the `enc:v1` token envelope.

Existing plaintext token rows are read as legacy values for compatibility. They are rewritten encrypted the next time the user reconnects Google or the access token is refreshed. Do not run an ad hoc production migration without a reviewed, idempotent migration plan and rollback notes.
