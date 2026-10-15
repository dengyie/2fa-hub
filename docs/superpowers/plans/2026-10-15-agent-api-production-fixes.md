# Agent API Production Fixes Implementation Plan

> **For agentic workers:** Execute this plan inline in the current feature branch. Each task starts with a failing regression and ends with a focused verification.

**Goal:** Fix the reviewed Agent API concurrency, rate-limit, and validation defects and cover security-sensitive API boundaries.

**Architecture:** Keep the existing native Node/SQLite route design. Make HOTP counter claims compare the full code-generating snapshot, separate invalid-credential throttling from accepted-key quotas, and validate machine API payloads strictly without changing browser form behavior.

**Tech Stack:** Node.js ESM, `node:sqlite`, `node:test`, Vue 3, Markdown API docs.

## Global Constraints

- Preserve the current branch and existing uncommitted Agent API feature changes.
- Keep the browser-facing entry validation behavior unchanged.
- Never return stored OTP secrets from Machine API v1.
- Do not add runtime dependencies.
- Run server tests, web build, and `git diff --check` after implementation.

---

### Task 1: Capture failing Agent API regressions

**Files:**
- Modify: `server/test/api.test.js`
- Modify: `server/src/routes/api-v1.js` only to expose the OTP generator injection seam needed for deterministic race testing, after the test shape is established.

- [x] Add a deterministic HOTP race test that pauses OTP generation, updates the entry secret through the browser API, then resumes generation and asserts the returned code corresponds to the new secret and its counter is consumed once.
- [x] Add tests showing malformed `type`, `algorithm`, `digits`, `period`, and `counter` return 400 without changing stored state.
- [x] Add tests for invalid-key traffic not blocking a valid key, accepted API rate limits returning 429, scope isolation, inactive-owner revocation, CORS preflight, and the 20-active-key cap.
- [x] Run the focused tests and record the expected failures before implementation.

### Task 2: Make HOTP claim compare the generated snapshot

**Files:**
- Modify: `server/src/routes/api-v1.js`
- Test: `server/test/api.test.js`

- [x] Re-read and decrypt the current entry after each failed compare-and-swap.
- [x] Compare counter, encrypted secret, type, algorithm, digits, and period in the atomic update; retry using the new row when any code-generating state changed.
- [x] Re-run the deterministic HOTP race test and existing API/OTP tests.

### Task 3: Separate invalid-key throttling and enforce strict machine payload validation

**Files:**
- Modify: `server/src/routes/api-v1.js`
- Modify: `server/src/routes/entries.js`
- Test: `server/test/api.test.js`

- [x] Restrict invalid-credential throttling to invalid credentials and return 429 when that bucket is exhausted; valid keys use only the post-auth per-IP and per-key buckets.
- [x] Add strict Machine API entry validation for explicit fields and preserve defaults/partial-update semantics; leave browser validation unchanged.
- [x] Re-run failure reproduction tests and browser entry CRUD regressions.

### Task 4: Keep scoped create state atomic and document retry semantics

**Files:**
- Modify: `server/src/routes/api-v1.js`
- Modify: `docs/API.md`
- Modify: `README.md`
- Modify: `README.zh-CN.md`

- [x] Wrap entry creation, scoped key allowlist extension, and audit event in one SQLite transaction; apply the same atomic audit boundary to key mutations, entry updates/deletes, and HOTP claims.
- [x] Document that HOTP consumes one counter per successful response and must not be automatically retried after an ambiguous network timeout; TOTP remains safe to repeat.
- [x] Run full server tests, web production build, and `git diff --check`.
