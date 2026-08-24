import type { Metadata, Viewport } from "next";
import {
  Andika,
  Atkinson_Hyperlegible,
  Comic_Neue,
  Inter,
  JetBrains_Mono,
  Lexend,
} from "next/font/google";
import localFont from "next/font/local";
import { APP_FONT_STORAGE_KEY, DEFAULT_APP_FONT } from "@/lib/app-font";
import { Analytics } from "./Analytics";
import { AnalyticsHeartbeat } from "./AnalyticsHeartbeat";
import { WhatsNewGate } from "@/components/WhatsNewGate";
import { GlobalTitleTooltip } from "@/components/nei/GlobalTitleTooltip";
import "./globals.css";

const monocraft = localFont({
  src: [
    { path: "./fonts/Monocraft-ExtraLight.ttf", weight: "200", style: "normal" },
    { path: "./fonts/Monocraft-Light.ttf", weight: "300", style: "normal" },
    { path: "./fonts/Monocraft.ttf", weight: "400", style: "normal" },
    { path: "./fonts/Monocraft-SemiBold.ttf", weight: "600", style: "normal" },
    { path: "./fonts/Monocraft-Bold.ttf", weight: "700", style: "normal" },
    { path: "./fonts/Monocraft-Black.ttf", weight: "900", style: "normal" },
  ],
  variable: "--font-minecraft",
  display: "swap",
});

/*
 * The alternative fonts the settings dialog offers (src/lib/app-font.ts).
 * next/font downloads the Google ones at build time and serves everything
 * from our own origin, so offering them costs no runtime request to Google.
 */
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

const lexend = Lexend({
  subsets: ["latin"],
  variable: "--font-lexend",
  display: "swap",
});

const atkinson = Atkinson_Hyperlegible({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-atkinson",
  display: "swap",
});

const andika = Andika({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-andika",
  display: "swap",
});

const comicNeue = Comic_Neue({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-comic-neue",
  display: "swap",
});

/* Not on Google Fonts; vendored under its SIL OFL (OpenDyslexic-LICENSE). */
const openDyslexic = localFont({
  src: [
    { path: "./fonts/OpenDyslexic-Regular.otf", weight: "400", style: "normal" },
    { path: "./fonts/OpenDyslexic-Bold.otf", weight: "700", style: "normal" },
  ],
  variable: "--font-open-dyslexic",
  display: "swap",
  // OpenDyslexic's x-height runs far past every other face here, so at the
  // same px size it rendered a size up and overflowed fixed-height chrome.
  // size-adjust scales the glyphs, not the layout, back into the app's scale.
  declarations: [{ prop: "size-adjust", value: "82%" }],
});

/*
 * Restamps the saved font choice before anything paints, so a reload never
 * flashes Monocraft at someone who switched away from it. Unknown or absent
 * values simply match no CSS rule and land on the default; setAppFont owns
 * the real validation.
 */
const appFontBootScript = `try{var f=localStorage.getItem(${JSON.stringify(
  APP_FONT_STORAGE_KEY,
)});if(f&&f!==${JSON.stringify(
  DEFAULT_APP_FONT,
)})document.documentElement.setAttribute("data-app-font",f)}catch(e){}`;

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://gtnhplanner.com";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: "GTNH Planner",
  title: "GTNH Planner | GregTech New Horizons Factory Calculator",
  description:
    "Plan and optimize GregTech: New Horizons factories on an interactive flowchart. Full recipe data for GTNH 2.8.4 and 2.9, throughput and power calculation, machine ratios, and community-shared plans.",
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  keywords: [
    "GTNH Planner",
    "GregTech New Horizons planner",
    "GTNH factory planner",
    "GTNH recipe calculator",
    "GTNH throughput calculator",
    "GregTech factory calculator",
  ],
  openGraph: {
    title: "GTNH Planner | GregTech New Horizons Factory Calculator",
    description:
      "Free factory planner for GregTech: New Horizons with full recipe data for GTNH 2.8.4 and 2.9. Draw production chains, balance machine ratios, find bottlenecks, and share plans with the community.",
    siteName: "GTNH Planner",
    type: "website",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "GTNH Planner | GregTech New Horizons Factory Calculator",
    description:
      "Free factory planner for GregTech: New Horizons with full recipe data for GTNH 2.8.4 and 2.9. Draw production chains, balance machine ratios, find bottlenecks, and share plans with the community.",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: "/apple-touch-icon.png",
  },
  other: {
    // The app is already dark. Without this, the Dark Reader extension
    // darkens it a second time and rewrites inline styles before React
    // hydrates, which both wrecks the palette and throws hydration mismatches.
    // Next drops metadata entries with an empty content value, so this carries
    // one even though Dark Reader only checks that the tag exists.
    "darkreader-lock": "true",
  },
};

export const viewport: Viewport = {
  // The app's charcoal, so the browser chrome around the page matches it.
  themeColor: "#1b1d21",
};

/**
 * What the site is, said in schema.org's terms for crawlers that read
 * structured data. Kept to claims a machine can verify: free, runs in a
 * browser, about GregTech: New Horizons.
 */
const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${siteUrl}/#website`,
      url: `${siteUrl}/`,
      name: "GTNH Planner",
    },
    {
      "@type": "WebApplication",
      "@id": `${siteUrl}/#app`,
      url: `${siteUrl}/`,
      name: "GTNH Planner",
      alternateName: "GregTech New Horizons Factory Planner",
      description:
        "Free factory planner and recipe calculator for GregTech: New Horizons. Draw production chains on a flowchart, balance machine ratios, compute power and throughput, and share plans.",
      applicationCategory: "GameApplication",
      operatingSystem: "Any",
      browserRequirements: "Requires JavaScript",
      image: `${siteUrl}/icon-512.png`,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      about: {
        "@type": "VideoGame",
        name: "GregTech: New Horizons",
        gamePlatform: "Minecraft",
      },
    },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${monocraft.variable} ${inter.variable} ${jetbrainsMono.variable} ${lexend.variable} ${atkinson.variable} ${andika.variable} ${comicNeue.variable} ${openDyslexic.variable} h-full`}
      // The boot script above stamps `data-app-font` on this element before
      // React ever renders, and the server markup does not carry it.
      suppressHydrationWarning
    >
      <body className="min-h-full">
        <script dangerouslySetInnerHTML={{ __html: appFontBootScript }} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
        {children}
        {/* Above the app rather than inside it: what changed is a fact about
            the whole planner, not about whichever tab happens to be open. */}
        <WhatsNewGate />
        {/* Every `title` attribute in the app, worn as the planner's own
            tooltip: the browser's grey box never renders again. */}
        <GlobalTitleTooltip />
        <Analytics />
        <AnalyticsHeartbeat />
      </body>
    </html>
  );
}
