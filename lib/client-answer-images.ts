export async function answerImagesFromFile(file: File): Promise<string[]> {
  if (file.size > 60 * 1024 * 1024) throw new Error(`${file.name} 超过 60 MB`);
  if (file.type.startsWith("image/")) {
    return [await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("图片读取失败"));
      reader.readAsDataURL(file);
    })];
  }
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) throw new Error("答案仅支持 PDF 或图片");
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  if (pdf.numPages > 80) throw new Error("答案 PDF 最多 80 页");
  const images: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.45 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建答案页画布");
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    images.push(canvas.toDataURL("image/jpeg", 0.88));
    canvas.width = 1; canvas.height = 1;
  }
  return images;
}
