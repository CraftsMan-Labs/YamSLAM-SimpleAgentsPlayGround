# YamSLAM Implementation Plan

## Plan Overview

- Build a frontend-only Vercel app with three routes:
  - `/` landing page with a short Interaction Reference summary block.
  - `/reference` full Interaction Reference page (the complete 5-section spec).
  - `/playground` YamSLAM app (YAML editor, examples, run, provider config, visualizer, collapsible chat).
- Apply one unified design language across both: JetBrains Mono, tokenized colors, technical white-card look, and the spacing/radius scales you defined.

## Phase 1: Product Structure

- Routes:
  - `/` -> landing page with hero and concise Interaction Reference summary.
  - `/reference` -> full Interaction Reference document with all 5 sections.
  - `/playground` -> main YamSLAM app UI.
- Shared shell:
  - token CSS variables, typography scale, button/link state styles, responsive breakpoints.
  - top-level docs-style consistency so landing and playground feel like one system.

## Phase 2: Design System (Spec as Source of Truth)

- Create token map from provided values:
  - color tokens (`primary/*`, `dark/*`, `surface/*`, `text/*`).
  - spacing scale: `8/12/16/20/28/32/48/64/80`.
  - radius scale: `10`, `14-16`, `999`.
- Typography:
  - JetBrains Mono globally.
  - enforce weights/sizes: H1 52/1.12, H2 36/1.2, H3 26/1.3, body 17/1.7, label 12 + 0.2em.
- Interaction states:
  - primary/secondary/nav-link hover/focus/active rules with WCAG-minded contrast.
  - include visible focus ring style (`primary/focus-ring`) in both modes.

## Phase 3: Playground Layout

- Left pane (editor column):
  - top-left `Examples` button.
  - YAML editor main area.
  - custom JS/TS function editor section (no imports; function-only).
  - bottom-right of left pane `Run` button.
- Right pane:
  - top-right compact provider config dropdown (`base_url`, `api_key`, `model`).
  - main right area: YAML flow visualizer.
  - mid-right collapsible mini chat pane layered/docked for interaction.
- Responsive behavior:
  - desktop split view.
  - tablet collapses chat by default, preserves visualizer.
  - mobile stacks editor/run then visualizer then chat.

## Phase 4: Runtime + Safety Constraints

- YAML runtime in browser only (no backend routes).
- Execution semantics v1:
  - deterministic sequential execution by default.
  - explicit future support for parallel with join semantics (to avoid nondeterminism surprises).
- Custom code execution:
  - run user JS/TS inside isolated Web Worker sandbox.
  - forbid imports and package installation.
  - expose only safe helper APIs (input/output transform utilities).
- Provider calls:
  - direct browser calls to user-provided OpenAI-compatible endpoint.
  - BYOK only, never platform keys.
  - key stored in-memory by default (optional session-only toggle later).

## Phase 5: Visualizer + Chat Integration

- Visualizer:
  - parse YAML nodes/edges and render flow graph.
  - live step status highlighting during run.
- Chat pane:
  - uses same provider config/model.
  - mode toggle:
    - direct chat
    - run-through-flow (future/optional)
- Collapsible mini-pane behavior:
  - remembers open/closed state per session.
  - keyboard shortcut to open/close for quick testing.

## Phase 6: QA + Deployment

- Tests:
  - YAML validation tests.
  - runtime step execution tests (success/failure/cancel/timeout).
  - custom function sandbox restrictions tests (imports blocked).
  - UI tests for pane collapse/responsive behavior.
- Vercel:
  - static/frontend deploy only.
  - strict CSP and no secret logging.
  - clear UI disclaimer: keys stay in browser session.

## Deliverables

- `Interaction Reference` page with all 5 sections implemented.
- tokenized component library (button/link/card/input variants).
- working playground matching the requested pane layout.
- docs: YAML schema, function sandbox rules, compatibility/CORS notes.

## Final Product Decision

- Use a standalone public `/reference` route and keep only a short summary block on `/` for cleaner navigation.
