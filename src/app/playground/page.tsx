"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Client as WasmClient } from "simple-agents-wasm";
import { parse } from "yaml";

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
};

let wasmClientCache: { cacheKey: string; client: WasmClientLike } | null = null;

async function loadWasmClient(config: ProviderConfig): Promise<WasmClientLike> {
  const cacheKey = `${config.baseUrl}::${config.apiKey}`;
  if (wasmClientCache !== null && wasmClientCache.cacheKey === cacheKey) {
    return wasmClientCache.client;
  }

  const client = new WasmClient("openai", {
    baseUrl: config.baseUrl,
    apiKey: config.apiKey
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

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

const PROVIDER_CONFIG_CACHE_KEY = "yamslam.provider.config.v1";

const EXAMPLES: Record<string, { yaml: string; code: string }> = {
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
    code: `function slugify(input) {
  return String(input).toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}`
  }
};

const DEFAULT_YAML = EXAMPLES["Quick hello"].yaml;

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

function interpolate(template: unknown, context: Record<string, unknown>): unknown {
  if (typeof template !== "string") {
    return template;
  }

  return template.replace(/{{\s*([^}]+)\s*}}/g, (_, token: string) => {
    const key = token.trim();
    return safeString(context[key] ?? "");
  });
}

function sanitizeCode(source: string): string {
  if (/\bimport\b|\brequire\b|\bfrom\b/.test(source)) {
    throw new Error("Imports are not allowed. Use inline functions only.");
  }

  const withoutTypeDecl = source.replace(/\btype\s+[\s\S]*?;/g, "");
  const withoutInterfaces = withoutTypeDecl.replace(/\binterface\s+[\s\S]*?\}/g, "");
  const withoutTypeAnnotations = withoutInterfaces.replace(/:\s*[A-Za-z_][A-Za-z0-9_<>,\[\]\s|]*/g, "");
  return withoutTypeAnnotations.replace(/\bexport\s+/g, "");
}

