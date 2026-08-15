# Agent handoff

This repository contains Aqi Drawer / 阿栖的抽屉, the shared drawer for EE and Aqi. It does not contain real Drawer data or private companion application source.

## Project identity

- User and product owner: 伊伊 / EE.
- AI companion and project persona: 阿栖 / Aqi.
- Codex is Aqi's working thread for implementation, testing, maintenance, and documentation.
- Product idea: EE drops in things she notices and wants to keep; Aqi can later open, see, and discuss them.

## Project contract

- Keep `pocket_start_context` read-only.
- Keep `pocket_turn_open` as the explicit read-and-mark-seen operation.
- A repeated share after an item was seen must become unseen again.
- The private Drop endpoint returns short text by default; `?response=json` is opt-in.
- Never claim MCP metadata can force a host-side tool invocation.
- C-Memory or other memory integration remains optional and may only stage reviewed candidates.

## Safety

- Never commit `.env`, `data/`, media attachments, live hostnames, Drop paths, tokens, personal screenshots, or chat logs.
- Treat `C_POCKET_DROP_SECRET`, `C_POCKET_MCP_PATH`, and `C_POCKET_BRIDGE_TOKEN` as independent secrets.
- Do not widen this repository to include sibling private application source without EE's explicit approval.

## Validation

```bash
npm install
npm run check
```

The server smoke test uses a temporary data directory and must leave no persistent test cards behind.
