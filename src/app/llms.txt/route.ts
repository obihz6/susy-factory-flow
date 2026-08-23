import {
  getCommunityDb,
  isCommunityConfigured,
  PLAN_SUMMARY_COLUMNS,
  type PlanRow,
} from "@/lib/server/community";
import { describePlanRow } from "@/lib/server/plan-preview";
import { APP_VERSION } from "@/lib/version";

/**
 * The site as one page of markdown, for readers that are language models.
 *
 * An LLM crawler fetches raw HTML and runs no JavaScript, so to it the
 * planner is a nearly empty page: this file (the llms.txt convention,
 * llmstxt.org) is where it learns what the site actually is. The top shared
 * plans are listed as links because each plan URL server-renders its name
 * and summary into metadata, making them the only text-rich pages we have.
 */
export const revalidate = 3600;

async function topPlans(base: string): Promise<string[]> {
  if (!isCommunityConfigured()) {
    return [];
  }
  try {
    const { data } = await getCommunityDb()
      .from("community_plans")
      .select(PLAN_SUMMARY_COLUMNS)
      .or("is_public.eq.true,is_public.is.null")
      .order("score", { ascending: false })
      .limit(10)
      .returns<PlanRow[]>();
    // An author's description can span lines; a link list entry cannot.
    return (data ?? []).map(
      (row) =>
        `- [${row.name}](${base}/?plan=${encodeURIComponent(row.id)}): ${describePlanRow(row).replace(/\s+/g, " ")}`,
    );
  } catch {
    return [];
  }
}

export async function GET() {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://gtnhplanner.com";
  const plans = await topPlans(base);

  const lines = [
    "# SUSY Planner",
    "",
    "> Free browser-based factory planner and recipe calculator for Supersymmetry (SUSY), the Minecraft GregTech modpack. Draw production chains on an interactive flowchart, balance machine ratios, compute EU/t power draw and throughput, and share plans with the community. No account and no install needed.",
    "",
    "Key facts:",
    "",
    "- Carries full recipe data exported from the game itself (HEI), including multiblock machines, ore dictionary alternatives, and programmed circuit settings.",
    "- Models GregTech mechanics faithfully: voltage tiers and overclocking, parallel processing on multiblocks, heat bonuses on the Electric Blast Furnace family, machine-specific speed and power coefficients.",
    "- A solver computes steady-state flow for the whole factory at once: what every machine produces and consumes per second, where the bottleneck is, and how full each machine runs.",
    "- Plans export as shareable links, JSON, PNG, or GIF. Opening a shared link loads the full plan, editable, with nothing to sign up for.",
    "- The planner is a client-side application. Pages carry little static HTML; a plan link's name and summary are server-rendered into its page metadata, so fetching a plan URL is the way to read a plan.",
    `- Version ${APP_VERSION} as of this file; ${base}/api/version reports what is live.`,
    "",
    "## Start here",
    "",
    `- [The planner](${base}/): the app itself. Everything happens on one page.`,
    `- [Sitemap](${base}/sitemap.xml): the home page plus every public community plan.`,
    "",
  ];

  if (plans.length > 0) {
    lines.push("## Popular community plans", "", ...plans, "");
  }

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
