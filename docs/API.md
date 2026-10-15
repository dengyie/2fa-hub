# 2fa-hub Machine API v1

Agent and application integrations use `/api/v1`. This API is separate from the browser session API.

## Authentication and safety

- Send `Authorization: Bearer 2fh_live_...` over HTTPS. Machine routes reject every request carrying a `Cookie`; a browser session token is not an API key.
- Create, list, and revoke keys through the signed-in web vault (`Agent API`). The plaintext value is returned once at creation. The database stores only an HMAC-SHA-256 digest with a pepper derived from `MASTER_KEY`.
- Keep keys in an agent secret store. Do not put them in prompts, source control, URLs, query strings, or logs. Revoke a key in the web UI immediately if it is exposed.
- Every response is `Cache-Control: no-store`. API v1 never returns an existing entry's secret, including to a `manage` key. Create and update requests may submit a secret over TLS.
- Machine API CORS is `Access-Control-Allow-Origin: *` because it uses explicit Bearer credentials and no cookies. A browser client should still keep the key in a protected vault and must not expose it to untrusted page scripts.
- Valid-key requests are rate limited per key and IP (120/minute); code endpoints also have a 60/minute per-key limit. Invalid credentials have a separate per-IP limit (120/minute), which returns `429` after the limit and does not consume a valid key's quota. Code reads are audited. HOTP claims and their audit records commit atomically.
- Disabling the owner account or revoking its key immediately blocks the key. A key is limited to its configured entry IDs; `null` means all current and future entries. `code` keys must be limited to selected IDs.

## Permission tiers

| Tier | Scopes | Allowed operations |
|---|---|---|
| `code` | `otp:read` | Get codes for selected entries only; no metadata listing |
| `read` | `entries:read`, `otp:read` | List/read metadata and get codes within selected IDs or the whole vault |
| `manage` | `entries:read`, `otp:read`, `entries:create`, `entries:update`, `entries:delete` | Metadata, codes, and entry CRUD within selected IDs or the whole vault |

All tiers are restricted to their owner's entries. A manage key cannot access users, settings, audit logs, or API-key management. Entry secret retrieval is not a scope in v1.

## Endpoints

### `GET /api/v1/entries`

Requires `entries:read`. Returns metadata only; `secret` is never present.

```json
{
  "entries": [
    {"id": 12, "label": "alice@example.com", "issuer": "GitHub", "type": "totp", "algorithm": "SHA1", "digits": 6, "period": 30, "counter": 0, "sort": 1, "created_at": "...", "updated_at": "..."}
  ]
}
```

### `GET /api/v1/entries/:id`

Requires `entries:read`; returns one metadata record, without a secret.

### `GET|POST /api/v1/entries/:id/code`

Requires `otp:read`. `GET` is convenient for polling; `POST` is also available to avoid intermediary assumptions about sensitive GET responses. TOTP returns:

```json
{"code":"123456","remaining":17,"type":"totp"}
```

HOTP returns the code for the old counter, then atomically advances the stored counter:

```json
{"code":"123456","remaining":null,"type":"hotp","counter":7}
```

Each successful HOTP response consumes exactly one counter. If the caller times out or loses the response, do not automatically retry: the server may already have advanced the counter and the original code may be lost. A `409` caused by repeated concurrent entry changes means this request did not claim a counter; it can be retried after the entry stops changing. TOTP reads do not change stored state and can be retried safely.

### `POST /api/v1/entries`

Requires `entries:create`. Accepts `label`, `issuer`, `secret`, `type`, `algorithm`, `digits`, `period`, and `counter`. On create, omitted optional values default to an empty label and issuer, `totp`, `SHA1`, 6 digits, a 30-second period, and counter 0. `secret` must be a valid Base32 string with at least 8 normalized characters. Type must be exactly `totp` or `hotp`; algorithm must be exactly `SHA1`, `SHA256`, or `SHA512`; digits must be an integer from 6 to 10; period must be an integer from 7 to 120; counter must be a non-negative safe integer below `Number.MAX_SAFE_INTEGER`, so HOTP can calculate the next counter without losing precision. Labels and issuers must be strings up to 120 characters. Unknown fields and values that would previously be silently coerced are rejected with `400`. Returns `201 {"id": 13}`. A scoped key gains access to entries it creates.

### `PUT /api/v1/entries/:id`

Requires `entries:update`. Accepts any non-empty subset of the fields above; omitted fields are retained, and empty or non-object bodies are rejected. The server decrypts and re-encrypts the secret internally when it is omitted; it is never returned.

### `DELETE /api/v1/entries/:id`

Requires `entries:delete`. Returns `{"ok":true}`. Deletion cannot be undone.

## Creating a key in the UI

1. Sign in and open **云端**.
2. Select **Agent API**.
3. Choose `出码` for least privilege, then select the exact entries. Choose `只读 + 出码` or `条目管理 + 出码` only when the integration needs those additional operations.
4. Copy the returned value to the agent's secret store. It cannot be recovered from 2fa-hub.

## Example

```sh
curl --fail --silent --show-error \
  -H "Authorization: Bearer $TWOFA_API_KEY" \
  "https://2fa.example.com/api/v1/entries/12/code"
```

## Errors

| Status | Meaning |
|---|---|
| `400` | Invalid request or entry fields |
| `401` | Missing, invalid, revoked key; inactive owner; or a Cookie was sent |
| `403` | The key tier does not grant the requested operation |
| `404` | Entry does not exist or is outside the key's scope |
| `409` | HOTP entry changed repeatedly while generating a code, or its counter reached the safe increment limit |
| `429` | Valid-key, code, or invalid-credential rate limit exceeded |
