/** Pure image pagination and PDF assembly, shared by the browser importer and tests. */
export type ImagePageBox = { x: number; y: number; width: number; height: number };
export const IMAGE_ACCEPT = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";
export const MAX_IMAGE_PAGES = 100;
export function isPaperImage(file: { name: string; type: string }) {
  return /\.(jpe?g|png|webp)$/i.test(file.name) || ["image/jpeg", "image/png", "image/webp"].includes(file.type);
}

/** Detect the white page panels of a screenshot, otherwise split only in blank rows.
 * Input is a small analysis bitmap; returned coordinates refer to that bitmap.
 * Never discard pixels around an uncertain boundary. Users can disable splitting.
 */
export function imagePageBoxes(pixels: Uint8ClampedArray, width: number, height: number): ImagePageBox[] {
  const whole = [{ x: 0, y: 0, width, height }];
  if (height < width * 2.1) return whole;
  const white = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) >= 248;
  };
  const panels: Array<[number, number]> = [];
  let start = -1;
  for (let y = 0; y <= height; y++) {
    const edgeWhite = y < height && [.075, .09, .91, .925].every(r => white(Math.floor(width * r), y));
    if (edgeWhite && start < 0) start = y;
    if (!edgeWhite && start >= 0) {
      if (y - start >= width * .65) panels.push([start, y]);
      start = -1;
    }
  }
  if (panels.length > 1 && panels.every(([top, bottom]) => bottom - top <= width * 2)
    && panels.reduce((sum, [top, bottom]) => sum + bottom - top, 0) > height * .7
    && panels.every(([top], i) => !i || top - panels[i - 1][1] < width * .2)) {
    return panels.map(([top, bottom]) => {
      let left = Math.floor(width / 2), right = left;
      const y = Math.min(bottom - 1, top + 3);
      while (left > 0 && white(left - 1, y)) left--;
      while (right < width - 1 && white(right + 1, y)) right++;
      // Include a pixel of border to avoid losing antialiased edge content.
      left = Math.max(0, left - 1); right = Math.min(width - 1, right + 1);
      return { x: left, y: Math.max(0, top - 1), width: right - left + 1, height: Math.min(height, bottom + 1) - Math.max(0, top - 1) };
    });
  }
  const blankRows = Array.from({ length: height }, (_, y) => {
    let light = 0;
    for (let x = 0; x < width; x++) if (white(x, y)) light++;
    return light >= width * .985;
  });
  const boxes: ImagePageBox[] = [];
  let top = 0;
  while (height - top > width * 1.85) {
    const target = top + width * Math.SQRT2;
    let cut = -1, distance = Infinity;
    for (let y = Math.ceil(top + width); y < Math.min(height - 2, top + width * 1.8); y++) {
      if (blankRows[y - 1] && blankRows[y] && blankRows[y + 1] && Math.abs(target - y) < distance) {
        cut = y; distance = Math.abs(target - y);
      }
    }
    if (cut < 0) break; // Keep unsplittable content intact, even if it is tall.
    boxes.push({ x: 0, y: top, width, height: cut - top }); top = cut;
  }
  boxes.push({ x: 0, y: top, width, height: height - top });
  return boxes;
}

/** Lossless embedding of already encoded JPEG pages. No network or PDF dependency. */
export function jpegPagesToPdf(pages: Array<{ bytes: Uint8Array; width: number; height: number }>): Uint8Array {
  if (!pages.length || pages.length > MAX_IMAGE_PAGES) throw new Error(`一份试卷须包含 1–${MAX_IMAGE_PAGES} 页`);
  const encode = (value: string) => new TextEncoder().encode(value);
  const parts: Uint8Array[] = [encode("%PDF-1.4\n%image-paper\n")];
  const offsets: number[] = [0];
  let length = parts[0].length;
  const append = (part: Uint8Array) => { parts.push(part); length += part.length; };
  const object = (id: number, body: string, stream?: Uint8Array) => {
    offsets[id] = length; append(encode(`${id} 0 obj\n${body}`));
    if (stream) { append(encode("\nstream\n")); append(stream); append(encode("\nendstream")); }
    append(encode("\nendobj\n"));
  };
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${3 + i * 3} 0 R`).join(" ")}] >>`);
  pages.forEach((page, i) => {
    if (!Number.isInteger(page.width) || !Number.isInteger(page.height) || page.width < 1 || page.height < 1
      || page.bytes[0] !== 255 || page.bytes[1] !== 216) throw new Error("页面图像无效");
    const id = 3 + i * 3;
    // One image pixel = 0.6pt, capped to valid PDF page dimensions.
    const factor = Math.min(.6, 14000 / Math.max(page.width, page.height));
    const w = +(page.width * factor).toFixed(3), h = +(page.height * factor).toFixed(3);
    const content = encode(`q\n${w} 0 0 ${h} 0 0 cm\n/Im0 Do\nQ\n`);
    object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`);
    object(id + 1, `<< /Length ${content.length} >>`, content);
    object(id + 2, `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.bytes.length} >>`, page.bytes);
  });
  const xref = length;
  append(encode(`xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  const result = new Uint8Array(length); let position = 0;
  for (const part of parts) { result.set(part, position); position += part.length; }
  return result;
}
