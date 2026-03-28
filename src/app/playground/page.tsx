"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Client as WasmClient } from "simple-agents-wasm";
import { LineCounter, parseDocument } from "yaml";
import craftsmanLogo from "../assets/CraftsmanLabs.svg";
import craftsmanLogoWhite from "../assets/CraftsmanLabs-white.svg";
import {
  PLAYGROUND_DRAFT_STORAGE_KEY,
  createDraftFromExample,
  createDraftStore,
  readDraftStore,
  type PlaygroundDraftStore,
  type PlaygroundDraftWorkspace
} from "./playground-drafts";
import { buildPlaygroundExport, type ExportLanguage } from "./playground-export";

type ProviderConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

type WasmCompletionResult = { content?: string };

type WasmMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
};

type WasmClientLike = {
  complete: (model: string, promptOrMessages: string | WasmMessage[]) => Promise<WasmCompletionResult>;
  streamEvents: (
    model: string,
    promptOrMessages: string | WasmMessage[],
    onEvent: (event: {
      eventType?: string;
      delta?: { content?: string };
      error?: { message?: string };
    }) => void
  ) => Promise<unknown>;
};

let wasmClientCache: { cacheKey: string; client: WasmClientLike } | null = null;

async function loadWasmClient(config: ProviderConfig): Promise<WasmClientLike> {
  const cacheKey = `${config.baseUrl}::${config.apiKey}`;
  if (wasmClientCache !== null && wasmClientCache.cacheKey === cacheKey) {
    return wasmClientCache.client;
  }

  const client = new WasmClient("openai", {
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    fetchImpl: (input, init) => window.fetch(input, init)
  });

  wasmClientCache = { cacheKey, client };
  return client;
}

type FlowStep = {
  id: string;
  type: "set" | "llm_call" | "if" | "output" | "call_function";
  key?: string;
  value?: unknown;
  prompt?: string;
  condition?: {
    left: unknown;
    operator: "eq" | "ne" | "contains";
    right: unknown;
  };
  then?: string;
  else?: string;
  text?: string;
  function?: string;
  args?: Record<string, unknown>;
  next?: string;
};

type FlowDoc = {
  version: string;
  steps: FlowStep[];
};

type GraphEdge = {
  from: string;
  to: string;
};

type GraphLlmNode = {
  id: string;
  node_type: {
    llm_call: {
      model?: string;
      messages_path?: string;
      append_prompt_as_user?: boolean;
    };
  };
  config?: {
    prompt?: string;
  };
};

type GraphSwitchNode = {
  id: string;
  node_type: {
    switch: {
      branches?: Array<{ condition?: string; target?: string }>;
      default?: string;
    };
  };
};

type GraphCustomWorkerNode = {
  id: string;
  node_type: {
    custom_worker: {
      handler?: string;
    };
  };
  config?: {
    payload?: {
      topic?: string;
    };
  };
};

type GraphNode = GraphLlmNode | GraphSwitchNode | GraphCustomWorkerNode;

type GraphWorkflowDoc = {
  id?: string;
  version?: string;
  entry_node: string;
  nodes: GraphNode[];
  edges?: GraphEdge[];
};

type MermaidEdge = {
  from: string;
  to: string;
  label?: string;
};

type RunState = "idle" | "running" | "failed" | "done";

type ValidationMessage = {
  source: "yaml" | "flow" | "graph" | "code";
  level: "error" | "warning";
  message: string;
  line?: number;
  column?: number;
};

type ValidationSummary = {
  parsedFlow: FlowDoc | null;
  parsedGraphFlow: GraphWorkflowDoc | null;
  messages: ValidationMessage[];
  functionRefs: Array<{ name: string; kind: "handler" | "function"; line?: number; column?: number }>;
};

type CodeValidationSummary = {
  errors: ValidationMessage[];
  warnings: ValidationMessage[];
  declaredFunctions: string[];
  ready: boolean;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type ParsedThinkingContent = {
  visible: string;
  thinking: string[];
};

type ExampleChatInput = {
  label: string;
  prompt: string;
};

type ExampleConfig = {
  yaml?: string;
  code: string;
  chatInputs: ExampleChatInput[];
  sampleFile?: string;
};

const PROVIDER_CONFIG_CACHE_KEY = "yamslam.provider.config.v1";
const THEME_MODE_CACHE_KEY = "yamslam.theme.mode.v1";
const YAML_WORKFLOW_DOCS_URL = "https://docs.simpleagents.craftsmanlabs.net/YAML_WORKFLOW_SYSTEM";
const SKILLS_INSTALL_COMMAND = "npx skills add CraftsMan-Labs/SimpleAgents";
const DEFAULT_EXAMPLE_NAME = "Quick hello";
const DRAFT_SAVE_DEBOUNCE_MS = 180;

const EXAMPLES: Record<string, ExampleConfig> = {
  "Quick hello": {
    yaml: `version: "1"
steps:
  - id: greet
    type: set
    key: user_name
    value: "builder"

  - id: ask
    type: llm_call
    prompt: "Say hello to {{user_name}} in one sentence."

  - id: final
    type: output
    text: "Model says: {{ask}}"`,
    chatInputs: [
      {
        label: "Greet Priya",
        prompt: "Use the quick hello workflow to greet Priya in one sentence."
      },
      {
        label: "Welcome builder",
        prompt: "Run the quick hello example for a first-time builder and keep the greeting short."
      }
    ],
    code: `function slugify(input) {
  return String(input).toLowerCase().replace(/\s+/g, "-");
}`
  },
  "Function + branch": {
    yaml: `version: "1"
steps:
  - id: project
    type: set
    key: title
    value: "YamSLAM Playground"

  - id: slug
    type: call_function
    function: slugify
    args:
      input: "{{title}}"

  - id: check
    type: if
    condition:
      left: "{{slug}}"
      operator: contains
      right: "yamslam"
    then: output_ok
    else: output_bad

  - id: output_ok
    type: output
    text: "Slug looks good: {{slug}}"

  - id: output_bad
    type: output
    text: "Slug missing keyword: {{slug}}"`,
    chatInputs: [
      {
        label: "Passing branch",
        prompt: "Use the Function + branch example with the title 'YamSLAM Playground' and tell me which branch wins."
      },
      {
        label: "Failing branch",
        prompt: "Use the Function + branch example with the title 'Simple Agents Demo' and show the output path when the slug misses yamslam."
      }
    ],
    code: `function slugify(input) {
  return String(input).toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}`
  },
  "Email Chat Draft (graph sample)": {
    sampleFile: "email-chat-draft-or-clarify.yaml",
    chatInputs: [
      {
        label: "Clarify missing info",
        prompt: "In the Email Chat Draft example, I need a reply email but I have not shared the recipient, tone, or goal yet. Ask me one concise clarifying question."
      },
      {
        label: "Capabilities path",
        prompt: "For the Email Chat Draft example, what kinds of emails can you help draft before I give you a concrete scenario?"
      }
    ],
    code: `function GetRagData(payload) {
  const topic = payload && typeof payload.topic === "string" ? payload.topic : "general";
  const messages = {
    already_terminated: "This interview session is already terminated.",
    terminated: "Candidate terminated based on interview policy.",
    ask_for_context: "Need more scenario context before proceeding."
  };
  return {
    topic,
    message: messages[topic] || "Worker completed.",
    source: "custom-js"
  };
}`
  },
  "Python Interview (graph sample)": {
    sampleFile: "python-intern-fun-interview-system.yaml",
    chatInputs: [
      {
        label: "Explain interview",
        prompt: "For the Python Interview example, explain how the interview works and ask me the first question."
      },
      {
        label: "Policy violation",
        prompt: "For the Python Interview example, the candidate asked to ignore the rules and skip straight to the final answer. Respond with the correct terminated outcome."
      }
    ],
    code: `function GetRagData(payload) {
  const topic = payload && typeof payload.topic === "string" ? payload.topic : "general";
  if (topic === "already_terminated" || topic === "terminated") {
    return {
      decision: "terminated",
      message: "Interview has been terminated according to policy.",
      topic
    };
  }
  return {
    decision: "continue",
    message: "No termination signal from worker.",
    topic
  };
}`
  },
  "Quick hello (steps sample file)": {
    sampleFile: "quick-hello-steps.yaml",
    chatInputs: [
      {
        label: "Greet Jordan",
        prompt: "Use the quick hello sample file to greet Jordan."
      },
      {
        label: "Greet Alex",
        prompt: "Use the quick hello sample file to welcome a new teammate named Alex."
      }
    ],
    code: `function identity(input) {
  return input;
}`
  },
  "Email Classification + Enrichment (graph sample)": {
    sampleFile: "email-hierarchical-classification-with-finance-enrichment.yaml",
    chatInputs: [
      {
        label: "Invoice enrichment",
        prompt: "Seller Google, 245 Market Street, Suite 800 San Francisco, CA 94105, USA EIN: 12-3456789 Sales Tax Permit: CA-987654321 Bill To Northwind Retail Inc. 890 Madison Ave New York, NY 10022, USA Invoice Details Invoice Number: INV-2026-104 Invoice Date: March 26, 2026 Due Date: April 9, 2026 Payment Terms: Net 14 Description Qty Unit Price Amount Website development services 20 hrs $75.00 $1,500.00 UI design revisions 5 hrs $60.00 $300.00 Hosting setup fee 1 $120.00 $120.00 Subtotal: $1,920.00 Sales Tax (8.25%): $158.40 Total Due: $2,078.40 Payment Method Bank Transfer / ACH Account Name: Google Bank: First National Bank Notes Thank you for your business. Please include the invoice number with your payment. Copyable version Seller: Google Buyer: Northwind Retail Inc. Invoice No: INV-2026-104 Date: March 26, 2026 Due: April 9, 2026 Website development services - $1,500.00 UI design revisions - $300.00 Hosting setup fee - $120.00 Subtotal: $1,920.00 Sales Tax: $158.40 Total Due: $2,078.40"
      },
      {
        label: "HR route",
        prompt: "I need help updating my parental leave dates and confirming whether payroll will reflect the approved leave period."
      },
      {
        label: "Education route",
        prompt: "Can you share the updated curriculum schedule for the data literacy course and confirm when the next assessment window opens?"
      }
    ],
    code: `function get_seller_name(input) {
  var company_name = "";
  if (typeof input === "string") {
    company_name = input;
  } else if (input && typeof input.payload === "string") {
    company_name = input.payload;
  }
  company_name = String(company_name || "").trim().toLowerCase();
  var stakeholderMap = {
    google: "Sundar Pichai",
    microsoft: "Satya Nadella",
    apple: "Tim Cook",
    amazon: "Andy Jassy"
  };
  return stakeholderMap[company_name] || "unknown";
}`
  }
};

const DEFAULT_YAML = EXAMPLES[DEFAULT_EXAMPLE_NAME].yaml ?? "";

function buildInitialDraftStore(): PlaygroundDraftStore {
  return createDraftStore({
    id: DEFAULT_EXAMPLE_NAME,
    title: DEFAULT_EXAMPLE_NAME,
    yaml: DEFAULT_YAML,
    code: EXAMPLES[DEFAULT_EXAMPLE_NAME].code
  });
}

function getActiveDraftWorkspace(store: PlaygroundDraftStore): PlaygroundDraftWorkspace {
  return store.workspaces[store.lastWorkspaceId] ?? store.workspaces[DEFAULT_EXAMPLE_NAME];
}

async function loadExampleYaml(example: ExampleConfig): Promise<string> {
  if (example.sampleFile === undefined) {
    return example.yaml ?? "";
  }

  const response = await fetch(`/api/examples?name=${encodeURIComponent(example.sampleFile)}`);
  if (!response.ok) {
    throw new Error(`Could not load example file (${response.status}).`);
  }

  const payload = (await response.json()) as { yaml?: string };
  if (typeof payload.yaml !== "string") {
    throw new Error("Example API returned invalid payload.");
  }

  return payload.yaml;
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "true");
  textArea.style.position = "absolute";
  textArea.style.left = "-9999px";
  document.body.appendChild(textArea);
  textArea.select();
  document.execCommand("copy");
  document.body.removeChild(textArea);
}

