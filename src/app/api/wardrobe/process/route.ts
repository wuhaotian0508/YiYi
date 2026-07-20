import OpenAI from "openai";
import sharp from "sharp";
import { zodTextFormat } from "openai/helpers/zod";
import { WardrobeAnalysisProviderSchema, WardrobeAnalysisSchema, type WardrobeAnalysis } from "@/domain/schemas";
import { apiError, noStoreJson } from "@/lib/api/responses";
import { providerRoutesAllowed, takeRateLimit } from "@/lib/api/rate-limit";
import { logApiDiagnostic, responseUsage, safeErrorMetadata } from "@/lib/api/diagnostics";
import { openAIClientOptions, providerTimeoutMs } from "@/lib/api/provider-policy";

export const runtime = "nodejs";
export const maxDuration = 60;
const MAX_INPUT_BYTES = 4_100_000;
const MAX_INPUT_PIXELS = 60_000_000;
const MAX_INPUT_DIMENSION = 12_000;

function supportedMagic(bytes: Uint8Array) {
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const webp = String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  const box = String.fromCharCode(...bytes.slice(4, 8));
  const brand = String.fromCharCode(...bytes.slice(8, 12));
  const heif = box === "ftyp" && new Set(["heic", "heix", "hevc", "hevx", "mif1", "msf1"]).has(brand);
  return jpeg || png || webp || heif;
}

async function validImageGeometry(input: Buffer) {
  try {
    const metadata = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "warning" }).metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    const pages = metadata.pages ?? 1;
    return width > 0 && height > 0 && width <= MAX_INPUT_DIMENSION && height <= MAX_INPUT_DIMENSION
      && width * height <= MAX_INPUT_PIXELS && pages === 1;
  } catch {
    return false;
  }
}

