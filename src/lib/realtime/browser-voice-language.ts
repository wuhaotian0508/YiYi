import { z } from "zod";
import { InitialRecommendationVoiceRequestSchema } from "@/domain/recommendation/voice-intent";

const VoiceInterpretResponseSchema = z.object({
  requestId: z.string().uuid(),
  source: z.literal("live"),
  model: z.string().min(1),
  interpretation: z.object({
    activityPhrases: z.array(z.string()),
    desiredFeelings: z.array(z.string()),
    exclusions: z.array(z.string()),
    wardrobeAnchors: z.array(z.string()),
  }).strict(),
}).strict();

export async function interpretBrowserVoiceTranscript(transcript: string) {
  const response = await fetch("/api/voice/interpret", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestId: crypto.randomUUID(), transcript }),
  });
  if (!response.ok) throw new Error("Voice language interpretation failed");
  const payload = VoiceInterpretResponseSchema.parse(await response.json() as unknown);
  return InitialRecommendationVoiceRequestSchema.parse({
    userRequest: transcript,
    ...payload.interpretation,
  });
}
