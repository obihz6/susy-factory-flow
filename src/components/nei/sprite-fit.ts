import type { CSSProperties } from "react";

// Cache only measurements, never decoded images or canvas pixels.
const fits = new Map<string, number>();

/** Maximum centered square scale that preserves every nontransparent pixel. */
export function getSpriteFitScale(
  image: HTMLImageElement,
  tile?: { x: number; y: number; width: number; height: number },
): number | undefined {
  const { x = 0, y = 0, width = image.naturalWidth, height = image.naturalHeight } = tile ?? {};
  if (width <= 0 || height <= 0) return undefined;
  const key = `${image.src}:${x}:${y}:${width}:${height}`;
  const cached = fits.get(key);
  if (cached !== undefined) return cached;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return undefined;
    context.drawImage(image, x, y, width, height, 0, 0, width, height);
    const { data } = context.getImageData(0, 0, width, height);
    let extent = 0;
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        if (data[(row * width + col) * 4 + 3] === 0) continue;
        extent = Math.max(
          extent,
          Math.abs(col / width - 0.5) * 2,
          Math.abs((col + 1) / width - 0.5) * 2,
          Math.abs(row / height - 0.5) * 2,
          Math.abs((row + 1) / height - 0.5) * 2,
        );
      }
    }
    const fit = extent > 0 ? 1 / extent : 2;
    if (fits.size >= 1024) fits.delete(fits.keys().next().value!);
    fits.set(key, fit);
    return fit;
  } catch {
    // External artwork may disallow canvas reads. Retain its normal sizing.
    return undefined;
  }
}

/** Keep the requested size unless opaque artwork would cross a 2px margin. */
export function spriteFitStyle(
  fit: number | undefined,
  pixels?: number,
): CSSProperties | undefined {
  if (fit === undefined) return undefined;
  const wanted = pixels ? `${pixels}px` : "calc((200% - 8px) * var(--resource-item-zoom, 1))";
  const size = `min(${wanted}, calc(${fit * 100}% - ${fit * 4}px))`;
  return { width: size, height: size };
}
