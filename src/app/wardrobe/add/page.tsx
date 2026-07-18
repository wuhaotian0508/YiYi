"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Camera, Check, ChevronLeft, ChevronRight, ImagePlus, RotateCcw } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { z } from "zod";
import { YiYiMark } from "@/components/brand/yiyi-mark";
import { PrimaryButton } from "@/components/ui/buttons";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Garment } from "@/components/wardrobe/garment";
import { ItemImageSetSchema, WardrobeAnalysisSchema, WardrobeItemSchema, type WardrobeAnalysis, type WardrobeItem } from "@/domain/schemas";
import { clothingCategories, colorHex, colorIds, colorLabels, commonMaterials } from "@/domain/taxonomy";
import { db, setExperienceMode } from "@/lib/storage/db";
import { demoWardrobe } from "@/mocks/wardrobe";
import { calmSpring } from "@/lib/motion/tokens";

type Step = "choose" | "processing" | "review" | "error";
type Sheet = "color" | "material" | "category" | null;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 4_000_000;

const ProcessResponseSchema = z.object({
  requestId: z.string().uuid(),
  cutoutDataUrl: z.string().startsWith("data:image/"),
  analysis: WardrobeAnalysisSchema,
}).strict();

const ErrorResponseSchema = z.object({
  error: z.object({ message: z.string(), retryable: z.boolean() }),
}).passthrough();

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => {
    if (blob) { resolve(blob); return; }
    if (type !== "image/png") { canvas.toBlob((fallback) => fallback ? resolve(fallback) : reject(new Error("Image conversion failed")), "image/png"); return; }
    reject(new Error("Image conversion failed"));
  }, type, quality));
}

async function preprocessImage(file: File) {
  if (file.size > MAX_FILE_BYTES) throw new Error("Choose an image smaller than 20 MB.");
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image processing is unavailable.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const normalized = await canvasBlob(canvas, "image/webp", .86);
    if (normalized.size > MAX_UPLOAD_BYTES) return canvasBlob(canvas, "image/webp", .7);
    return normalized;
  } catch (error) {
    if (file.size <= MAX_UPLOAD_BYTES) return file;
    throw error instanceof Error ? error : new Error("This image could not be prepared.");
  }
}

async function dataUrlToBlob(dataUrl: string) {
  const response = await fetch(dataUrl);
  if (!response.ok) throw new Error("Processed image could not be decoded.");
  return response.blob();
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
  return canvasBlob(canvas, "image/webp", .78);
}

