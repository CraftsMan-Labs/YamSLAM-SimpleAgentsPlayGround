import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const ALLOWED_EXAMPLES = new Set([
  "email-chat-draft-or-clarify.yaml",
  "python-intern-fun-interview-system.yaml",
  "quick-hello-steps.yaml"
]);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get("name");

  if (name === null || !ALLOWED_EXAMPLES.has(name)) {
    return NextResponse.json({ error: "Invalid example name" }, { status: 400 });
  }

  try {
    const filePath = path.join(process.cwd(), "examples", name);
    const yaml = await readFile(filePath, "utf8");
    return NextResponse.json({ name, yaml });
  } catch {
    return NextResponse.json({ error: "Example file not found" }, { status: 404 });
  }
}
