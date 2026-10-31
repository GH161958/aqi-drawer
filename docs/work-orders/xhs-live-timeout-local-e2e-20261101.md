# Aqi Drawer · XHS live timeout diagnosis + local E2E before next release

**Date:** 2026-11-01. **Status:** CODING/DIAGNOSIS TASK ONLY, not a tested fix. **Repo:** `GH161958/aqi-drawer`. **Baseline:** `main == deploy/tokyo == 4066ca5e15d01add221d554369e3a62da2da712c` after PR #38. No production changes, merges or deployment authorized.

## Problem verified read-only against actual Drawer

EE used the new `重新读取来源` control after PR #38's Tokyo promotion. It failed. EE shared the **same XHS post again** and received a **different `xhslink.cn/o/...` short URL**. The new capture also failed. Owner MCP read-only inspection confirmed:
- First saved record: XHS provider, `parseStatus=failed`, original `error=fetch failed`, no resolved note ID, no images.
- Second saved record: distinct item ID, distinct short URL, XHS provider, `parseStatus=failed`, **`errorCode=XHS_TIMEOUT`**, no resolved note ID, no images.
- The two records share human-visible content but cannot be safely identified as the same canonical note without resolving at least one redirect. PR #38 explicitly guarded only exact URLs or note IDs, so it does **not** deduplicate these aliases. This is a production-reported gap, not proof the second link has expired.
- Existing normalisation includes `xhslink.cn`; no evidence that the error is merely a missing hostname rule. Inability to fetch could be DNS, TCP/TLS, redirect latency, page-body stall, server anti-bot, platform availability or environment-specific egress. **Do not guess root cause from a timeout code.**
- This public repository must **not** receive EE's exact live share URLs, auth tokens, private source material or raw response bodies. Obtain any live URL at runtime through a local environment variable; redact sensitive query strings in logs.

## Required scope — first reproduce, then change code narrowly

1. Verify current repo HEAD, `npm ci`, baseline tests. **Run locally**, not only GitHub Actions; use a disposable `C_POCKET_DATA_DIR`. Preserve EE's real Tokyo Store, attachments and original short links.
2. Add a **diagnostic-only local CLI** (e.g. `tools/xhs-connection-diagnostic.mjs`) using the app's current safe XHS adapter, plus bounded, stepwise DNS / connection / redirect / response timing probes as appropriate. Only allow existing XHS hosts; no generic arbitrary URL fetch/proxy. Use `XHS_DIAG_URL` supplied locally; never print full URLs, tokens, cookies or raw HTML. Report only host, HTTP status, redirect count, elapsed stages, safe error category, and whether an approved final note ID is present. Keep SSRF boundaries. If external HTTP is blocked from the test machine, report `environment_inconclusive` rather than claiming XHS is down.
3. Compare **two kinds of local test**: (a) synthetic injected adapter fixture proving graceful failure/recovery; (b) one actual public XHS share provided locally via `XHS_DIAG_URL`, with `xhslink.cn` redirects, page fetch, and image fetch if permitted. Compare browser-openable link vs Node fetch only if available. Diagnose which stage times out. Do not record the actual link in committed test fixtures.
4. Make **only an evidence-based minimal fix** to genuine app defects uncovered (timeouts, error propagation, redirect/body handling, source-data UI, etc.). Do not blindly increase timeout, mutate `.cn` to `.com`, add broad egress, bypass access gates, inject authenticated cookies, scrape behind login, or install an unreviewed third-party proxy/downloader. If a host/network restriction is the root cause, provide a configuration/deployment recommendation with narrow verification; don't pretend code alone fixes Tokyo access.
5. On repeated share using different short aliases when both fail: **do not merge by common title alone.** Consider an explicit *possible duplicate* hint or safe user-review affordance, preserving both originals until EE chooses. Successful note ID resolution can support deterministic identity; conflicts remain explicit.
6. If automatic XHS extraction is unavailable even from a valid fresh link, offer an honest manual path using existing authenticated attachment upload/Inspect, preserving original images and XHS source appearance without synthetic images. No new feature is required unless a real UX gap is established.
7. Add targeted regression tests for real-world failure paths: two short aliases of same note, both unreadable; one resolves later; subsequent retries and 409 conflict; timeout before redirect vs after redirect vs body stream vs image fetch; absent `__INITIAL_STATE__`; no leaks of URLs/tokens; no phantom media/duplicate writes; existing successful XHS and non-XHS preserved.

## Mandatory LOCAL acceptance (must show actual executed receipts)

- On Codex/dev environment: `npm ci`, `npm run check`, `npm run frontend:check`, `npm run frontend:build` (or actual documented frontend build script), plus targeted tests. Show terminal exit codes and runtime Node version. Run against an isolated fixture Store/Media, never Tokyo.
- Launch local Drawer against a synthetic fixture. Browser at **375px mobile viewport**: paste full XHS share text, fail safely with visible XHS identity and original link, inspect/retry, show error, test source recovery with same item ID and exactly one real fixture attachment-backed photo stack. Desktop check optional. This is **not** a replacement for physical iPhone Safari acceptance, which remains separate.
- Attempt read-only live-source probe from a local machine with known outbound access and report classification. If network unavailable, show that uncertainty honestly; do not mark actual XHS extraction green. Never commit the actual live URL, note content, response body, HAR, secrets or screenshot of EE's private post.
- CI must still be green on the exact code HEAD before asking EE to review. Provide a Draft **code** PR, exact files/commits, rollback, known remaining limitations and local test receipts. This task work-order PR is documentation-only and should not be merged as a fix.

## Safety/production

No edits, deletions or retry attempts on EE's **two existing real Drawer items**. No production Store/Media mutation, deployment, environment variables, DNS, secret rotation, `main` merge or `deploy/tokyo` advancement without separate EE approval. The prior release rollback candidate is `352a88d1ce81cdacd291ce28342efc310ca081e4`, but do not force-reset or auto-rollback. Full offsite backup/restore is intentionally postponed by EE to the planned hosting move; this is a local fix/test phase. Report if a necessary change would increase risk or require owner control-plane actions.

**Definition of done:** A concrete, locally reproduced diagnosis (or explicit network-limited uncertainty); a minimal, evidence-backed fix where possible; repeatable local end-to-end tests; no false promises of universal Xiaohongshu access; user-approved production steps remain separate.
