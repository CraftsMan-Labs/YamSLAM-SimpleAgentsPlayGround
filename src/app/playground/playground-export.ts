import { parseDocument } from "yaml";

export type ExportLanguage = "js" | "python" | "go";

export type PlaygroundExportBundle = {
  content: string;
  filename: string;
  language: ExportLanguage;
  note?: string;
};

type ExportInput = {
  apiKey: string;
  baseUrl: string;
  yaml: string;
  code: string;
  language: ExportLanguage;
  model: string;
};

function escapeTemplateLiteral(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

function escapePythonTripleQuote(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/"""/g, '\\"\\"\\"');
}

function escapeDoubleQuotedString(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function detectWorkflowFunctionNames(yaml: string): string[] {
  const names = new Set<string>();

  for (const match of yaml.matchAll(/handler:\s*([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
    names.add(match[1]);
  }

  for (const match of yaml.matchAll(/function:\s*([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
    names.add(match[1]);
  }

  return [...names];
}

function detectCustomWorkerLookupAliases(yaml: string): Array<{ lookupKey: string; handler: string }> {
  const aliases: Array<{ lookupKey: string; handler: string }> = [];

  try {
    const parsed = parseDocument(yaml).toJSON();
    if (parsed === null || typeof parsed !== "object") {
      return aliases;
    }

    const nodes = (parsed as { nodes?: unknown }).nodes;
    if (!Array.isArray(nodes)) {
      return aliases;
    }

    for (const node of nodes) {
      if (node === null || typeof node !== "object") {
        continue;
      }
      const customWorker =
        (node as { node_type?: { custom_worker?: { handler?: unknown; handler_file?: unknown } } }).node_type
          ?.custom_worker;
      const handler = customWorker?.handler;
      const handlerFile = customWorker?.handler_file;
      if (
        typeof handler === "string" &&
        handler.length > 0 &&
        typeof handlerFile === "string" &&
        handlerFile.length > 0
      ) {
        aliases.push({ lookupKey: `${handlerFile}#${handler}`, handler });
      }
    }
  } catch {
    return aliases;
  }

  return aliases;
}

function buildJavaScriptExport(input: ExportInput): PlaygroundExportBundle {
  const functionNames = detectWorkflowFunctionNames(input.yaml);
  const aliasEntries = detectCustomWorkerLookupAliases(input.yaml).map(
    (entry) => `    ${JSON.stringify(entry.lookupKey)}: typeof ${entry.handler} === "function" ? ${entry.handler} : undefined`
  );
  const functionEntries = functionNames
    .map((name) => `    ${name}: typeof ${name} === "function" ? ${name} : undefined`)
    .concat(aliasEntries)
    .join(",\n");

  const functionMapBlock =
    functionEntries.length > 0
      ? `function buildFunctions() {\n  const scope = new Function(\`${"${customCode}"}\\nreturn {\\n${functionEntries}\\n  };\`)();\n  return Object.fromEntries(Object.entries(scope).filter(([, value]) => typeof value === "function"));\n}`
      : `function buildFunctions() {\n  return {};\n}`;

  return {
    filename: "workflow-playground-example.ts",
    language: "js",
    content: `import { Client } from "simple-agents-wasm";

const workflowYaml = \`${escapeTemplateLiteral(input.yaml)}\`;
const customCode = \`${escapeTemplateLiteral(input.code)}\`;
const model = ${JSON.stringify(input.model)};
const apiKey = ${JSON.stringify(input.apiKey)};
const baseUrl = ${JSON.stringify(input.baseUrl)};

${functionMapBlock}

async function main() {
  if (!apiKey) {
    throw new Error("The exported snippet expects a non-empty API key.");
  }

  const client = new Client("openai", {
    apiKey,
    baseUrl,
    fetchImpl: fetch
  });

  console.log("Running model:", model);
  const result = await client.runWorkflowYamlString(
    workflowYaml,
    {
      messages: [{ role: "user", content: "Hello from the exported playground workflow." }]
    },
    {
      functions: buildFunctions()
    }
  );

  console.log(result);
  console.log("Custom helper source preserved in customCode.");
}

void main();
`
  };
}

function buildPythonExport(input: ExportInput): PlaygroundExportBundle {
  const functionNames = detectWorkflowFunctionNames(input.yaml);
  const stubBlock =
    functionNames.length > 0
      ? `${functionNames
          .map(
            (name) => `def ${name}(payload, context):\n    raise NotImplementedError("Port ${name} from the JS/TS playground helper before running this workflow.")`
          )
          .join("\n\n")}\n\n`
      : "";

  return {
    filename: "workflow_playground_example.py",
    language: "python",
    note:
      input.code.trim().length > 0
        ? "Includes the original custom JS/TS as reference plus Python stubs for manual porting."
        : "YAML-only export.",
    content: `from simple_agents_py import Client

WORKFLOW_YAML = """${escapePythonTripleQuote(input.yaml)}"""

CUSTOM_JS_TS_REFERENCE = """${escapePythonTripleQuote(input.code)}"""

API_KEY = "${escapeDoubleQuotedString(input.apiKey)}"
API_BASE = "${escapeDoubleQuotedString(input.baseUrl)}"
MODEL = "${escapeDoubleQuotedString(input.model)}"

${stubBlock}def main() -> None:
    client = Client("openai", api_key=API_KEY, api_base=API_BASE)
    print(f"Configured model: {MODEL}")
    print("Paste WORKFLOW_YAML into your workflow runner and port any stubs below before execution.")
    print(WORKFLOW_YAML)


if __name__ == "__main__":
    main()
`
  };
}

function buildGoExport(input: ExportInput): PlaygroundExportBundle {
  const functionNames = detectWorkflowFunctionNames(input.yaml);
  const stubBlock = functionNames
    .map(
      (name) => `func ${name}(payload any, context map[string]any) (any, error) {
\treturn nil, fmt.Errorf("port ${name} from the JS/TS playground helper before running this workflow")
}`
    )
    .join("\n\n");

  return {
    filename: "workflow_playground_example.go",
    language: "go",
    note:
      input.code.trim().length > 0
        ? "Includes the original custom JS/TS as reference plus Go stubs for manual porting."
        : "YAML-only export.",
    content: `package main

import "fmt"

const workflowYAML = \`${escapeTemplateLiteral(input.yaml)}\`

const customJSTSReference = \`${escapeTemplateLiteral(input.code)}\`
const apiKey = ${JSON.stringify(input.apiKey)}
const baseURL = ${JSON.stringify(input.baseUrl)}
const model = ${JSON.stringify(input.model)}

${stubBlock.length > 0 ? `${stubBlock}

` : ""}func main() {
\tfmt.Println("Configured API key:", apiKey)
\tfmt.Println("Configured base URL:", baseURL)
\tfmt.Println("Configured model:", model)
\tfmt.Println("Paste workflowYAML into your Go workflow runner and port any stubs below before execution.")
\tfmt.Println(workflowYAML)
}
`
  };
}

export function buildPlaygroundExport(input: ExportInput): PlaygroundExportBundle {
  if (input.language === "js") {
    return buildJavaScriptExport(input);
  }

  if (input.language === "python") {
    return buildPythonExport(input);
  }

  return buildGoExport(input);
}
