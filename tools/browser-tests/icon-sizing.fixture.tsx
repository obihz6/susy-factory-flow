import { createRoot } from "react-dom/client";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import { EnergyHatchArt } from "@/components/flow/EnergyHatchMenu";
import "./icon-sizing.css";
const oilBerry = new URL("./fixtures/oil-berry.png", import.meta.url).href;
const aluminaDust = new URL("./fixtures/alumina-dust.png", import.meta.url).href;
const sand = new URL("./fixtures/sand.png", import.meta.url).href;
const water = new URL("./fixtures/water.png", import.meta.url).href;

// A sprite with the same 50% transparent margin as dataset renders. The atlas
// and standalone image deliberately carry identical art, isolating layout.
const image =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect x="64" y="64" width="128" height="128" fill="#ff0080"/></svg>',
  );
const item = {
  kind: "item" as const,
  id: "fixture",
  displayName: "Fixture",
  amount: 1,
  iconPath: image,
};
const atlas = {
  ...item,
  iconAtlas: {
    imagePath: image,
    x: 0,
    y: 0,
    width: 256,
    height: 256,
    atlasWidth: 256,
    atlasHeight: 256,
  },
};
const sizes = [
  { box: 22, css: "!h-[22px] !w-[22px]" },
  { box: 28, css: "!h-7 !w-7" },
  { box: 36, css: "!h-9 !w-9" },
  { box: 44, css: "!h-11 !w-11" },
  { box: 48, css: "!h-12 !w-12" },
];
const wideImage =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect x="48" y="48" width="160" height="160" fill="#ff0080"/></svg>',
  );
const variants = [
  { name: "sprite", resource: item, fit: 2 },
  { name: "atlas", resource: atlas, fit: 2 },
  { name: "wide-sprite", resource: { ...item, iconPath: wideImage }, fit: 1.6 },
  {
    name: "wide-atlas",
    resource: { ...atlas, iconAtlas: { ...atlas.iconAtlas, imagePath: wideImage } },
    fit: 1.6,
  },
  { name: "oil-berry", resource: { ...item, iconPath: oilBerry }, fit: 2 },
  { name: "alumina-dust", resource: { ...item, iconPath: aluminaDust }, fit: 256 / 96 },
  { name: "sand", resource: { ...item, iconPath: sand }, fit: 256 / 126 },
  { name: "fluid-sprite", resource: { ...item, kind: "fluid" as const } },
  { name: "fluid-atlas", resource: { ...atlas, kind: "fluid" as const } },
  { name: "water", resource: { ...item, kind: "fluid" as const, iconPath: water } },
  { name: "swatch", resource: { kind: "fluid" as const, id: "water", amount: 1 } },
  { name: "aspect", resource: { ...item, kind: "aspect" as const, dominantColor: "#ff0080" } },
];
const params = new URLSearchParams(location.search);
const scale = Number(params.get("scale") ?? 1);
const camera = Number(params.get("camera") ?? 1);
const itemZoom = Number(params.get("itemZoom") ?? 1);
createRoot(document.getElementById("root")!).render(
  <main style={{ padding: 30, background: "#fff", color: "#000", zoom: scale }}>
    <div
      style={{
        transform: `scale(${camera})`,
        transformOrigin: "left top",
        display: "grid",
        gridTemplateColumns: "repeat(6, 130px)",
        gap: 24,
      }}
    >
      {variants.flatMap(({ name, resource, fit }) =>
        sizes.flatMap(({ box, css }) =>
          [false, true].map((explicit) => {
            const requested = explicit
              ? name === "swatch"
                ? 64 * 0.56
                : 64
              : name === "swatch"
                ? box * 0.56
                : name === "aspect"
                  ? box * 0.72
                  : box * 2 - 8;
            const expected = fit
              ? Math.min(requested * (explicit ? 1 : itemZoom), (box - 4) * fit)
              : requested;
            return (
              <div
                key={`${name}-${box}-${explicit}`}
                data-case={`${name}-${box}-${explicit}`}
                data-box={box}
                data-art={expected}
                data-fit={fit}
                data-shadow={
                  resource.kind === "item" || resource.kind === "fluid" ? "true" : undefined
                }
                data-fluid={
                  resource.kind === "fluid" ? (name === "swatch" ? "swatch" : "sprite") : undefined
                }
              >
                <p style={{ fontSize: 10 }}>
                  {name} {box} {explicit ? "64px" : "%"}
                </p>
                <ResourceIcon
                  itemZoom={itemZoom}
                  resource={resource}
                  bare
                  tooltip={false}
                  showAmount={false}
                  className={css}
                  iconPixelSize={explicit ? 64 : undefined}
                />
              </div>
            );
          }),
        ),
      )}
      <div data-case="hatch" data-box="32" data-art="70.4">
        <p>Hatch</p>
        <EnergyHatchArt
          entry={{ id: "fixture", displayName: "Hatch", iconPath: image }}
          boxClass="h-8 w-8"
        />
      </div>
    </div>
  </main>,
);