function parseFlow(input: string): FlowDoc {
  const parsed = parse(input) as Partial<FlowDoc>;
  if (!parsed || !Array.isArray(parsed.steps)) {
    throw new Error("YAML must include a top-level 'steps' array.");
  }

  parsed.steps.forEach((step, index) => {
    if (!step.id || !step.type) {
      throw new Error(`Step at index ${index} is missing 'id' or 'type'.`);
    }
  });

  return {
    version: parsed.version ?? "1",
    steps: parsed.steps as FlowStep[]
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

async function callProvider(
  config: ProviderConfig,
  promptOrMessages: string | WasmMessage[],
  model?: string
): Promise<string> {
  const wasmClient = await loadWasmClient(config);
  const wasmResult = await wasmClient.complete(model ?? config.model, promptOrMessages);
  const content = wasmResult.content;
  if (!content) {
    throw new Error("WASM runtime response had no message content.");
  }
  return content;
}

function parseGraphFlow(input: string): GraphWorkflowDoc {
  const parsed = parse(input) as Partial<GraphWorkflowDoc>;
  if (
    parsed === null ||
    parsed === undefined ||
    typeof parsed !== "object" ||
    typeof parsed.entry_node !== "string" ||
    !Array.isArray(parsed.nodes)
  ) {
    throw new Error("Not a graph workflow document.");
  }
  return parsed as GraphWorkflowDoc;
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

async function executeGraphWorkflowForChat(
  workflow: GraphWorkflowDoc,
  inputMessages: ChatMessage[],
  config: ProviderConfig
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

    if ("llm_call" in node.node_type) {
      const llmNode = node as GraphLlmNode;
      const llm = llmNode.node_type.llm_call;
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

      const content = await callProvider(config, promptOrMessages, llm.model);
      const parsedOutput = parsePossiblyJson(content);
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
      pointer = target ?? spec.default ?? "";
      if (pointer.length === 0) {
        break;
      }
      continue;
    }

    if ("custom_worker" in node.node_type) {
      const customNode = node as GraphCustomWorkerNode;
      const topic = customNode.config?.payload?.topic ?? "custom_worker";
      const message =
        topic === "terminated" || topic === "already_terminated"
          ? "Interview already terminated based on prior policy decision."
          : `Custom worker executed for topic: ${topic}`;
      const nodesBucket = context.nodes as Record<string, unknown>;
      nodesBucket[node.id] = { output: { message } };
      finalOutput = { message };

      const nextList = edgeMap.get(node.id) ?? [];
      pointer = nextList[0] ?? "";
      if (pointer.length === 0) {
        break;
      }
      continue;
    }

    throw new Error(`Unsupported node type at '${node.id}'.`);
  }

  return formatGraphChatOutput(finalOutput);
}

function evaluateCondition(
  condition: FlowStep["condition"],
  context: Record<string, unknown>
): boolean {
  if (!condition) {
    return false;
  }

  const left = interpolate(condition.left, context);
  const right = interpolate(condition.right, context);

  if (condition.operator === "eq") {
    return left === right;
  }
  if (condition.operator === "ne") {
    return left !== right;
  }
  if (condition.operator === "contains") {
    return safeString(left).includes(safeString(right));
  }
  return false;
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
  const [yamlInput, setYamlInput] = useState(DEFAULT_YAML);
  const [codeInput, setCodeInput] = useState(EXAMPLES["Quick hello"].code);
  const [selectedExample, setSelectedExample] = useState("Quick hello");
  const [runState, setRunState] = useState<RunState>("idle");
  const [logs, setLogs] = useState<string[]>([]);
  const [activeStepId, setActiveStepId] = useState<string | null>(null);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatPending, setChatPending] = useState(false);
  const [flowSvg, setFlowSvg] = useState<string>("");
  const [flowRenderError, setFlowRenderError] = useState<string | null>(null);
  const [config, setConfig] = useState<ProviderConfig>({
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    model: "gpt-4o-mini"
  });

  const abortRef = useRef<AbortController | null>(null);

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

  const parsedFlow = useMemo(() => {
    try {
      return parseFlow(yamlInput);
    } catch {
      return null;
    }
  }, [yamlInput]);

  const parsedGraphFlow = useMemo(() => {
    try {
      return parseGraphFlow(yamlInput);
    } catch {
      return null;
    }
  }, [yamlInput]);

  const mermaidSource = useMemo(() => {
    if (parsedFlow !== null) {
      return flowToMermaid(parsedFlow, activeStepId);
    }
    if (parsedGraphFlow !== null) {
      return graphFlowToMermaid(parsedGraphFlow, activeStepId);
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

  const applyExample = (name: string) => {
    const example = EXAMPLES[name];
    setSelectedExample(name);
    setYamlInput(example.yaml);
    setCodeInput(example.code);
    setLogs([`Loaded example: ${name}`]);
  };

  const runFlow = async () => {
    setLogs([]);
    setRunState("running");

    if (!config.baseUrl || !config.model) {
      setRunState("failed");
      setLogs(["Base URL and model are required."]);
      return;
    }

    let flow: FlowDoc;
    try {
      flow = parseFlow(yamlInput);
    } catch (error) {
      setRunState("failed");
      setLogs([error instanceof Error ? error.message : "Invalid YAML"]);
      return;
    }

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    const context: Record<string, unknown> = {};
    const stepIndex = new Map(flow.steps.map((step, index) => [step.id, index]));
    let pointer = 0;
    let iterations = 0;

    try {
      while (pointer < flow.steps.length) {
        iterations += 1;
        if (iterations > 500) {
          throw new Error("Execution stopped. Too many step transitions.");
        }

        const step = flow.steps[pointer];
        setActiveStepId(step.id);
        setLogs((prev) => [...prev, `Running step: ${step.id} (${step.type})`]);

        if (step.type === "set") {
          if (!step.key) {
            throw new Error(`Step '${step.id}' is missing 'key'.`);
          }
          context[step.key] = interpolate(step.value, context);
        }

        if (step.type === "llm_call") {
          if (!config.apiKey) {
            throw new Error("API key is required for llm_call steps.");
          }
          const prompt = safeString(interpolate(step.prompt ?? "", context));
          const answer = await callProvider(config, prompt);
          context[step.id] = answer;
        }

        if (step.type === "if") {
          const matched = evaluateCondition(step.condition, context);
          const targetId = matched ? step.then : step.else;
          if (targetId) {
            const jumpTo = stepIndex.get(targetId);
            if (jumpTo === undefined) {
              throw new Error(`Step '${step.id}' points to unknown step '${targetId}'.`);
            }
            pointer = jumpTo;
            continue;
          }
        }

        if (step.type === "call_function") {
          if (!step.function) {
            throw new Error(`Step '${step.id}' is missing 'function'.`);
          }

          const runnableCode = sanitizeCode(codeInput);
          const args = (interpolate(step.args ?? {}, context) ?? {}) as Record<string, unknown>;
          const runner = new Function(
            "input",
            "context",
            `${runnableCode}\nif (typeof ${step.function} !== "function") { throw new Error("Function '${step.function}' was not found."); }\nreturn ${step.function}(input, context);`
          ) as (input: Record<string, unknown>, context: Record<string, unknown>) => unknown;
          context[step.id] = runner(args, context);
        }

        if (step.type === "output") {
          const rendered = safeString(interpolate(step.text ?? "", context));
          context[step.id] = rendered;
          setLogs((prev) => [...prev, `Output: ${rendered}`]);
        }

        if (step.next) {
          const jumpTo = stepIndex.get(step.next);
          if (jumpTo === undefined) {
            throw new Error(`Step '${step.id}' points to unknown step '${step.next}'.`);
          }
          pointer = jumpTo;
          continue;
        }

        pointer += 1;
      }

      setRunState("done");
      setLogs((prev) => [...prev, "Run complete."]);
    } catch (error) {
      const message = normalizeProviderError(error, config.apiKey);
      if (message.toLowerCase().includes("cors")) {
        setLogs((prev) => [
          ...prev,
          "This provider may not allow browser-origin requests (CORS).",
          message
        ]);
      } else {
        setLogs((prev) => [...prev, message]);
      }
      setRunState("failed");
    } finally {
      setActiveStepId(null);
    }
  };

  const stopRun = () => {
    abortRef.current?.abort();
    setRunState("idle");
    setActiveStepId(null);
    setLogs((prev) => [...prev, "Run aborted."]);
  };

  const sendChat = async () => {
    const prompt = chatInput.trim();
    if (!prompt || chatPending) {
      return;
    }

    if (!config.apiKey || !config.baseUrl || !config.model) {
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Add base URL, API key, and model first." }
      ]);
      return;
    }

    setChatInput("");
    setChatPending(true);
    const updatedMessages = [...chatMessages, { role: "user" as const, content: prompt }];
    setChatMessages(updatedMessages);

    try {
      let answer: string;
      if (parsedGraphFlow !== null) {
        answer = await executeGraphWorkflowForChat(parsedGraphFlow, updatedMessages, config);
      } else {
        const yamlAwarePrompt = buildYamlAwareChatPrompt({
          yamlSource: yamlInput,
          customCode: codeInput,
          userMessage: prompt,
          history: updatedMessages
        });
        answer = await callProvider(config, yamlAwarePrompt);
      }
      setChatMessages((prev) => [...prev, { role: "assistant", content: answer }]);
    } catch (error) {
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: normalizeProviderError(error, config.apiKey)
        }
      ]);
    } finally {
      setChatPending(false);
    }
  };

  return (
    <main className="playground-shell">
      <div className="pane-header" style={{ marginBottom: 16 }}>
        <div>
          <div className="label">YamSLAM Playground</div>
          <h3>Browser-only YAML runtime</h3>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <Link href="/" className="state-link">
            Home
          </Link>
          <Link href="/reference" className="state-link">
            Reference
          </Link>
        </div>
      </div>

      <div className="playground-layout" style={{ position: "relative" }}>
        <section className="pane pane-right">
          <div className="pane-header">
            <button
              className="btn-secondary"
              onClick={() => {
                const names = Object.keys(EXAMPLES);
                const nextIndex = (names.indexOf(selectedExample) + 1) % names.length;
                applyExample(names[nextIndex]);
              }}
              type="button"
            >
              Examples ({selectedExample})
            </button>
            <span className="label">Left pane</span>
          </div>

          <div className="editor-stack">
            <div className="field">
              <label htmlFor="yaml-editor" className="label">
                Flow YAML
              </label>
              <textarea
                id="yaml-editor"
                className="yaml-editor"
                value={yamlInput}
                onChange={(event) => setYamlInput(event.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="code-editor" className="label">
                Custom JS/TS Functions (no imports)
              </label>
              <textarea
                id="code-editor"
                value={codeInput}
                onChange={(event) => setCodeInput(event.target.value)}
              />
            </div>

            <div className="run-row" style={{ gap: 8 }}>
              <button className="btn-secondary" type="button" onClick={stopRun}>
                Stop
              </button>
              <button
                className="btn-primary"
                type="button"
                disabled={runState === "running"}
                onClick={runFlow}
              >
                {runState === "running" ? "Running..." : "Run"}
              </button>
            </div>
          </div>
        </section>

        <section className="pane">
          <div className="pane-header">
            <span className="label">Right pane</span>
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
                    Runtime: simple-agents-wasm
                  </p>
                </div>
              ) : null}
            </div>
          </div>

          <div className="flow-area">
            {parsedFlow || parsedGraphFlow ? (
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
                  <pre className="mono-value">{mermaidSource}</pre>
                </details>
              </>
            ) : (
              <p>Flow visualizer appears when YAML is valid.</p>
            )}
          </div>

          <div className="run-log">
            <div className="label">Run Log ({runState})</div>
            {logs.length === 0 ? (
              <p className="mono-value">No logs yet.</p>
            ) : (
              logs.map((line, index) => (
                <p key={`${line}-${index}`} className="mono-value" style={{ marginBottom: 6 }}>
                  {line}
                </p>
              ))
            )}
          </div>

          <div className="chat-drawer">
            <div className="chat-header">
              <span className="label">Chat</span>
              <button
                className="btn-secondary"
                style={{ padding: "4px 10px", fontSize: 13 }}
                onClick={() => setChatOpen((prev) => !prev)}
                type="button"
              >
                {chatOpen ? "Collapse" : "Expand"}
              </button>
            </div>
            {chatOpen ? (
              <>
                  <div className="chat-body">
                    {chatMessages.length === 0 ? (
                      <p className="mono-value">
                        Ask anything. Chat responses are grounded in the current YAML flow.
                      </p>
                    ) : (
                    chatMessages.map((msg, index) => (
                      <div className={`msg ${msg.role}`} key={`${msg.role}-${index}`}>
                        {msg.content}
                      </div>
                    ))
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
