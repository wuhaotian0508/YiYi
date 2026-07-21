import { OpenAIRealtimeWebSocket, RealtimeAgent, RealtimeSession, tool } from "@openai/agents/realtime";
import { z } from "zod";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("OPENAI_API_KEY is required for this opt-in live smoke.");

const startedAt = Date.now();
const timeline = {};
let toolCalls = 0;
const recommendationTool = tool({
  name: "request_outfit_recommendation",
  description: "Required first outfit transaction. Extract only concise semantic fields.",
  parameters: z.object({
    userRequest: z.string().min(1).max(300),
    activityPhrases: z.array(z.string().min(1).max(60)).max(8),
    desiredFeelings: z.array(z.string().min(1).max(50)).max(8),
    exclusions: z.array(z.string().min(1).max(60)).max(8),
    wardrobeAnchors: z.array(z.string().min(1).max(80)).max(4),
  }).strict(),
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
  model: process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime-2.1-mini",
  transport,
  tracingDisabled: true,
  historyStoreAudio: false,
  config: {
    outputModalities: ["text"],
    toolChoice: "required",
    parallelToolCalls: false,
    audio: { input: { turnDetection: { type: "semantic_vad", eagerness: "auto", createResponse: false, interruptResponse: false } } },
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
  session.sendMessage("I have class and a lot of walking. I want to feel relaxed.");
  await completed;
  if (toolCalls !== 1) throw new Error(`LIVE_REALTIME_TOOL_COUNT_${toolCalls}`);
  console.info(JSON.stringify({ event: "yiyi_realtime_live_smoke", success: true, toolCalls, timeline }));
} finally {
  session.close();
}
