# Drawer Design Prototypes

## Status

```text
DESIGN / REFERENCE ONLY
NOT PRODUCTION CONTRACT
FIXTURE DATA ONLY
```

## Purpose

These standalone files preserve historical design work for:

- comparing physical-paper layouts;
- reviewing typography and media specimens;
- visual acceptance on iPhone and desktop;
- recording visual directions that have already been explored;
- providing historical context during future real-content burn-in.

## File inventory

### `inspect-original-paper-picker.html`

- Original/A2 typography
- Photo Stack
- Viewer
- natural paper
- Font fitting
- fixture-only XHS comments

### `inspect-receipt-picker.html`

- Receipt / Record layout comparisons
- expanded / closed states
- historical header candidates

### `intake-folio-picker.html`

- Incoming Folio placement candidates
- open / return / success lifecycle specimen
- reduced-motion comparison

### `paper-peek.html`

- shallow paper/folder-edge exploration
- historical Cabinet peek reference

## Production boundary

- Production components must not import these files.
- Prototype fixtures are not an API or data contract.
- Native `<dialog>` elements, debug controls, contact sheets, and device frames in a prototype do not represent production architecture.
- Production truth lives in `frontend/src/` and its committed contracts.
- Designs already implemented in production must not be copied back from a prototype to overwrite living production behavior.
- Future changes should begin by reconciling the living production source.

## Accepted production outcomes

The major directions already carried into production include:

- Archive physical-object presentation
- Inspect A2 reading typography
- natural paper growth
- Photo Stack
- full-image Viewer
- persistent Font Wardrobe
- Receipt/Filing/attached-paper physical language
- Incoming Folio functional lifecycle

## Prototype-only material

The following remain reference material rather than production contracts:

- fixture XHS captured comments
- contact sheets
- alternative A2-readable comparison
- rejected Receipt/header variants
- alternative Intake placement variants
- prototype-only fitting/debug controls

## Local viewing

With the Vite development server running, open:

```text
/prototypes/inspect-original-paper-picker.html
/prototypes/inspect-receipt-picker.html
/prototypes/intake-folio-picker.html
/prototypes/paper-peek.html
```
