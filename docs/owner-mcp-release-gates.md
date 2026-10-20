# Tokyo Drawer · Same-URL Owner MCP release gates (PR D-1 candidate)

**State:** code-only D-1 proposal, 2026-10-17. PRs #15–#18 are merged, and EE confirmed Tokyo code release at `70abf0ebcee7e5a8fd524c5437454074d4e980dc`, with all new flags OFF. Branch and live service must always be rechecked. This document does not authorize production changes, ChatGPT connector mutations or actual uploads; each gate needs separate EE approval. The historical split-path option remains available but is NOT EE's chosen target.

## Architecture and permissions

**EE's chosen target:** the existing ChatGPT Aqi Drawer App → its **existing** private `C_POCKET_MCP_PATH` → Owner lane → the same PocketStore + Media. **No second route, no second App.** This is a deliberate change of capabilities at one endpoint, so when activated the URL does NOT continue to expose the old standard tool set in parallel. Owner replaces the old unrestricted `pocket_edit_metadata` with existing-taxonomy organizer tools; other approved old read/Memory/Vault tools remain.

Owner has reading, explicitly requested text/link Capture, user-authorized quiet single-item organization using *registered* Tags and Collections with later receipts, and **explicitly requested** PDF/image/document file Intake. New taxonomy, bulk operations, original-content rewrites, deletion and automatic file collection still require new authorization. Model instructions and read-only diagnostic tools cannot supersede platform write confirmations.

**Important risk:** The existing private URL is a bearer capability, not scoped OAuth. **Anyone who holds the old URL acquires Owner capabilities upon upgrade.** Before enabling, privately review sharing, leakage and *all* consumers of that URL; if there is any doubt, STOP for EE to decide whether to rotate the secret (which would require a separately approved URL change). Keep secrets out of chat, screenshots, repo and logs. Owner still includes reviewed Memory/Vault operations and obeys app-level prompts/confirmations.

## Gate 0 · read-only preflight (NO production changes)

- [ ] Recheck GitHub `main`, `deploy/tokyo` and CI, branch merge-base; do not assume previous hashes are still current.
- [ ] In **private Zeabur Dashboard**, verify the *actual* Tokyo aqi-drawer service is Running and serves health, the existing UI, and old MCP tools. Confirm mounted persistent volume and `C_POCKET_DATA_DIR=/app/data/drawer-production`; record only boolean presence/healthy status, not secret values.
- [ ] Privately confirm **current** production backup: timestamp, full volume archive checksum, encrypted offsite copy, complete PocketStore/media inspection and isolated restore rehearsal; don't reuse old snapshot counts as current. Use `docs/tokyo-backup-and-restore-drill.md` as procedure, updating its stale commit references at execution time.
- [ ] Confirm existing `C_POCKET_MCP_PATH` meets its current production validation (≥32 URL-safe random suffix characters) without exposing its contents. For the in-place mode, `C_POCKET_MCP_CAPTURE_PATH` must be **absent**; no second URL must be created. Confirm Capture, Owner, In-Place, Host Probe, File Intake flags all absent/false.
- [ ] Privately inventory *all* holders/consumers of the current MCP URL and evaluate whether expanding its capabilities is safe. Capture/Owner must not go live until EE independently approves the risk, a rollback plan and a maintenance window.

**If any current backup/volume/secret/health check is unknown or failing, STOP before applying any configuration.** GitHub cannot inspect live Zeabur variables, mounts, latest backup or real ChatGPT host file support.

## Gate 1 · deploy code with all new flags OFF (new EE approval required)

- [x] EE separately authorized the previous code-only fast-forward of `deploy/tokyo` to `70abf0ebcee7e5a8fd524c5437454074d4e980dc` with all new flags OFF (confirmed in conversation). Deploying *this new D-1 code candidate* will again require a NEW separate release approval.
- [x] EE confirmed the prior Tokyo deployment completed, and a subsequent read-only check found the old taxonomy MCP tool responding; UI/iPhone smoke and production backup checks remain distinct gate items. With all new flags OFF, old MCP stays standard.
- [ ] Rollback if required: restore previously working image/config only through authorized operational procedure. **Do not roll back the persistent volume**, unless separately approved for a genuine restore with a tested backup.

## Gate 2 · staged Owner connection (new EE approval required)

