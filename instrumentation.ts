export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { kickExtractionQueue } = await import("./lib/extraction-queue");
  void kickExtractionQueue();
}
