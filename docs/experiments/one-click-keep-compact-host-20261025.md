# One-Click Keep — compact bordered Host sizing experiment (code-only)

**Status:** isolated EXPERIMENT, not in PR #35, not deployed, no QA App connection, no impact on frozen CSS V2, Owner MCP or file operations.

## Decision

EE prefers **bordered + compact** instead of a full-row empty white Host frame.

Keep current MCP resource metadata `_meta.ui.prefersBorder = true`. The border option is only a Host hint. The inner `.card { max-width: 440px }` does not control the outer iframe.

## Verified standard behavior

MCP Apps `McpUiHostContext.containerDimensions` distinguishes **fixed width** (`width`) and **flexible width** (`maxWidth`). A connected View can send `ui/notifications/size-changed` with `width` and `height` on content change. For flexible width, the Host is responsible for resizing the container. When width is fixed, reporting a smaller preferred width **cannot override Host-controlled layout**.

Reference:
- https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx
- https://apps.extensions.modelcontextprotocol.io/api/classes/app.App.html#sendsizechanged
- https://developers.openai.com/plugins/reference

## Isolated helper

`server/experiments/keep-compact-size.js` is not imported by any production resource. It calculates a preferred viewport width from actual rendered card + measured padding (440px card + 14px total horizontal gutter → **454px** target), and reports height when content changes.

- Flexible Host: report measured width + height, limited by `maxWidth` and viewport.
- Fixed-width Host: **do not request width changes**; report only flexible height when applicable.
- Debounce duplicate notifications, observe content changes, disconnect cleanly.
- Send **only numeric sizes**; no file name, source hostname, raw fileParams, bearer, IDs or SHA-256.
- Bridge delivery **must be supplied by an initialized MCP Apps App** (e.g. the SDK's `app.sendSizeChanged`). Do not simply push JSON-RPC events before `ui/initialize`.

Test module `server/experiments/keep-compact-size.test.js` covers fixed/flexible, mobile clamp, content update, de-duplication and lifecycle. A separate in-memory execution of the exact committed JS passed 6 targeted behavioral checks; this is not a browser/real-Host test.

## Remaining unknown

PR #35's working Widget uses `window.openai.callTool` and ChatGPT compatibility hydration and does not implement the full MCP Apps bridge handshake itself. Simply posting size notifications without initialization risks being ignored. Integrating the standard bridge or the official MCP Apps SDK is a separate, narrowly scoped compatibility decision, not an incidental CSS tweak.

The real ChatGPT Host may present a **fixed-width iframe** even if the open standard permits flexible width. If so, the right-side white area cannot be reliably removed from inside the iframe. `prefersBorder=false` would only change border presentation and would not solve fixed width.

## Gate

Do **not** cherry-pick this helper into PR #35 or production just to claim a compact Host. First decide whether a small standards-compatible bridge integration is justified. Only the final isolated live Host observation can establish that ChatGPT honors compact width. Preserve existing CSS freeze, save/cancel behavior and previous real-byte E2E.
