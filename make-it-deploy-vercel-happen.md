# Make It Deploy on Vercel

Use this checklist to get `YamSLAM` running on Vercel with `simple-agents-wasm` only.

## 1) Ensure WASM package is pinned

- [ ] Update `package.json` to a stable `simple-agents-wasm` version.
- [ ] Run `npm install` and commit updated `package-lock.json`.

## 2) Keep runtime browser-only

- [ ] Ensure playground runtime calls `simple-agents-wasm` directly.
- [ ] Ensure no Node fallback route is used for completions.

## 3) BYOK handling and safety checks

- [ ] Ensure API key is only used in browser requests and not persisted server-side.
- [ ] Avoid logging raw credentials in client logs.
- [ ] Keep API key input masked by default with explicit show/hide toggle.

## 4) Vercel project configuration

- [ ] Set Node version in Vercel to a supported version (`>=18`, recommend current LTS).
- [ ] Confirm install command is standard (`npm install`) and build command is `npm run build`.
- [ ] Ensure there are no custom build steps that break client-side wasm assets.

## 5) Pre-deploy verification (local)

- [ ] Run `make test` (lint + typecheck).
- [ ] Run `make verify` (lint + typecheck + build).
- [ ] Start local prod server (`npm run build && npm run start`) and test `/playground` `llm_call` + chat.

## 6) Deploy and smoke test (Vercel)

- [ ] Deploy branch preview on Vercel.
- [ ] Open `/playground` and run a sample YAML `llm_call`.
- [ ] Verify chat pane request also succeeds.
- [ ] Check browser console for CORS/provider errors.
- [ ] Confirm no credential leakage in logs.

## Done criteria

- [ ] `simple-agents-wasm` loads in `/playground` production build.
- [ ] YAML `llm_call` and chat both succeed in browser for a CORS-compatible provider.
- [ ] `make verify` passes and Vercel smoke tests pass.
