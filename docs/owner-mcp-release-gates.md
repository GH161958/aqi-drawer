# Tokyo Drawer · Unified Owner MCP release gates (PR D-0 candidate)

**State:** planning and code-only checklist as of 2026-10-17. Nothing in this document authorizes a production change, automatic data write, ChatGPT connector replacement, or a real file transfer. Source baseline: GH161958/aqi-drawer `main` includes merged PR #15 unified gateway, #16 bounded organizer, #17 file Intake. The previously verified `deploy/tokyo` branch is `b701fd0a67afcf90242875784e6572c2775842b2`. Both refs must be re-read before release.

## Architecture and permissions

One **eventual** ChatGPT Aqi Drawer Owner connector → one high-entropy /mcp/... capability URL → existing PocketStore + Media. The old URL **must remain operational during cutover**. It continues to have its previous tools and cannot gain Capture from a feature flag. Neither creating a separate data source nor linking Memory/Vault write policy to Drawer metadata is authorized.

Owner has reading, explicitly requested text/link Capture, user-authorized quiet single-item organization using *registered* Tags and Collections with later receipts, and **explicitly requested** PDF/image/document file Intake. New taxonomy, bulk operations, original-content rewrites, deletion and automatic file collection still require new authorization. Model instructions and read-only diagnostic tools cannot supersede platform write confirmations.

**Important risk:** The Owner connection also exposes existing Memory / Vault tools. The secret URL is a capability bearer; it is not OAuth with scoped roles. Treat it as an administrator-like credential; keep out of chats, screenshots, repositories, logs and third-party issue trackers. Rotate if leaked. Do not shut down the old endpoint before verifying all consumers have migrated.

## Gate 0 · read-only preflight (NO production changes)

- [ ] Recheck GitHub `main`, `deploy/tokyo` and CI, branch merge-base; do not assume previous hashes are still current.
- [ ] In **private Zeabur Dashboard**, verify the *actual* Tokyo aqi-drawer service is Running and serves health, the existing UI, and old MCP tools. Confirm mounted persistent volume and `C_POCKET_DATA_DIR=/app/data/drawer-production`; record only boolean presence/healthy status, not secret values.
- [ ] Privately confirm **current** production backup: timestamp, full volume archive checksum, encrypted offsite copy, complete PocketStore/media inspection and isolated restore rehearsal; don't reuse old snapshot counts as current. Use `docs/tokyo-backup-and-restore-drill.md` as procedure, updating its stale commit references at execution time.
- [ ] Confirm `C_POCKET_MCP_CAPTURE_PATH` is configured at ≥43 URL-safe random chars and differs from `C_POCKET_MCP_PATH`; never reveal either. Ensure Capture, Owner, probe and file Intake flags all unset or `false`.
- [ ] Identify consumers of the old MCP path and confirm rollback contact/maintenance window.

**If any current backup/volume/secret/health check is unknown or failing, STOP before applying any configuration.** GitHub cannot inspect live Zeabur variables, mounts, latest backup or real ChatGPT host file support.

## Gate 1 · deploy code with all new flags OFF (new EE approval required)

- [ ] EE separately approves advancing `deploy/tokyo` to an exact CI-verified `main` SHA; fast-forward only, no force push, no `C_POCKET_*` variable edits.
- [ ] Zeabur deploy success + old URL health + UI/iPhone workflows checked; no Owner route exposed while `C_POCKET_ENABLE_MCP_CAPTURE=false`.
- [ ] Rollback if required: restore previously working image/config only through authorized operational procedure. **Do not roll back the persistent volume**, unless separately approved for a genuine restore with a tested backup.

## Gate 2 · staged Owner connection (new EE approval required)

- [ ] Keep `C_POCKET_ENABLE_LEGACY_MCP=true` (or unset, default true). After fresh backup/health, approve adding `C_POCKET_ENABLE_MCP_CAPTURE=true` and `C_POCKET_ENABLE_UNIFIED_OWNER=true` **together**; the existing high-entropy private `C_POCKET_MCP_CAPTURE_PATH` becomes the Owner endpoint. `C_POCKET_ENABLE_MCP_FILE_HOST_PROBE=false`, `C_POCKET_ENABLE_MCP_FILE_INTAKE=false`.
- [ ] Recheck old endpoint is unchanged and working. Connect/refresh **one intended Aqi Drawer ChatGPT App** to the new Owner secret address by private UI only. Avoid leaving a second permanent connector, but keep the old route during migration. Confirm listTools: reads, Capture, organize, undo; no unrestricted `pocket_edit_metadata`; no file Intake yet.
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

## Gate 5 · legacy route retirement (LAST, separately approved)

- [ ] Verify the replacement ChatGPT App uses the Owner URL and **all** intended old clients have migrated; confirm old MCP is not used by iPhone or another integration. Ensure health, activity receipts, file accessibility and up-to-date backup.
- [ ] EE separately approves `C_POCKET_ENABLE_LEGACY_MCP=false`. Confirm old endpoint closes without disabling Owner. Retiring a path does not rotate a leaked secret.
- [ ] Roll back by restoring the legacy route flag to true and disabling File Intake / probe / Owner-Capture as appropriate with explicit approval; verify old clients and Store/media remain intact. Production data always requires independent restore authorization.

## Fail-closed switch relationships

| Variable | Default | Constraint |
| --- | --- | --- |
| `C_POCKET_ENABLE_MCP_CAPTURE` | false | Requires valid `C_POCKET_MCP_CAPTURE_PATH`, distinct from the old MCP route |
| `C_POCKET_ENABLE_UNIFIED_OWNER` | false | Requires Capture true |
| `C_POCKET_ENABLE_MCP_FILE_HOST_PROBE` | false | Requires Capture + Owner true; no DNS, download, Store read/write |
| `C_POCKET_ENABLE_MCP_FILE_INTAKE` | false | Requires Capture + Owner true **and** reviewed nonempty host allowlist |
| `C_POCKET_MCP_FILE_HOSTS` | unset | Exact approved DNS hostname list; host probe does not authorize |
| `C_POCKET_ENABLE_LEGACY_MCP` | true | May be false only if Owner true and after explicit retirement approval |

The `npm run production:check` guard verifies switch consistency with no secret printing. It is not a replacement for Zeabur inspection or the private, version-specific deployment runbook. No production environment should be modified based solely on this draft.
