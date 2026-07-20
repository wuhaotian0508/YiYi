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
const MAX_BACKGROUND_REMOVAL_BYTES = 5_000_000;
const MAX_BACKGROUND_REMOVAL_PIXELS = 2_000_000;
const MAX_BACKGROUND_REMOVAL_DIMENSION = 4_096;
const MAX_NORMALIZED_OUTPUT_BYTES = 1_100_000;

type DetectedImage = { format: "jpeg" | "png" | "webp" | "heif"; mime: "image/jpeg" | "image/png" | "image/webp" | "image/heic" };

function detectedImage(bytes: Uint8Array): DetectedImage | null {
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const webp = String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  const box = String.fromCharCode(...bytes.slice(4, 8));
  const brand = String.fromCharCode(...bytes.slice(8, 12));
  const heif = box === "ftyp" && new Set(["heic", "heix", "hevc", "hevx", "mif1", "msf1"]).has(brand);
  if (jpeg) return { format: "jpeg", mime: "image/jpeg" };
  if (png) return { format: "png", mime: "image/png" };
  if (webp) return { format: "webp", mime: "image/webp" };
  if (heif) return { format: "heif", mime: "image/heic" };
  return null;
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

async function readResponseBodyWithinLimit(response: Response, maximumBytes: number) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) throw new Error("provider output too large");
  if (!response.body) throw new Error("provider output missing");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error("provider output too large");
    }
    chunks.push(value);
  }
  if (total === 0) throw new Error("provider output empty");
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

async function validateBackgroundRemovalOutput(input: Buffer) {
  const metadata = await sharp(input, { limitInputPixels: MAX_BACKGROUND_REMOVAL_PIXELS, failOn: "warning" }).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (metadata.format !== "webp" || (metadata.pages ?? 1) !== 1 || width <= 0 || height <= 0
    || width > MAX_BACKGROUND_REMOVAL_DIMENSION || height > MAX_BACKGROUND_REMOVAL_DIMENSION
    || width * height > MAX_BACKGROUND_REMOVAL_PIXELS) throw new Error("invalid provider image metadata");
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
  const requestContentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!/^multipart\/form-data(?:;|$)/.test(requestContentType)) return apiError(requestId, 415, "UNSUPPORTED_MEDIA_TYPE", "Send one image as multipart form data.");
  try {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return apiError(requestId, 400, "INVALID_MULTIPART", "The multipart form data was invalid.");
    }
    const file = form.get("image");
    if (!(file instanceof File)) return apiError(requestId, 400, "IMAGE_REQUIRED", "Choose one image to continue.");
    if (file.size > MAX_INPUT_BYTES) return apiError(requestId, 413, "IMAGE_TOO_LARGE", "This photo is too large. Take a new photo or choose a smaller one.");
    const input = Buffer.from(await file.arrayBuffer());
    const detected = detectedImage(input.subarray(0, 16));
    if (!detected) return apiError(requestId, 415, "UNSUPPORTED_IMAGE", "Use a JPEG, PNG, WebP, or HEIC image.");
    if (!(await validImageGeometry(input))) return apiError(requestId, 415, "INVALID_IMAGE", "Choose a valid single-frame photo.");

    if (process.env.AI_MODE !== "live") {
      const normalized = await sharp(input).rotate().resize(1024, 1024, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 88 }).toBuffer();
      return noStoreJson({ requestId, cutoutDataUrl: `data:image/webp;base64,${normalized.toString("base64")}`, analysis: mockAnalysis() });
    }

    if (!process.env.PHOTOROOM_API_KEY || !process.env.OPENAI_API_KEY) return apiError(requestId, 503, "NOT_CONFIGURED", "Image processing is not configured.", true);
    const providerForm = new FormData();
    providerForm.append("image_file", new Blob([input], { type: detected.mime }), file.name);
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
      const providerContentType = cutoutResponse.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
      if (providerContentType !== "image/webp") throw new Error("unexpected provider content type");
      const removed = await readResponseBodyWithinLimit(cutoutResponse, MAX_BACKGROUND_REMOVAL_BYTES);
      await validateBackgroundRemovalOutput(removed);
      const fitted = await sharp(removed, { limitInputPixels: MAX_BACKGROUND_REMOVAL_PIXELS, failOn: "warning" }).trim().resize(860, 860, { fit: "inside", withoutEnlargement: true }).toBuffer();
      normalized = await sharp(fitted, { limitInputPixels: MAX_BACKGROUND_REMOVAL_PIXELS, failOn: "warning" }).resize(1024, 1024, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 90, alphaQuality: 100 }).toBuffer();
      if (normalized.byteLength > MAX_NORMALIZED_OUTPUT_BYTES) throw new Error("normalized output too large");
      const normalizedMetadata = await sharp(normalized, { limitInputPixels: 1_100_000, failOn: "warning" }).metadata();
      if (normalizedMetadata.format !== "webp" || normalizedMetadata.width !== 1024 || normalizedMetadata.height !== 1024 || (normalizedMetadata.pages ?? 1) !== 1) throw new Error("invalid normalized output");
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
