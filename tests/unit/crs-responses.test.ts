import { describe, expect, it } from "vitest";
import { readCrsResponseText } from "@/lib/api/crs-responses";

describe("CRS Responses stream parsing", () => {
  it("collects text deltas until the completed event", async () => {
    const response = new Response([
      "event: response.output_text.delta\n",
      "data: {\"type\":\"response.output_text.delta\",\"delta\":\"{\\\"activities\\\":[\\\"Dinner\\\"]\"}\n\n",
      "event: response.output_text.delta\n",
      "data: {\"type\":\"response.output_text.delta\",\"delta\":\",\\\"desiredFeelings\\\":[\\\"polished\\\"]}\"}\n\n",
      "event: response.completed\n",
      "data: {\"type\":\"response.completed\",\"response\":{\"model\":\"gpt-5.5\",\"usage\":{\"input_tokens\":12,\"output_tokens\":8}}}\n\n",
    ].join(""), { headers: { "content-type": "text/event-stream" } });

    await expect(readCrsResponseText(response)).resolves.toEqual({
      text: '{"activities":["Dinner"],"desiredFeelings":["polished"]}',
      model: "gpt-5.5",
      usage: { inputTokens: 12, outputTokens: 8, totalTokens: undefined },
    });
  });

  it("uses the completed response text when the stream has no deltas", async () => {
    const response = new Response([
      "event: response.completed\n",
      "data: {\"type\":\"response.completed\",\"response\":{\"output_text\":\"{\\\"activities\\\":[]}\",\"model\":\"gpt-5.5\"}}\n\n",
    ].join(""), { headers: { "content-type": "text/event-stream" } });

    await expect(readCrsResponseText(response)).resolves.toMatchObject({
      text: '{"activities":[]}',
      model: "gpt-5.5",
    });
  });
});
