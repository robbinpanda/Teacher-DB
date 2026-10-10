import sharp from "sharp";

export type PixelBox = { x: number; y: number; width: number; height: number };
export type AssetCandidate = PixelBox & { id: string };

/** Connected ink gives real pixel boundaries; the model only chooses semantic ownership. */
export async function detectAssetCandidates(bytes: Buffer): Promise<{ width: number; height: number; candidates: AssetCandidate[] }> {
  const { data, info } = await sharp(bytes, { limitInputPixels: 12_000_000 }).flatten({ background: "white" }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const seen = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  const components: Array<PixelBox & { area: number }> = [];
  for (let start = 0; start < data.length; start++) {
    if (seen[start] || data[start] > 220) continue;
    let head = 0, tail = 1, x0 = start % width, x1 = x0, y0 = Math.floor(start / width), y1 = y0;
    queue[0] = start; seen[start] = 1;
    while (head < tail) {
      const current = queue[head++], x = current % width, y = Math.floor(current / width);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      // Bridge small gaps in antialiasing, dashed lines and pale photograph edges.
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const nx = x + dx, ny = y + dy, next = ny * width + nx;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height || seen[next] || data[next] > 220) continue;
        seen[next] = 1; queue[tail++] = next;
      }
    }
    if (tail >= 4) components.push({ x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1, area: tail });
  }
  const scale = width / 982;
  const cores = components.filter((c) => c.width >= 60 * scale && c.height >= 45 * scale && c.area >= 160 * scale * scale);
  // Stem-and-leaf plots have one thin divider and disconnected digits, not an outer frame.
  for (const divider of components.filter((c) => c.width <= 5 * scale && c.height >= 60 * scale)) {
    const digits = components.filter((c) => c !== divider && c.width <= 35 * scale && c.height <= 30 * scale
      && c.x >= divider.x - 30 * scale && c.x + c.width <= divider.x + 190 * scale
      && c.y >= divider.y - 4 * scale && c.y + c.height <= divider.y + divider.height + 4 * scale);
    if (digits.length < 8) continue;
    const x = Math.min(divider.x, ...digits.map((c) => c.x));
    const right = Math.max(divider.x + divider.width, ...digits.map((c) => c.x + c.width));
    cores.push({ x, y: divider.y, width: right - x, height: divider.height,
      area: divider.area + digits.reduce((sum, c) => sum + c.area, 0) });
  }
  const candidates: AssetCandidate[] = [];
  for (const core of cores) {
    const horizontalEdge = (y: number) => {
      let count = 0;
      for (let x = core.x; x < core.x + core.width; x++) if (data[y * width + x] <= 220) count++;
      return count >= core.width * 0.9;
    };
    const framedTable = [0, 1, 2].some((offset) => horizontalEdge(core.y + offset))
      && [0, 1, 2].some((offset) => horizontalEdge(core.y + core.height - 1 - offset));
    // Do not cascade through nearby letters: that can absorb a whole text line.
    // A closed table already contains its labels; nearby headers must stay outside.
    const margin = framedTable ? 0 : 8 * scale;
    const nearby = components.filter((c) => c.x < core.x + core.width + margin && c.x + c.width > core.x - margin
      && c.y < core.y + core.height + margin && c.y + c.height > core.y - margin);
    const pad = Math.max(3, Math.round(4 * scale));
    const x = Math.max(0, Math.min(...nearby.map((c) => c.x)) - pad);
    const y = Math.max(0, Math.min(...nearby.map((c) => c.y)) - pad);
    const right = Math.min(width, Math.max(...nearby.map((c) => c.x + c.width)) + pad);
    const bottom = Math.min(height, Math.max(...nearby.map((c) => c.y + c.height)) + pad);
    if (candidates.some((c) => Math.abs(c.x - x) + Math.abs(c.y - y) + Math.abs(c.width - (right - x)) + Math.abs(c.height - (bottom - y)) < 12 * scale)) continue;
    candidates.push({ id: String(candidates.length + 1), x, y, width: right - x, height: bottom - y });
  }
  return { width, height, candidates };
}

export async function annotateAssetCandidates(bytes: Buffer, candidates: Array<AssetCandidate & { displayLabel?: string }>) {
  const { width, height } = await sharp(bytes).metadata();
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${candidates.map((c) =>
    `<rect x="${c.x}" y="${c.y}" width="${c.width}" height="${c.height}" fill="none" stroke="${c.displayLabel ? '#007c69' : '#d000a0'}" stroke-width="2"/><rect x="${c.x + c.width + 2}" y="${c.y}" width="48" height="24" fill="white"/><text x="${c.x + c.width + 4}" y="${c.y + 18}" font-size="18" fill="${c.displayLabel ? '#007c69' : '#d000a0'}">${c.displayLabel ?? c.id}</text>`).join("")}</svg>`;
  return sharp(bytes).composite([{ input: Buffer.from(svg) }]).jpeg({ quality: 92 }).toBuffer();
}
