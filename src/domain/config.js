import { wheelSectors } from './random.js';

export function validateConfig(config, decks) {
  const assert = (condition, code) => { if (!condition) throw new Error(`CONFIG:${code}`); };
  assert(config.schemaVersion === 1, 'SCHEMA');
  const slots = config.slots;
  assert(Number.isInteger(slots.reels) && slots.reels > 0, 'REELS');
  assert(Object.values(slots.target).every(n => Number.isInteger(n) && n > 0), 'TARGET');
  assert(Object.values(slots.target).reduce((a, b) => a + b, 0) === slots.positions, 'REEL_SIZE');
  assert(config.grid.initial.reduce((sum, tile) => sum + tile.count, 0) === config.grid.rows * config.grid.columns, 'GRID_SIZE');
  assert(config.progression.choiceAt > 0 && config.progression.forceAt > config.progression.choiceAt, 'PROGRESSION');
  const adaptive = config.progression.adaptive;
  if (adaptive) {
    assert(typeof adaptive.enabled === 'boolean', 'ADAPTIVE_ENABLED');
    if (adaptive.enabled) {
      const probability = n => Number.isFinite(n) && n >= 0 && n <= 1;
      assert(probability(adaptive.minimumFill) && probability(adaptive.maximumFill) && adaptive.minimumFill < adaptive.maximumFill && adaptive.maximumFill < 1, 'ADAPTIVE_LIMITS');
      assert(Math.ceil(slots.reels * slots.positions * adaptive.minimumFill) <= Math.floor(slots.reels * slots.positions * adaptive.maximumFill), 'ADAPTIVE_POSITIONS');
      assert(probability(adaptive.pityFrom) && probability(adaptive.perMiss) && probability(adaptive.probabilityCeiling) && adaptive.probabilityCeiling > 0, 'ADAPTIVE_PROBABILITY');
      assert(Array.isArray(adaptive.curve) && adaptive.curve.length >= 2 && adaptive.curve.every((p, i, a) => Array.isArray(p) && p.length === 2 && p.every(probability) && (i === 0 || p[0] > a[i - 1][0])) && adaptive.curve[0][0] === 0 && adaptive.curve.at(-1)[0] === 1, 'ADAPTIVE_CURVE');
      const categories = config.wheels[config.progression.initialWheel]?.categories ?? [];
      assert(categories.filter(c => c.behavior === 'progression').length === 1 && categories.filter(c => c.behavior !== 'progression').some(c => c.weight > 0), 'ADAPTIVE_CATEGORIES');
    }
  }
  assert(config.final.minSpins > 0 && config.final.maxSpins >= config.final.minSpins, 'FINAL_SPINS');
  assert(config.final.autoFinishWhenComplete === undefined || typeof config.final.autoFinishWhenComplete === 'boolean', 'FINAL_AUTO_FINISH');
  const inventory = {};
  for (const entry of [...config.grid.initial, ...config.grid.reserves, ...config.grid.replenishments]) {
    assert(Number.isInteger(entry.count) && entry.count > 0, 'TILE_COUNT');
    if (entry.kind === 'symbol') {
      assert(Number.isInteger(entry.units) && entry.units > 0 && entry.symbol in slots.target, 'TILE_SYMBOL');
      inventory[entry.symbol] = (inventory[entry.symbol] ?? 0) + entry.count * entry.units;
    } else assert(entry.effect in config.grid.effects, 'EFFECT');
  }
  for (const [symbol, count] of Object.entries(slots.target)) assert(inventory[symbol] === count * slots.reels, `INVENTORY:${symbol}`);
  for (const [wheelId, wheel] of Object.entries(config.wheels)) {
    assert(wheel.categories.length > 0, 'CATEGORIES');
    wheelSectors(wheel.categories);
    assert(new Set(wheel.categories.map(c => c.id)).size === wheel.categories.length, 'DUPLICATE_CATEGORY');
    for (const category of wheel.categories) {
      assert(['cards', 'progression', 'finale'].includes(category.behavior), 'CATEGORY_BEHAVIOR');
      if (category.behavior === 'progression') assert(!decks[wheelId].some(c => c.category === category.id), 'PROGRESSION_DECK');
      if (category.behavior !== 'cards') continue;
      const cards = decks[wheelId].filter(c => c.category === category.id);
      assert(cards.length > 0, `EMPTY_DECK:${category.id}`);
      for (const card of cards) {
        assert(['binary', 'numeric'].includes(card.resolution), 'RESOLUTION');
        assert(typeof card.text_key === 'string', 'TEXT_KEY');
        assert(Number.isInteger(card.reward.success) && card.reward.success >= 0 && Number.isInteger(card.reward.failure) && card.reward.failure >= 0, 'REWARD');
        if (card.resolution === 'numeric') {
          assert(Number.isInteger(card.maximum) && card.maximum > 0, 'NUMERIC_MAXIMUM');
          assert(card.reward.byResult?.length === card.maximum + 1 && card.reward.byResult.every(n => Number.isInteger(n) && n >= 0), 'NUMERIC_REWARDS');
        }
      }
    }
    assert(new Set(decks[wheelId].map(c => c.id)).size === decks[wheelId].length, 'DUPLICATE_CARD');
    assert(decks[wheelId].every(c => wheel.categories.some(category => category.id === c.category)), 'UNKNOWN_CATEGORY');
  }
  for (const symbol of Object.keys(slots.target)) assert(config.symbols[symbol], `SYMBOL:${symbol}`);
  return config;
}
