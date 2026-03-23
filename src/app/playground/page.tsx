"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { parse } from "yaml";

type ProviderConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

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

type RunState = "idle" | "running" | "failed" | "done";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

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

async function callProvider(config: ProviderConfig, prompt: string, signal?: AbortSignal) {
  const response = await fetch("/api/complete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      prompt,
      temperature: 0.7
    }),
    signal
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Provider request failed (${response.status}). ${text.slice(0, 260)}`);
  }

  const data = (await response.json()) as { content?: string };
  const content = data.content;
  if (!content) {
    throw new Error("Provider response had no message content.");
  }

  return content;
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
  const [config, setConfig] = useState<ProviderConfig>({
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    model: "gpt-4o-mini"
  });

  const abortRef = useRef<AbortController | null>(null);

  const parsedFlow = useMemo(() => {
    try {
      return parseFlow(yamlInput);
    } catch {
      return null;
    }
  }, [yamlInput]);

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
          const answer = await callProvider(config, prompt, abortRef.current.signal);
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
      const message = error instanceof Error ? error.message : "Execution failed.";
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
    setChatMessages((prev) => [...prev, { role: "user", content: prompt }]);

    try {
      const answer = await callProvider(config, prompt);
      setChatMessages((prev) => [...prev, { role: "assistant", content: answer }]);
    } catch (error) {
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: error instanceof Error ? error.message : "Chat request failed"
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
                    BYOK mode: key is forwarded to server runtime per request and not persisted.
                  </p>
                </div>
              ) : null}
            </div>
          </div>

          <div className="flow-area">
            {parsedFlow ? (
              <>
                {parsedFlow.steps.map((step, index) => (
                  <div key={step.id}>
                    <article
                      className={`flow-node ${activeStepId === step.id ? "active" : ""}`}
                    >
                      <div className="label">{step.type}</div>
                      <strong>{step.id}</strong>
                      {step.prompt ? <p>{step.prompt}</p> : null}
                      {step.text ? <p>{step.text}</p> : null}
                    </article>
                    {index < parsedFlow.steps.length - 1 ? (
                      <div className="flow-arrow">v</div>
                    ) : null}
                  </div>
                ))}
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
                    <p className="mono-value">Ask anything using current provider config.</p>
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
