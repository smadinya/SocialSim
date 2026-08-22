export interface SeededRng {
  next(): number;
  nextInt(maxExclusive: number): number;
}

export function createSeededRng(seed: number): SeededRng {
  let state = seed >>> 0;

  return {
    next() {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    nextInt(maxExclusive: number) {
      return Math.floor(this.next() * maxExclusive);
    },
  };
}
