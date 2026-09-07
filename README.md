<h1 align="center">2fa-hub</h1>

<p align="center">
  <b>Self-hosted dual-mode 2FA vault</b> — cloud sync for logged-in users, local-only mode for guests, full admin control.
</p>

<p align="center">
  <a href="https://github.com/dengyie/2fa-hub/actions/workflows/ci.yml"><img src="https://github.com/dengyie/2fa-hub/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-AGPL_v3-blue.svg" alt="License: AGPL v3"></a>
  <a href="https://github.com/dengyie/2fa-hub/pkgs/container/2fa-hub"><img src="https://img.shields.io/badge/Docker-ghcr.io-2496ED?logo=docker&logoColor=white" alt="Docker GHCR"></a>
</p>

<p align="center">
  [English](./README.md) | [简体中文](./README.zh-CN.md)
</p>

---

## Why 2fa-hub

Most open-source authenticators force a choice: either everything lives in someone's cloud, or everything is locked in one device. 2fa-hub gives both modes in one self-hosted app:

- ☁️ **Cloud mode (logged-in users)** — register and log in; your 2FA entries are stored AES-256-GCM encrypted in server-side SQLite and sync across all your devices in real time.
- 🔒 **Local mode (guest)** — no account needed. Entries live only in your browser's localStorage and **never touch the network**. Optional full-vault encryption (PBKDF2 200k + AES-GCM).
- 🛡️ **Admin control** — the first registered user becomes admin: enable/disable/delete any account, reset passwords (instantly revoking sessions), grant admin, switch registration between open / invite-code / closed, and browse a full audit log.

## Features

- TOTP / HOTP with SHA1/SHA256/SHA512, 6–10 digits, custom period & counter — **implementation verified against the official RFC 4226 / RFC 6238 test vectors**
- Live codes with countdown, one-tap copy, multi-device HOTP counter sync
- Add entries by camera QR scan, QR image upload, pasting an `otpauth://` link, or manually
- Import: **2FAS, Aegis (plaintext), Google Authenticator otpauth links, 2fa-hub JSON**
- Export: JSON (with secrets) or otpauth URI list — your data leaves whenever you want, zero lock-in
- Light / dark / auto theme; mobile-first responsive UI built on [awesome-ui](https://github.com/dengyie/awesome-ui) components

## Engineering & Security

- **Server has zero npm runtime dependencies** (native `node:sqlite` + `node:crypto`) — minimal attack surface, no supply chain
- Secrets encrypted at rest with AES-256-GCM; keys derived via HKDF (separate encryption & session-signing subkeys)
- scrypt (N=32768) password hashing; HMAC-signed session tokens in HttpOnly + SameSite + Secure cookies
- Login/registration rate limiting, anti-enumeration, audit logging, CSP / nosniff / frame-deny
- Fully separated frontend & backend: pure JSON API with CORS whitelist, SPA deployable to any static host
- Single container, ~60 MB RAM — friendly to 1 GB VPS boxes

## Quick Start (Docker)

```bash
git clone https://github.com/dengyie/2fa-hub.git && cd 2fa-hub
docker compose up -d
# open http://127.0.0.1:8000 — first registered user becomes admin
```

Images are published to GHCR on every push to `main` (multi-arch amd64/arm64):

```bash
docker run -d --name 2fa-hub -p 127.0.0.1:8000:8000 -v 2fa-hub-data:/data ghcr.io/dengyie/2fa-hub:latest
```

Behind a reverse proxy (Caddy example):

```
2fa.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:8000
}
```

## Local Development

```bash
# Server (Node >= 22.5, no npm install needed)
cd server && npm start            # http://127.0.0.1:8000

# Frontend (hot reload, /api proxied to :8000; API_PROXY to change target)
cd web && npm install && npm run dev

# Tests (19 cases incl. official RFC vectors)
cd server && npm test
```

## Separate Frontend/Backend Deployment

The server runs as a **pure JSON API** by default (static hosting is only attached when `web/dist` exists). Deploy the SPA anywhere:

```bash
cd web
VITE_API_BASE=https://api.example.com npm run build   # bake backend origin at build time
# publish dist/ to any static host; rewrite SPA routes to index.html
```

Then open CORS and cross-site cookies on the backend:

```env
ALLOWED_ORIGINS=https://hub.example.com   # exact frontend origins, comma-separated
COOKIE_SAMESITE=None                      # requires COOKIE_SECURE=1
COOKIE_SECURE=1
```

Camera access for QR scanning is granted to whitelisted origins automatically via `Permissions-Policy`.

## ⚠️ Backup

Both are required inside `DATA_DIR`:

1. `2fa-hub.db` — users & encrypted entries
2. `.master_key` — encryption root key; **losing it = cloud secrets unrecoverable**

Local-mode data lives in browser localStorage — export before clearing browser data.

## Architecture

```
├── shared/          # base32 / TOTP-HOTP / otpauth URI (shared FE+BE, RFC vector tests)
├── server/          # Node native ESM, zero runtime deps — pure JSON API (CORS whitelist)
│   ├── src/         # config / crypto(AES-GCM+scrypt+HMAC) / db(SQLite) / http(router+CORS) / limiter
│   │   └── routes/  # auth / entries / admin
│   └── test/        # node:test integration tests + RFC vectors
├── web/             # Vue 3 + Vite + Tailwind CSS v4 SPA (independently deployable)
│   └── src/
│       ├── views/       # Login / Cloud vault / Local vault / Admin panel
│       ├── components/  # OtpCard / EntryModal / ScannerModal(jsQR) / ImportModal
│       ├── components/ui/  # awesome-ui kit (UiIcon / ThemeToggle / StatusIndicator)
│       └── lib/         # localvault(WebCrypto) / formats(import/export) / useVault
└── Dockerfile       # multi-stage build, single container
```

## Design Decisions

| Decision | Why |
|---|---|
| Codes generated client-side (same path for guest & logged-in) | Zero OTP load on server; local mode works offline; single auditable code path |
| Secrets encrypted at rest, served decrypted over TLS | Required by client-side code generation; E2EE on the roadmap |
| Zero npm runtime deps | A 2FA tool must be a minimal attack surface; supply-chain risk eliminated |
| Encryption cannot be turned off | 2FAuth's lesson — optional encryption with silent downgrade is a trap |
| FE/BE separation with CORS whitelist | Frontend on CDN/static hosting; backend independently hardened and scaled |

## Roadmap

- [ ] WebAuthn/passkey login (passwordless)
- [ ] End-to-end encrypted sync (server stores ciphertext only, Ente-style)
- [ ] Groups/tags, encrypted backup import (Aegis encrypted)
- [ ] PWA offline code generation
- [ ] Steam Guard

## License

[AGPL-3.0](./LICENSE) — prevents closed-source freeriding by cloud providers. For commercial licensing, contact the author.
