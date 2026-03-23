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
```

- `make test` runs quick checks (`lint` + `typecheck`)
- `make verify` runs full local verification (`lint` + `typecheck` + `build`)

## Notes

- Uses `simple-agents-node` in a Next.js Node runtime API route
- BYOK credentials are forwarded per request and are not stored by the app
- Custom code editor allows inline JS/TS functions only (no imports)
