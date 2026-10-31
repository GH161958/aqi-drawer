# Aqi Drawer · XHS link intake failure & in-place recovery (Codex work order)

**Date:** 2026-11-01  
**Repo:** `GH161958/aqi-drawer`  
**Verified base:** `main == deploy/tokyo == 352a88d1ce81cdacd291ce28342efc310ca081e4` (before creating this task branch)  
**Status:** Task specification only; **NO IMPLEMENTATION, MERGE, RELEASE, DATA EDIT, OR DEPLOY PERMISSION**.  
**Product intent:** An EE-pasted Xiaohongshu share should remain a recognisable XHS object when page extraction fails, and should be recoverable *in place*, with original object identity, contents, and attachments preserved.

## 1. Real user-reported reproduction and verified runtime evidence

On iPhone Safari, EE opened Aqi Drawer's `INCOMING / 01` capture sheet and pasted an XHS share message containing title text, `https://xhslink.cn/o/72W533rbYSq`, and the usual '複製後開啟小紅書查看筆記' suffix. After saving, the item looked like a generic paper/article instead of the existing XHS photo stack.

Owner MCP read-only lookup of existing stored item:
- **Item ID:** `d58123f0-d699-4109-9d79-fbc37ef93aec`
- **Existing original URL:** `https://xhslink.cn/o/72W533rbYSq`
- **Stored:** `kind=link`, `sourceApp=小红书`, `sourceData.provider=xiaohongshu`, `sourceData.parseStatus=failed`, `sourceData.error=fetch failed`, `attachmentCount=0`, no `noteId` or stable XHS `sourceIdentity`.
- Therefore URL/domain/source recognition succeeded; remote note fetch and parse did not. **The precise external cause of `fetch failed` is unproven** (DNS, TLS, redirect, timeout, blocked egress, access gating etc.). Do not claim a definite cause.
- Comparison: previously saved XHS item `a25e8cef-ca3e-4102-8fe8-58f94bf36152` has `parseStatus=complete`, canonical `/discovery/item/<noteId>`, and a real image attachment, so the existing normal XHS flow once worked.
- Screenshot is the **Capture input form**, which correctly remains an input paper while composing. Special post-save object rendering is the repair target; do not mistakenly make the input form a XHS preview based on pasted URL without product approval.

## 2. Verified code paths (main at base)

- `server/adapters/xhs.js`: `extractXhsUrl` recognises share text and `xhslink.cn`; `XhsAdapter.parse` fetches HTML through allowlisted redirects, bounded by timeout/size and `__INITIAL_STATE__` parsing. `fetch failed` is thrown by the remote fetch layer without an actionable classification.
- `server/share-normalizer.js`: `normalizeIncomingShare` extracts first URL, infers `sourceApp=小红书`.
- `server/index.js`, `handleUpload`: on successful parse calls `store.upsertXhs`; on error writes link fallback with `sourceData.parseStatus=failed`, `error`, and optional `sourceIdentity` only if a noteId is recoverable from resolved URL.
- `server/store.js`, `upsertXhs`: currently matches pre-existing XHS item by `sourceIdentity.provider/externalId=noteId`. It does **not** explicitly match a failed short-link fallback without noteId. Reposting the same short URL once successful **could create a second item**, losing in-place continuity.
- `frontend/src/presentation/classifyPresentation.ts`: XHS specialised photo presentation only when actual photo attachments exist. No images -> `article` when `sourceUrl` exists.
- `frontend/src/features/archive/ItemPreview.tsx`: `isArticle` generic paper layout, `isXhsPhoto` special photo-stack layout. Do not render fake photos to force `isXhsPhoto`.
- `server/xhs-test.js`: includes recovery after failure when **noteId is already in a canonical URL**, but does not cover today's unresolved short-link identity case.
- `server/content-reader.js`: stored XHS read path skips `parseStatus=failed`, so generic fallback also affects subsequent content reading.

## 3. Implement in a bounded, reviewable code PR (one cohesive slice or clearly split)

### A. Truthful XHS fallback (UI)
- When an XHS URL is detected but remote extraction failed, keep the native XHS source identity visible in the saved preview (e.g. labelled XHS *link clipping* / '小红书 · 待补全', proper original-source affordance). It should **not** pretend photos or notes were fetched.
- Prefer minimal changes using existing object language/styles. Keep `INCOMING / 01` input design, existing photo stack for successful XHS notes, and all non-XHS presentation unchanged.
- If the frontend summary model lacks `parseStatus`, choose a safe, narrow source-data projection rather than inferring failure simply from 'no image' (text-only XHS posts and legitimate image-less notes may exist).

