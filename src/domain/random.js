// No browser dependencies: callers own the random source and its seed.
export function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let t = Math.imul(value ^ value >>> 15, 1 | value);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function indexOfRandom(length, rng) {
  if (!Number.isInteger(length) || length < 1) throw new Error('EMPTY_SELECTION');
  const value = rng();
  if (!(value >= 0 && value < 1)) throw new Error('INVALID_RANDOM_SOURCE');
  return Math.floor(value * length);
}

// Geometry and random selection share exactly these normalized boundaries.
export function wheelSectors(categories) {
  const total = categories.reduce((sum, c) => sum + c.weight, 0);
  if (!(total > 0) || categories.some(c => !Number.isFinite(c.weight) || c.weight < 0)) {
    throw new Error('INVALID_WHEEL_WEIGHTS');
  }
  let start = 0;
  return categories.map(category => {
    const probability = category.weight / total;
    const sector = { ...category, start, end: start + probability, probability };
    start += probability;
    return sector;
  });
}

export function selectCategory(categories, rng) {
  const sectors = wheelSectors(categories).filter(s => s.probability > 0);
  const value = rng();
  if (!(value >= 0 && value < 1)) throw new Error('INVALID_RANDOM_SOURCE');
  return sectors.find(s => value < s.end) ?? sectors.at(-1);
}
