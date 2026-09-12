/**
 * The interface size's constants and no-flash boot script. Split from
 * ui-scale.ts, which imports a React hook: Next refuses a hook-importing
 * module in the server layout, and the layout is where the boot script is
 * inlined. See ui-scale.ts for the model.
 */

export const UI_SCALE_STORAGE_KEY = "gtnh-factory-flow.ui-scale.v1";

/** What the setting's 100% renders at, on a desktop-sized window. */
export const UI_SCALE_BASE = 1.17;

/** Phone baseline, also reduced by 10% while the setting stays at 100%. */
export const UI_SCALE_PHONE_BASE = 0.9;

export const UI_SCALE_MIN_PERCENT = 60;
export const UI_SCALE_MAX_PERCENT = 200;
export const UI_SCALE_STEP_PERCENT = 10;
export const DEFAULT_UI_SCALE_PERCENT = 100;

export const UI_SCALE_VAR = "--ui-scale";
export const UI_SCALE_INVERSE_VAR = "--ui-scale-inverse";

/**
 * The 1:1 compact test, for the base decision. Deliberately the raw numbers
 * from viewport-breakpoints.ts rather than an import: the boot script inlines
 * the same query, and it must read the same either way.
 */
export const PHONE_MEDIA_QUERY = "(max-width: 899.98px), (max-height: 559.98px)";

/**
 * The inline script layout.tsx runs before first paint. It repeats
 * `uiScaleFactor` and the viewport attributes from compact-view.ts in plain
 * ES5 because it runs before any module does; the numbers are passed in so
 * there is one place they are written.
 */
export function uiScaleBootScript(viewport: {
  compactMaxWidth: number;
  compactMaxHeight: number;
  snugMaxWidth: number;
}): string {
  const { compactMaxWidth, compactMaxHeight, snugMaxWidth } = viewport;
  return (
    `try{var d=document.documentElement,m=window.matchMedia,p=+localStorage.getItem(${JSON.stringify(
      UI_SCALE_STORAGE_KEY,
    )});` +
    `if(!(p>=${UI_SCALE_MIN_PERCENT}&&p<=${UI_SCALE_MAX_PERCENT}))p=${DEFAULT_UI_SCALE_PERCENT};` +
    `var b=m(${JSON.stringify(PHONE_MEDIA_QUERY)}).matches?${UI_SCALE_PHONE_BASE}:${UI_SCALE_BASE};` +
    `var s=Math.round(p/100*b*1000)/1000;` +
    `d.style.setProperty("${UI_SCALE_VAR}",s);d.style.setProperty("${UI_SCALE_INVERSE_VAR}","calc(1 / "+s+")");` +
    `if(m("(max-width: "+(${compactMaxWidth}*s-0.02)+"px), (max-height: "+(${compactMaxHeight}*s-0.02)+"px)").matches)d.setAttribute("data-compact","");` +
    `if(m("(max-width: "+(${snugMaxWidth}*s-0.02)+"px)").matches)d.setAttribute("data-snug","")}catch(e){}`
  );
}
