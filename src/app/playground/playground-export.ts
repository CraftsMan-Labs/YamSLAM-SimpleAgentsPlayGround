export type ExportLanguage = "js" | "python" | "go";

export type PlaygroundExportBundle = {
  content: string;
  filename: string;
  language: ExportLanguage;
  note?: string;
};

type ExportInput = {
  yaml: string;
  code: string;
  language: ExportLanguage;
};

function escapeTemplateLiteral(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

function escapePythonTripleQuote(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/"""/g, '\\"\\"\\"');
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

function buildJavaScriptExport(input: ExportInput): PlaygroundExportBundle {
  const functionNames = detectWorkflowFunctionNames(input.yaml);
  const functionEntries = functionNames
    .map((name) => `    ${name}: typeof ${name} === "function" ? ${name} : undefined`)
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

${functionMapBlock}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY || "";
  if (!apiKey) {
    throw new Error("Set OPENAI_API_KEY before running this example.");
  }

  const client = new Client("openai", {
    apiKey,
    baseUrl: process.env.OPENAI_API_BASE || "https://api.openai.com/v1",
    fetchImpl: fetch
  });

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

${stubBlock}def main() -> None:
    client = Client("openai", api_key="YOUR_API_KEY", api_base="https://api.openai.com/v1")
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

${stubBlock.length > 0 ? `${stubBlock}

` : ""}func main() {
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