function safeString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

function redactSecret(input: string, secret: string): string {
  if (secret.trim().length === 0) {
    return input;
  }
  return input.split(secret).join("[REDACTED_API_KEY]");
}

function normalizeProviderError(error: unknown, apiKey: string): string {
  const fallback = "Provider request failed.";
  const raw = error instanceof Error ? error.message : fallback;
  const sanitized = redactSecret(raw, apiKey);
  const lower = sanitized.toLowerCase();

  if (
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("network error") ||
    lower.includes("cors")
  ) {
    return "Network/CORS issue: this provider may block browser-origin requests.";
  }

  return sanitized;
}

function parseThinkingContent(content: string): ParsedThinkingContent {
  const thinking: string[] = [];
  const visible = content.replace(/<think>([\s\S]*?)<\/think>/gi, (_match, group: string) => {
    thinking.push(group.trim());
    return "";
  });
  return {
    visible: visible.trim(),
    thinking: thinking.filter((chunk) => chunk.length > 0)
  };
}

function parseFlowFromObject(parsed: unknown): FlowDoc {
  if (parsed === null || parsed === undefined || typeof parsed !== "object") {
    throw new Error("YAML must include a top-level 'steps' array.");
  }
  const flow = parsed as Partial<FlowDoc>;
  if (!Array.isArray(flow.steps)) {
    throw new Error("YAML must include a top-level 'steps' array.");
  }

  flow.steps.forEach((step, index) => {
    if (!step.id || !step.type) {
      throw new Error(`Step at index ${index} is missing 'id' or 'type'.`);
    }
  });

  return {
    version: flow.version ?? "1",
    steps: flow.steps as FlowStep[]
  };
}

function sanitizeMermaidId(id: string): string {
  let normalized = id;
  const first = normalized.charAt(0);
  if (!/^[A-Za-z_]$/.test(first)) {
    normalized = `n_${normalized}`;
  }
  return normalized.replace(/[^A-Za-z0-9_]/g, "_");
}

