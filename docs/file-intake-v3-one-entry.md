# Aqi Drawer · File Intake V3 / one-entry router (code-only candidate)

**Status:** 2026-10-21 · Draft engineering candidate; no merge, release, production flag change, or real-file upload approved by this document.

## User-facing problem

EE says “收进抽屉” once. File Intake V1 currently saves through an explicitly reviewed **exact HTTPS hostname**; if the host drifts, V1 rejects and the model must separately call V2 Prepare. V2 then asks EE to approve a fresh title + hostname + ticket before Commit. That extra rejection/tool hop is unnecessary, but authorizing a brand-new download host is a distinct security decision.

## Scope implemented in this PR

**No new file upload service or MCP tool.** Behind default-off `C_POCKET_ENABLE_MCP_FILE_SMART_ROUTE_V3=true`, the existing `pocket_file_intake` entry point uses the already-issued ChatGPT `fileParams` value:

1. Parse and validate its URL's HTTPS hostname using existing `describeMcpFileHost` (never echo the signed URL or file ID).
2. **Confirmed exact replay**: inspect the existing durable request identity and re-read/hash its original attachment before recovering the receipt. The current fingerprint binds intent, file metadata and the exact URL through SHA-256; no raw URL or File ID is persisted by the configured Owner services. A file ID or request ID alone is never proof of a new file's bytes.
3. **Exact host already approved** in `C_POCKET_MCP_FILE_HOSTS`: use V1 to save, or verify changed fileParams against the previously stored bytes/type/intent. No new human reconfirmation of the same save intent.
4. **Different hostname, new request**: call V2 Prepare *on the same fileParams input*, without downloading or writing Store/Media. Return `status: "approval_required"`, `ticketId`, exact `hostname`, `title`, expiry, and `stored:false`.
5. **Different hostname, prior save but changed fileParams**: return `status: "verification_required"`, `priorSaveExists:true`, `requestedFileVerified:false` and a pinned ticket. Omit `stored` and do not return a success receipt. The prior save exists; whether these current bytes match it is still unknown. Identical live retries reuse one ticket. A previously completed identical ticket can recover its verified result without another fetch or approval.
6. Only after EE explicitly approves **that exact ticket, title, and hostname**, use V2 Commit. Commit still checks the pinned original URL, safe public DNS + TLS, no redirects, 25 MiB, file signature/MIME, byte/hash/idempotency, and never expands the persistent host list. Changed bytes or intent conflict instead of replacing the original attachment.

The existing V1, V2 and optional V3 remain available under their original gates. V1/V2 share the stricter replay validation even with V3 OFF. Supplied safe readable filenames are preserved; a missing name uses `chatgpt-file` plus the validated extension, never a transient File ID.

## Retry, response loss and restart recovery

- Prepare remains synchronous and metadata-only: no DNS, download, Store read/write or Media write. Exact live request retries reuse one ticket without extending its TTL or consuming another queue slot. Any conflicting fileParams/intent with the same live request ID fails closed. Unclaimed tickets expire after at most 15 minutes; in-flight requests retain their reservation until they settle.
- Successful commit removes its pinned source data and caches only safe request proof and the original result. This separate cache has at most 12 receipts (or the configured lower pending limit), each for at most 15 minutes after completion. Reads do not extend TTL. The oldest entry is evicted at capacity; completed entries do not occupy pending slots.
- Repeating a completed ticket with the original hostname/title rechecks canonical attachment binding, size and SHA-256, then returns the **exact first result**, including its original `duplicate` value. Wrong approval, removed attachment or corrupt bytes still fail closed. Prepare of an identical cached completion returns `receipt_available`, not `stored:false`; it performs no new read or transfer. Changed fileParams after completion may prepare a fresh ticket but cannot reuse the old ticket's download authority.
- Tickets and receipt caches remain process-local. After restart, expiry or eviction, an old ticket is rejected; recover through a fresh Prepare/Commit using the same stable request ID and exact intent/fileParams. A matching durable fingerprint plus verified stored attachment permits receipt recovery without a fetch. Changed parameters or legacy fingerprints require an approved actual download and byte/type/intent comparison; the old canonical identity is not rewritten.
- **Strict replay versus UX:** a changed URL (even with the same File ID) is not an exact replay. If it is expired, verification fails; if its host is unfamiliar, it still needs the existing V2 approval. Returning a prior successful receipt as proof of these unverified new bytes would sacrifice integrity. This PR deliberately does not do that.
- Approval remains the existing conversation/Host policy. Matching model-supplied hostname/title is not independently verified user consent; these reliability fixes do not claim otherwise.

