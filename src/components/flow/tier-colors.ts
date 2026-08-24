import type { MachineTier } from "@/lib/model/types";

type VoltageTier = Exclude<MachineTier, "DEMO">;

/**
 * The game's own tier colours, transcribed from GTValues.TIER_COLORS (each an
 * EnumChatFormatting code): ULV red, LV dark green, MV gold, HV yellow, EV
 * dark gray, IV blue, LuV light purple, ZPM aqua - then the underlined ranks,
 * which REUSE earlier colours and are told apart by the underline exactly as
 * the game does (UV is LV's green underlined, UMV is ULV's red, UXV is UHV's
 * dark red). Borders and shadows are the colour at 55%, text flips black on
 * the light backgrounds.
 */
export const GT_TIER_COLORS: Record<
  VoltageTier,
  { background: string; border: string; text: string; shadow: string; underline?: boolean }
> = {
  ULV: { background: "#FF5555", border: "#8C2F2F", text: "#ffffff", shadow: "#8C2F2F" },
  LV: { background: "#00AA00", border: "#005E00", text: "#ffffff", shadow: "#005E00" },
  MV: { background: "#FFAA00", border: "#8C5E00", text: "#111111", shadow: "#8C5E00" },
  HV: { background: "#FFFF55", border: "#8C8C2F", text: "#111111", shadow: "#8C8C2F" },
  EV: { background: "#555555", border: "#2F2F2F", text: "#ffffff", shadow: "#2F2F2F" },
  IV: { background: "#5555FF", border: "#2F2F8C", text: "#ffffff", shadow: "#2F2F8C" },
  LuV: { background: "#FF55FF", border: "#8C2F8C", text: "#ffffff", shadow: "#8C2F8C" },
  ZPM: { background: "#55FFFF", border: "#2F8C8C", text: "#111111", shadow: "#2F8C8C" },
  UV: { background: "#00AA00", border: "#005E00", text: "#ffffff", shadow: "#005E00", underline: true },
  UHV: { background: "#AA0000", border: "#5E0000", text: "#ffffff", shadow: "#5E0000", underline: true },
  UEV: { background: "#AA00AA", border: "#5E005E", text: "#ffffff", shadow: "#5E005E", underline: true },
  UIV: { background: "#0000AA", border: "#00005E", text: "#ffffff", shadow: "#00005E", underline: true },
  UMV: { background: "#FF5555", border: "#8C2F2F", text: "#ffffff", shadow: "#8C2F2F", underline: true },
  UXV: { background: "#AA0000", border: "#5E0000", text: "#ffffff", shadow: "#5E0000", underline: true },
  MAX: { background: "#FFFFFF", border: "#8C8C8C", text: "#111111", shadow: "#8C8C8C", underline: true },
};
