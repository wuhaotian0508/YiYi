"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Camera, Check, ChevronLeft, ChevronRight, ImagePlus, RotateCcw } from "lucide-react";
import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";
import { z } from "zod";
import { PrimaryButton } from "@/components/ui/buttons";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Garment } from "@/components/wardrobe/garment";
import { VoiceCore } from "@/components/voice/voice-core";
import { ItemImageSetSchema, WardrobeAnalysisSchema, WardrobeItemSchema, type WardrobeAnalysis, type WardrobeItem } from "@/domain/schemas";
import { clothingCategories, colorHex, colorIds, colorLabels, commonMaterials } from "@/domain/taxonomy";
import { db, getExperienceMode, pruneProcessingJobs, savePersonalWardrobeItem } from "@/lib/storage/db";
import { demoWardrobe } from "@/mocks/wardrobe";
import { calmSpring } from "@/lib/motion/tokens";
import { canvasToBlob } from "@/lib/images/prepare-upload";
import { ClientImagePreparationError, preprocessWardrobeImage } from "@/lib/images/client-preprocess";
import { shouldRetryWardrobeProcessing, WardrobeProcessErrorResponseSchema, WardrobeProcessingError } from "@/lib/wardrobe/process-client";
import { providerSessionHeaders } from "@/lib/api/client-session";

type Step = "choose" | "processing" | "review" | "error";
type Sheet = "color" | "material" | "category" | null;

const ProcessResponseSchema = z.object({
  requestId: z.string().uuid(),
  cutoutDataUrl: z.string().max(1_500_000).regex(/^data:image\/(?:webp|png);base64,[A-Za-z0-9+/]*={0,2}$/),
  analysis: WardrobeAnalysisSchema,
  analysisStatus: z.enum(["complete", "needs-review"]),
  source: z.object({ cutout: z.enum(["mock", "photoroom"]), analysis: z.enum(["mock", "terra", "manual-review"]) }).strict(),
  diagnostics: z.object({ photoroomMs: z.number().nullable(), analysisMs: z.number().nullable(), analysisErrorCode: z.string().nullable() }).strict(),
}).strict();

function dataUrlToBlob(dataUrl: string) {
  const match = /^data:(image\/(?:webp|png));base64,([A-Za-z0-9+/]*={0,2})$/.exec(dataUrl);
  if (!match) throw new Error("Processed image could not be decoded.");
  const binary = window.atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes.buffer as ArrayBuffer], { type: match[1] });
}

function loadBlobImage(blob: Blob) {
  return new Promise<{ image: HTMLImageElement; revoke: () => void }>((resolve, reject) => {
    const source = URL.createObjectURL(blob);
    const image = new window.Image();
    image.onload = () => resolve({ image, revoke: () => URL.revokeObjectURL(source) });
    image.onerror = () => { URL.revokeObjectURL(source); reject(new Error("Processed image could not be opened.")); };
    image.src = source;
  });
}

async function imageDimensions(blob: Blob) {
  const loaded = await loadBlobImage(blob);
  const dimensions = { width: loaded.image.naturalWidth, height: loaded.image.naturalHeight };
  loaded.revoke();
  return dimensions;
}

