import type { ChatResponse } from "@contract/chat";

export type { ChatResponse };

export interface Step {
  node: string;
  message: string;
}

export interface StreamHandlers {
  onStep: (step: Step) => void;
  onResult: (result: ChatResponse) => void;
}

/** A failure the agent can read: what to show, and whether trying again is likely to help. */
export class ChatError extends Error {
  constructor(
    message: string,
    readonly retryable = true,
  ) {
    super(message);
    this.name = "ChatError";
  }
}

interface SseBlock {
  event: string;
  data: string;
}

/**
 * Splits a growing text buffer into complete SSE blocks. Anything after the last blank line is an unfinished block and is
 * returned as `rest` for the next chunk. Comment lines (": keepalive") and blocks without data are dropped.
 */
export function parseSse(buffer: string): { blocks: SseBlock[]; rest: string } {
  const parts = buffer.replace(/\r\n/g, "\n").split("\n\n");
  const rest = parts.pop() ?? "";
  const blocks: SseBlock[] = [];
  for (const part of parts) {
    let event = "message";
    const data: string[] = [];
    for (const line of part.split("\n")) {
      if (line.startsWith(":")) continue;
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (data.length) blocks.push({ event, data: data.join("\n") });
  }
  return { blocks, rest };
}

async function failureMessage(response: Response): Promise<ChatError> {
  const body = (await response.json().catch(() => null)) as { detail?: unknown } | null;
  const detail = typeof body?.detail === "string" ? body.detail : null;
  if (response.status === 401) return new ChatError("Your session has ended. Sign in again.", false);
  if (response.status === 429) return new ChatError(detail ?? "You are asking too quickly. Wait a moment and try again.");
  if (response.status === 422) return new ChatError(detail ?? "That question could not be sent.", false);
  if (response.status === 503 || response.status === 504) return new ChatError(detail ?? "The assistant is unavailable. Please try again shortly.");
  return new ChatError(detail ?? "The assistant ran into a problem. Please try again.");
}

/**
 * Sends a question and reports progress as the server streams it. Resolves once the answer arrived; throws ChatError
 * otherwise. Aborting `signal` stops the request quietly (the caller decides what that means).
 */
export async function streamChat(body: { query: string; msisdn?: string }, handlers: StreamHandlers, signal?: AbortSignal): Promise<void> {
  let response: Response;
  try {
    response = await fetch("/api/chat/stream", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ChatError("Cannot reach the server. Check your connection and try again.");
  }
  if (!response.ok) throw await failureMessage(response);
  if (!response.body) throw new ChatError("The assistant sent no answer. Please try again.");

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let answered = false;
  for (;;) {
    let chunk: ReadableStreamReadResult<string>;
    try {
      chunk = await reader.read();
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new ChatError("The connection dropped before the answer arrived. Please try again.");
    }
    if (chunk.done) break;
    const parsed = parseSse(buffer + chunk.value);
    buffer = parsed.rest;
    for (const block of parsed.blocks) {
      let payload: unknown;
      try {
        payload = JSON.parse(block.data);
      } catch {
        continue; // a malformed block is skipped rather than ending the whole answer
      }
      if (block.event === "step") handlers.onStep(payload as Step);
      else if (block.event === "result") {
        answered = true;
        handlers.onResult(payload as ChatResponse);
      } else if (block.event === "error") {
        throw new ChatError((payload as { detail?: string }).detail ?? "The assistant ran into a problem. Please try again.");
      }
    }
  }
  if (!answered) throw new ChatError("The assistant stopped before answering. Please try again.");
}
