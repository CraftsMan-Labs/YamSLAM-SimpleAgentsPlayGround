# YamSLAM-SimpleAgentsPlayGround

YamSLAM is a frontend-only playground for running YAML flows in the browser with
bring-your-own OpenAI-compatible API configuration.

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

## Notes

- Browser-only BYOK mode (no backend relay in this project)
- Custom code editor allows inline JS/TS functions only (no imports)