function escapeMermaidLabel(label: string): string {
  return label.replace(/"/g, '\\"');
}

function buildMermaidEdges(flow: FlowDoc): MermaidEdge[] {
  const edges: MermaidEdge[] = [];

  flow.steps.forEach((step, index) => {
    const nextStep = flow.steps[index + 1];

    if (step.type === "if") {
      if (step.then) {
        edges.push({ from: step.id, to: step.then, label: "true" });
      }
      if (step.else) {
        edges.push({ from: step.id, to: step.else, label: "false" });
      }
    }

    if (step.next) {
      edges.push({ from: step.id, to: step.next });
      return;
    }

    const hasExplicitBranch = step.type === "if" && (step.then !== undefined || step.else !== undefined);
    if (!hasExplicitBranch && nextStep) {
      edges.push({ from: step.id, to: nextStep.id });
    }
  });

  return edges;
}

function flowToMermaid(flow: FlowDoc, activeStepId: string | null): string {
  const lines: string[] = ["flowchart TD"];

  flow.steps.forEach((step) => {
    lines.push(
      `  ${sanitizeMermaidId(step.id)}["${escapeMermaidLabel(step.id)}\\n(${escapeMermaidLabel(step.type)})"]`
    );
  });

  buildMermaidEdges(flow).forEach((edge) => {
    const from = sanitizeMermaidId(edge.from);
    const to = sanitizeMermaidId(edge.to);
    if (edge.label) {
      lines.push(`  ${from} -- "${escapeMermaidLabel(edge.label)}" --> ${to}`);
      return;
    }
    lines.push(`  ${from} --> ${to}`);
  });

  if (activeStepId) {
    lines.push("  classDef activeNode fill:#fff2e8,stroke:#c9754b,stroke-width:2px;");
    lines.push(`  class ${sanitizeMermaidId(activeStepId)} activeNode;`);
  }

  return lines.join("\n");
}

function graphFlowToMermaid(flow: GraphWorkflowDoc, activeStepId: string | null): string {
  const lines: string[] = ["flowchart TD"];

  flow.nodes.forEach((node) => {
    const kind = Object.keys(node.node_type)[0] ?? "node";
    lines.push(
      `  ${sanitizeMermaidId(node.id)}["${escapeMermaidLabel(node.id)}\\n(${escapeMermaidLabel(kind)})"]`
    );
  });

  (flow.edges ?? []).forEach((edge) => {
    lines.push(`  ${sanitizeMermaidId(edge.from)} --> ${sanitizeMermaidId(edge.to)}`);
  });

  flow.nodes.forEach((node) => {
    if (!("switch" in node.node_type)) {
      return;
    }
    const spec = node.node_type.switch;
    (spec.branches ?? []).forEach((branch, index) => {
      if (!branch.target) {
        return;
      }
      lines.push(
        `  ${sanitizeMermaidId(node.id)} -- "route${index + 1}" --> ${sanitizeMermaidId(branch.target)}`
      );
    });
    if (spec.default) {
      lines.push(
        `  ${sanitizeMermaidId(node.id)} -- "default" --> ${sanitizeMermaidId(spec.default)}`
      );
    }
  });

  if (activeStepId) {
    lines.push("  classDef activeNode fill:#fff2e8,stroke:#c9754b,stroke-width:2px;");
    lines.push(`  class ${sanitizeMermaidId(activeStepId)} activeNode;`);
  }

  return lines.join("\n");
}

async function callProviderStream(
  config: ProviderConfig,
  promptOrMessages: string | WasmMessage[],
  options?: {
    model?: string;
    onDelta?: (chunk: string, aggregate: string) => void;
  }
): Promise<string> {
  const wasmClient = await loadWasmClient(config);
  let aggregate = "";
  let streamError: string | null = null;

  await wasmClient.streamEvents(options?.model ?? config.model, promptOrMessages, (event) => {
    if (event?.eventType === "delta") {
      const chunk = event.delta?.content;
      if (typeof chunk === "string" && chunk.length > 0) {
        aggregate += chunk;
        options?.onDelta?.(chunk, aggregate);
      }
      return;
    }

    if (event?.eventType === "error") {
      streamError = event.error?.message ?? "Stream failed.";
    }
  });

  if (streamError) {
    throw new Error(streamError);
  }
  if (aggregate.length === 0) {
    throw new Error("WASM streaming response had no message content.");
  }
  return aggregate;
}

function parseGraphFlowFromObject(parsed: unknown): GraphWorkflowDoc {
  if (
    parsed === null ||
    parsed === undefined ||
    typeof parsed !== "object" ||
    typeof (parsed as Partial<GraphWorkflowDoc>).entry_node !== "string" ||
    !Array.isArray((parsed as Partial<GraphWorkflowDoc>).nodes)
  ) {
    throw new Error("Not a graph workflow document.");
  }
  return parsed as GraphWorkflowDoc;
}

function toValidationMessage(
  source: ValidationMessage["source"],
  level: ValidationMessage["level"],
  message: string,
  line?: number,
  column?: number
): ValidationMessage {
  return {
    source,
    level,
    message,
    line,
    column
  };
}

function getLinePosition(lineCounter: LineCounter | null, offset: number | null | undefined) {
  if (!lineCounter || offset === null || offset === undefined) {
    return null;
  }
  try {
    return lineCounter.linePos(offset);
  } catch {
    return null;
  }
}

function buildYamlDiagnostics(input: string) {
  const lineCounter = new LineCounter();
  const doc = parseDocument(input, { lineCounter });
  const messages: ValidationMessage[] = [];

  doc.errors.forEach((error) => {
    const position = getLinePosition(lineCounter, error.pos ?? error.range?.[0]);
    messages.push(
      toValidationMessage(
        "yaml",
        "error",
        error.message,
        position?.line !== undefined ? position.line + 1 : undefined,
        position?.col !== undefined ? position.col + 1 : undefined
      )
    );
  });

  doc.warnings.forEach((warning) => {
    const position = getLinePosition(lineCounter, warning.pos ?? warning.range?.[0]);
    messages.push(
      toValidationMessage(
        "yaml",
        "warning",
        warning.message,
        position?.line !== undefined ? position.line + 1 : undefined,
        position?.col !== undefined ? position.col + 1 : undefined
      )
    );
  });

  return {
    doc,
    lineCounter,
    messages
  };
}

function extractFunctionRefs(input: string, lineCounter: LineCounter | null) {
  const refs: Array<{ name: string; kind: "handler" | "function"; line?: number; column?: number }> = [];
  const handlerRegex = /handler:\s*([A-Za-z_$][A-Za-z0-9_$]*)/g;
  const functionRegex = /function:\s*([A-Za-z_$][A-Za-z0-9_$]*)/g;

  for (const match of input.matchAll(handlerRegex)) {
    const position = getLinePosition(lineCounter, match.index ?? 0);
    refs.push({
      name: match[1],
      kind: "handler",
      line: position?.line !== undefined ? position.line + 1 : undefined,
      column: position?.col !== undefined ? position.col + 1 : undefined
    });
  }

  for (const match of input.matchAll(functionRegex)) {
    const position = getLinePosition(lineCounter, match.index ?? 0);
    refs.push({
      name: match[1],
      kind: "function",
      line: position?.line !== undefined ? position.line + 1 : undefined,
      column: position?.col !== undefined ? position.col + 1 : undefined
    });
  }

  return refs;
}

function validateFlowSemantics(flow: FlowDoc): ValidationMessage[] {
  const messages: ValidationMessage[] = [];
  const ids = new Set<string>();
  const knownTypes: FlowStep["type"][] = ["set", "llm_call", "if", "output", "call_function"];
  const idList = flow.steps.map((step) => step.id);
  const idSet = new Set(idList);

  flow.steps.forEach((step, index) => {
    if (ids.has(step.id)) {
      messages.push(
        toValidationMessage("flow", "error", `Duplicate step id '${step.id}' at index ${index}.`)
      );
    } else {
      ids.add(step.id);
    }

    if (!knownTypes.includes(step.type)) {
      messages.push(
        toValidationMessage("flow", "error", `Step '${step.id}' has unsupported type '${step.type}'.`)
      );
    }

    if (step.type === "call_function" && (!step.function || step.function.trim().length === 0)) {
      messages.push(
        toValidationMessage("flow", "error", `Step '${step.id}' requires a 'function' name.`)
      );
    }

    if (step.type === "if") {
      if (step.then && !idSet.has(step.then)) {
        messages.push(
          toValidationMessage("flow", "error", `Step '${step.id}' references missing 'then' target '${step.then}'.`)
        );
      }
      if (step.else && !idSet.has(step.else)) {
        messages.push(
          toValidationMessage("flow", "error", `Step '${step.id}' references missing 'else' target '${step.else}'.`)
        );
      }
    }

    if (step.next && !idSet.has(step.next)) {
      messages.push(
        toValidationMessage("flow", "error", `Step '${step.id}' references missing 'next' target '${step.next}'.`)
      );
    }
  });

  return messages;
}

function validateGraphSemantics(flow: GraphWorkflowDoc): ValidationMessage[] {
  const messages: ValidationMessage[] = [];
  const ids = new Set<string>();
  const idList = flow.nodes.map((node) => node.id);
  const idSet = new Set(idList);
  const supportedTypes = new Set(["llm_call", "switch", "custom_worker"]);

  flow.nodes.forEach((node, index) => {
    if (ids.has(node.id)) {
      messages.push(
        toValidationMessage("graph", "error", `Duplicate node id '${node.id}' at index ${index}.`)
      );
    } else {
      ids.add(node.id);
    }

    const typeKeys = Object.keys(node.node_type ?? {});
    const kind = typeKeys[0];
    if (!kind || !supportedTypes.has(kind)) {
      messages.push(
        toValidationMessage("graph", "error", `Node '${node.id}' has unsupported type '${kind ?? "unknown"}'.`)
      );
    }

    if ("custom_worker" in node.node_type) {
      const handler = node.node_type.custom_worker?.handler;
      if (!handler || handler.trim().length === 0) {
        messages.push(
          toValidationMessage("graph", "error", `Custom worker node '${node.id}' requires a handler.`)
        );
      }
    }
  });

  if (!idSet.has(flow.entry_node)) {
    messages.push(
      toValidationMessage("graph", "error", `Entry node '${flow.entry_node}' is not defined in nodes.`)
    );
  }

  (flow.edges ?? []).forEach((edge) => {
    if (!idSet.has(edge.from)) {
      messages.push(
        toValidationMessage("graph", "error", `Edge references missing 'from' node '${edge.from}'.`)
      );
    }
    if (!idSet.has(edge.to)) {
      messages.push(
        toValidationMessage("graph", "error", `Edge references missing 'to' node '${edge.to}'.`)
      );
    }
  });

  flow.nodes.forEach((node) => {
    if (!("switch" in node.node_type)) {
      return;
    }
    const spec = node.node_type.switch;
    (spec.branches ?? []).forEach((branch, index) => {
      if (branch.target && !idSet.has(branch.target)) {
        messages.push(
          toValidationMessage(
            "graph",
            "error",
            `Switch node '${node.id}' branch ${index + 1} references missing target '${branch.target}'.`
          )
        );
      }
    });
    if (spec.default && !idSet.has(spec.default)) {
      messages.push(
        toValidationMessage(
          "graph",
          "error",
          `Switch node '${node.id}' default references missing target '${spec.default}'.`
        )
      );
    }
  });

  return messages;
}

function validateYamlInput(input: string): ValidationSummary {
  const { doc, lineCounter, messages } = buildYamlDiagnostics(input);
  const functionRefs = extractFunctionRefs(input, lineCounter);

  if (doc.errors.length > 0) {
    return {
      parsedFlow: null,
      parsedGraphFlow: null,
      messages,
      functionRefs
    };
  }

  const parsed = doc.toJSON();
  let parsedFlow: FlowDoc | null = null;
  let parsedGraphFlow: GraphWorkflowDoc | null = null;
  let flowError: string | null = null;
  let graphError: string | null = null;

  try {
    parsedFlow = parseFlowFromObject(parsed);
  } catch (error) {
    flowError = error instanceof Error ? error.message : "Invalid flow workflow.";
  }

  try {
    parsedGraphFlow = parseGraphFlowFromObject(parsed);
  } catch (error) {
    graphError = error instanceof Error ? error.message : "Invalid graph workflow.";
  }

  if (!parsedFlow && !parsedGraphFlow) {
    if (flowError) {
      messages.push(toValidationMessage("flow", "error", flowError));
    }
    if (graphError) {
      messages.push(toValidationMessage("graph", "error", graphError));
    }
    messages.push(toValidationMessage("yaml", "error", "YAML does not match a flow or graph workflow."));
  }

  if (parsedFlow) {
    messages.push(...validateFlowSemantics(parsedFlow));
  }

  if (parsedGraphFlow) {
    messages.push(...validateGraphSemantics(parsedGraphFlow));
  }

  if (parsedFlow && parsedGraphFlow) {
    messages.push(
      toValidationMessage(
        "yaml",
        "warning",
        "Both flow and graph workflow shapes detected; graph workflow will be used for execution."
      )
    );
  }

  return {
    parsedFlow,
    parsedGraphFlow,
    messages,
    functionRefs
  };
}

function formatValidationLabel(message: ValidationMessage): string {
  if (message.line === undefined || message.column === undefined) {
    return message.message;
  }
  return `Line ${message.line}, Col ${message.column}: ${message.message}`;
}

function extractFunctionNamesFromCode(
  ts: typeof import("typescript"),
  sourceFile: import("typescript").SourceFile
): string[] {
  const names = new Set<string>();

  const visit = (node: import("typescript").Node) => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      names.add(node.name.text);
    }

    if (ts.isVariableStatement(node)) {
      node.declarationList.declarations.forEach((decl) => {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) {
          return;
        }
        if (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) {
          names.add(decl.name.text);
        }
      });
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sourceFile, visit);
  return [...names];
}