async function makeThumbnail(blob: Blob) {
  const loaded = await loadBlobImage(blob);
  const scale = Math.min(1, 320 / Math.max(loaded.image.naturalWidth, loaded.image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(loaded.image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(loaded.image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) { loaded.revoke(); throw new Error("Thumbnail generation is unavailable."); }
  context.drawImage(loaded.image, 0, 0, canvas.width, canvas.height);
  loaded.revoke();
  return canvasToBlob(canvas, "image/webp", .78);
}

export default function AddWardrobePage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("choose");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [sourceBlob, setSourceBlob] = useState<Blob | null>(null);
  const [cutoutBlob, setCutoutBlob] = useState<Blob | null>(null);
  const [analysis, setAnalysis] = useState<WardrobeAnalysis | null>(null);
  const [analysisStatus, setAnalysisStatus] = useState<"complete" | "needs-review">("complete");
  const [error, setError] = useState<{ message: string; requestId: string | null; code: string | null; retryable: boolean }>({ message: "", requestId: null, code: null, retryable: false });
  const [saving, setSaving] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const savePromiseRef = useRef<Promise<void> | null>(null);
  const saveItemIdRef = useRef<string | null>(null);
  const reduceMotion = useReducedMotionConfig();

  useEffect(() => () => {
    controllerRef.current?.abort();
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  useEffect(() => { void pruneProcessingJobs(); }, []);

  async function requestProcessing(image: Blob, filename: string, attempt = 0): Promise<z.infer<typeof ProcessResponseSchema>> {
    const form = new FormData();
    form.append("image", new File([image], filename.replace(/\.[^.]+$/, ".webp"), { type: image.type || "image/webp" }));
    const controller = new AbortController();
    controllerRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 62_000);
    try {
      const response = await fetch("/api/wardrobe/process", { method: "POST", headers: providerSessionHeaders(), body: form, cache: "no-store", signal: controller.signal });
      if (!response.ok) {
        const parsedError = WardrobeProcessErrorResponseSchema.safeParse(await response.json().catch(() => null));
        if (!parsedError.success) throw new WardrobeProcessingError("We couldn’t process this item. Please try again.", null, "INVALID_ERROR_RESPONSE", false, response.status);
        const failure = parsedError.data;
        if (attempt === 0 && shouldRetryWardrobeProcessing(response.status, failure.error.code, failure.error.retryable)) return requestProcessing(image, filename, 1);
        throw new WardrobeProcessingError(failure.error.message, failure.requestId, failure.error.code, failure.error.retryable, response.status);
      }
      return ProcessResponseSchema.parse(await response.json());
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === "AbortError") throw new WardrobeProcessingError("Processing took too long. Please try again.", null, "CLIENT_TIMEOUT", true, null);
      throw requestError;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function chooseFile(file?: File) {
    if (!file) return;
    saveItemIdRef.current = null;
    setError({ message: "", requestId: null, code: null, retryable: false });
    setStep("processing");
    const jobId = crypto.randomUUID();
    await db.processingJobs.put({ id: jobId, status: "processing", createdAt: Date.now() });
    try {
      const normalized = await preprocessWardrobeImage(file);
      const response = await requestProcessing(normalized, file.name);
      const cutout = dataUrlToBlob(response.cutoutDataUrl);
      const nextPreview = URL.createObjectURL(cutout);
      if (preview) URL.revokeObjectURL(preview);
      setSourceBlob(normalized);
      setCutoutBlob(cutout);
      setAnalysis(response.analysis);
      setAnalysisStatus(response.analysisStatus);
      setPreview(nextPreview);
      setStep("review");
      await db.processingJobs.update(jobId, { status: "complete" });
    } catch (processingError) {
      setError(processingError instanceof WardrobeProcessingError
        ? { message: processingError.message, requestId: processingError.requestId, code: processingError.code, retryable: processingError.retryable }
        : processingError instanceof ClientImagePreparationError
          ? { message: processingError.message, requestId: null, code: processingError.code, retryable: false }
          : { message: processingError instanceof Error ? processingError.message : "We couldn’t process this item. Please try again.", requestId: null, code: "CLIENT_PROCESSING_FAILED", retryable: false });
      setStep("error");
      await db.processingJobs.update(jobId, { status: "failed" });
    }
  }

  function saveItem() {
    if (savePromiseRef.current) return savePromiseRef.current;
    const operation = saveItemOnce();
    savePromiseRef.current = operation;
    void operation.finally(() => { if (savePromiseRef.current === operation) savePromiseRef.current = null; });
    return operation;
  }

  async function saveItemOnce() {
    if (!analysis || !cutoutBlob || !sourceBlob || (analysisStatus === "needs-review" && !["category", "colors", "materials"].every((field) => analysis.userEditedFields.includes(field)))) return;
    setSaving(true);
    const requestId = crypto.randomUUID();
    let stage = "schema";
    try {
      const now = Date.now();
      const id = saveItemIdRef.current ?? crypto.randomUUID();
      saveItemIdRef.current = id;
      recordLocalSave(requestId, stage, "started");
      const item = WardrobeItemSchema.parse({
        ...analysis,
        id,
        schemaVersion: 1,
        dataProvenance: "personal",
        availability: "available",
        createdAt: now,
        updatedAt: now,
        lastWornAt: null,
      });
      recordLocalSave(requestId, stage, "success");
      stage = "blob-copy";
      recordLocalSave(requestId, stage, "started");
      const originalBlob = new Blob([await sourceBlob.arrayBuffer()], { type: sourceBlob.type || "image/webp" });
      const storedCutoutBlob = new Blob([await cutoutBlob.arrayBuffer()], { type: cutoutBlob.type || "image/webp" });
      recordLocalSave(requestId, stage, "success");
      stage = "thumbnail";
      recordLocalSave(requestId, stage, "started");
      const generatedThumbnail = await makeThumbnail(storedCutoutBlob);
      const thumbnailBlob = new Blob([await generatedThumbnail.arrayBuffer()], { type: generatedThumbnail.type || "image/webp" });
      recordLocalSave(requestId, stage, "success", { outputMime: thumbnailBlob.type });
      stage = "dimensions";
      const dimensions = await imageDimensions(storedCutoutBlob);
      stage = "image-schema";
      const images = ItemImageSetSchema.parse({
        itemId: id,
        originalBlob,
        cutoutBlob: storedCutoutBlob,
        thumbnailBlob,
        ...dimensions,
        createdAt: now,
        updatedAt: now,
      });
      stage = "indexeddb-transaction";
      recordLocalSave(requestId, stage, "started");
      const result = await savePersonalWardrobeItem(item, images);
      recordLocalSave(requestId, stage, "success", { alreadySaved: result.alreadySaved });
      router.push("/wardrobe");
    } catch (saveError) {
      const id = saveItemIdRef.current;
      const [storedItem, storedImages, mode] = id
        ? await Promise.all([db.wardrobeItems.get(id).catch(() => undefined), db.itemImages.get(id).catch(() => undefined), getExperienceMode().catch(() => null)])
        : [undefined, undefined, null];
      if (storedItem && storedImages && mode === "personal") {
        recordLocalSave(requestId, "post-failure-check", "success", { recoveredCommittedRecord: true });
        router.push("/wardrobe");
        return;
      }
      const classified = classifyLocalSaveError(saveError, Boolean(storedItem) !== Boolean(storedImages));
      recordLocalSave(requestId, stage, "error", { errorCode: classified.code, errorType: saveError instanceof Error ? saveError.name : typeof saveError });
      setError({ message: classified.message, requestId, code: classified.code, retryable: classified.retryable });
      setStep("error");
      setSaving(false);
    }
  }

  function updateAnalysis(patch: Partial<WardrobeAnalysis>) {
    if (!analysis) return;
    const provenanceKey: Partial<Record<keyof WardrobeAnalysis, string>> = {
      category: "category",
      primaryColor: "colors",
      secondaryColors: "colors",
      materials: "materials",
      pattern: "pattern",
      fit: "fit",
      styleTags: "style",
      formality: "formality",
      warmth: "warmth",
      comfort: "comfort",
    };
    const editedFeatures = [...new Set(Object.keys(patch).map((key) => provenanceKey[key as keyof WardrobeAnalysis]).filter((key): key is string => Boolean(key)))];
    setAnalysis(WardrobeAnalysisSchema.parse({
      ...analysis,
      ...patch,
      featureProvenance: { ...analysis.featureProvenance, ...Object.fromEntries(editedFeatures.map((key) => [key, "user"])) },
      userEditedFields: [...new Set([...analysis.userEditedFields, ...editedFeatures])],
    }));
  }

  const reviewItem: WardrobeItem | null = analysis ? WardrobeItemSchema.parse({
    ...analysis, id: "99999999-9999-4999-8999-999999999999", schemaVersion: 1, availability: "available", createdAt: Date.now(), updatedAt: Date.now(), lastWornAt: null,
  }) : null;

  const sheetLabel = sheet === "color" ? "Select colors" : sheet === "material" ? "Select materials" : "Select category";
  const reviewReady = analysisStatus === "complete" || ["category", "colors", "materials"].every((field) => analysis?.userEditedFields.includes(field));
  return <main className="phone-page"><div className="page-column"><header className="topbar"><Link href="/wardrobe" className="icon-button" aria-label="Back"><ChevronLeft /></Link><div className="topbar-title">{step === "review" ? "Review item" : "Add clothes"}</div><span /></header><AnimatePresence mode="popLayout" initial={false}><motion.div className="add-flow-motion" key={step} initial={reduceMotion ? { opacity: 0 } : { opacity: 0, transform: "translateY(7px)" }} animate={{ opacity: 1, transform: "translateY(0)" }} exit={reduceMotion ? { opacity: 0 } : { opacity: 0, transform: "translateY(-4px)" }} transition={reduceMotion ? { duration: 0.12 } : calmSpring}>{step === "choose" && <Choose onFile={(file) => void chooseFile(file)} />}{step === "processing" && <Processing />}{step === "error" && <ProcessingError error={error} onRetry={() => setStep("choose")} />}{step === "review" && reviewItem && analysis && <Review item={reviewItem} preview={preview} onSheet={setSheet} onSave={() => void saveItem()} saving={saving} needsReview={analysisStatus === "needs-review"} reviewReady={reviewReady} />}</motion.div></AnimatePresence><BottomSheet open={Boolean(sheet && analysis)} onClose={() => setSheet(null)} label={sheetLabel}>{analysis && <>{sheet === "color" && <ColorSheet value={analysis.primaryColor} onChange={(primaryColor) => updateAnalysis({ primaryColor })} onDone={() => setSheet(null)} />}{sheet === "material" && <MaterialSheet value={analysis.materials[0] ?? "Unknown"} onChange={(material) => updateAnalysis({ materials: [material] })} onDone={() => setSheet(null)} />}{sheet === "category" && <CategorySheet value={analysis.category} onChange={(category) => updateAnalysis({ category })} onDone={() => setSheet(null)} />}</>}</BottomSheet></div></main>;
}

function classifyLocalSaveError(error: unknown, partialRecord: boolean) {
  if (partialRecord) return { code: "LOCAL_SAVE_PARTIAL_RECORD", message: "The item was not fully saved. Try again after reopening YiYi.", retryable: true };
  if (error instanceof DOMException && ["QuotaExceededError", "NS_ERROR_DOM_QUOTA_REACHED"].includes(error.name)) {
    return { code: "LOCAL_STORAGE_QUOTA_EXCEEDED", message: "This device does not have enough browser storage for the item.", retryable: false };
  }
  const message = error instanceof Error ? error.message : "";
  if (/thumbnail|image conversion/i.test(message)) return { code: "THUMBNAIL_GENERATION_FAILED", message: "YiYi could not prepare a saved preview for this image.", retryable: true };
  if (/schema|validation/i.test(message)) return { code: "LOCAL_ITEM_VALIDATION_FAILED", message: "One or more item details are invalid. Review them and try again.", retryable: true };
  return { code: "LOCAL_SAVE_FAILED", message: "This item could not be saved. Please try again.", retryable: true };
}

function recordLocalSave(requestId: string, stage: string, outcome: "started" | "success" | "error", extra: Record<string, unknown> = {}) {
  const payload = { event: "yiyi_wardrobe_local_save", requestId, stage, outcome, ...extra };
  if (outcome === "error") console.error(JSON.stringify(payload));
  else if (process.env.NODE_ENV !== "test") console.info(JSON.stringify(payload));
}

function Choose({ onFile }: { onFile: (file?: File) => void }) {
  return <section className="add-flow"><div className="center-stage"><div><div className="capture-example"><div style={{ transform: "scale(2)" }}><Garment item={demoWardrobe[0]} /></div></div><h1 className="page-title" style={{ fontSize: 26 }}>One item at a time</h1><p className="secondary-copy">Place one item on a clear background.<br />Keep the full item inside the frame.</p></div></div><div style={{ display: "grid", gap: 10 }}><label className="primary-button" style={{ cursor: "pointer" }}><Camera size={18} />Take Photo<input hidden type="file" accept="image/*" capture="environment" onChange={(event) => onFile(event.target.files?.[0])} /></label><label className="secondary-button" style={{ cursor: "pointer" }}><ImagePlus size={18} />Choose from Library<input hidden type="file" accept="image/*" onChange={(event) => onFile(event.target.files?.[0])} /></label></div></section>;
}

function Processing() {
  return <section className="add-flow"><div className="center-stage"><div className="processing-narrative"><p className="secondary-copy">Processing 1 of 1</p><div className="processing-focus"><VoiceCore state="thinking" label="YiYi is preparing this item" /><div><p className="body-copy">Preparing your item…</p><span>Removing the background and reading editable details</span></div></div><div className="processing-steps"><span className="active">Cutout</span><i /><span className="active">Details</span></div></div></div></section>;
}

function ProcessingError({ error, onRetry }: { error: { message: string; requestId: string | null; code: string | null; retryable: boolean }; onRetry: () => void }) {
  return <section className="add-flow"><div className="center-stage"><div><VoiceCore state="error" label="Item processing failed" disabled /><h1 className="page-title" style={{ fontSize: 25 }}>Something went wrong</h1><p className="secondary-copy" style={{ maxWidth: 300 }}>{error.message}</p>{error.code && <p className="secondary-copy">Error: {error.code}{error.requestId ? ` · Diagnostic ID: ${error.requestId}` : ""}</p>}</div></div><PrimaryButton onClick={onRetry}><RotateCcw size={17} />{error.retryable ? "Try another photo" : "Choose another photo"}</PrimaryButton></section>;
}

function Review({ item, preview, onSheet, onSave, saving, needsReview, reviewReady }: { item: WardrobeItem; preview: string | null; onSheet: (sheet: Sheet) => void; onSave: () => void; saving: boolean; needsReview: boolean; reviewReady: boolean }) {
  const rows = [
    <button key="category" className="attribute-row" onClick={() => onSheet("category")}><span>Category</span><span>{categoryLabel(item.category)} <ChevronRight size={15} /></span></button>,
    <button key="color" className="attribute-row" onClick={() => onSheet("color")}><span>Color</span><span style={{ display: "flex", alignItems: "center", gap: 7 }}>{colorLabels[item.primaryColor]} <i style={{ width: 12, height: 12, borderRadius: "50%", background: colorHex[item.primaryColor] }} /><ChevronRight size={15} /></span></button>,
    <button key="material" className="attribute-row" onClick={() => onSheet("material")}><span>Material</span><span>{item.materials[0]} <ChevronRight size={15} /></span></button>,
  ];
  return <section className="add-flow"><div className="review-preview">{preview ? <Image unoptimized fill sizes="(max-width: 430px) 90vw, 390px" src={preview} alt="Processed clothing item" style={{ objectFit: "contain", padding: "12px 5%", filter: "drop-shadow(0 10px 10px rgb(0 0 0 / .12))" }} /> : <div style={{ transform: "scale(2)" }}><Garment item={item} /></div>}</div><h2 className="review-name">{item.subtype}</h2>{needsReview && <p className="secondary-copy" role="status">YiYi saved the cutout, but details need your review. Choose category, color, and material.</p>}<div>{rows.map((row, index) => <div key={index}>{row}</div>)}</div><p className="ready-copy"><Check size={15} />{reviewReady ? "Ready to add" : "Review three details to continue"}</p><div style={{ marginTop: "auto" }}><PrimaryButton disabled={saving || !reviewReady} onClick={onSave}>{saving ? "Saving…" : "Add to wardrobe"}</PrimaryButton></div></section>;
}

function categoryLabel(value: WardrobeItem["category"]) { return value.replaceAll("_", " ").replace(/(^|\s)\S/g, (letter) => letter.toUpperCase()); }
function SheetTitle({ children }: { children: React.ReactNode }) { return <h2 style={{ fontSize: 15, textAlign: "center", margin: "4px 0 18px" }}>{children}</h2>; }

function ColorSheet({ value, onChange, onDone }: { value: (typeof colorIds)[number]; onChange: (value: (typeof colorIds)[number]) => void; onDone: () => void }) {
  return <><SheetTitle>Select colors</SheetTitle><p className="secondary-copy" style={{ textAlign: "center" }}>Choose one primary color.</p><div className="color-grid">{colorIds.map((color) => <button key={color} onClick={() => onChange(color)} aria-label={colorLabels[color]}><span style={{ background: colorHex[color], border: color === "white" ? "1px solid #ccc" : 0 }}>{value === color && <Check size={17} color={color === "white" || color === "yellow" ? "#111" : "#fff"} />}</span>{colorLabels[color]}</button>)}</div><PrimaryButton onClick={onDone}>Done</PrimaryButton></>;
}

function MaterialSheet({ value, onChange, onDone }: { value: string; onChange: (value: string) => void; onDone: () => void }) {
  return <><SheetTitle>Select materials</SheetTitle><p className="secondary-copy">Suggested</p><div className="chip-row" style={{ justifyContent: "flex-start" }}>{["Cotton", "Knit"].map((material) => <button className="chip" key={material} onClick={() => onChange(material)}>{material}</button>)}</div><p className="secondary-copy">All materials</p><div style={{ maxHeight: 220, overflow: "auto" }}>{commonMaterials.map((name) => <button className="attribute-row" key={name} onClick={() => onChange(name)}><span>{name}</span>{value === name && <Check size={17} />}</button>)}</div><PrimaryButton onClick={onDone} style={{ marginTop: 14 }}>Done</PrimaryButton></>;
}

function CategorySheet({ value, onChange, onDone }: { value: WardrobeItem["category"]; onChange: (value: WardrobeItem["category"]) => void; onDone: () => void }) {
  return <><SheetTitle>Select category</SheetTitle><div className="category-list">{clothingCategories.map((category) => <button className="attribute-row" key={category} onClick={() => onChange(category)}><span>{categoryLabel(category)}</span>{value === category ? <Check size={17} /> : null}</button>)}</div><PrimaryButton onClick={onDone} style={{ marginTop: 18 }}>Done</PrimaryButton></>;
}
