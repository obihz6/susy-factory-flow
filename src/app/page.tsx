import type { Metadata } from "next";
import { FactoryPlannerApp } from "@/components/FactoryPlannerApp";
import { describePlanRow, getPublicPlanRow } from "@/lib/server/plan-preview";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * A shared link unfurls as the plan it carries: its name, the author's words
 * (or the plan's numbers), and a card drawn from its inputs and outputs -
 * instead of the site's one generic face. Any other visit, and any plan a
 * crawler may not see, falls through to the layout's metadata untouched.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const params = await searchParams;
  const planId = typeof params.plan === "string" ? params.plan : undefined;
  const row = planId ? await getPublicPlanRow(planId) : undefined;
  if (!row) {
    return {};
  }

  const description = describePlanRow(row);
  const planUrl = `/?plan=${encodeURIComponent(row.id)}`;
  const image = {
    url: `/api/community/plans/${encodeURIComponent(row.id)}/card`,
    width: 1200,
    height: 630,
    alt: `${row.name} on SUSY Planner`,
  };

  return {
    title: `${row.name} | SUSY Planner`,
    description,
    alternates: { canonical: planUrl },
    openGraph: {
      title: row.name,
      description,
      siteName: "SUSY Planner",
      type: "website",
      url: planUrl,
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title: row.name,
      description,
      images: [image.url],
    },
  };
}

export default function Home() {
  return (
    <>
      <FactoryPlannerApp />
      {/* The one paragraph a JS-less visitor (or crawler) gets. Renders
          nothing at all when the app itself is going to. */}
      <noscript>
        <h1>SUSY Planner</h1>
        <p>
          A free factory planner and recipe calculator for Supersymmetry.
          Draw production chains on an interactive flowchart with
          full recipe data exported from the game itself, balance machine ratios,
          compute power and throughput, and share plans with the community.
          The planner needs JavaScript to run.
        </p>
      </noscript>
    </>
  );
}