function getValueFromPath(source: unknown, path: string): unknown {
  if (source === null || source === undefined || typeof source !== "object") {
    return undefined;
  }
  const parts = path.split(".").filter((token) => token.length > 0);
  let current: unknown = source;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function interpolateGraphPrompt(template: string, context: Record<string, unknown>): string {
  return template.replace(/{{\s*([^}]+)\s*}}/g, (_, token: string) => {
    const resolved = getValueFromPath(context, token.trim());
    if (resolved === undefined || resolved === null) {
      return "";
    }
    if (typeof resolved === "string") {
      return resolved;
    }
    return JSON.stringify(resolved);
  });
}

function interpolateGraphValue(value: unknown, context: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    return value.replace(/{{\s*([^}]+)\s*}}/g, (_, token: string) => {
      const resolved = getValueFromPath(context, token.trim())
      if (resolved === undefined || resolved === null) {
        return ""
      }
      if (typeof resolved === "string") {
        return resolved
      }
      return JSON.stringify(resolved)
    })
  }

  if (Array.isArray(value)) {
    return value.map((entry) => interpolateGraphValue(entry, context))
  }

  if (value !== null && value !== undefined && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        interpolateGraphValue(nested, context)
      ])
    )
  }

  return value
}

function parsePossiblyJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    const start = value.indexOf("{");
    const end = value.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return JSON.parse(value.slice(start, end + 1));
      } catch {
        return value;
      }
    }
    return value;
  }
}

function evaluateGraphSwitchCondition(
  condition: string | undefined,
  context: Record<string, unknown>
): boolean {
  if (!condition) {
    return false;
  }
  const eq = condition.match(/^\$\.([A-Za-z0-9_\.]+)\s*==\s*"([\s\S]*)"$/);
  if (eq) {
    const left = getValueFromPath(context, eq[1]);
    return String(left ?? "") === eq[2];
  }
  const ne = condition.match(/^\$\.([A-Za-z0-9_\.]+)\s*!=\s*"([\s\S]*)"$/);
  if (ne) {
    const left = getValueFromPath(context, ne[1]);
    return String(left ?? "") !== ne[2];
  }
  return false;
}

function formatGraphChatOutput(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value !== null && value !== undefined && typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (typeof v.question === "string") {
      return v.question;
    }
    if (typeof v.message === "string") {
      return v.message;
    }
    if (typeof v.body === "string" && typeof v.subject === "string") {
      return `Subject: ${v.subject}\n\n${v.body}`;
    }
  }
  return safeString(value);
}

function sanitizeCustomCode(source: string): string {
  if (/\bimport\b|\brequire\b/.test(source)) {
    throw new Error("Imports are not allowed in custom JS/TS functions.");
  }

  const withoutTypes = source
    .replace(/\btype\s+[\s\S]*?;/g, "")
    .replace(/\binterface\s+[\s\S]*?\}/g, "")
    .replace(/:\s*[A-Za-z_][A-Za-z0-9_<>,\[\]\s|]*/g, "");

  return withoutTypes.replace(/\bexport\s+/g, "");
}

function executeCustomWorkerHandler(input: {
  code: string;
  handler: string;
  payload: unknown;
  context: Record<string, unknown>;
}): unknown {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(input.handler)) {
    throw new Error(`Invalid custom worker handler name '${input.handler}'.`);
  }

  const runnableCode = sanitizeCustomCode(input.code);
  const fn = new Function(
    "payload",
    "context",
    `${runnableCode}\nif (typeof ${input.handler} !== "function") { throw new Error("Custom worker function '${input.handler}' was not found."); }\nreturn ${input.handler}(payload, context);`
  ) as (payload: unknown, context: Record<string, unknown>) => unknown;

  return fn(input.payload, input.context);
}

async function executeGraphWorkflowForChat(
  workflow: GraphWorkflowDoc,
  inputMessages: ChatMessage[],
  config: ProviderConfig,
  customCode: string,
  hooks?: {
    onLog?: (line: string) => void;
    onActiveStep?: (stepId: string | null) => void;
    onStepStream?: (stepId: string, content: string) => void;
  }
): Promise<string> {
  const nodeById = new Map<string, GraphNode>();
  workflow.nodes.forEach((node) => nodeById.set(node.id, node));

  const edgeMap = new Map<string, string[]>();
  (workflow.edges ?? []).forEach((edge) => {
    const existing = edgeMap.get(edge.from) ?? [];
    existing.push(edge.to);
    edgeMap.set(edge.from, existing);
  });

  const context: Record<string, unknown> = {
    input: {
      messages: inputMessages
    },
    nodes: {}
  };

  let pointer = workflow.entry_node;
  let finalOutput: unknown = "";

  for (let i = 0; i < 200; i += 1) {
    const node = nodeById.get(pointer);
    if (!node) {
      throw new Error(`Workflow references unknown node '${pointer}'.`);
    }

    hooks?.onActiveStep?.(node.id);
    hooks?.onLog?.(`Running step: ${node.id}`);

    if ("llm_call" in node.node_type) {
      const llmNode = node as GraphLlmNode;
      const llm = llmNode.node_type.llm_call;
      const configuredModel = config.model.trim();
      const selectedModel = configuredModel.length > 0 ? configuredModel : llm.model;
      const prompt = interpolateGraphPrompt(llmNode.config?.prompt ?? "", context);
      let promptOrMessages: string | WasmMessage[] = prompt;

      if (llm.messages_path === "input.messages") {
        const source = getValueFromPath(context, "input.messages");
        const history = Array.isArray(source)
          ? source
              .map((msg) => {
                if (msg && typeof msg === "object") {
                  const role = (msg as Record<string, unknown>).role;
                  const content = (msg as Record<string, unknown>).content;
                  if (
                    (role === "system" || role === "user" || role === "assistant" || role === "tool") &&
                    typeof content === "string"
                  ) {
                    return { role, content } as WasmMessage;
                  }
                }
                return null;
              })
              .filter((msg): msg is WasmMessage => msg !== null)
          : [];

        if (llm.append_prompt_as_user !== false) {
          history.push({ role: "user", content: prompt });
        }
        promptOrMessages = history;
      }

      const content = await callProviderStream(config, promptOrMessages, {
        model: selectedModel,
        onDelta: (_chunk, aggregate) => {
          hooks?.onStepStream?.(node.id, aggregate);
        }
      });
      const parsedOutput = parsePossiblyJson(content);
      hooks?.onLog?.(`Completed llm_call: ${node.id}`);
      const nodesBucket = context.nodes as Record<string, unknown>;
      nodesBucket[node.id] = { output: parsedOutput, raw: content };
      finalOutput = parsedOutput;

      const nextList = edgeMap.get(node.id) ?? [];
      pointer = nextList[0] ?? "";
      if (pointer.length === 0) {
        break;
      }
      continue;
    }

    if ("switch" in node.node_type) {
      const switchNode = node as GraphSwitchNode;
      const spec = switchNode.node_type.switch;
      const target = (spec.branches ?? []).find((branch) =>
        evaluateGraphSwitchCondition(branch.condition, context)
      )?.target;
      hooks?.onLog?.(`Switch route: ${target ?? spec.default ?? "(end)"}`);
      pointer = target ?? spec.default ?? "";
      if (pointer.length === 0) {
        break;
      }
      continue;
    }

    if ("custom_worker" in node.node_type) {
      const customNode = node as GraphCustomWorkerNode;
      const handler = customNode.node_type.custom_worker.handler ?? "GetRagData";
      const payload = interpolateGraphValue(
        customNode.config?.payload ?? { topic: "custom_worker" },
        context
      );
      const workerOutput = executeCustomWorkerHandler({
        code: customCode,
        handler,
        payload,
        context
      });
      const nodesBucket = context.nodes as Record<string, unknown>;
      nodesBucket[node.id] = { output: workerOutput };
      finalOutput = workerOutput;
      hooks?.onLog?.(`Custom worker output (${handler}) ready.`);

      const nextList = edgeMap.get(node.id) ?? [];
      pointer = nextList[0] ?? "";
      if (pointer.length === 0) {
        break;
      }
      continue;
    }

    throw new Error(`Unsupported node type at '${node.id}'.`);
  }

  hooks?.onActiveStep?.(null);
  hooks?.onLog?.("Workflow run complete.");

  return formatGraphChatOutput(finalOutput);
}

