import { indexOfRandom } from "./random.js";

function expand(entries) {
  return entries.flatMap((entry) =>
    Array.from({ length: entry.count }, () => {
      const { count, ...tile } = entry;
      return tile;
    }),
  );
}

export function createGrid(config, rng) {
  const cells = expand(config.initial);
  for (let i = cells.length - 1; i > 0; i--) {
    const j = indexOfRandom(i + 1, rng);
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  return {
    cells,
    pool: expand(config.replenishments),
    reserves: expand(config.reserves),
  };
}

// A blast collects the current board snapshot before any refill. Adjacent effects
// chain once; corners never wrap and inactive cells never produce rewards.
export function executeGrid(grid, points, config, rng) {
  const next = structuredClone(grid);
  const draws = [],
    tokens = [];
  let spins = 0;
  for (let p = 0; p < points; p++) {
    const active = next.cells.flatMap((tile, i) => (tile ? [i] : []));
    if (!active.length) break;
    const index = active[indexOfRandom(active.length, rng)];
    const queue = [index],
      visited = new Set(),
      collections = [],
      explosions = [];
    for (let q = 0; q < queue.length; q++) {
      const target = queue[q];
      if (visited.has(target) || !next.cells[target]) continue;
      visited.add(target);
      const tile = next.cells[target];
      collections.push({ index: target, tile });
      if (tile.kind === "symbol")
        tokens.push({ symbol: tile.symbol, units: tile.units });
      else {
        const effect = config.effects[tile.effect];
        spins += effect.spins ?? 0;
        if (effect.collect === "orthogonal") {
          explosions.push(target);
          const row = Math.floor(target / config.columns),
            col = target % config.columns;
          if (row > 0) queue.push(target - config.columns);
          if (row < config.rows - 1) queue.push(target + config.columns);
          if (col > 0) queue.push(target - 1);
          if (col < config.columns - 1) queue.push(target + 1);
        }
      }
    }
    for (const item of collections) next.cells[item.index] = null;
    const upgrades = [];
    for (const item of collections) {
      if (item.tile.kind !== "symbol" || !next.reserves.length) continue;
      const specialIndex = indexOfRandom(next.reserves.length, rng);
      const special = next.reserves[specialIndex];
      // Reserved spin tiles enter through the same upgrade path as rare symbols.
      const candidates = next.cells.flatMap((cell, i) =>
        cell?.kind === "symbol" &&
        (special.kind === "effect" || config.ranks[cell.symbol] < config.ranks[special.symbol])
          ? [i]
          : [],
      );
      if (candidates.length) {
        const target = candidates[indexOfRandom(candidates.length, rng)];
        next.pool.push(next.cells[target]);
        next.cells[target] = special;
        next.reserves.splice(specialIndex, 1);
        upgrades.push({ index: target, tile: special });
      }
    }
    for (const item of collections) {
      if (item.tile.kind === "effect" && config.effects[item.tile.effect].vanish) {
        item.replacement = null;
        continue;
      }
      const source =
        next.reserves.length && !next.pool.length ? next.reserves : next.pool;
      item.replacement = source.length
        ? source.splice(indexOfRandom(source.length, rng), 1)[0]
        : null;
      next.cells[item.index] = item.replacement;
    }
    draws.push({
      index,
      tile: collections[0].tile,
      collections,
      explosions,
      upgrades,
    });
  }
  return { grid: next, draws, tokens, spins };
}
