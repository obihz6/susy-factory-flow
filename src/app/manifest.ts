import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SUSY Planner",
    short_name: "SUSY Planner",
    description:
      "Factory planner and recipe calculator for Supersymmetry.",
    start_url: "/",
    display: "standalone",
    background_color: "#1b1d21",
    theme_color: "#1b1d21",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
