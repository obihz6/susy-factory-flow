# Icon sizing investigation and regression

The Firefox/Chrome discrepancy was reproduced on Windows on 2026-09-11,
using Chromium 153.0.8010.12 and Firefox 155.0 with identical sprite art,
viewport, device scale, CSS zoom, and camera transform.

## Cause

`ResourceIcon` centers artwork inside a clipped flex container. Sprite art
deliberately exceeds the container to remove the dataset's transparent margin:
the default width and height are `calc(200% - 8px)`. The artwork retained the
default `flex-shrink: 1`.

Chromium's automatic minimum size kept a standalone `<img>` square. Firefox
allowed its width to shrink to the slot while retaining its oversized height.
`object-fit: contain` then fitted the square artwork to the narrower width,
making the visible icon smaller. Atlas `<span>` elements shrank horizontally
in both browsers; background sizing stretched the art instead of preserving
its aspect ratio.

Measured untransformed artwork boxes (CSS pixels):

| Slot | Before: Chrome image | Before: Firefox image | Before: atlas, both | After: all |
| --- | --- | --- | --- | --- |
| 22 | 36 × 36 | 22 × 36 | 22 × 36 | 36 × 36 |
| 36 | 64 × 64 | 36 × 64 | 36 × 64 | 64 × 64 |
| 48 | 88 × 88 | 48 × 88 | 48 × 88 | 88 × 88 |

The fix explicitly disables shrinking on artwork, including the independent
hatch image path and the NEI aspect glyph. It preserves the intended sprite
dimensions and cropping rather than adding browser-specific size multipliers.
It does not override users' browser zoom or saved interface-size preferences.

Related specification and browser implementation context:
- [Flexbox automatic minimum size](https://www.w3.org/TR/css-flexbox-1/#min-size-auto)
- [Mozilla's percentage-sized replaced flex item investigation](https://bugzilla.mozilla.org/show_bug.cgi?id=2064812)

## Run

```sh
npm ci
node node_modules/playwright-core/cli.js install --with-deps --only-shell chromium firefox
npm run test:icons:browsers
```

The script starts and closes its own isolated Vite server. It imports the real
icon components and compiles their actual Tailwind utilities; no dev app,
dataset, account, browser profile, or temporary application route is needed.
Fixtures include the usual centered sprite, wider artwork, and actual Oil Berry,
Alumina Dust, Sand and Water captures from the dataset.

The check asserts expected slot sizes, artwork width AND height, and agreement
between engines to within 0.16 screen CSS pixels (fractional layout rounding).
It covers 4,356 cases per engine: standalone and atlas sprites, fluid sprites,
fluid swatches, aspect masks, hatch art, five slot sizes (including the left
panel and input/output rows), automatic and explicit pixel sizing, original and
magnified item artwork, three interface scales, three camera zooms, and DPR 1
and 2. Item bounds must stay inside a 2px margin. Items and fluids share the same
drop shadow; fluid corners are rounded by 1px. Pixel checks confirm the shadow
actually paints below standalone and atlas fluid textures and colour swatches.
It also verifies that the application's `!h-*` / `!w-*` overrides actually size
the slot, independently of the artwork fix.

Measurements and screenshots go to `.icon-sizing-results.local/` (ignored),
or `ICON_TEST_OUTPUT`. `PLAYWRIGHT_BROWSERS_PATH` can select a local engine cache.
The CI icon job runs this separately from typecheck and Vitest, since jsdom
does not implement layout and cannot detect this regression.

## Whole-item zoom

`itemZoom` replaces transforms on the outer icon slot. It magnifies artwork
without enlarging the clipping box. `sprite-fit.ts` reads and caches each image's
opaque extent (or its atlas tile), then caps the requested size only when art
would cross the slot margin. Small piles retain their preferred zoom; wide or
off-center items shrink just enough to remain whole. Both renderers retain
`shrink-0`, with the same CSS width, height and shadow rules in both engines.
