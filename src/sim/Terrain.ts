import { SCREEN_H, SCREEN_W, TERRAIN_RES } from "./Constants";

export const SAMPLES = Math.floor(SCREEN_W / TERRAIN_RES) + 1;

export function generateHeights(): number[] {
  const heights = new Array<number>(SAMPLES);
  const baseline = SCREEN_H * 0.62;
  const amp1 = 40;
  const amp2 = 18;
  const seedA = Math.random() * 1000;
  const seedB = Math.random() * 1000;
  for (let i = 0; i < SAMPLES; i++) {
    const x = i * TERRAIN_RES;
    heights[i] =
      baseline -
      amp1 * Math.sin((x + seedA) * 0.006) -
      amp2 * Math.sin((x + seedB) * 0.017);
  }
  return heights;
}

export function heightAt(heights: ArrayLike<number>, x: number): number {
  const cx = Math.max(0, Math.min(SCREEN_W - 0.001, x));
  const idx = cx / TERRAIN_RES;
  const i0 = Math.floor(idx);
  const i1 = Math.min(SAMPLES - 1, i0 + 1);
  const t = idx - i0;
  return heights[i0] * (1 - t) + heights[i1] * t;
}

export function isBelowGround(heights: ArrayLike<number>, x: number, y: number): boolean {
  return y >= heightAt(heights, x);
}

export function carveCrater(heights: number[], cx: number, cy: number, radius: number): void {
  for (let i = 0; i < SAMPLES; i++) {
    const sx = i * TERRAIN_RES;
    const dx = sx - cx;
    if (Math.abs(dx) > radius) continue;
    const halfChord = Math.sqrt(Math.max(0, radius * radius - dx * dx));
    const candidate = cy + halfChord * 0.9;
    if (candidate > heights[i]) {
      heights[i] = Math.min(SCREEN_H, candidate);
    }
  }
}
