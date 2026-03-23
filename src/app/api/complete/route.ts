import { Client, type MessageInput } from "simple-agents-node";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type CompleteRequestBody = {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt?: string;
  messages?: MessageInput[];
  temperature?: number;
  maxTokens?: number;
};

function parseRequestBody(value: unknown): CompleteRequestBody {
  if (value === null || value === undefined || typeof value !== "object") {
    throw new Error("Request body must be an object.");
  }

  const body = value as Record<string, unknown>;
  const baseUrl = body.baseUrl;
  const apiKey = body.apiKey;
  const model = body.model;
  const prompt = body.prompt;
  const messages = body.messages;
  const temperature = body.temperature;
  const maxTokens = body.maxTokens;

  if (typeof baseUrl !== "string" || baseUrl.trim() === "") {
    throw new Error("baseUrl is required.");
  }
  if (typeof apiKey !== "string" || apiKey.trim() === "") {
    throw new Error("apiKey is required.");
  }
  if (typeof model !== "string" || model.trim() === "") {
    throw new Error("model is required.");
  }
  if (prompt !== undefined && typeof prompt !== "string") {
    throw new Error("prompt must be a string.");
  }
  if (messages !== undefined && !Array.isArray(messages)) {
    throw new Error("messages must be an array.");
  }
  if (temperature !== undefined && typeof temperature !== "number") {
    throw new Error("temperature must be a number.");
  }
  if (maxTokens !== undefined && typeof maxTokens !== "number") {
    throw new Error("maxTokens must be a number.");
  }

  return {
    baseUrl,
    apiKey,
    model,
    prompt,
    messages: messages as MessageInput[] | undefined,
    temperature,
    maxTokens
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = parseRequestBody(await request.json());

    if (body.prompt === undefined && body.messages === undefined) {
      return NextResponse.json(
        { error: "Either prompt or messages is required." },
        { status: 400 }
      );
    }

    const prevKey = process.env.OPENAI_API_KEY;
    const prevBase = process.env.OPENAI_API_BASE;
    const prevModel = process.env.OPENAI_MODEL;

    process.env.OPENAI_API_KEY = body.apiKey;
    process.env.OPENAI_API_BASE = body.baseUrl;
    process.env.OPENAI_MODEL = body.model;

    try {
      const client = new Client("openai");
      const result = await client.complete(body.model, body.messages ?? body.prompt ?? "", {
        temperature: body.temperature ?? 0.7,
        maxTokens: body.maxTokens
      });

      return NextResponse.json(
        {
          id: result.id,
          model: result.model,
          content: result.content ?? "",
          usage: result.usage,
          latencyMs: result.latencyMs,
          finishReason: result.finishReason
        },
        { status: 200 }
      );
    } finally {
      if (prevKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = prevKey;
      }

      if (prevBase === undefined) {
        delete process.env.OPENAI_API_BASE;
      } else {
        process.env.OPENAI_API_BASE = prevBase;
      }

      if (prevModel === undefined) {
        delete process.env.OPENAI_MODEL;
      } else {
        process.env.OPENAI_MODEL = prevModel;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
