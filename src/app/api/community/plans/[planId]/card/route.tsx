import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { NextResponse } from "next/server";
import { PNG } from "pngjs";
import { GT_TIER_COLORS } from "@/components/flow/tier-colors";
import { getPlanPreviewPng, getPublicPlanRow } from "@/lib/server/plan-preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The card a shared plan link unfurls into: the plan's name and numbers over
 * the plan's own face, drawn server-side from the summary row at Discord's
 * 1200x630. The face is the board photograph the share flow uploaded
 * (plan-previews bucket); posts from before that feature — or shares whose
 * browser could not photograph the board — fall back to the plan's chosen
 * icon LARGE on the icon's own dominant colour, then to any resource the
 * plan makes or needs, so the middle of the card is never empty. The inputs
 * and outputs stay in the embed's text (describePlanRow), not the picture.
 *
 * Rendered with next/og (satori), which lays out with flexbox only and no
 * cascade: every box says display:flex out loud, and text truncates by
 * clipping. The icon is a rendered standalone PNG read straight from
 * public/datasets and upscaled with image-rendering: pixelated, so 32px of
 * pixel art stays sharp at 256.
 */

const PLATE = "#131417";
const FRAME = "#2a2d33";
const TEXT = "#e8e9ec";
const SUBTLE = "#9aa1ab";
const MUTED = "#686f7a";
const BRAND = "#22d3ee";
const ICON_PANEL_FALLBACK = "#1b1e24";

/** Font files read once per server; satori wants raw ArrayBuffers. */
let fontsPromise: Promise<{ regular: ArrayBuffer; bold: ArrayBuffer }> | undefined;

async function loadFonts() {
  fontsPromise ??= (async () => {
    const load = async (file: string) => {
      const buffer = await readFile(path.join(process.cwd(), "src", "app", "fonts", file));
      return buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ) as ArrayBuffer;
    };
    const [regular, bold] = await Promise.all([
      load("Monocraft.ttf"),
      load("Monocraft-Bold.ttf"),
    ]);
    return { regular, bold };
  })();
  return fontsPromise;
}

/**
 * The rendered dataset PNGs pad their art with wide transparent margins
 * (an oil berry occupies 112px of a 256px canvas), so drawn as-is a "large"
 * icon reads as a small one. Crop to the opaque pixels, squared and with a
 * little breathing room, and the art fills the space it is given.
 */
function cropToArt(data: Buffer): Buffer {
  const png = PNG.sync.read(data);
  let minX = png.width;
  let minY = png.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      if (png.data[(y * png.width + x) * 4 + 3]! > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) {
    return data;
  }
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const margin = Math.max(2, Math.round(Math.max(width, height) * 0.08));
  const side = Math.max(width, height) + margin * 2;
  const out = new PNG({ width: side, height: side });
  PNG.bitblt(
    png,
    out,
    minX,
    minY,
    width,
    height,
    Math.floor((side - width) / 2),
    Math.floor((side - height) / 2),
  );
  return PNG.sync.write(out);
}

/**
 * A dataset icon path (`/datasets/<pack>/<version>/textures/rendered/x.png`)
 * as a data URI, read from disk the same way the texture route serves it.
 * Anything that fails to validate, read or decode becomes undefined, never
 * a throw: a card with no icon must still render.
 */
async function loadIconDataUri(iconPath: string | undefined): Promise<string | undefined> {
  if (!iconPath?.startsWith("/datasets/")) {
    return undefined;
  }
  const segments = iconPath.slice(1).split("/");
  const safe = segments.every(
    (segment) => /^[a-zA-Z0-9._-]+$/.test(segment) && segment !== "." && segment !== "..",
  );
  if (!safe || !iconPath.endsWith(".png")) {
    return undefined;
  }
  try {
    const data = await readFile(path.join(process.cwd(), "public", ...segments));
    return `data:image/png;base64,${cropToArt(data).toString("base64")}`;
  } catch {
    return undefined;
  }
}

/**
 * The uploaded board photograph, contain-fit into the card's hero area by
 * hand: satori is not asked to guess an image's intrinsic size. The bounds
 * assume the worst-case two-line title above; a shorter title just gives the
 * photo more air. Dimensions come straight from the PNG's IHDR — width and
 * height live at fixed offsets — so no pixel decode is paid per unfurl.
 */
const PREVIEW_BOX_WIDTH = 1084;
const PREVIEW_BOX_HEIGHT = 330;