- [ ] After independently approving production expansion of the existing URL's capabilities, enable **three flags together**: `C_POCKET_ENABLE_OWNER_IN_PLACE=true`, `C_POCKET_ENABLE_MCP_CAPTURE=true`, `C_POCKET_ENABLE_UNIFIED_OWNER=true`. Keep `C_POCKET_ENABLE_LEGACY_MCP` unset/true, and `C_POCKET_MCP_CAPTURE_PATH` **unset**. `C_POCKET_ENABLE_MCP_FILE_HOST_PROBE` and `C_POCKET_ENABLE_MCP_FILE_INTAKE` remain false. This registers Owner ON THE ORIGINAL PRIVATE ROUTE ONLY, not on a second address.
- [ ] Refresh/reconnect the **existing Aqi Drawer ChatGPT App** to its *unchanged* MCP URL as needed: tool schemas may be cached. Confirm Owner listTools: reads, memory/vault, Capture, organize, undo; no unrestricted `pocket_edit_metadata`; no File Intake or probe yet. Verify no duplicate MCP registrations/second App. If the provider does not refresh tools or clients break, use same-URL rollback instead of silently adding a new route.
- [ ] Do **read-only** list/get/taxonomy smoke first. Any new Capture/organize write test needs separate EE authorization and a deliberately disposable item.

## Gate 3 · metadata-only ChatGPT fileParams hostname probe (new EE approval required)

- [ ] With Owner connected and File Intake still **OFF**, EE separately approves setting `C_POCKET_ENABLE_MCP_FILE_HOST_PROBE=true` temporarily. This registers `pocket_file_host_probe` on Owner only. It is read-only; it neither fetches/downloads nor persists file bytes or URLs.
- [ ] EE explicitly provides/approves a **disposable non-sensitive** file for a one-off ChatGPT host compatibility test. Observe only the returned lowercase HTTPS `hostname`; **never** print or retain `download_url`, token, `file_id`, document contents or filename. Passing this probe does **not** prove any file can actually be downloaded.
- [ ] EE independently reviews hostname ownership/trust before deciding whether to allow any outbound transfer. **Never auto-copy the reported hostname into `C_POCKET_MCP_FILE_HOSTS`.** If the file parameter is missing or rejected by the host, STOP and investigate without weakening validation.
- [ ] Turn probe flag back off after the one-time test. Do not leave diagnostics active without a reason.

## Gate 4 · controlled binary Intake (new EE approval required)

- [ ] Configure `C_POCKET_MCP_FILE_HOSTS` with precisely the separately approved HTTPS hostname(s), no IP, wildcard, signed URL, or example placeholder. Only then, and with a new EE approval, set `C_POCKET_ENABLE_MCP_FILE_INTAKE=true`.
- [ ] EE explicitly authorizes one non-sensitive disposable PDF or image to be saved. Compare returned `itemId`, `attachmentId`, byte length and SHA-256 with the original file on a trusted machine. Test safe repeated calls (same ID), actual attachment readback and file accessibility, without exposing private data. **Mock SDK tests are not proof of ChatGPT host compatibility.**
- [ ] Only after pass, approve a small controlled real user workflow. A lack of confirmation, unexpected host, failed hash/readback, wrong file or orphaned bytes is a **STOP** condition. Disable File Intake; investigate before further writes.

## Gate 5 · accept one-route mode, monitor & rollback (separate approval for any writes)

- [ ] Confirm the original App/URL connects to Owner successfully and all previous consumers still work; no new/old separate MCP routes to retire. Check the independent iPhone Drop REST endpoint after deployment.
- [ ] **Do NOT set `C_POCKET_ENABLE_LEGACY_MCP=false` in same-URL mode.** It would violate the explicit in-place fail-closed contract. No legacy route retirement exists here: the same path becomes Owner.
- [ ] On malfunction, separately authorize setting `C_POCKET_ENABLE_OWNER_IN_PLACE=false`, `C_POCKET_ENABLE_MCP_CAPTURE=false`, `C_POCKET_ENABLE_UNIFIED_OWNER=false`, File Intake/Probe false. Restart/refresh the old same-URL connection; validate original standard tools and Store/media untouched. Rollback of code/image may be needed if feature flags alone fail. **Never roll back the production data volume** without a separate data-restore authorization.

## Fail-closed switch relationships

| Variable | Default | Constraint |
| --- | --- | --- |
| `C_POCKET_ENABLE_MCP_CAPTURE` | false | In-place mode requires existing secure `C_POCKET_MCP_PATH`; historical split-mode requires distinct `C_POCKET_MCP_CAPTURE_PATH` |
| `C_POCKET_ENABLE_UNIFIED_OWNER` | false | Requires Capture true |
| `C_POCKET_ENABLE_OWNER_IN_PLACE` | false | Requires Capture + Unified Owner + Legacy MCP true; requires second Capture path **absent** |
| `C_POCKET_ENABLE_MCP_FILE_HOST_PROBE` | false | Requires Capture + Owner true; no DNS, download, Store read/write |
| `C_POCKET_ENABLE_MCP_FILE_INTAKE` | false | Requires Capture + Owner true **and** reviewed nonempty host allowlist |
| `C_POCKET_ENABLE_MCP_FILE_TRANSFER_V2` | false | Independent V2 Prepare/Commit; requires Capture + Unified Owner; does not require or modify static V1 host list |
| `C_POCKET_MCP_FILE_HOSTS` | unset | Exact approved DNS hostname list; host probe does not authorize |
| `C_POCKET_ENABLE_LEGACY_MCP` | true | Must remain true/unset for same-URL mode; legacy retirement applies only to historical split-path mode |

