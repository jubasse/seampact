// Seeded random choices shared by the scale generator and the inline = include property test.

/** A small deterministic generator (mulberry32): the same seed always gives the same sequence. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);

    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);

    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(random: () => number, choices: readonly T[]): T {
  const chosen = choices[Math.floor(random() * choices.length)];

  if (chosen === undefined) throw new Error("nothing to pick from");

  return chosen;
}
