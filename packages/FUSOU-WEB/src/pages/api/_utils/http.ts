export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export class BodyTooLargeError extends Error {
  constructor(message = "Request payload too large") {
    super(message);
    this.name = "BodyTooLargeError";
  }
}

export class InvalidJsonError extends Error {
  constructor(message = "Invalid JSON body") {
    super(message);
    this.name = "InvalidJsonError";
  }
}

export class MissingBodyError extends Error {
  constructor(message = "Request body is required") {
    super(message);
    this.name = "MissingBodyError";
  }
}

export async function readJsonBody(request: Request, limit: number): Promise<any> {
  const text = await readTextBody(request, limit);
  try {
    return JSON.parse(text);
  } catch {
    throw new InvalidJsonError();
  }
}

export async function readTextBody(request: Request, limit: number): Promise<string> {
  const stream = request.body;
  if (!stream) {
    throw new MissingBodyError();
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let result = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      received += value.byteLength;
      if (received > limit) {
        throw new BodyTooLargeError();
      }
      result += decoder.decode(value, { stream: true });
    }
  }

  result += decoder.decode();
  return result;
}

export function handleJsonReadError(err: unknown): Response {
  if (err instanceof BodyTooLargeError) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 413,
      headers: { ...CORS_HEADERS, "content-type": "application/json" },
    });
  }
  if (err instanceof InvalidJsonError) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...CORS_HEADERS, "content-type": "application/json" },
    });
  }
  if (err instanceof MissingBodyError) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...CORS_HEADERS, "content-type": "application/json" },
    });
  }
  console.error("Failed to read request body", err);
  return new Response(JSON.stringify({ error: "Unable to read request body" }), {
    status: 400,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
}
