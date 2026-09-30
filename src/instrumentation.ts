export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  if (
    process.env.SUSY_PREWARM_ON_STARTUP !== "1" &&
    process.env.GTNH_PREWARM_ON_STARTUP !== "1"
  ) {
    return;
  }

  const { prewarmLatestDatasetVersions } = await import("@/lib/server/dataset-query");
  try {
    await prewarmLatestDatasetVersions();
    console.info("Dataset cache prewarmed.");
  } catch (error) {
    console.error("Dataset cache prewarm failed.", error);
  }
}