function sizePlanPreview(
  png: Buffer,
): { dataUri: string; width: number; height: number } | undefined {
  if (png.length < 24) {
    return undefined;
  }
  const sourceWidth = png.readUInt32BE(16);
  const sourceHeight = png.readUInt32BE(20);
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return undefined;
  }
  const scale = Math.min(
    PREVIEW_BOX_WIDTH / sourceWidth,
    PREVIEW_BOX_HEIGHT / sourceHeight,
  );
  return {
    dataUri: `data:image/png;base64,${png.toString("base64")}`,
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ planId: string }> },
) {
  const { planId } = await params;
  const [row, previewPng] = await Promise.all([
    getPublicPlanRow(planId),
    getPlanPreviewPng(planId),
  ]);
  if (!row) {
    // The site's one generic face, rather than an error a chat would show
    // as a broken embed.
    return NextResponse.redirect(new URL("/opengraph-image.png", request.url), 302);
  }

  const fonts = await loadFonts();
  const tier = row.highest_tier
    ? GT_TIER_COLORS[row.highest_tier as keyof typeof GT_TIER_COLORS]
    : undefined;

  const preview = previewPng ? sizePlanPreview(previewPng) : undefined;

  // Without a photograph: the plan's chosen face, or failing that any
  // resource icon the summary row carries — outputs before needs, items
  // before fluids, because item sprites are real art while a fluid's is
  // often a flat colour chip.
  const face = row.icon?.iconPath ? row.icon : undefined;
  const fallback =
    row.outputs?.find((stat) => stat.kind === "item" && stat.iconPath) ??
    row.outputs?.find((stat) => stat.iconPath) ??
    row.needs?.find((stat) => stat.kind === "item" && stat.iconPath) ??
    row.needs?.find((stat) => stat.iconPath);
  const iconDataUri = preview
    ? undefined
    : ((await loadIconDataUri(face?.iconPath)) ?? (await loadIconDataUri(fallback?.iconPath)));
  const iconBackdrop = (face ?? fallback)?.dominantColor ?? ICON_PANEL_FALLBACK;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: PLATE,
          border: `10px solid ${FRAME}`,
          padding: "40px 48px",
          fontFamily: "Monocraft",
          color: TEXT,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 40,
          }}
        >
          {/* With a photograph below, the name gets one clipped line (its
              full text is the embed's own title); without one there is room
              for two. */}
          <div
            style={{
              display: "flex",
              fontSize: preview ? 46 : 52,
              fontWeight: 700,
              lineHeight: 1.15,
              maxWidth: 780,
              maxHeight: preview ? 54 : 122,
              overflow: "hidden",
            }}
          >
            {row.name}
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              gap: 6,
              paddingTop: 8,
            }}
          >
            <div style={{ display: "flex", fontSize: 28, fontWeight: 700, color: BRAND }}>
              susyplanner.local
            </div>
            {row.game_version ? (
              <div style={{ display: "flex", fontSize: 21, color: MUTED }}>
                SUSY {row.game_version}
              </div>
            ) : null}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            marginTop: 18,
            fontSize: 24,
            color: SUBTLE,
          }}
        >
          <div style={{ display: "flex" }}>{row.machine_count} machines</div>
          <div style={{ display: "flex", color: MUTED }}>·</div>
          <div style={{ display: "flex" }}>{row.node_count} cards</div>
          {tier && row.highest_tier ? (
            <div
              style={{
                display: "flex",
                backgroundColor: tier.background,
                color: tier.text,
                border: `3px solid ${tier.border}`,
                padding: "1px 14px",
                fontSize: 21,
                fontWeight: 700,
              }}
            >
              {row.highest_tier}
            </div>
          ) : null}
          {row.author_name ? (
            <div style={{ display: "flex", color: MUTED }}>by {row.author_name}</div>
          ) : null}
        </div>

        <div
          style={{
            display: "flex",
            flexGrow: 1,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {preview ? (
            <div
              style={{
                display: "flex",
                borderRadius: 10,
                overflow: "hidden",
                border: `3px solid ${FRAME}`,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview.dataUri} width={preview.width} height={preview.height} alt="" />
            </div>
          ) : iconDataUri ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 320,
                height: 320,
                borderRadius: 24,
                backgroundColor: iconBackdrop,
                border: `3px solid ${FRAME}`,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={iconDataUri}
                width={256}
                height={256}
                alt=""
                style={{ imageRendering: "pixelated" }}
              />
            </div>
          ) : null}
        </div>

        <div style={{ display: "flex", marginTop: 24, fontSize: 21, color: MUTED }}>
          Open the link to see the whole board and make it your own.
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: "Monocraft", data: fonts.regular, weight: 400 as const, style: "normal" as const },
        { name: "Monocraft", data: fonts.bold, weight: 700 as const, style: "normal" as const },
      ],
      headers: {
        // Discord and friends cache aggressively anyway; an hour on the CDN
        // keeps a hot link from re-rendering the card per paste.
        "Cache-Control": "public, max-age=300, s-maxage=3600",
      },
    },
  );
}
