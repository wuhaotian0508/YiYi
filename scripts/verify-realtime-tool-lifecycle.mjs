import { OpenAIRealtimeWebSocket, RealtimeAgent, RealtimeSession, tool } from "@openai/agents/realtime";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("OPENAI_API_KEY is required for this opt-in live smoke.");

const startedAt = Date.now();
const timeline = {};
let toolCalls = 0;
const recommendationTool = tool({
  name: "request_outfit_recommendation",
  description: "Required first outfit transaction. Extract only concise semantic fields.",
  parameters: {
    type: "object",
    properties: {
      userRequest: { type: "string", minLength: 1, maxLength: 300 },
      activityPhrases: { type: "array", items: { type: "string", minLength: 1, maxLength: 60 }, maxItems: 8 },
      desiredFeelings: { type: "array", items: { type: "string", minLength: 1, maxLength: 50 }, maxItems: 8 },
      exclusions: { type: "array", items: { type: "string", minLength: 1, maxLength: 60 }, maxItems: 8 },
      wardrobeAnchors: { type: "array", items: { type: "string", minLength: 1, maxLength: 80 }, maxItems: 4 },
    },
    required: ["userRequest", "activityPhrases", "desiredFeelings", "exclusions", "wardrobeAnchors"],
    additionalProperties: false,
  },
  strict: true,
  execute: async () => {
    toolCalls += 1;
    timeline.toolExecutedMs = Date.now() - startedAt;
    return JSON.stringify({ success: true, summary: "Verified live tool dispatch." });
  },
});

const agent = new RealtimeAgent({
  name: "YiYi lifecycle smoke",
  instructions: "For the first user message, call request_outfit_recommendation exactly once. Do not answer before the tool succeeds.",
  tools: [recommendationTool],
});
const transport = new OpenAIRealtimeWebSocket({ useInsecureApiKey: true });
const session = new RealtimeSession(agent, {
  model: process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime-2.1",
  transport,
  tracingDisabled: true,
  historyStoreAudio: false,
  config: {
    outputModalities: ["text"],
    toolChoice: "required",
    parallelToolCalls: false,
    audio: { input: { transcription: { model: process.env.OPENAI_REALTIME_TRANSCRIPTION_MODEL ?? "gpt-4o-mini-transcribe-2025-12-15", language: "en" }, turnDetection: { type: "semantic_vad", eagerness: "auto", createResponse: false, interruptResponse: false } } },
  },
});

const completed = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("LIVE_REALTIME_TOOL_TIMEOUT")), 45_000);
  session.on("agent_tool_start", () => { timeline.toolStartMs = Date.now() - startedAt; });
  session.on("agent_tool_end", () => {
    timeline.toolEndMs = Date.now() - startedAt;
    clearTimeout(timeout);
    resolve(undefined);
  });
  session.on("error", () => {
    clearTimeout(timeout);
    reject(new Error("LIVE_REALTIME_SESSION_ERROR"));
  });
  session.on("transport_event", (event) => {
    if (event.type === "session.updated") timeline.sessionReadyMs = Date.now() - startedAt;
    if (event.type === "response.created") timeline.responseCreatedMs = Date.now() - startedAt;
    if (event.type === "response.output_item.added" && event.item.type === "function_call") timeline.functionCallMs = Date.now() - startedAt;
  });
});

try {
  await session.connect({ apiKey });
  timeline.connectedMs = Date.now() - startedAt;
  transport.sendMessage("I have class and a lot of walking. I want to feel relaxed.", {}, { triggerResponse: false });
  transport.requestResponse({ tool_choice: "required", parallel_tool_calls: false });
  await completed;
  if (toolCalls !== 1) throw new Error(`LIVE_REALTIME_TOOL_COUNT_${toolCalls}`);
  console.info(JSON.stringify({ event: "yiyi_realtime_live_smoke", success: true, toolCalls, timeline }));
} finally {
  session.close();
}