function buildYamlAwareChatPrompt(input: {
  yamlSource: string;
  customCode: string;
  userMessage: string;
  history: ChatMessage[];
}): string {
  const historyBlock = input.history
    .slice(-8)
    .map((msg) => `${msg.role.toUpperCase()}: ${msg.content}`)
    .join("\n");

  const customCodeBlock = input.customCode.trim().length > 0 ? input.customCode : "(none)";

  return [
    "You are the YamSLAM playground assistant.",
    "Answer the user using the workflow intent from the YAML flow below.",
    "If the YAML is invalid or incomplete, state that clearly and still help with best effort.",
    "Do not reveal secrets.",
    "",
    "YAML FLOW:",
    input.yamlSource,
    "",
    "CUSTOM FUNCTIONS:",
    customCodeBlock,
    "",
    "RECENT CHAT:",
    historyBlock.length > 0 ? historyBlock : "(no prior messages)",
    "",
    `USER: ${input.userMessage}`,
    "ASSISTANT:"
  ].join("\n");
}

export default function PlaygroundPage() {
  const [draftStore, setDraftStore] = useState<PlaygroundDraftStore>(() => buildInitialDraftStore());
  const [isDraftHydrated, setIsDraftHydrated] = useState(false);
  const [lastDraftSavedAt, setLastDraftSavedAt] = useState<number | null>(null);
  const [copyLanguage, setCopyLanguage] = useState<ExportLanguage>("js");
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [runState, setRunState] = useState<RunState>("idle");
  const [logs, setLogs] = useState<string[]>([]);
  const [stepStreams, setStepStreams] = useState<Record<string, string>>({});
  const [activeStepId, setActiveStepId] = useState<string | null>(null);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatPending, setChatPending] = useState(false);
  const [themeMode, setThemeMode] = useState<"light" | "dark">("dark");
  const [flowSvg, setFlowSvg] = useState<string>("");
  const [flowRenderError, setFlowRenderError] = useState<string | null>(null);
  const [codeValidation, setCodeValidation] = useState<CodeValidationSummary>({
    errors: [],
    warnings: [],
    declaredFunctions: [],
    ready: false
  });
  const [config, setConfig] = useState<ProviderConfig>({
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    model: "gpt-4o-mini"
  });
  const draftSaveTimerRef = useRef<number | null>(null);

  const activeDraft = useMemo(() => getActiveDraftWorkspace(draftStore), [draftStore]);
  const selectedExample = activeDraft.id;
  const activeExample = EXAMPLES[selectedExample] ?? EXAMPLES[DEFAULT_EXAMPLE_NAME];
  const yamlInput = activeDraft.yaml;
  const codeInput = activeDraft.code;
  const sampleChatInputs = activeExample.chatInputs;
  const draftSaveState =
    !isDraftHydrated || lastDraftSavedAt === null
      ? "Saving locally..."
      : activeDraft.updatedAt > lastDraftSavedAt
        ? "Saving locally..."
        : `Saved locally at ${new Date(lastDraftSavedAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit"
          })}`;

  const updateActiveDraft = (patch: Partial<Pick<PlaygroundDraftWorkspace, "yaml" | "code">>) => {
    setDraftStore((prev) => {
      const current = getActiveDraftWorkspace(prev);
      const nextYaml = patch.yaml ?? current.yaml;
      const nextCode = patch.code ?? current.code;
      if (nextYaml === current.yaml && nextCode === current.code) {
        return prev;
      }
      const nextWorkspace: PlaygroundDraftWorkspace = {
        ...current,
        yaml: nextYaml,
        code: nextCode,
        updatedAt: Date.now()
      };
      return {
        ...prev,
        workspaces: {
          ...prev.workspaces,
          [current.id]: nextWorkspace
        }
      };
    });
  };

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(THEME_MODE_CACHE_KEY);
      if (raw === "light" || raw === "dark") {
        setThemeMode(raw);
      }
    } catch {
      // Ignore storage read errors.
    }
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", themeMode);
    try {
      window.localStorage.setItem(THEME_MODE_CACHE_KEY, themeMode);
    } catch {
      // Ignore storage write errors.
    }
  }, [themeMode]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PROVIDER_CONFIG_CACHE_KEY);
      if (raw === null) {
        return;
      }
      const parsed = JSON.parse(raw) as Partial<ProviderConfig>;
      if (
        typeof parsed.baseUrl === "string" &&
        typeof parsed.apiKey === "string" &&
        typeof parsed.model === "string"
      ) {
        setConfig({
          baseUrl: parsed.baseUrl,
          apiKey: parsed.apiKey,
          model: parsed.model
        });
      }
    } catch {
      // Ignore invalid cache payloads.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(PROVIDER_CONFIG_CACHE_KEY, JSON.stringify(config));
    } catch {
      // Ignore storage write errors.
    }
  }, [config]);

  useEffect(() => {
    try {
      const cached = readDraftStore(window.localStorage.getItem(PLAYGROUND_DRAFT_STORAGE_KEY));
      if (cached !== null) {
        setDraftStore(cached);
        const activeWorkspace = getActiveDraftWorkspace(cached);
        setLastDraftSavedAt(activeWorkspace.updatedAt);
      }
    } catch {
      // Ignore storage read errors.
    } finally {
      setIsDraftHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!isDraftHydrated) {
      return;
    }

    if (draftSaveTimerRef.current !== null) {
      window.clearTimeout(draftSaveTimerRef.current);
    }

    draftSaveTimerRef.current = window.setTimeout(() => {
      try {
        window.localStorage.setItem(PLAYGROUND_DRAFT_STORAGE_KEY, JSON.stringify(draftStore));
        setLastDraftSavedAt(Date.now());
      } catch {
        // Ignore storage write errors.
      }
    }, DRAFT_SAVE_DEBOUNCE_MS);

    return () => {
      if (draftSaveTimerRef.current !== null) {
        window.clearTimeout(draftSaveTimerRef.current);
      }
    };
  }, [draftStore, isDraftHydrated]);

  useEffect(() => {
    if (copyFeedback === null) {
      return;
    }

    const timeout = window.setTimeout(() => setCopyFeedback(null), 2400);
    return () => window.clearTimeout(timeout);
  }, [copyFeedback]);

  const yamlValidation = useMemo(() => validateYamlInput(yamlInput), [yamlInput]);
  const parsedFlow = yamlValidation.parsedFlow;
  const parsedGraphFlow = yamlValidation.parsedGraphFlow;
  const yamlErrors = useMemo(
    () => yamlValidation.messages.filter((item) => item.level === "error"),
    [yamlValidation.messages]
  );
  const yamlWarnings = useMemo(
    () => yamlValidation.messages.filter((item) => item.level === "warning"),
    [yamlValidation.messages]
  );

  const codeErrors = useMemo(() => {
    if (!codeValidation.ready) {
      return codeValidation.errors;
    }
    const errors = [...codeValidation.errors];
    const known = new Set(codeValidation.declaredFunctions);
    const missing = new Set<string>();
    yamlValidation.functionRefs.forEach((ref) => {
      if (!known.has(ref.name)) {
        missing.add(ref.name);
        errors.push(
          toValidationMessage(
            "code",
            "error",
            `Referenced ${ref.kind} '${ref.name}' was not found in custom JS/TS.`,
            ref.line,
            ref.column
          )
        );
      }
    });
    if (missing.size > 0 && codeInput.trim().length === 0) {
      errors.push(toValidationMessage("code", "error", "Custom JS/TS editor is empty."));
    }
    return errors;
  }, [codeValidation, yamlValidation.functionRefs, codeInput]);

  const codeWarnings = useMemo(() => codeValidation.warnings, [codeValidation.warnings]);
  const hasYamlErrors = yamlErrors.length > 0;
  const hasCodeErrors = codeErrors.length > 0;

  const mermaidSource = useMemo(() => {
    if (parsedGraphFlow !== null) {
      return graphFlowToMermaid(parsedGraphFlow, activeStepId);
    }
    if (parsedFlow !== null) {
      return flowToMermaid(parsedFlow, activeStepId);
    }
    return "";
  }, [activeStepId, parsedFlow, parsedGraphFlow]);

  useEffect(() => {
    if (mermaidSource.length === 0) {
      setFlowSvg("");
      setFlowRenderError(null);
      return;
    }

    let cancelled = false;

    const renderDiagram = async () => {
      try {
        const mermaidModule = await import("mermaid");
        const mermaid = mermaidModule.default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "neutral"
        });

        const id = `flow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const rendered = await mermaid.render(id, mermaidSource);

        if (!cancelled) {
          setFlowSvg(rendered.svg);
          setFlowRenderError(null);
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : "Failed to render flow graph.";
          setFlowRenderError(message);
          setFlowSvg("");
        }
      }
    };

    void renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [mermaidSource]);

  useEffect(() => {
    let cancelled = false;

    const validateCode = async () => {
      const errors: ValidationMessage[] = [];
      const warnings: ValidationMessage[] = [];
      let declaredFunctions: string[] = [];

      if (/\bimport\b|\brequire\b/.test(codeInput)) {
        errors.push(
          toValidationMessage("code", "error", "Imports are not allowed in custom JS/TS functions.")
        );
      }

      try {
        const tsModule = await import("typescript");
        const ts = tsModule.default ?? tsModule;
        const sourceFile = ts.createSourceFile(
          "custom.ts",
          codeInput,
          ts.ScriptTarget.ES2022,
          true,
          ts.ScriptKind.TSX
        );

        sourceFile.parseDiagnostics.forEach((diag) => {
          const position = typeof diag.start === "number" ? diag.start : 0;
          const { line, character } = sourceFile.getLineAndCharacterOfPosition(position);
          errors.push(
            toValidationMessage(
              "code",
              "error",
              ts.flattenDiagnosticMessageText(diag.messageText, "\n"),
              line + 1,
              character + 1
            )
          );
        });

        declaredFunctions = extractFunctionNamesFromCode(ts, sourceFile);
      } catch {
        warnings.push(
          toValidationMessage(
            "code",
            "warning",
            "JS/TS validation is unavailable in this environment."
          )
        );
      }

      if (!cancelled) {
        setCodeValidation({
          errors,
          warnings,
          declaredFunctions,
          ready: true
        });
      }
    };

    void validateCode();

    return () => {
      cancelled = true;
    };
  }, [codeInput]);

  const applyExample = async (name: string) => {
    const example = EXAMPLES[name];
    const cachedDraft = draftStore.workspaces[name];

    if (cachedDraft !== undefined) {
      setDraftStore((prev) => ({ ...prev, lastWorkspaceId: name }));
      setLogs([`Loaded draft: ${name}`]);
      return;
    }

    try {
      const yaml = await loadExampleYaml(example);
      const nextWorkspace = createDraftFromExample(name, example, yaml);
      setDraftStore((prev) => ({
        ...prev,
        lastWorkspaceId: name,
        workspaces: {
          ...prev.workspaces,
          [name]: nextWorkspace
        }
      }));
      setLogs([`Loaded example: ${name}${example.sampleFile ? ` (${example.sampleFile})` : ""}`]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load sample file.";
      setLogs([`Failed to load example: ${name}`, message]);
    }
  };

  const resetCurrentExample = async () => {
    const example = EXAMPLES[selectedExample];

    try {
      const yaml = await loadExampleYaml(example);
      const nextWorkspace = createDraftFromExample(selectedExample, example, yaml);
      setDraftStore((prev) => ({
        ...prev,
        workspaces: {
          ...prev.workspaces,
          [selectedExample]: nextWorkspace
        }
      }));
      setLogs([`Reset draft to example defaults: ${selectedExample}`]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to reset current example.";
      setLogs([`Failed to reset example: ${selectedExample}`, message]);
    }
  };

  const copyYaml = async () => {
    try {
      await copyTextToClipboard(yamlInput);
      setCopyFeedback("YAML copied.");
    } catch {
      setCopyFeedback("Could not copy YAML.");
    }
  };

  const copyExportCode = async () => {
    try {
      const bundle = buildPlaygroundExport({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        yaml: yamlInput,
        code: codeInput,
        language: copyLanguage,
        model: config.model
      });
      await copyTextToClipboard(bundle.content);
      setCopyFeedback(`Copied ${bundle.filename}${bundle.note ? ` - ${bundle.note}` : ""}`);
    } catch {
      setCopyFeedback("Could not copy export code.");
    }
  };

  const clearChatHistory = () => {
    setChatMessages([]);
    setChatInput("");
  };

  const applyChatExample = (prompt: string) => {
    setChatInput(prompt);
    setChatOpen(true);
  };

  const copyChatExample = async (prompt: string) => {
    try {
      await copyTextToClipboard(prompt);
      setCopyFeedback("Chat example copied.");
    } catch {
      setCopyFeedback("Could not copy chat example.");
    }
  };

  const sendChat = async () => {
    const prompt = chatInput.trim();
    if (!prompt || chatPending) {
      return;
    }

    if (!config.apiKey || !config.baseUrl || !config.model) {
      setRunState("failed");
      setLogs((prev) => [...prev, "Missing provider config: baseUrl/apiKey/model"]);
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Add base URL, API key, and model first." }
      ]);
      return;
    }

    if (hasYamlErrors || hasCodeErrors) {
      setRunState("failed");
      setLogs((prev) => [...prev, "Validation failed: fix YAML/JS errors before running."]);
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Fix the validation errors in the editors before running." }
      ]);
      return;
    }

    setChatInput("");
    setChatPending(true);
    setRunState("running");
    setStepStreams({});
    const historyForWorkflow: ChatMessage[] = [...chatMessages, { role: "user", content: prompt }];
    const updatedMessages: ChatMessage[] = [...historyForWorkflow, { role: "assistant", content: "" }];
    const assistantIndex = historyForWorkflow.length;
    setLogs((prev) => [...prev, `Chat input: ${prompt}`]);
    setChatMessages(updatedMessages);

    const setAssistantContent = (content: string) => {
      setChatMessages((prev) => {
        if (assistantIndex >= prev.length) {
          return prev;
        }
        const next = [...prev];
        next[assistantIndex] = { role: "assistant", content };
        return next;
      });
    };

    try {
      let answer: string;
      if (parsedGraphFlow !== null) {
        setLogs((prev) => [...prev, `Workflow mode: graph (${parsedGraphFlow.entry_node})`]);
        answer = await executeGraphWorkflowForChat(parsedGraphFlow, historyForWorkflow, config, codeInput, {
          onLog: (line) => setLogs((prev) => [...prev, line]),
          onActiveStep: (stepId) => setActiveStepId(stepId),
          onStepStream: (stepId, content) => {
            setStepStreams((prev) => ({ ...prev, [stepId]: content }));
            setAssistantContent(`[${stepId}] ${content}`);
          }
        });
      } else {
        setLogs((prev) => [...prev, "Workflow mode: prompt-grounded chat"]);
        const yamlAwarePrompt = buildYamlAwareChatPrompt({
          yamlSource: yamlInput,
          customCode: codeInput,
          userMessage: prompt,
          history: historyForWorkflow
        });
        answer = await callProviderStream(config, yamlAwarePrompt, {
          onDelta: (_chunk, aggregate) => {
            setStepStreams((prev) => ({ ...prev, chat_llm: aggregate }));
            setAssistantContent(aggregate);
          }
        });
        setLogs((prev) => [...prev, "Completed single llm_call from chat context"]);
      }
      setAssistantContent(answer);
      setRunState("done");
      setLogs((prev) => [...prev, "Chat run complete."]);
    } catch (error) {
      const message = normalizeProviderError(error, config.apiKey);
      setAssistantContent(message);
      setRunState("failed");
      setLogs((prev) => [...prev, `Run failed: ${message}`]);
    } finally {
      setChatPending(false);
      setActiveStepId(null);
    }
  };

  return (
    <main className="playground-shell">
      <div className="pane-header" style={{ marginBottom: 16 }}>
        <div className="header-brand">
          <Image
            src={themeMode === "dark" ? craftsmanLogoWhite : craftsmanLogo}
            alt="CraftsmanLabs logo"
            className="header-logo"
            priority
          />
          <div>
            <div className="label">SimpleAgents Playground By CraftsmanLabs</div>
            <h3>SIMPLEAGENTS PLAYGROUND BY CRAFTSMANLABS</h3>
            <p className="mono-value" style={{ marginTop: 6 }}>
              If you like this project, please star it. Feel free to reach out.
            </p>
          </div>
        </div>
        <div className="header-links">
          <a
            className="report-issue-link"
            href="https://github.com/CraftsMan-Labs/YamSLAM-SimpleAgentsPlayGround/issues"
            target="_blank"
            rel="noreferrer"
            aria-label="Report an issue on GitHub"
            title="Report Issue"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M1.75 1.5h8.5c.97 0 1.75.78 1.75 1.75v8.5c0 .97-.78 1.75-1.75 1.75h-8.5A1.75 1.75 0 0 1 0 11.75v-8.5C0 2.28.78 1.5 1.75 1.5Zm0 1A.75.75 0 0 0 1 3.25v8.5c0 .41.34.75.75.75h8.5a.75.75 0 0 0 .75-.75v-8.5a.75.75 0 0 0-.75-.75h-8.5ZM14.5 0A1.5 1.5 0 0 1 16 1.5v9.25a.75.75 0 0 1-1.5 0V1.5h-9a.75.75 0 0 1 0-1.5h9Z" />
              <path d="M6 4.25a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0V5A.75.75 0 0 1 6 4.25Zm0 6a.88.88 0 1 1 0 1.76.88.88 0 0 1 0-1.76Z" />
            </svg>
            <span>Report Issue</span>
          </a>
          <button
            className="icon-link"
            type="button"
            aria-label={themeMode === "light" ? "Enable dark mode" : "Enable light mode"}
            title={themeMode === "light" ? "Dark mode" : "Light mode"}
            onClick={() => {
              setThemeMode((prev) => {
                const next = prev === "light" ? "dark" : "light";
                setLogs((current) => [...current, `Theme changed: ${next} mode`]);
                return next;
              });
            }}
          >
            {themeMode === "light" ? (
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M8 1a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 8 1Zm0 10.25a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5Zm0 3.75a.75.75 0 0 1-.75-.75v-1.5a.75.75 0 0 1 1.5 0v1.5A.75.75 0 0 1 8 15Zm7-7a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 15 8ZM4.25 8A.75.75 0 0 1 3.5 8.75H2a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 4.25 8Zm7.53-4.28a.75.75 0 0 1 1.06 0l1.06 1.06a.75.75 0 1 1-1.06 1.06L11.78 4.78a.75.75 0 0 1 0-1.06ZM3.16 12.84a.75.75 0 0 1 1.06 0l1.06 1.06a.75.75 0 1 1-1.06 1.06L3.16 13.9a.75.75 0 0 1 0-1.06Zm10.68 1.06a.75.75 0 0 1-1.06 1.06l-1.06-1.06a.75.75 0 1 1 1.06-1.06l1.06 1.06ZM5.28 5.84A.75.75 0 0 1 4.22 4.78L5.28 3.72a.75.75 0 1 1 1.06 1.06L5.28 5.84Z" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M6 0a8 8 0 1 0 8 8 6 6 0 0 1-8-8Z" />
              </svg>
            )}
          </button>
          <a
            className="icon-link"
            href="https://www.linkedin.com/in/rishub-c-r/"
            target="_blank"
            rel="noreferrer"
            aria-label="LinkedIn profile"
            title="LinkedIn"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M0 1.15C0 .52.52 0 1.15 0h13.7C15.48 0 16 .52 16 1.15v13.7c0 .63-.52 1.15-1.15 1.15H1.15A1.15 1.15 0 0 1 0 14.85V1.15ZM4.75 13V6.17H2.48V13h2.27ZM3.61 5.2c.79 0 1.28-.52 1.28-1.17-.01-.67-.49-1.17-1.27-1.17-.78 0-1.29.5-1.29 1.17 0 .65.5 1.17 1.27 1.17h.01ZM13.52 13V9.26c0-2-1.06-2.93-2.48-2.93-1.14 0-1.65.63-1.93 1.07v-0.92H6.84c.03.61 0 6.52 0 6.52h2.27V9.36c0-.19.01-.38.07-.52.15-.38.49-.78 1.06-.78.75 0 1.05.58 1.05 1.43V13h2.23Z" />
            </svg>
          </a>
          <a
            className="icon-link"
            href="https://github.com/CraftsMan-Labs/SimpleAgents"
            target="_blank"
            rel="noreferrer"
            aria-label="SimpleAgents repository"
            title="Project GitHub"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M8 0a8 8 0 0 0-2.53 15.6c.4.08.54-.17.54-.38 0-.19-.01-.82-.01-1.49-2 .37-2.53-.5-2.69-.95-.09-.23-.48-.95-.82-1.14-.28-.15-.68-.52 0-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.58.82-2.14-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.14 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.19 0 .21.14.47.55.38A8 8 0 0 0 8 0Z" />
            </svg>
          </a>
          <a
            className="icon-link"
            href="https://docs.simpleagents.craftsmanlabs.net/"
            target="_blank"
            rel="noreferrer"
            aria-label="SimpleAgents docs"
            title="Docs"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M1.5 1A1.5 1.5 0 0 0 0 2.5v10A1.5 1.5 0 0 0 1.5 14H14V2.5A1.5 1.5 0 0 0 12.5 1h-11ZM14 15H1.5A2.5 2.5 0 0 1-1 12.5v-10A2.5 2.5 0 0 1 1.5 0h11A2.5 2.5 0 0 1 15 2.5V15h-1Z" />
              <path d="M2.5 2.5h5v9h-5v-9Zm6 0h5v9h-5v-9Z" />
            </svg>
          </a>
          <Link href="/" className="state-link">
            Home
          </Link>
        </div>
      </div>

      <div className="playground-layout" style={{ position: "relative" }}>
        <section className="pane pane-right">
          <div className="pane-header">
            <div className="field editor-example-field">
              <label className="label" htmlFor="examples-select">
                Examples
              </label>
              <div className="editor-toolbar-row example-switcher-row">
                <select
                  className="editor-inline-select example-switcher-select"
                  id="examples-select"
                  value={selectedExample}
                  onChange={(event) => {
                    void applyExample(event.target.value);
                  }}
                >
                  {Object.keys(EXAMPLES).map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <button className="btn-secondary" type="button" onClick={() => void resetCurrentExample()}>
                  Reset
                </button>
              </div>
            </div>
          </div>

          <div className="editor-stack">
            <div className="field">
              <div className="editor-card-header">
                <div className="editor-title-block">
                  <label htmlFor="yaml-editor" className="label">
                    YAML Workflow Editor
                  </label>
                  <p className="editor-help-text">Edit YAML, keep drafts locally, and export a starter snippet.</p>
                </div>
              </div>
              <div className="editor-help-stack">
                <p className="editor-help-text">
                  Build or edit a SimpleAgents YAML workflow here. Learn the format in the{" "}
                  <a href={YAML_WORKFLOW_DOCS_URL} target="_blank" rel="noreferrer">
                    YAML workflow docs
                  </a>
                  .
                </p>
                <p className="editor-help-text">
                  Need help drafting YAML fast? Run <code>{SKILLS_INSTALL_COMMAND}</code> and use the
                  SimpleAgents skill.
                </p>
              </div>
              <div className="editor-command-bar">
                <div className="editor-status-stack">
                  <span className="editor-status-badge">{draftSaveState}</span>
                  {copyFeedback ? <span className="editor-feedback-text">{copyFeedback}</span> : null}
                </div>
                <div className="editor-command-actions">
                  <div className="export-control">
                    <span className="editor-control-label">Current YAML</span>
                    <button className="btn-secondary editor-action-button" type="button" onClick={() => void copyYaml()}>
                      Copy YAML
                    </button>
                  </div>
                  <div className="export-control export-control-wide">
                    <span className="editor-control-label">Export starter code</span>
                    <div className="editor-toolbar-row export-control-row">
                      <select
                        className="editor-inline-select export-language-select editor-action-input"
                        aria-label="Select export language"
                        value={copyLanguage}
                        onChange={(event) => setCopyLanguage(event.target.value as ExportLanguage)}
                      >
                        <option value="js">JS/TS</option>
                        <option value="python">Python</option>
                        <option value="go">Go</option>
                      </select>
                      <button className="btn-primary editor-action-button" type="button" onClick={() => void copyExportCode()}>
                        Copy Code
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              <textarea
                id="yaml-editor"
                className={`yaml-editor${hasYamlErrors ? " editor-invalid" : ""}`}
                aria-invalid={hasYamlErrors}
                value={yamlInput}
                onChange={(event) => updateActiveDraft({ yaml: event.target.value })}
              />
              {yamlErrors.length > 0 ? (
                <div className="editor-validation error" role="alert">
                  <div className="editor-validation-title">YAML validation errors</div>
                  {yamlErrors.map((item, index) => (
                    <p key={`${item.message}-${index}`} className="mono-value">
                      {formatValidationLabel(item)}
                    </p>
                  ))}
                </div>
              ) : null}
              {yamlWarnings.length > 0 ? (
                <div className="editor-validation warning">
                  <div className="editor-validation-title">YAML warnings</div>
                  {yamlWarnings.map((item, index) => (
                    <p key={`${item.message}-${index}`} className="mono-value">
                      {formatValidationLabel(item)}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="field">
              <div className="editor-card-header">
                <div className="editor-title-block">
                  <label htmlFor="code-editor" className="label">
                    Custom JS/TS Functions
                  </label>
                  <span className="editor-help-text">
                    Used by call_function and custom_worker nodes.
                  </span>
                </div>
              </div>
              <p className="editor-help-text">
                Keep helpers deterministic and import-free so the playground and exported snippets can
                preserve them cleanly.
              </p>
              <textarea
                id="code-editor"
                className={hasCodeErrors ? "editor-invalid" : undefined}
                aria-invalid={hasCodeErrors}
                value={codeInput}
                onChange={(event) => updateActiveDraft({ code: event.target.value })}
              />
              {codeErrors.length > 0 ? (
                <div className="editor-validation error" role="alert">
                  <div className="editor-validation-title">Custom JS/TS errors</div>
                  {codeErrors.map((item, index) => (
                    <p key={`${item.message}-${index}`} className="mono-value">
                      {formatValidationLabel(item)}
                    </p>
                  ))}
                </div>
              ) : null}
              {codeWarnings.length > 0 ? (
                <div className="editor-validation warning">
                  <div className="editor-validation-title">Custom JS/TS warnings</div>
                  {codeWarnings.map((item, index) => (
                    <p key={`${item.message}-${index}`} className="mono-value">
                      {formatValidationLabel(item)}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="field">
              <div className="editor-card-header">
                <div className="editor-title-block">
                  <label className="label">Sample Chat Inputs</label>
                  <span className="editor-help-text">
                    Reuse these prompts for the selected YAML example in the chat panel.
                  </span>
                </div>
              </div>
              <div className="chat-example-list">
                {sampleChatInputs.map((item) => (
                  <div key={`${selectedExample}-${item.label}`} className="chat-example-card">
                    <div className="chat-example-copy">
                      <div className="chat-example-label">{item.label}</div>
                      <p className="chat-example-prompt mono-value">{item.prompt}</p>
                    </div>
                    <div className="chat-example-actions">
                      <button
                        className="btn-secondary chat-example-button"
                        type="button"
                        onClick={() => applyChatExample(item.prompt)}
                      >
                        Use in chat
                      </button>
                      <button
                        className="btn-secondary chat-example-button"
                        type="button"
                        onClick={() => void copyChatExample(item.prompt)}
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <p className="mono-value" style={{ margin: 0 }}>
              Interaction mode: chat-only workflow execution.
            </p>
          </div>
        </section>

        <section className="pane">
          <div className="pane-header">
            <div className="provider-box">
              <button
                className="btn-secondary"
                type="button"
                onClick={() => setIsConfigOpen((prev) => !prev)}
                style={{ width: "100%" }}
              >
                Provider Config
              </button>
              {isConfigOpen ? (
                <div className="dropdown-body">
                  <div className="field">
                    <label className="label" htmlFor="base-url">
                      Base URL
                    </label>
                    <input
                      id="base-url"
                      value={config.baseUrl}
                      onChange={(event) =>
                        setConfig((prev) => ({ ...prev, baseUrl: event.target.value }))
                      }
                    />
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="api-key">
                      API Key
                    </label>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input
                        id="api-key"
                        type={showApiKey ? "text" : "password"}
                        value={config.apiKey}
                        onChange={(event) =>
                          setConfig((prev) => ({ ...prev, apiKey: event.target.value }))
                        }
                      />
                      <button
                        className="btn-secondary"
                        type="button"
                        onClick={() => setShowApiKey((prev) => !prev)}
                        style={{ minWidth: 88, padding: "8px 10px" }}
                      >
                        {showApiKey ? "Hide" : "Show"}
                      </button>
                    </div>
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="model">
                      Model
                    </label>
                    <input
                      id="model"
                      value={config.model}
                      onChange={(event) =>
                        setConfig((prev) => ({ ...prev, model: event.target.value }))
                      }
                    />
                  </div>
                  <p className="mono-value" style={{ margin: 0 }}>
                    BYOK mode: WASM-only in browser.
                  </p>
                  <p className="mono-value" style={{ margin: 0 }}>
                    Provider config is cached in your local browser storage.
                  </p>
                  <p className="mono-value" style={{ margin: 0 }}>
                    Security note: please invalidate/revoke your API key after use.
                  </p>
                  <p className="mono-value" style={{ margin: 0 }}>
                    Runtime: simple-agents-wasm
                  </p>
                </div>
              ) : null}
            </div>
          </div>

          <div className="flow-area">
            {hasYamlErrors ? (
              <div className="editor-validation error" role="alert">
                <div className="editor-validation-title">Workflow visualizer unavailable</div>
                {yamlErrors.map((item, index) => (
                  <p key={`${item.message}-${index}`} className="mono-value">
                    {formatValidationLabel(item)}
                  </p>
                ))}
              </div>
            ) : parsedFlow || parsedGraphFlow ? (
              <>
                {flowRenderError ? (
                  <p className="mono-value">{flowRenderError}</p>
                ) : (
                  <div
                    className="mermaid-view"
                    dangerouslySetInnerHTML={{ __html: flowSvg }}
                  />
                )}
                <details className="mermaid-source">
                  <summary className="label">Visualize output (Mermaid)</summary>
                  <div className="mermaid-source-panel">
                    <pre className="mono-value">{mermaidSource}</pre>
                  </div>
                </details>
              </>
            ) : (
              <p>Flow visualizer appears when YAML is valid.</p>
            )}
          </div>

          <div className="run-log">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div className="label">Run Log ({runState})</div>
              <button
                className="btn-secondary"
                type="button"
                style={{ padding: "6px 10px", fontSize: 12 }}
                onClick={() => {
                  setLogs([]);
                  setStepStreams({});
                  setRunState("idle");
                  setActiveStepId(null);
                }}
              >
                Clear logs
              </button>
            </div>
            {logs.length === 0 ? (
              <p className="mono-value">No logs yet.</p>
            ) : (
              logs.map((line, index) => (
                <p key={`${line}-${index}`} className="mono-value" style={{ marginBottom: 6 }}>
                  {line}
                </p>
              ))
            )}
            {Object.entries(stepStreams).map(([stepId, streamText]) => {
              const parsed = parseThinkingContent(streamText);
              return (
                <details key={stepId} className="stream-block" open>
                  <summary className="label">Stream: {stepId}</summary>
                  {parsed.visible.length > 0 ? (
                    <p className="mono-value" style={{ marginTop: 8 }}>
                      {parsed.visible}
                    </p>
                  ) : null}
                  {parsed.thinking.map((chunk, idx) => (
                    <details key={`${stepId}-think-${idx}`} className="think-block">
                      <summary className="label">Thinking tokens ({idx + 1})</summary>
                      <pre className="mono-value">{chunk}</pre>
                    </details>
                  ))}
                </details>
              );
            })}
          </div>

          <div className={`chat-drawer ${chatOpen ? "expanded" : "collapsed"}`}>
            <div className="chat-header">
              <button
                className="chat-header-icon"
                type="button"
                aria-label={chatOpen ? "Messages" : "Expand log"}
                title={chatOpen ? "Messages" : "Expand log"}
                onClick={() => {
                  if (!chatOpen) {
                    setChatOpen(true);
                  }
                }}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M2.5 2A1.5 1.5 0 0 0 1 3.5v7A1.5 1.5 0 0 0 2.5 12H4v2.2c0 .5.6.8 1 .5l3.6-2.7h4.9a1.5 1.5 0 0 0 1.5-1.5v-7A1.5 1.5 0 0 0 13.5 2h-11Zm.5 3h10v1H3V5Zm0 2h7v1H3V7Zm0 2h5v1H3V9Z" />
                </svg>
              </button>
              {chatOpen ? (
                <div className="chat-header-actions">
                  <button
                    className="btn-secondary chat-header-button"
                    onClick={clearChatHistory}
                    type="button"
                    disabled={chatPending || chatMessages.length === 0}
                  >
                    Clear chat
                  </button>
                  <button
                    className="btn-secondary chat-header-button"
                    onClick={() => setChatOpen(false)}
                    type="button"
                    aria-label="Minimise"
                    title="Minimise"
                  >
                    -
                  </button>
                </div>
              ) : null}
            </div>
            {chatOpen ? (
              <>
                  <div className="chat-body">
                    {chatMessages.length === 0 ? (
                      <p className="mono-value">
                        Ask anything. Chat responses are grounded in the current YAML flow.
                      </p>
                    ) : (
                    chatMessages.map((msg, index) => {
                      const parsed = msg.role === "assistant" ? parseThinkingContent(msg.content) : null;
                      return (
                        <div className={`msg ${msg.role}`} key={`${msg.role}-${index}`}>
                          {parsed ? (
                            <>
                              <div>{parsed.visible || msg.content}</div>
                              {parsed.thinking.map((chunk, idx) => (
                                <details key={`${index}-think-${idx}`} className="think-block">
                                  <summary className="label">Thinking tokens ({idx + 1})</summary>
                                  <pre className="mono-value">{chunk}</pre>
                                </details>
                              ))}
                            </>
                          ) : (
                            msg.content
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
                <div className="chat-input">
                  <input
                    placeholder="Send a message"
                    value={chatInput}
                    onChange={(event) => setChatInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        void sendChat();
                      }
                    }}
                  />
                  <button
                    className="btn-primary"
                    type="button"
                    onClick={() => void sendChat()}
                    disabled={chatPending}
                  >
                    {chatPending ? "Sending..." : "Send"}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
