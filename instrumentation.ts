export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.JIANTI_EMBEDDED_WORKER !== "1") return;
  const { kickExtractionQueue } = await import("./lib/extraction-queue");
  void kickExtractionQueue();
}
