# YamSLAM-SimpleAgentsPlayGround

YamSLAM is a web playground for running YAML flows with bring-your-own
OpenAI-compatible API configuration.

## Routes

- `/` landing page with summary blocks
- `/reference` full interaction reference
- `/playground` YAML runtime, visualizer, provider config, and chat pane

## Run locally

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

## Make shortcuts

```bash
make install
make dev
make test
make verify
make run-wasm-chat-history
```

- `make test` runs quick checks (`lint` + `typecheck`)
- `make verify` runs full local verification (`lint` + `typecheck` + `build`)
- `make run-wasm-chat-history` runs a quick wasm workflow check using `simple-agents-wasm`
  - Defaults: `WASM_WORKFLOW_YAML=examples/email-chat-draft-or-clarify.yaml`
  - Pass flags with `WASM_CHAT_FLAGS`, for example:
    `make run-wasm-chat-history WASM_CHAT_FLAGS='--show-events --message "Draft a concise replacement request email"'`

## Notes

- Runtime adapter uses WASM-only browser execution via `simple-agents-wasm`
- BYOK credentials are forwarded per request and are not stored by the app
- Custom code editor allows inline JS/TS functions only (no imports)
