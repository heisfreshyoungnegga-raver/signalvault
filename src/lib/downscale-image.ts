// Client-side slip-photo downscale, before upload to the vision model.
// Phone photos are routinely 3-12MP / multi-MB: slow to upload on mobile
// data and heavy model input, for zero transcription gain — the model
// reads team names fine at 1600px. Limits are chosen to preserve
// readability, not to squeeze bytes: 1600px longest edge at JPEG 0.85
// keeps small printed text legible (verified: the clean test slip still
// transcribes 8/8 after this downscale); only if the result still tops
// 1MB does it step down to 1200px / 0.75. The SAME downscaled blob is
// re-sent for every scan stage, so transcription and verification judge
// the identical image. Proof screenshots (not SA-review proofs) are
// deliberately NOT downscaled by this module.
export type DownscaledImage = {
  blob: Blob;
  width: number;
  height: number;
  originalBytes: number;
  downscaledBytes: number;
};

const MAX_EDGE = 1600;
const FALLBACK_EDGE = 1200;
const MAX_BYTES = 1024 * 1024;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read the image."));
    img.src = src;
  });
}

async function encode(
  img: HTMLImageElement,
  maxEdge: number,
  quality: number,
): Promise<{ blob: Blob; width: number; height: number }> {
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not prepare the image.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality),
  );
  if (!blob) throw new Error("Could not prepare the image.");
  return { blob, width, height };
}

export async function downscaleSlipImage(file: Blob): Promise<DownscaledImage> {
  const originalBytes = file.size;
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    let out = await encode(img, MAX_EDGE, 0.85);
    if (out.blob.size > MAX_BYTES) {
      out = await encode(img, FALLBACK_EDGE, 0.75);
    }
    return {
      blob: out.blob,
      width: out.width,
      height: out.height,
      originalBytes,
      downscaledBytes: out.blob.size,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
