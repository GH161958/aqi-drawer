# One-Click Keep · isolated, default-OFF executable POC (2026-10-21)

**Development only. NOT deployed, merged, enabled, or exercised against real ChatGPT private files.** Parent design: [PR #34](https://github.com/GH161958/aqi-drawer/pull/34). Baseline: [merged PR #33](https://github.com/GH161958/aqi-drawer/pull/33).

## Exact user experience under test

EE says "把这份文件收进抽屉" with one ChatGPT file attachment. For already approved exact hosts, use existing V1 single-call save. For other HTTPS hosts, call the separate `pocket_file_keep_prepare` tool to show a compact in-chat file-specific card. This tool does **not** download, resolve DNS, or write Store/Media. EE presses the one save button. The Widget invokes `pocket_file_keep_redeem`, which receives only a short-lived private token (never raw URL/fileParams), and returns a genuine PocketStore receipt with item ID, attachment ID, bytes, SHA-256. No external upload page or permanent wildcard allowlist.

**Important:** the button and private capability cannot cryptographically establish an actual physical human click. A malicious script in a compromised Widget or an actor that steals the one-time bearer can redeem it. The official ChatGPT tool-result `_meta` is model-hidden but is **not** an independent user-consent attestation. Therefore POC results must be distinguished from an independently enforced human-approval proof.

## Security and scope

- POC gated behind `C_POCKET_ENABLE_ONE_CLICK_KEEP_POC=true` (default **false**), with runtime and production preflight also requiring existing Owner/Capture, File Intake V1 (and its reviewed static host list) and V2. No active service exists when OFF.
- Only the private Owner MCP connection registers the new tools. `pocket_file_keep_prepare` is model callable, requires one valid `fileParams` object and a stable **independent** request ID, and pins the exact original URL, file ID, title/text/target in process memory for at most two minutes.
- `pocket_file_keep_redeem` is marked app-only through `_meta.ui.visibility=['app']` and additionally requires a random 256-bit private bearer in tool arguments. The bearer is delivered exclusively as tool-result `_meta.aqiOneClickKeep.capability` to the Widget. Neither public `structuredContent` nor model-visible `content` carries that bearer. The legacy model-callable V2 Commit never has an associated ticket for this workflow and therefore **cannot** redeem it.
- The Widget uses a real button handler (no automatic calls/effects), with `window.openai.callTool` and private `window.openai.toolResponseMetadata`. Feature detection fails closed when the Host cannot provide private metadata/tool interaction. It has no remote scripts, CORS access, storage, cookies, long-lived token or direct browser fetch.
- `createOneClickKeep` handles single intent conflicts and de-duplication, one in-flight save per capability, bound TTL, expiry and cancellation. Successful redemption reuses existing File Intake with one **exact hostname** in that operation only. Same URL, SSRF, public IPv4+DNS pinning, TLS, redirects prohibited, byte size <=25 MiB, type/MIME, request SHA and Store publication validation as PR #33. No new database, upload API, schema or permanent egress list.
- Completed replay within TTL re-reads/verifies the already stored original attachment; it cannot re-download, retarget or substitute fileParams. Expired/changed file references require a new explicit per-file action. Raw signed URL, ID and private capability disappear from the completed record. Process restart invalidates unredeemed capabilities.

## Actual scope of automated tests

The POC adds `server/one-click-keep.test.js` plus a real isolated Owner MCP transport regression. Synthetic disposable PDF bytes, temporary PocketStore only. Tests: no prepare egress/write, private token absent from public results, invalid/forged tokens, source+intent conflicts, bounded approval capacity, expiry, late uncooperative downloader, same-capability concurrent redemption and verified durable replay. Owner MCP fixture inspects Widget resource and registered tool visibility; checks no pre-click egress, authenticated app-token redemption and original attachment read-back. Preflight tests default-OFF + prerequisite gates.

**Not yet proved:** ChatGPT Host renders the widget or correctly passes private `_meta` in all desktop/mobile clients, Host itself enforces UI-only tool discovery, actual click provenance, real fileParams URLs/host rotation, generated image or document handoff, live TLS compatibility, source URL renewal, and actual user interaction count. Production deployment, enabling POC, real ChatGPT Host QA and use of EE's private files each require separate EE authorization.

## Follow-up gates

1. GitHub checks + code/security review; address findings **without** breaking Owner lanes or production. No merge from this draft.
2. Synthetic Host preview and the authorized ChatGPT isolated Host QA, one disposable file only. If hidden `_meta` fails to reach component or Host cannot render the app-only call, **do not weaken security or pretend the save succeeded**.
3. Only then separately decide whether to merge/deploy/enable. V2 is unchanged and serves as rollback. PR #34 remains the design record.

Sources: https://developers.openai.com/plugins/build/chatgpt-ui and https://developers.openai.com/plugins/reference.