### B. Explicit user-directed safe source retry
- Provide a bounded `重新读取来源` action on failed/partial XHS objects. Retry **server-side**, only on an existing owner-authenticated item, with original URL from the persisted object; do not trust a newly supplied arbitrary URL.
- If retry fails, preserve current item and all original data; return clear recoverable failure, avoid blank UI/infinite spinner. Do not mark complete.
- If retry succeeds, atomically refresh the **same item ID** with canonical noteId/title/desc/images and correct status, preserving existing EE note, tags, collection, status, replies, non-XHS attachments, manual title (when `titleOrigin=capture`), and historical activity. Avoid recording a false new 'received' event or incrementing received count solely for retry.
- Resolve fallback item identity before `upsertXhs` by a carefully constrained prior matching rule (exact stored originalUrl / resolved canonicalUrl from the same source, nondeleted, XHS-only, only unambiguous matches). If the resolved noteId already belongs to a *different* existing real XHS object, do not silently merge or overwrite either; return an explicit conflict/review outcome. Prevent duplicates and cross-source collisions.
- Treat retries as idempotent; support repeat clicks/concurrent requests without ghost items or repeated image downloads. Use existing Store single-writer/transaction patterns.

### C. Observability and remote failures
- First perform **read-only** environment/repro checks using safely synthetic URLs + existing isolated fixtures. Determine whether the short-link failure is network/redirect/access gating or parser failure. Do not assume that switching the incoming URL to a canonical note page automatically fixes it.
- Categorise safe errors (network/DNS/TLS/timeouts/HTTP access denial/redirect blocked/HTML parse changed) without leaking secrets, auth headers, cookies, capability path or private URLs into logs/UI.
- No new proxy, scraper, bypass of XHS access restrictions, stored login cookies, external third-party downloader, unbounded retries, generic DNS/SSRF whitelist expansion, or unauthorised ingress.

## 4. Regression / acceptance (must add real tests)

- Full pasted Chinese share text, `xhslink.cn` short URL, `xhslink.com`, canonical `xiaohongshu.com/discovery/item/<id>`, trailing punctuation, irrelevant non-XHS URL.
- Explicit `fetch failed` fallback: one item, provider XHS, parse failed, original share/source URL retained; UI no synthetic content.
- **Critical:** Failed short-link first, later successful parse with noteId: **same original item ID**, no second Inbox item, original EE metadata/attachments preserved, manual title preserved, actual image hashes saved only on success; second retry stays idempotent. Test both same-session and restart.
- Existing complete XHS note refresh; failed subsequent retry leaves complete/partial data intact.
- Resolved noteId already owned by a different item -> conflict, never implicit overwrite.
- Concurrent retry, timeout/redirect cap, image download failures, unavailable upstream, and non-XHS original link should be covered as appropriate.
- Regression `server/xhs-test.js`, MCP/Store, frontend presentation tests, Docker smoke. Ensure no regression in One-Click Keep, PDF/TXT/DOCX, ordinary article UI, mobile Safari paper geometry. Acceptance is not complete without testing that the specific fallback **visibly** appears as XHS after retry (on a fixture; no unauthorized production changes).

## 5. Execution / safety gate

- Implement on **a fresh isolated branch from latest main**; this task PR is documentation-only and NOT a merge candidate. Can make a separate Draft code PR referring to this work order. Use Codex only after owner explicitly starts a Codex session; this PR by itself does not trigger an agent.
- Test locally/CI on synthetic disposable fixture Store/Media. **No edits, imports, retries, or deletions on the real item** `d58123f0-...` during development. No GitHub merge, `deploy/tokyo` update, Zeabur rollout, env/secret change, or production data writes without separate EE approval.
- Submit concise proof: exact changed files, failing/green tests, before/after mobile screenshots where feasible, stable itemId proof, known limits, rollback path.
- Deployment later has separate mandatory backup/restore gate because Zeabur sunset makes data loss risk time-sensitive. Work must not obstruct priority offsite backup/migration.

**Definition of done:** A user can keep a share even when XHS is unreachable, see truthful XHS-source status, safely retry later, and receive a genuine XHS content/photo rendering **on the same original object** if source data becomes accessible. If upstream remains inaccessible, no fabricated content or guaranteed photo extraction is claimed.
