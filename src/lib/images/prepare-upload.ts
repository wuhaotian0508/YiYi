export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 4_000_000;

export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  const attempts: Array<{ type: string; quality?: number }> = [
    { type, quality },
    ...(type === "image/png" ? [] : [{ type: "image/png" }]),
    ...(type === "image/jpeg" ? [] : [{ type: "image/jpeg", quality: 0.88 }]),
  ];
  return new Promise<Blob>((resolve, reject) => {
    const tryEncode = (index: number) => {
      const attempt = attempts[index];
      if (!attempt) { reject(new Error("Image conversion failed")); return; }
      canvas.toBlob((blob) => {
        if (blob && blob.size > 0 && ["image/webp", "image/png", "image/jpeg"].includes(blob.type)) {
          resolve(blob);
          return;
        }
        tryEncode(index + 1);
      }, attempt.type, attempt.quality);
    };
    tryEncode(0);
  });
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
