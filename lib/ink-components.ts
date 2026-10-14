export type InkComponent = { x: number; y: number; width: number; height: number; area: number };

/** Exact Chebyshev-radius-3 connectivity, using row runs instead of 49 neighbors per ink pixel. */
export function findInkComponents(data: Uint8Array, width: number, height: number): InkComponent[] {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || data.length !== width * height) {
    throw new Error("Invalid grayscale image dimensions");
  }
  type Run = { left: number; right: number; parent: number; rank: number; x0: number; x1: number; y0: number; y1: number; area: number; first: number };
  const runs: Run[] = [];
  const previousRows: number[][] = [];
  const root = (id: number): number => {
    let current = id;
    while (runs[current].parent !== current) current = runs[current].parent;
    while (id !== current) { const next = runs[id].parent; runs[id].parent = current; id = next; }
    return current;
  };
  const join = (a: number, b: number) => {
    let left = root(a), right = root(b);
    if (left === right) return;
    if (runs[left].rank < runs[right].rank) [left, right] = [right, left];
    const target = runs[left], source = runs[right];
    source.parent = left;
    if (target.rank === source.rank) target.rank++;
    target.x0 = Math.min(target.x0, source.x0); target.x1 = Math.max(target.x1, source.x1);
    target.y0 = Math.min(target.y0, source.y0); target.y1 = Math.max(target.y1, source.y1);
    target.area += source.area; target.first = Math.min(target.first, source.first);
  };
  for (let y = 0; y < height; y++) {
    const row: number[] = [];
    let left = -1, right = -1, area = 0;
    const finish = () => {
      if (left < 0) return;
      const id = runs.length;
      runs.push({ left, right, parent: id, rank: 0, x0: left, x1: right, y0: y, y1: y, area, first: y * width + left });
      row.push(id);
    };
    for (let x = 0, offset = y * width; x < width; x++) {
      if (data[offset + x] > 220) continue;
      if (left < 0 || x - right > 3) { finish(); left = x; area = 0; }
      right = x; area++;
    }
    finish();
    for (const previous of previousRows) {
      let cursor = 0;
      for (const id of row) {
        const current = runs[id];
        while (cursor < previous.length && runs[previous[cursor]].right < current.left - 3) cursor++;
        for (let i = cursor; i < previous.length && runs[previous[i]].left <= current.right + 3; i++) join(id, previous[i]);
      }
    }
    previousRows.push(row);
    if (previousRows.length > 3) previousRows.shift();
  }
  // Preserve raster discovery order: downstream candidate IDs must not change.
  return runs.filter((run, id) => run.parent === id && run.area >= 4).sort((a, b) => a.first - b.first)
    .map(run => ({ x: run.x0, y: run.y0, width: run.x1 - run.x0 + 1, height: run.y1 - run.y0 + 1, area: run.area }));
}
