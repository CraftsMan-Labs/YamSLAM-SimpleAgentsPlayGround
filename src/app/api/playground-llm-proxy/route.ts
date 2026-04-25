import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const TARGET_HEADER = "x-playground-target-url";

function isAllowedTargetUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Forwards OpenAI-compatible POST /chat/completions traffic from the browser to the
 * user-configured provider. Avoids CORS: the browser only talks to this same-origin
 * route; the server performs the cross-origin request.
 */
export async function POST(request: NextRequest) {
  const target = request.headers.get(TARGET_HEADER);
  if (!target || !isAllowedTargetUrl(target)) {
    return NextResponse.json({ error: "Missing or disallowed target URL" }, { status: 400 });
  }

  const body = await request.text();
  const headers = new Headers();
  const auth = request.headers.get("authorization");
  const contentType = request.headers.get("content-type") || "application/json";
  const accept = request.headers.get("accept");
  if (auth) {
    headers.set("Authorization", auth);
  }
  headers.set("Content-Type", contentType);
  if (accept) {
    headers.set("Accept", accept);
  }
  request.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (
      k === TARGET_HEADER ||
      k === "host" ||
      k === "connection" ||
      k === "content-length" ||
      k === "authorization" ||
      k === "content-type" ||
      k === "accept" ||
      k.startsWith("x-forwarded-") ||
      k.startsWith("x-vercel-")
    ) {
      return;
    }
    if (k.startsWith("x-") && !k.startsWith("x-playground-")) {
      headers.set(key, value);
    }
  });

  const upstream = await fetch(target, {
    method: "POST",
    headers,
    body
  });

  const resHeaders = new Headers();
  const uct = upstream.headers.get("content-type");
  if (uct) {
    resHeaders.set("Content-Type", uct);
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: resHeaders
  });
}
