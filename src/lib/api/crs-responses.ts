import { z } from "zod";

const ResponseCompletedSchema = z.object({
  type: z.literal("response.completed").optional(),
  response: z.object({
    output_text: z.string().optional(),
    output: z.array(z.object({
      content: z.array(z.object({ text: z.string().optional() }).passthrough()).optional(),
    }).passthrough()).optional(),
    model: z.string().optional(),
    usage: z.object({
      input_tokens: z.number().int().nonnegative().optional(),
      output_tokens: z.number().int().nonnegative().optional(),
      total_tokens: z.number().int().nonnegative().optional(),
    }).optional(),
  }).optional(),
}).passthrough();

const ResponseDeltaSchema = z.object({
  type: z.literal("response.output_text.delta").optional(),
  delta: z.string(),
}).passthrough();

const ResponseTextDoneSchema = z.object({
  type: z.literal("response.output_text.done").optional(),
  text: z.string(),
}).passthrough();

export type ProviderTextUsage = {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  totalTokens: number | undefined;
};

export type ProviderTextResponse = {
  text: string;
  model: string | undefined;
  usage: ProviderTextUsage | undefined;
};

function usageFrom(value: { input_tokens?: number; output_tokens?: number; total_tokens?: number } | undefined): ProviderTextUsage | undefined {
  if (!value) return undefined;
  return {
    inputTokens: value.input_tokens,
    outputTokens: value.output_tokens,
    totalTokens: value.total_tokens,
  };
}

function outputTextFrom(response: z.infer<typeof ResponseCompletedSchema>["response"]) {
  return response?.output
    ?.flatMap((item) => item.content ?? [])
    .map((part) => part.text ?? "")
    .join("");
}

/**
 * CRS requires Responses requests to stream. This consumes only text and
 * usage/model metadata; callers never receive or log provider event bodies.
 */
export async function readCrsResponseText(response: Response): Promise<ProviderTextResponse> {
  if (!response.ok) throw Object.assign(new Error("Language provider failed"), { status: response.status });
  if (response.headers.get("content-type")?.includes("application/json")) {
    const payload: unknown = await response.json();
    const completed = ResponseCompletedSchema.safeParse({ response: payload });
    if (!completed.success) throw new Error("Language provider returned invalid JSON");
    const completedResponse = completed.data.response;
    const text = completedResponse?.output_text ?? outputTextFrom(completedResponse);
    if (!text?.trim()) throw new Error("Language provider returned no text");
    return { text, model: completedResponse?.model, usage: usageFrom(completedResponse?.usage) };
  }
  if (!response.body) throw new Error("Language provider returned no response body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let text = "";
  let completedText: string | undefined;
  let model: string | undefined;
  let usage: ProviderTextUsage | undefined;

  const consume = (block: string) => {
    const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
    if (!data || data === "[DONE]") return;
    let event: unknown;
    try { event = JSON.parse(data); } catch { return; }
    const delta = ResponseDeltaSchema.safeParse(event);
    if (delta.success) {
      text += delta.data.delta;
      return;
    }
    const textDone = ResponseTextDoneSchema.safeParse(event);
    if (textDone.success) {
      // Providers may send both deltas and the complete final text. The final
      // event is authoritative; appending it would duplicate structured JSON.
      completedText = textDone.data.text;
      return;
    }
    const completed = ResponseCompletedSchema.safeParse(event);
    if (!completed.success || !completed.data.response) return;
    completedText = completed.data.response.output_text ?? outputTextFrom(completed.data.response);
    model = completed.data.response.model;
    usage = usageFrom(completed.data.response.usage);
  };

  while (true) {
    const { done, value } = await reader.read();
    pending += decoder.decode(value, { stream: !done });
    const blocks = pending.split(/\r?\n\r?\n/);
    pending = blocks.pop() ?? "";
    blocks.forEach(consume);
    if (done) break;
  }
  if (pending.trim()) consume(pending);
  const result = completedText || text || "";
  if (!result.trim()) throw new Error("Language provider returned no text");
  return { text: result, model, usage };
}

export async function requestCrsResponseText(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  instructions: string;
  text: string;
  signal: AbortSignal;
  stream?: boolean;
}) {
  const url = input.baseUrl.replace(/\/+$/, "") + "/responses";
  const stream = input.stream ?? true;
  const body = stream
    ? {
      model: input.model,
      stream,
      store: false,
      input: [
        { role: "system", content: [{ type: "input_text", text: input.instructions }] },
        { role: "user", content: [{ type: "input_text", text: input.text }] },
      ],
    }
    : {
      model: input.model,
      stream,
      store: false,
      instructions: input.instructions,
      input: input.text,
    };
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + input.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: input.signal,
  });
  return readCrsResponseText(response);
}
