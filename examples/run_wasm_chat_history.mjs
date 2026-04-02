#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { Client } from "simple-agents-wasm";

function parseArgs(argv) {
  const args = {
    workflow: "examples/email-chat-draft-or-clarify.yaml",
    message: "Can you draft a reply email asking for a replacement order update?",
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    apiKey: process.env.OPENAI_API_KEY ?? process.env.API_KEY ?? "",
    showEvents: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--workflow" && argv[i + 1]) {
      args.workflow = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--message" && argv[i + 1]) {
      args.message = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--model" && argv[i + 1]) {
      args.model = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--base-url" && argv[i + 1]) {
      args.baseUrl = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--api-key" && argv[i + 1]) {
      args.apiKey = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--show-events") {
      args.showEvents = true;
      continue;
    }
    if (token === "--help" || token === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return args;
}

function printHelp() {
  console.log("Usage: node examples/run_wasm_chat_history.mjs [options]");
  console.log("");
  console.log("Options:");
  console.log("  --workflow <path>    YAML workflow path");
  console.log("  --message <text>     Chat prompt for input.messages");
  console.log("  --model <name>       Model name (default: gpt-4o-mini)");
  console.log("  --base-url <url>     OpenAI-compatible base URL");
  console.log("  --api-key <key>      API key (or use OPENAI_API_KEY)");
  console.log("  --show-events        Print workflow step events");
  console.log("  -h, --help           Show help");
}

function formatOutput(value) {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return "";
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.apiKey || args.apiKey.trim().length === 0) {
    throw new Error("Missing API key. Set OPENAI_API_KEY or pass --api-key.");
  }

  const workflowYaml = await readFile(args.workflow, "utf8");
  const client = new Client("openai", {
    apiKey: args.apiKey,
    baseUrl: args.baseUrl,
    fetchImpl: fetch
  });

  console.log(`[wasm-check] workflow: ${args.workflow}`);
  console.log(`[wasm-check] model: ${args.model}`);

  const result = await client.runWorkflowYamlString(
    workflowYaml,
    {
      model: args.model,
      messages: [{ role: "user", content: args.message }]
    },
    {
      functions: {}
    }
  );

  if (args.showEvents) {
    const events = Array.isArray(result.events) ? result.events : [];
    console.log("\nEvents:");
    for (const event of events) {
      console.log(`- ${event.stepId} (${event.stepType}) -> ${event.status}`);
    }
  }

  console.log("\nOutput:");
  console.log(formatOutput(result.output));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