export default function AddWardrobePage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("choose");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [sourceBlob, setSourceBlob] = useState<Blob | null>(null);
  const [cutoutBlob, setCutoutBlob] = useState<Blob | null>(null);
  const [analysis, setAnalysis] = useState<WardrobeAnalysis | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => () => {
    controllerRef.current?.abort();
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  async function requestProcessing(image: Blob, filename: string, attempt = 0): Promise<z.infer<typeof ProcessResponseSchema>> {
    const form = new FormData();
    form.append("image", new File([image], filename.replace(/\.[^.]+$/, ".webp"), { type: image.type || "image/webp" }));
    const controller = new AbortController();
    controllerRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch("/api/wardrobe/process", { method: "POST", body: form, cache: "no-store", signal: controller.signal });
      if (!response.ok) {
        if (attempt === 0 && response.status >= 500) return requestProcessing(image, filename, 1);
        const parsedError = ErrorResponseSchema.safeParse(await response.json().catch(() => null));
        throw new Error(parsedError.success ? parsedError.data.error.message : "We couldn’t process this item. Please try again.");
      }
      return ProcessResponseSchema.parse(await response.json());
    } catch (requestError) {
      if (attempt === 0 && requestError instanceof TypeError) return requestProcessing(image, filename, 1);
      throw requestError;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function chooseFile(file?: File) {
    if (!file) return;
    setError("");
    setStep("processing");
    const jobId = crypto.randomUUID();
    await db.processingJobs.put({ id: jobId, status: "processing", createdAt: Date.now() });
    try {
      const normalized = await preprocessImage(file);
      const response = await requestProcessing(normalized, file.name);
      const cutout = await dataUrlToBlob(response.cutoutDataUrl);
      const nextPreview = URL.createObjectURL(cutout);
      if (preview) URL.revokeObjectURL(preview);
      setSourceBlob(normalized);
      setCutoutBlob(cutout);
      setAnalysis(response.analysis);
      setPreview(nextPreview);
      setStep("review");
      await db.processingJobs.update(jobId, { status: "complete" });
    } catch (processingError) {
      setError(processingError instanceof Error ? processingError.message : "We couldn’t process this item. Please try again.");
      setStep("error");
      await db.processingJobs.update(jobId, { status: "failed" });
    }
  }

  async function saveItem() {
    if (!analysis || !cutoutBlob || !sourceBlob || saving) return;
    setSaving(true);
    try {
      const now = Date.now();
      const id = crypto.randomUUID();
      const item = WardrobeItemSchema.parse({
        ...analysis,
        id,
        schemaVersion: 1,
        availability: "available",
        createdAt: now,
        updatedAt: now,
        lastWornAt: null,
      });
      const originalBlob = new Blob([await sourceBlob.arrayBuffer()], { type: sourceBlob.type || "image/webp" });
      const storedCutoutBlob = new Blob([await cutoutBlob.arrayBuffer()], { type: cutoutBlob.type || "image/webp" });
      const generatedThumbnail = await makeThumbnail(storedCutoutBlob);
      const thumbnailBlob = new Blob([await generatedThumbnail.arrayBuffer()], { type: generatedThumbnail.type || "image/webp" });
      const dimensions = await imageDimensions(storedCutoutBlob);
      const images = ItemImageSetSchema.parse({
        itemId: id,
        originalBlob,
        cutoutBlob: storedCutoutBlob,
        thumbnailBlob,
        ...dimensions,
        createdAt: now,
        updatedAt: now,
      });
      await db.transaction("rw", db.wardrobeItems, db.itemImages, async () => {
        await db.wardrobeItems.add(item);
        await db.itemImages.add(images);
      });
      await setExperienceMode("personal");
      router.push("/wardrobe");
    } catch {
      setError("This item could not be saved. Please try again.");
      setStep("error");
      setSaving(false);
    }
  }

  function updateAnalysis(patch: Partial<WardrobeAnalysis>) {
    if (!analysis) return;
    setAnalysis(WardrobeAnalysisSchema.parse({
      ...analysis,
      ...patch,
      userEditedFields: [...new Set([...analysis.userEditedFields, ...Object.keys(patch)])],
    }));
  }

  const reviewItem: WardrobeItem | null = analysis ? WardrobeItemSchema.parse({
    ...analysis, id: "99999999-9999-4999-8999-999999999999", schemaVersion: 1, availability: "available", createdAt: Date.now(), updatedAt: Date.now(), lastWornAt: null,
  }) : null;

  const sheetLabel = sheet === "color" ? "Select colors" : sheet === "material" ? "Select materials" : "Select category";
  return <main className="phone-page"><div className="page-column"><header className="topbar"><Link href="/wardrobe" className="icon-button" aria-label="Back"><ChevronLeft /></Link><div className="topbar-title">{step === "review" ? "Review item" : "Add clothes"}</div><span /></header><AnimatePresence mode="popLayout" initial={false}><motion.div className="add-flow-motion" key={step} initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -5 }} transition={reduceMotion ? { duration: 0.12 } : calmSpring}>{step === "choose" && <Choose onFile={(file) => void chooseFile(file)} />}{step === "processing" && <Processing />}{step === "error" && <ProcessingError message={error} onRetry={() => setStep("choose")} />}{step === "review" && reviewItem && analysis && <Review item={reviewItem} preview={preview} onSheet={setSheet} onSave={() => void saveItem()} saving={saving} />}</motion.div></AnimatePresence><BottomSheet open={Boolean(sheet && analysis)} onClose={() => setSheet(null)} label={sheetLabel}>{analysis && <>{sheet === "color" && <ColorSheet value={analysis.primaryColor} onChange={(primaryColor) => updateAnalysis({ primaryColor })} onDone={() => setSheet(null)} />}{sheet === "material" && <MaterialSheet value={analysis.materials[0] ?? "Unknown"} onChange={(material) => updateAnalysis({ materials: [material] })} onDone={() => setSheet(null)} />}{sheet === "category" && <CategorySheet value={analysis.category} onChange={(category) => updateAnalysis({ category })} onDone={() => setSheet(null)} />}</>}</BottomSheet></div></main>;
}

