export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 4_000_000;

export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => {
    if (blob) { resolve(blob); return; }
    if (type !== "image/png") {
      canvas.toBlob((fallback) => fallback ? resolve(fallback) : reject(new Error("Image conversion failed")), "image/png");
      return;
    }
    reject(new Error("Image conversion failed"));
  }, type, quality));
}

function scaledCanvas(source: HTMLCanvasElement, scale: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image processing is unavailable.");
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function encodeCanvasWithinUploadLimit(source: HTMLCanvasElement, maxBytes = MAX_UPLOAD_BYTES) {
  const attempts = [
    { scale: 1, quality: 0.86 },
    { scale: 1, quality: 0.7 },
    { scale: 0.85, quality: 0.7 },
    { scale: 0.7, quality: 0.62 },
    { scale: 0.55, quality: 0.55 },
  ];

  for (const attempt of attempts) {
    const canvas = attempt.scale === 1 ? source : scaledCanvas(source, attempt.scale);
    const blob = await canvasToBlob(canvas, "image/webp", attempt.quality);
    if (blob.size <= maxBytes) return blob;
  }

  throw new Error("This image could not be reduced below 4 MB. Choose a less detailed photo.");
}
