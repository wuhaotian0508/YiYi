import { encodeCanvasWithinUploadLimit, MAX_FILE_BYTES } from "@/lib/images/prepare-upload";

export class ClientImagePreparationError extends Error {
  readonly code: "IMAGE_TOO_LARGE" | "IMAGE_DECODE_UNSUPPORTED" | "IMAGE_PREPARATION_UNAVAILABLE";

  constructor(code: ClientImagePreparationError["code"], message: string) {
    super(message);
    this.name = "ClientImagePreparationError";
    this.code = code;
  }
}

type DecodedImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  cleanup(): void;
};

function likelyHeic(file: File) {
  return /image\/(?:heic|heif)/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

async function decodeWithImageElement(file: File): Promise<DecodedImage> {
  const objectUrl = URL.createObjectURL(file);
  const image = new window.Image();
  try {
    image.src = objectUrl;
    if (typeof image.decode === "function") await image.decode();
    else await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Image decode failed"));
    });
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("Image dimensions unavailable");
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, cleanup: () => URL.revokeObjectURL(objectUrl) };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

async function decodeClientImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      if (!bitmap.width || !bitmap.height) { bitmap.close(); throw new Error("Image dimensions unavailable"); }
      return { source: bitmap, width: bitmap.width, height: bitmap.height, cleanup: () => bitmap.close() };
    } catch { /* Safari can decode some Photos formats through <img> but not ImageBitmap. */ }
  }
  return decodeWithImageElement(file);
}

export async function preprocessWardrobeImage(file: File) {
  if (file.size > MAX_FILE_BYTES) throw new ClientImagePreparationError("IMAGE_TOO_LARGE", "Choose an image smaller than 20 MB.");
  let decoded: DecodedImage;
  try {
    decoded = await decodeClientImage(file);
  } catch {
    throw new ClientImagePreparationError(
      "IMAGE_DECODE_UNSUPPORTED",
      likelyHeic(file)
        ? "This iPhone photo could not be converted on this device. In Photos, export or share it as JPEG, then try again."
        : "This photo format could not be opened. Choose a JPEG, PNG, or WebP image.",
    );
  }
  try {
    const scale = Math.min(1, 2048 / Math.max(decoded.width, decoded.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(decoded.width * scale));
    canvas.height = Math.max(1, Math.round(decoded.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new ClientImagePreparationError("IMAGE_PREPARATION_UNAVAILABLE", "Image processing is unavailable on this device.");
    context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
    const output = await encodeCanvasWithinUploadLimit(canvas);
    if (!/^image\/(?:webp|png)$/.test(output.type)) {
      throw new ClientImagePreparationError("IMAGE_PREPARATION_UNAVAILABLE", "This photo could not be converted safely.");
    }
    return output;
  } finally {
    decoded.cleanup();
  }
}
