export type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

export type AssistantRequest = {
  messages: AssistantMessage[];
  context: Record<string, unknown> | null;
};

export type AssistantConnection = {
  auth: "chatgpt";
  plan: string | null;
  model: string;
};

export const MAX_REQUEST_BYTES = 96_000;
export const MAX_MESSAGE_LENGTH = 8_000;
export const MAX_CONTEXT_LENGTH = 64_000;
export const HISTORY_WINDOW = 16;

export function parseAssistantRequest(value: unknown): AssistantRequest {
  if (!value || typeof value !== "object") throw new Error("Expected a conversation.");
  const input = value as Record<string, unknown>;
  if (!Array.isArray(input.messages) || !input.messages.length || input.messages.length > HISTORY_WINDOW) {
    throw new Error("Send between 1 and 16 recent messages.");
  }
  const messages = input.messages.map((entry: unknown): AssistantMessage => {
    if (!entry || typeof entry !== "object") throw new Error("Invalid message.");
    const message = entry as Record<string, unknown>;
    if ((message.role !== "user" && message.role !== "assistant") ||
        typeof message.id !== "string" || message.id.length > 100 ||
        typeof message.text !== "string" || !message.text.trim() || message.text.length > MAX_MESSAGE_LENGTH) {
      throw new Error("Each message needs a role and up to 8,000 characters.");
    }
    return { id: message.id, role: message.role, text: message.text };
  });
  if (messages.at(-1)?.role !== "user") throw new Error("The last message must be yours.");
  const context = input.context ?? null;
  if (context !== null && (typeof context !== "object" || Array.isArray(context) || JSON.stringify(context).length > MAX_CONTEXT_LENGTH)) {
    throw new Error("Planning context is too large or invalid.");
  }
  return { messages, context: context as Record<string, unknown> | null };
}

// This experiment spends the machine owner's Codex subscription. It is only
// enabled by the loopback launcher, never by a normal Vercel deployment.
export function isLocalAssistantRequest(request: Request, enabled: boolean) {
  if (!enabled) return false;
  const url = new URL(request.url);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return false;
  if (request.headers.get("host") !== url.host) return false;
  // Next.js adds this header even for a direct loopback connection.
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost && forwardedHost !== url.host) return false;
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return false;
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  return request.method !== "POST" ||
    (origin === url.origin && request.headers.get("content-type")?.split(";")[0] === "application/json");
}