function mockAnalysis(): WardrobeAnalysis {
  return WardrobeAnalysisSchema.parse({
    category: "outerwear", subtype: "Soft jacket", primaryColor: "brown", secondaryColors: [], materials: ["Cotton blend"],
    pattern: "solid", fit: "relaxed", warmth: 3, formality: 2, comfort: 4, styleTags: ["relaxed", "clean"],
    occasionTags: ["everyday"], weatherTags: ["mild"], aiConfidence: { category: .96, colors: .94, materials: .61, pattern: .96, fit: .83, style: .74, formality: .78, warmth: .7, comfort: .62 },
    featureProvenance: { category: "terra", colors: "terra", materials: "terra", pattern: "terra", fit: "terra", style: "terra", formality: "terra", warmth: "terra", comfort: "terra" },
    internalDescription: "Brown relaxed cotton-blend outerwear", userEditedFields: [],
  });
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  if (!providerRoutesAllowed()) return apiError(requestId, 503, "PUBLIC_PROTECTION_REQUIRED", "Live processing is not available until production rate protection is configured.", true);
  const rate = await takeRateLimit(request, "wardrobe-process", 20);
  if (!rate.available) return apiError(requestId, 503, "RATE_LIMIT_UNAVAILABLE", "Image processing protection is temporarily unavailable.", true);
  if (!rate.allowed) return apiError(requestId, 429, "RATE_LIMITED", `Try again in ${rate.retryAfterSeconds} seconds.`, true);
  try {
    const form = await request.formData();
    const file = form.get("image");
    if (!(file instanceof File)) return apiError(requestId, 400, "IMAGE_REQUIRED", "Choose one image to continue.");
    if (file.size > MAX_INPUT_BYTES) return apiError(requestId, 413, "IMAGE_TOO_LARGE", "This photo is too large. Take a new photo or choose a smaller one.");
    const input = Buffer.from(await file.arrayBuffer());
    if (!supportedMagic(input.subarray(0, 16))) return apiError(requestId, 415, "UNSUPPORTED_IMAGE", "Use a JPEG, PNG, WebP, or HEIC image.");
    if (!(await validImageGeometry(input))) return apiError(requestId, 415, "INVALID_IMAGE", "Choose a valid single-frame photo.");

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
    const photoroomStartedAt = Date.now();
    let cutoutResponse: Response;
    try {
      cutoutResponse = await fetch("https://sdk.photoroom.com/v1/segment", { method: "POST", headers: { "x-api-key": process.env.PHOTOROOM_API_KEY }, body: providerForm, signal: AbortSignal.timeout(30_000) });
    } catch (error) {
      const metadata = safeErrorMetadata(error);
      logApiDiagnostic({ requestId, route: "/api/wardrobe/process", provider: "photoroom", outcome: "error", ...metadata, durationMs: Date.now() - photoroomStartedAt, errorCode: "BACKGROUND_REMOVAL_FAILED" });
      return apiError(requestId, 502, "BACKGROUND_REMOVAL_FAILED", "We couldn’t process this item. Please try again.", true);
    }
    if (!cutoutResponse.ok) {
      logApiDiagnostic({ requestId, route: "/api/wardrobe/process", provider: "photoroom", outcome: "error", httpStatus: cutoutResponse.status, durationMs: Date.now() - photoroomStartedAt, errorCode: "BACKGROUND_REMOVAL_FAILED", errorType: "ProviderHttpError" });
      return apiError(requestId, 502, "BACKGROUND_REMOVAL_FAILED", "We couldn’t process this item. Please try again.", cutoutResponse.status >= 500);
    }
    let normalized: Buffer;
    try {
      const removed = Buffer.from(await cutoutResponse.arrayBuffer());
      normalized = await sharp(removed).trim().resize(860, 860, { fit: "inside", withoutEnlargement: true }).extend({ top: 82, bottom: 82, left: 82, right: 82, background: { r: 0, g: 0, b: 0, alpha: 0 } }).resize(1024, 1024, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 90, alphaQuality: 100 }).toBuffer();
    } catch (error) {
      const metadata = safeErrorMetadata(error);
      logApiDiagnostic({ requestId, route: "/api/wardrobe/process", provider: "photoroom", outcome: "error", ...metadata, httpStatus: cutoutResponse.status, durationMs: Date.now() - photoroomStartedAt, errorCode: "INVALID_BACKGROUND_REMOVAL_OUTPUT" });
      return apiError(requestId, 502, "INVALID_BACKGROUND_REMOVAL_OUTPUT", "We couldn’t process this item. Please try again.", true);
    }
    logApiDiagnostic({ requestId, route: "/api/wardrobe/process", provider: "photoroom", outcome: "success", httpStatus: cutoutResponse.status, durationMs: Date.now() - photoroomStartedAt });
    const imageUrl = `data:image/webp;base64,${normalized.toString("base64")}`;
    const openai = new OpenAI(openAIClientOptions(process.env.OPENAI_API_KEY));
    const model = process.env.OPENAI_ITEM_MODEL ?? "gpt-5.6-terra";
    const openaiStartedAt = Date.now();
    const result = await openai.responses.parse({
        model,
        store: false,
        reasoning: { effort: "none" },
        input: [{ role: "user", content: [
          { type: "input_text", text: "Analyze this single transparent clothing cutout using only visible evidence. Use the supplied schema, controlled colors, specific accessory categories, unknown when uncertain, and no brand guesses. Return calibrated confidence for category, colors, materials, pattern, fit, style, formality, warmth, and comfort. Mark model-derived feature provenance as terra; user corrections will override it later." },
          { type: "input_image", image_url: imageUrl, detail: "high" },
        ] }],
        text: { format: zodTextFormat(WardrobeAnalysisProviderSchema, "wardrobe_analysis") },
      }, { signal: AbortSignal.timeout(providerTimeoutMs.itemAnalysis) }).catch((error: unknown) => {
      const metadata = safeErrorMetadata(error);
      logApiDiagnostic({ requestId, route: "/api/wardrobe/process", provider: "openai-responses", model, outcome: "error", ...metadata, durationMs: Date.now() - openaiStartedAt, errorCode: "ITEM_ANALYSIS_FAILED" });
      return null;
    });
    if (!result) return apiError(requestId, 502, "ITEM_ANALYSIS_FAILED", "We couldn’t understand this item. Please try again.", true);
    const parsedAnalysis = WardrobeAnalysisSchema.safeParse(result.output_parsed);
    if (!parsedAnalysis.success) {
      logApiDiagnostic({ requestId, route: "/api/wardrobe/process", provider: "openai-responses", model, outcome: "error", httpStatus: 200, durationMs: Date.now() - openaiStartedAt, errorCode: "INVALID_ITEM_ANALYSIS_OUTPUT", errorType: "InvalidProviderOutput", usage: responseUsage(result) });
      return apiError(requestId, 502, "INVALID_ITEM_ANALYSIS_OUTPUT", "We couldn’t understand this item. Please try again.", true);
    }
    const analysis = parsedAnalysis.data;
    logApiDiagnostic({ requestId, route: "/api/wardrobe/process", provider: "openai-responses", model, outcome: "success", httpStatus: 200, durationMs: Date.now() - openaiStartedAt, usage: responseUsage(result) });
    return noStoreJson({ requestId, cutoutDataUrl: imageUrl, analysis });
  } catch (error) {
    const metadata = safeErrorMetadata(error);
    logApiDiagnostic({ requestId, route: "/api/wardrobe/process", provider: "application", outcome: "error", ...metadata, durationMs: 0, errorCode: "PROCESSING_FAILED" });
    return apiError(requestId, 500, "PROCESSING_FAILED", "We couldn’t process this item. Please try again.", true);
  }
}
