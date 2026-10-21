# One-Click Keep · 对话内一点入柜 — isolated POC brief

**Status:** 2026-10-21 · Design and feasibility only. **BLOCKED by PR #33 reliability/privacy fixes.** This document does not approve implementation, merge, Tokyo rollout, environment changes, or real private-file tests.

## User outcome

EE selects or references an already attached/generated ChatGPT original and says **“阿栖，把这个收进抽屉。”** The ideal is one instruction plus **at most one file-specific click inside the conversation**, followed by a genuine `itemId`, `attachmentId`, byte count and SHA-256 receipt. No copying tickets, approving Azure hostname strings, opening an external Drawer page, manually reuploading, or managing whitelists. Sources already reviewed under the exact-host policy keep the existing one-call V1 path.

A safe *one-click unfamiliar-host save* is the first goal; zero clicks for unverified sources is **not** promised. The proposed click authorizes a **specific file + fixed source URL + target + bounded action**, not an Azure tenant, host suffix or permanent egress privilege.

## Current baseline

- PR #31: `pocket_file_transfer_prepare` pins original `fileParams` in temporary RAM, then V2 `commit` downloads through the secure existing V1 downloader and PocketStore/Media.
- PR #32: V1 one-call preference on allowlisted host and removal of raw file_id from `sourceData`; Codex discovered a separate fallback filename leak.
- PR #33: optional default-off V3 one-entry router over V1 + V2; unknown host still returns `approval_required`. **Draft; currently under P2 fixes.**
- The current V2 `commit` validates the pinned ticket + hostname + title, **not a server-enforced record of EE's click/consent**. Merely skinning this tool with a button is NOT sufficient.
- React Drawer Capture already has multipart file submission but its write API relies on Drawer browser login (HttpOnly SameSite=strict cookie + same-origin Origin). A ChatGPT-embedded widget cannot simply reuse the external same-origin session, nor should it receive a long-lived Bridge Token.
- Public ChatGPT App fileParams gives `download_url`, `file_id`, optional MIME/name. Neither these nor a storage hostname constitutes independently verifiable OpenAI provenance. Widget selectFiles/uploadFile/getFileDownloadUrl API availability must be re-verified in current published docs; a URL is not a browser-readable File/Blob or trusted attestation.

## Feasibility gate — FIRST, read-only

Review current official ChatGPT MCP App UI / Widget API:
1. How to register the widget resource and map it to a file-prepare tool response.
2. What exactly is exposed only to Widget through tool-result `_meta`, what can still be seen/invoked by the model, and what `tools/call` means for caller identity. **`_meta` is transport routing, not cryptographic proof of a physical click.**
3. Whether a browser widget can initiate an authenticated model-independent tool action; feature support in actual ChatGPT Host; CSP/sandbox restrictions; ability to bind a one-shot session capability to a specific owner action.
4. Confirm what `selectFiles` and `getFileDownloadUrl` actually return. Do not assume arbitrary selected ChatGPT files are raw Blob objects or retrievable via browser CORS.
5. Whether the existing secure original-byte server downloader can be reused via widget-scoped capability while keeping the unknown-host policy explicit.
6. Authentication identity and abuse model: a malicious injected file, prompt or model output must not be able to synthesize user approval; app other sessions must not redeem capabilities intended for this one file; a token in hidden `_meta` remains a bearer secret, not a signed human click. If the Host provides no independently enforceable interaction boundary, report it as blocker rather than claim “secure user click.”

**Result:** a concrete yes/no capability matrix, threat model, and <=4-file initial exploratory POC plan, BEFORE writing code.

## Proposed minimal isolated design (subject to feasibility)

1. A new, default-OFF feature gate for Widget Keep POC. Existing Owner MCP stays at its current private URL; no new long-lived public endpoint, app, store or database.
2. On EE's explicit save intent for one actual fileParams, prepare pins `request_id`, exact URL/host, `mode`, target item ID, title, file type/size as known, expiry and a random short-lived capability in RAM. Prepare makes **no** DNS request, download, or Store write.
3. For an unknown hostname only, provide a small in-conversation card showing a **sanitized file display title** and target with a **save** control, and optional inspectable source hostname. Never expose the signed download URL, raw `file_id`, or long-lived Owner/Bridge credential.
4. A user-initiated card action transmits the one-time scope-limited capability by an actually supported protected Host path; server checks capability, file/target binding, expiry, reuse and *proven provenance of interaction only if the Host truly supplies it*. The model-callable legacy V2 `commit` MUST NOT be able to complete this newly scoped widget ticket using echoed hostname/title. If this cannot be enforced, fail POC security.
5. The existing V2/V1 safe downloader enforces exact host, public DNS + TLS, redirects disallowed, 25 MiB, full content limit, signatures/MIME, SHA and durable idempotency. No widening to `*.blob.core.windows.net`. Successful result is a real existing PocketStore/Media receipt.
6. Repeated click, concurrent commit and response-loss retry must return the verified same completed receipt, without duplicates. Failure/expiry must never result in stale/bypassed authorization. Rotated or expired download URL requires a new pinned intent, no silent source substitution.

## Explicit non-goals

No automatic chat transcript capture, no automatic Memory/Vault promotions, no new canonical artifact repository, no file origin proofs by hostname heuristics, no lowering SSRF/TLS/type/size policies, no bypass of platform safety blocks, no production deployment, no data migration. Do not modify `/api/pocket/items/upload` or cookie/CORS policy just to shortcut authentication.

## Tests / acceptance

**Isolated synthetic documents only** (e.g. a self-created disposable PDF; no private user files). Test: zero pre-approval egress/persistence, missing/forged/expired/cross-target/reused capability, unauthorized model-call fallback, source URL rotation/expiry, concurrent and lost-response retry, no metadata secrets in Store/log/receipts/UI, true hash and byte equality, normal known-host behavior, default-off rollback. Use precise pinned-file URL in RAM; no operational environment or live storage writes.

**Real ChatGPT Host acceptance requires separate EE approval** once code, docs and CI pass: synthetic chat-uploaded PDF, generated artifact, widget reload, mobile use, independent Drawer attachment re-download/sha verification.

## Delivery and staging

- **Step A:** Codex read-only feasibility finding and threat model.
- **Step B:** AFTER PR #33 four P2 fixes are complete and EE approves concrete code scope, independent POC code on a new branch/Draft PR; CI; no merge/deploy.
- **Step C:** EE separately authorizes disposable real-host QA, later merge/deploy/production flag.

The ideal UX is **“伊伊挑东西，阿栖负责收好”**, not a new class of technical confirmations.

### References

- https://github.com/GH161958/aqi-drawer/pull/31
- https://github.com/GH161958/aqi-drawer/pull/32
- https://github.com/GH161958/aqi-drawer/pull/33
- https://developers.openai.com/plugins/reference
- https://developers.openai.com/plugins/build/chatgpt-ui
- https://developers.openai.com/plugins/guides/security-privacy
