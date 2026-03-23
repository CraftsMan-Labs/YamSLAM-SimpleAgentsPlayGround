# Make It Deploy on Vercel

Use this checklist to get `YamSLAM` running on Vercel with `simple-agents-node`.

## 1) Ship Linux-compatible native binaries

- [ ] Update `simple-agents-node` CI/release pipeline to publish prebuilt binaries for Linux (x64 and arm64 at minimum).
- [ ] Ensure the package resolves the correct platform artifact at install/runtime (not a macOS-only `index.node`).
- [ ] Publish a new npm version (for example `0.2.29+`) with multi-platform support.
- [ ] Verify from a clean Linux environment that `require("simple-agents-node")` loads without rebuild.

## 2) Pin and consume the fixed package in YamSLAM

- [ ] Update `package.json` to the new `simple-agents-node` version.
- [ ] Run `npm install` and commit updated `package-lock.json`.
- [ ] Keep Next config externalization for native package loading:
  - [ ] `next.config.mjs` includes `experimental.serverComponentsExternalPackages: ["simple-agents-node"]`.

## 3) Keep API route on Node runtime

- [ ] Confirm `src/app/api/complete/route.ts` exports `runtime = "nodejs"`.
- [ ] Confirm no Edge runtime is used for this route.
- [ ] Confirm route uses `simple-agents-node` `Client` for completions.

## 4) BYOK handling and safety checks

- [ ] Ensure API key is only forwarded per request and not persisted server-side.
- [ ] Avoid logging raw credentials in server logs and client logs.
- [ ] Keep API key input masked by default with explicit show/hide toggle.

## 5) Vercel project configuration

- [ ] Set Node version in Vercel to a supported version (`>=18`, recommend current LTS).
- [ ] Confirm install command is standard (`npm install`) and build command is `npm run build`.
- [ ] Ensure there are no custom build steps that strip native binaries.

## 6) Pre-deploy verification (local)

- [ ] Run `make test` (lint + typecheck).
- [ ] Run `make verify` (lint + typecheck + build).
- [ ] Start local prod server (`npm run build && npm run start`) and test `/api/complete` via playground UI.

## 7) Deploy and smoke test (Vercel)

- [ ] Deploy branch preview on Vercel.
- [ ] Open `/playground` and run a sample YAML `llm_call`.
- [ ] Verify chat pane request also succeeds.
- [ ] Check Vercel function logs for native load/runtime errors.
- [ ] Confirm no credential leakage in logs.

## 8) Rollback/fallback plan

- [ ] Keep a fallback branch or feature flag that uses direct `fetch` (or JS SDK) if native loading fails in production.
- [ ] Document the fallback trigger conditions and rollback steps.

## Done criteria

- [ ] `simple-agents-node` loads on Vercel runtime without binary errors.
- [ ] `/api/complete` works for valid BYOK config.
- [ ] `make verify` passes and Vercel smoke tests pass.