The `npm run production:check` guard verifies switch consistency with no secret printing. It is not a replacement for Zeabur inspection or the private, version-specific deployment runbook. No production environment should be modified based solely on this draft.

## Candidate V1 · Owner taxonomy creation (2026-10-19, code-only, DEFAULT OFF)

EE requested construction of **new Tag / Collection registration and organizing**; this is permission to develop a guarded interface, **not** pre-approval of any particular label, merge, Tokyo deployment, or production flag change. `C_POCKET_ENABLE_OWNER_TAXONOMY_CREATE=false` (default) leaves all previous Owner tool lists and client capabilities unchanged.

- `pocket_taxonomy_create(request_id, kind, name, approved_name)` is registered **only** on the Owner lane with the separate enable flag. It registers exactly one Tag or Collection after EE confirms the exact name. General permission to organize is NOT label approval; user-supplied files, links, screenshots and model suggestions do not count as permission.
- Before proposing or creating a name: `pocket_taxonomy`; reuse existing case-insensitive labels. `approved_name` must exactly match the submitted normalized name, and the ChatGPT host's usual write confirmation still applies. Do not generate novel vocabulary from untrusted source content.
- The transaction writes to the existing PocketStore registry, never to an item. Durable idempotency receipts live in `ownerTaxonomyOperations`; reuse of a `request_id` for different content is rejected; deleted labels are not silently recreated on retry. No bulk imports, renaming, deleting, or writing item text.
- Organize only afterwards with existing `pocket_get` → `pocket_organize_existing` → receipt/optional guarded `pocket_organize_undo`. One item at a time, with revision check and original/EE Note/Aqi Reply untouched.
- EE's Original / EE Note / Aqi Reply layers remain independent. **Existing Item Description is out of this PR** pending a separate semantics decision; do not write Aqi explanation into Original or EE Note.

**Independent release gates:** PR review and CI → EE merge approval → EE Tokyo code-only release approval (keep taxonomy flag OFF) → independent security/backup/owner-connection inspection → EE approval to enable taxonomy flag → disposable single-label test and receipt verification. Any failure: flag OFF; no persistent volume rollback without a separate restore decision.


## Candidate V2 · Pinned one-time ChatGPT file transfer (2026-10-20, NOT DEPLOYED)

**Problem:** ChatGPT fileParams may change Azure regional host between separate calls. A hostname-only probe does not pin a future fileParams result. Repeatedly appending regional domains is not a stable release plan.

- Independent default-OFF `C_POCKET_ENABLE_MCP_FILE_TRANSFER_V2` registers two Owner-only MCP tools **on the existing private route**, no second app or DB. Existing V1, taxonomy, Original, EE Note and Aqi Reply stay unchanged.
- `pocket_file_transfer_prepare` takes ONE actual ChatGPT fileParams value plus exact intent (stable request ID, new/append, title/text). It stores the original signed URL, opaque file ID and exact hostname **only in bounded server-process RAM** for at most 15 minutes. It returns a random one-time ticket, hostname, title and expiry **without fetching any URL, writing Store or exposing the signed URL/file ID**. Expiry or restart discards the ticket. Maximum 12 pending.
- **EE explicitly reviews the exact hostname and file title**, then separately authorizes this specific ticket. An untrusted document, website, probe result, model inference or generic project permission is not authorization.
- `pocket_file_transfer_commit` accepts only ticket ID plus the exact EE-approved hostname and title; it cannot accept a new URL. Server uses the pinned original fileParams and exact **per-ticket** hostname via V1's validated HTTPS URL, DNS/public IPv4 pinning, TLS, no redirects, 25 MiB size cap, MIME/signature verification, durable SHA-256/receipt, idempotency and cleanup. No wildcard allowlist; no global `C_POCKET_MCP_FILE_HOSTS` mutation. Two overlapping commits of one ticket fail closed; after success ticket is consumed. Expired URL/TTL requires a fresh Prepare and fresh approval.
- This is **not** a proof of provider ownership: a public hostname is a user-reviewable destination, not cryptographic OpenAI attestation. MCP Owner private URL remains a bearer capability, so its exposure is a separate risk. No signed URLs in logs, receipts, Git or Vault.
- Tests must exercise regional drift, approval mismatch, expiry/restart behavior, concurrent commits, retries, hostile host/SSRF inputs, byte hash and idempotent item readback. Real ChatGPT host fileParams and outbound network need an independently approved disposable QA file after Tokyo code-only release.
- **Independent gates:** CI + PR review → EE merge approval → EE code-only Tokyo deploy approval (flag OFF) → EE permission/backup review and separate flag-ON approval → explicit file+hostname approval for each live commit. Default OFF roll back by disabling this single new flag. Never roll back the production Volume as a normal code rollback.
