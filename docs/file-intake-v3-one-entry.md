# Aqi Drawer · File Intake V3 / one-entry router (code-only candidate)

**Status:** 2026-10-21 · Draft engineering candidate; no merge, release, production flag change, or real-file upload approved by this document.

## User-facing problem

EE says “收进抽屉” once. File Intake V1 currently saves through an explicitly reviewed **exact HTTPS hostname**; if the host drifts, V1 rejects and the model must separately call V2 Prepare. V2 then asks EE to approve a fresh title + hostname + ticket before Commit. That extra rejection/tool hop is unnecessary, but authorizing a brand-new download host is a distinct security decision.

## Scope implemented in this PR

**No new file upload service or MCP tool.** Behind default-off `C_POCKET_ENABLE_MCP_FILE_SMART_ROUTE_V3=true`, the existing `pocket_file_intake` entry point uses the already-issued ChatGPT `fileParams` value:

1. Parse and validate its URL's HTTPS hostname using existing `describeMcpFileHost` (never echo the signed URL or file ID).
2. **Exact host already approved** in `C_POCKET_MCP_FILE_HOSTS`: run existing V1 downloader and return the unchanged durable byte/hash receipt; no new human reconfirmation of save intent.
3. **Different hostname**: call existing V2 Prepare *on the same fileParams input*, without downloading or storing. Return `status: "approval_required"`, `ticketId`, exact `hostname`, `title`, expiry, and `stored:false`. Do not report this as a successful save.
4. Only after EE explicitly approves **that exact ticket, title, and hostname**, use the existing V2 Commit. Commit still checks the pinned original URL, one-time ticket, safe public DNS + TLS, no redirects, 25 MiB, file signature/MIME, byte/hash/idempotency, and never expands the persistent host list.

The current `pocket_file_transfer_prepare` and `pocket_file_transfer_commit` remain available and unchanged. V1 alone and V2 alone retain their current behavior when V3 is OFF.

## Rollout and security boundaries

- V3 requires **both** `C_POCKET_ENABLE_MCP_FILE_INTAKE=true` (which itself requires a reviewed exact-host list) and `C_POCKET_ENABLE_MCP_FILE_TRANSFER_V2=true`, plus the already required Owner/Capture controls. Runtime and production preflight both fail closed on invalid combinations.
- Do **not** set the new flag on Tokyo as part of this PR. Keep current persistent PocketStore/Media, OAuth/MCP connection path, V2 code, secrets, file permissions and deployed configuration unchanged.
- Do not trust a DNS suffix, wildcard (especially `*.blob.core.windows.net`), IP range, prefix `oaisdmntpr...`, file_id, filename, the model's assertion of provenance, or a tool-provided URL as cryptographic OpenAI attestation.
- Treat all `fileParams` fields as untrusted input. ChatGPT provides the fields at runtime, but the published file schema does not provide a cryptographically verifiable server-side provenance signature. Unknown public hosts therefore still require human approval.
- Failed V1 downloads on an **approved** host must surface errors; V3 must not silently fall back to V2 to bypass platform blocks, expired URLs, bad MIME/signature, failed hash verification or SSRF checks.
- No automatic chat logging, unknown Tag/Collection creation, Memory/Vault mutation, file intake from arbitrary local sandbox paths, or auto-promoting saved Drawer objects.

## Tests / acceptance

Isolated Owner MCP test: existing allowed host saves immediately; unknown host prepares without downloader or Store mutation; wrong approval fails closed; explicitly approved Commit saves once through the **ticket's exact host**, preserving original bytes/hash; unsafe IP/URL input fails closed; neither signed URLs nor raw transient OpenAI file IDs leak into receipts/Store. Runtime config and production preflight reject enabling V3 alone or without both reviewed file lanes.

**Not yet verified:** fresh real ChatGPT fileParams host rotation, live browser/widget behavior, model response clarity, independently downloaded checksum, generated images/artifacts, or any production deployment. CI passing would prove code-level regression only.

## Future real one-click UX (not implemented by this PR)

Explore a ChatGPT plugin widget that presents the selected filename and unfamiliar hostname in **one actionable approval surface**. OpenAI's optional widget APIs include `window.openai.selectFiles()`, `uploadFile()`, and `getFileDownloadUrl({fileId})`. They can improve selection/URL refresh, **but none is proof of arbitrary hostname ownership**; don't claim the feature eliminates platform confirmations. A server-verified approval mechanism (not merely model-supplied `approved_hostname`) must be designed before any actual “one-click unfamiliar-host authorization” is shipped.

References:
- https://developers.openai.com/plugins/reference — File APIs + `_meta["openai/fileParams"]` schema.
- https://developers.openai.com/plugins/guides/security-privacy — least privilege, authorization and network safeguards.
- PR #31 (pinned transfer), PR #32 (V1 privacy and one-step guidance), Aqi Vault `40_WORK/Aqi_Drawer/Project_Plan.md` v3.3.