function Choose({ onFile }: { onFile: (file?: File) => void }) {
  return <section className="add-flow"><div className="center-stage"><div><div className="capture-example"><div style={{ transform: "scale(2)" }}><Garment item={demoWardrobe[0]} /></div></div><h1 className="page-title" style={{ fontSize: 26 }}>One item at a time</h1><p className="secondary-copy">Place one item on a clear background.<br />Keep the full item inside the frame.</p></div></div><div style={{ display: "grid", gap: 10 }}><label className="primary-button" style={{ cursor: "pointer" }}><Camera size={18} />Take Photo<input hidden type="file" accept="image/*" capture="environment" onChange={(event) => onFile(event.target.files?.[0])} /></label><label className="secondary-button" style={{ cursor: "pointer" }}><ImagePlus size={18} />Choose from Library<input hidden type="file" accept="image/*" onChange={(event) => onFile(event.target.files?.[0])} /></label></div></section>;
}

function Processing() {
  return <section className="add-flow"><div className="center-stage"><div style={{ width: "100%" }}><p className="secondary-copy" style={{ marginBottom: 42 }}>Processing 1 of 1</p><div className="processing-stack"><div><VoiceCoreSmall active /><p className="body-copy">Removing background…</p></div><div><VoiceCoreSmall active /><p className="body-copy">Understanding the item…</p></div></div><div className="soft-card" style={{ marginTop: 44, textAlign: "left" }}><div style={{ display: "flex", justifyContent: "space-between" }}><span>1&nbsp;&nbsp; Clothing item</span><span className="secondary-copy">Processing</span></div></div></div></div></section>;
}

function ProcessingError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <section className="add-flow"><div className="center-stage"><div><VoiceCoreSmall /><h1 className="page-title" style={{ fontSize: 25 }}>Something went wrong</h1><p className="secondary-copy" style={{ maxWidth: 300 }}>{message}</p></div></div><PrimaryButton onClick={onRetry}><RotateCcw size={17} />Choose another photo</PrimaryButton></section>;
}

function VoiceCoreSmall({ active = false }: { active?: boolean }) { return <div className={`processing-core ${active ? "active" : ""}`}><YiYiMark size={47} /></div>; }

function Review({ item, preview, onSheet, onSave, saving }: { item: WardrobeItem; preview: string | null; onSheet: (sheet: Sheet) => void; onSave: () => void; saving: boolean }) {
  return <section className="add-flow"><div className="review-preview">{preview ? <Image unoptimized src={preview} alt="Processed clothing item" width={320} height={260} style={{ maxHeight: 260, maxWidth: "90%", objectFit: "contain", filter: "drop-shadow(0 10px 10px rgb(0 0 0 / .12))" }} /> : <div style={{ transform: "scale(2)" }}><Garment item={item} /></div>}</div><h2 className="review-name">{item.subtype}</h2><div><button className="attribute-row" onClick={() => onSheet("category")}><span>Category</span><span>{categoryLabel(item.category)} <ChevronRight size={15} /></span></button><button className="attribute-row" onClick={() => onSheet("color")}><span>Color</span><span style={{ display: "flex", alignItems: "center", gap: 7 }}>{colorLabels[item.primaryColor]} <i style={{ width: 12, height: 12, borderRadius: "50%", background: colorHex[item.primaryColor] }} /><ChevronRight size={15} /></span></button><button className="attribute-row" onClick={() => onSheet("material")}><span>Material</span><span>{item.materials[0]} <ChevronRight size={15} /></span></button></div><p className="ready-copy"><Check size={15} /> Ready to add</p><div style={{ marginTop: "auto" }}><PrimaryButton disabled={saving} onClick={onSave}>{saving ? "Saving…" : "Add to wardrobe"}</PrimaryButton></div></section>;
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