## Rollout and security boundaries

- V3 requires **both** `C_POCKET_ENABLE_MCP_FILE_INTAKE=true` (which itself requires a reviewed exact-host list) and `C_POCKET_ENABLE_MCP_FILE_TRANSFER_V2=true`, plus the already required Owner/Capture controls. Runtime and production preflight both fail closed on invalid combinations.
- Do **not** set the new flag on Tokyo as part of this PR. Keep current persistent PocketStore/Media, MCP connection path, secrets, file permissions and deployed configuration unchanged. No new persistence system or Store schema migration is introduced.
- Do not trust a DNS suffix, wildcard (especially `*.blob.core.windows.net`), IP range, prefix `oaisdmntpr...`, file_id, filename, the model's assertion of provenance, or a tool-provided URL as cryptographic OpenAI attestation.
- Treat all `fileParams` fields as untrusted input. ChatGPT provides the fields at runtime, but the published file schema does not provide a cryptographically verifiable server-side provenance signature. Unknown public hosts therefore still require human approval.
- Failed V1 downloads on an **approved** host must surface errors; V3 must not silently fall back to V2 to bypass platform blocks, expired URLs, bad MIME/signature, failed hash verification or SSRF checks.
- No automatic chat logging, unknown Tag/Collection creation, Memory/Vault mutation, file intake from arbitrary local sandbox paths, or auto-promoting saved Drawer objects.

## Tests / acceptance

Isolated Owner MCP test: existing allowed host saves immediately; unknown host prepares without downloader or Store mutation; wrong approval fails closed; explicitly approved Commit saves once through the **ticket's exact host**, preserving original bytes/hash; unsafe IP/URL input fails closed; neither signed URLs nor raw transient OpenAI file IDs leak into receipts/Store. Runtime config and production preflight reject enabling V3 alone or without both reviewed file lanes.

Regression fixtures additionally cover full canonical new/append serialization without a filename, exact-versus-changed URL replay, legacy durable fingerprints, repeated/conflicting Prepare, unclaimed/in-flight expiry, bounded completed cache and non-sliding TTL, commit response loss, wrong cached approvals, restart recovery, removed/corrupt attachments, V3 hostname drift and append target conflicts. They use disposable synthetic files and temporary Stores only.

**Not yet verified:** fresh real ChatGPT fileParams host rotation, live browser/widget behavior, model response clarity, independently downloaded checksum, generated images/artifacts, or any production deployment. CI passing would prove code-level regression only.

## Future real one-click UX (not implemented by this PR)

Explore a ChatGPT plugin widget that presents the selected filename and unfamiliar hostname in **one actionable approval surface**. OpenAI's optional widget APIs include `window.openai.selectFiles()`, `uploadFile()`, and `getFileDownloadUrl({fileId})`. They can improve selection/URL refresh, **but none is proof of arbitrary hostname ownership**; don't claim the feature eliminates platform confirmations. A server-verified approval mechanism (not merely model-supplied `approved_hostname`) must be designed before any actual “one-click unfamiliar-host authorization” is shipped.

References:
- https://developers.openai.com/plugins/reference — File APIs + `_meta["openai/fileParams"]` schema.
- https://developers.openai.com/plugins/guides/security-privacy — least privilege, authorization and network safeguards.
- PR #31 (pinned transfer), PR #32 (V1 privacy and one-step guidance), Aqi Vault `40_WORK/Aqi_Drawer/Project_Plan.md` v3.3.
