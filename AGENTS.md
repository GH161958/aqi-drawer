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

## Frontend design and Skill routing

For Drawer frontend, motion, prototype, or visual work:

1. First read `DESIGN.md` and the relevant **living source** under `frontend/src/`. Read `docs/REFERENCE_LIBRARY.md` when considering external design references. `frontend/prototypes/` is historical/isolated reference, not production authority.
2. Check actual Git branch, HEAD, and deployed baseline before modifying code. `docs/PROJECT_STATUS.md` and older roadmap sections are historical; reconcile them with current code, tests, and the latest approved handoff. Never use a frozen checkpoint to overwrite newer production work.
3. Preserve Drawer’s physical-object language, existing accepted visual geometry, iPhone Safari first-paint behavior, and interaction contracts. Product decisions and EE-accepted QA override generic Skill aesthetics.
4. Select the **smallest task-specific Skill set** from what this Codex environment can actually discover:
   - React implementation/composition/performance: `vercel-react-best-practices`.
   - Focused interaction/design craft: `emil-design-eng`.
   - Explicit isolated interactive variants: `prototype` (invoke deliberately; do not infer availability from documentation).
   - Review of an implemented motion diff: `review-animations` (invoke deliberately).
   - Broad read-only motion audit: `improve-animations` (not a feature executor).
5. Do not stack competing design-director Skills, install/update tools, copy external components, or add dependencies without task-specific review and EE approval. A documented Skill is not necessarily installed; an installed Skill is not necessarily invoked.
6. For external reference reuse, record source/revision, rights, what was borrowed, and what was rejected. For mobile changes, require actual iPhone Safari QA; desktop emulation alone is insufficient.
7. Report a brief **Skill Usage Receipt**: Skills available, Skills actually read/invoked, decisions influenced, rejected suggestions, and unverified device checks. Do not claim tool use without evidence.

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
