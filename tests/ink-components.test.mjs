import assert from 'node:assert/strict';
import test from 'node:test';
import { findInkComponents } from '../lib/ink-components.ts';

// Independent pixel-graph oracle checks exact boundaries, area and discovery order.
function reference(data, width, height) {
  const seen = new Set(), out = [];
  for (let i = 0; i < data.length; i++) {
    if (seen.has(i) || data[i] > 220) continue;
    const queue = [i]; seen.add(i);
    let x0 = width, y0 = height, x1 = 0, y1 = 0;
    for (let k = 0; k < queue.length; k++) {
      const current = queue[k], x = current % width, y = Math.floor(current / width);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (let yy = Math.max(0, y - 3); yy <= Math.min(height - 1, y + 3); yy++) {
        for (let xx = Math.max(0, x - 3); xx <= Math.min(width - 1, x + 3); xx++) {
          const next = yy * width + xx;
          if (data[next] <= 220 && !seen.has(next)) { seen.add(next); queue.push(next); }
        }
      }
    }
    if (queue.length >= 4) out.push({ x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1, area: queue.length });
  }
  return out;
}

test('run connectivity equals pixel connectivity across random densities and page edges', () => {
  let seed = 51273;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let n = 0; n < 180; n++) {
    const width = 1 + Math.floor(random() * 90), height = 1 + Math.floor(random() * 65);
    const data = Uint8Array.from({ length: width * height }, () => random() < (n % 10) / 12 ? Math.floor(random() * 221) : 255);
    assert.deepEqual(findInkComponents(data, width, height), reference(data, width, height), `fixture ${n}`);
  }
});

test('sparse dashed lines and late bridges retain exact bounds and component IDs', () => {
  const width = 70, height = 35, data = new Uint8Array(width * height).fill(255);
  for (const x of [0, 3, 7, 10, 20, 23, 40, 43, 69]) for (const y of [0, 3, 6, 10, 13, 16, 25, 28, 31, 34]) data[y * width + x] = 220;
  for (let x = 7; x <= 40; x += 3) data[19 * width + x] = 0;
  assert.deepEqual(findInkComponents(data, width, height), reference(data, width, height));
  assert.throws(() => findInkComponents(data, width + 1, height));
});
