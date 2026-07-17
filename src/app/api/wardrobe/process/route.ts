import OpenAI from "openai";
import sharp from "sharp";
import { zodTextFormat } from "openai/helpers/zod";
import { WardrobeAnalysisSchema, type WardrobeAnalysis } from "@/domain/schemas";
import { apiError, noStoreJson } from "@/lib/api/responses";
import { takeRateLimit } from "@/lib/api/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;
const MAX_INPUT_BYTES = 4_100_000;

function supportedMagic(bytes: Uint8Array) {
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const webp = String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  const heif = String.fromCharCode(...bytes.slice(4, 12)).includes("ftyp");
  return jpeg || png || webp || heif;
}

function mockAnalysis(): WardrobeAnalysis {
  return WardrobeAnalysisSchema.parse({
    category: "outerwear", subtype: "Soft jacket", primaryColor: "brown", secondaryColors: [], materials: ["Cotton blend"],
    pattern: "solid", fit: "relaxed", warmth: 3, formality: 2, comfort: 4, styleTags: ["relaxed", "clean"],
    occasionTags: ["everyday"], weatherTags: ["mild"], aiConfidence: { category: .96, colors: .94, materials: .61, pattern: .96 },
    internalDescription: "Brown relaxed cotton-blend outerwear", userEditedFields: [],
  });
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const rate = takeRateLimit(request, "wardrobe-process", 20);
  if (!rate.allowed) return apiError(requestId, 429, "RATE_LIMITED", `Try again in ${rate.retryAfterSeconds} seconds.`, true);
  try {
    const form = await request.formData();
    const file = form.get("image");
    if (!(file instanceof File)) return apiError(requestId, 400, "IMAGE_REQUIRED", "Choose one image to continue.");
    if (file.size > MAX_INPUT_BYTES) return apiError(requestId, 413, "IMAGE_TOO_LARGE", "This photo is too large. Take a new photo or choose a smaller one.");
    const input = Buffer.from(await file.arrayBuffer());
    if (!supportedMagic(input.subarray(0, 16))) return apiError(requestId, 415, "UNSUPPORTED_IMAGE", "Use a JPEG, PNG, WebP, or HEIC image.");

    if (process.env.AI_MODE !== "live") {
      const normalized = await sharp(input).rotate().resize(1024, 1024, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 88 }).toBuffer();
      return noStoreJson({ requestId, cutoutDataUrl: `data:image/webp;base64,${normalized.toString("base64")}`, analysis: mockAnalysis() });
    }

    if (!process.env.PHOTOROOM_API_KEY || !process.env.OPENAI_API_KEY) return apiError(requestId, 503, "NOT_CONFIGURED", "Image processing is not configured.", true);
    const providerForm = new FormData();
    providerForm.append("image_file", new Blob([input], { type: file.type }), file.name);
    providerForm.append("format", "webp");
    providerForm.append("channels", "rgba");
    providerForm.append("size", "medium");
    providerForm.append("crop", "true");
    const cutoutResponse = await fetch("https://sdk.photoroom.com/v1/segment", { method: "POST", headers: { "x-api-key": process.env.PHOTOROOM_API_KEY }, body: providerForm, signal: AbortSignal.timeout(30_000) });
    if (!cutoutResponse.ok) return apiError(requestId, 502, "BACKGROUND_REMOVAL_FAILED", "We couldn’t process this item. Please try again.", cutoutResponse.status >= 500);
    const removed = Buffer.from(await cutoutResponse.arrayBuffer());
    const normalized = await sharp(removed).trim().resize(860, 860, { fit: "inside", withoutEnlargement: true }).extend({ top: 82, bottom: 82, left: 82, right: 82, background: { r: 0, g: 0, b: 0, alpha: 0 } }).resize(1024, 1024, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 90, alphaQuality: 100 }).toBuffer();
    const imageUrl = `data:image/webp;base64,${normalized.toString("base64")}`;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const result = await openai.responses.parse({
      model: process.env.OPENAI_ITEM_MODEL ?? "gpt-5.6-terra",
      store: false,
      reasoning: { effort: "none" },
      input: [{ role: "user", content: [
        { type: "input_text", text: "Analyze this single transparent clothing cutout using only visible evidence. Use the supplied schema, controlled colors, specific accessory categories, unknown when uncertain, and no brand guesses." },
        { type: "input_image", image_url: imageUrl, detail: "high" },
      ] }],
      text: { format: zodTextFormat(WardrobeAnalysisSchema, "wardrobe_analysis") },
    });
    const analysis = WardrobeAnalysisSchema.parse(result.output_parsed);
    return noStoreJson({ requestId, cutoutDataUrl: imageUrl, analysis });
  } catch {
    return apiError(requestId, 500, "PROCESSING_FAILED", "We couldn’t process this item. Please try again.", true);
  }
}
