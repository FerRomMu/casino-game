import { indexOfRandom } from './random.js';

function expand(entries) {
  return entries.flatMap(entry => Array.from({ length: entry.count }, () => {
    const { count, ...tile } = entry;
    return tile;
  }));
}

export function createGrid(config, rng) {
  const cells = expand(config.initial);
  for (let i = cells.length - 1; i > 0; i--) {
    const j = indexOfRandom(i + 1, rng);
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  return { cells, pool: expand(config.replenishments), reserves: expand(config.reserves) };
}

export function executeGrid(grid, points, config, rng) {
  const next = structuredClone(grid);
  const draws = [];
  const tokens = [];
  let spins = 0;
  for (let p = 0; p < points; p++) {
    const active = next.cells.flatMap((tile, i) => tile ? [i] : []);
    if (!active.length) break;
    const index = active[indexOfRandom(active.length, rng)];
    const tile = next.cells[index];
    next.cells[index] = null;
    let upgrade = null;
    if (tile.kind === 'symbol') tokens.push({ symbol: tile.symbol, units: tile.units });
    else {
      const effect = config.effects[tile.effect];
      spins += effect.spins ?? 0;
    }
    // Special inventory swaps with a random lower-ranked tile. Displaced inventory
    // is preserved in the refill pool, so extraction can eventually fill all reels.
    if (next.reserves.length) {
      const specialIndex = indexOfRandom(next.reserves.length, rng);
      const special = next.reserves[specialIndex];
      const candidates = next.cells.flatMap((cell, i) => cell?.kind === 'symbol' && config.ranks[cell.symbol] < config.ranks[special.symbol] ? [i] : []);
      if (candidates.length) {
        const target = candidates[indexOfRandom(candidates.length, rng)];
        next.pool.push(next.cells[target]);
        next.cells[target] = special;
        next.reserves.splice(specialIndex, 1);
        upgrade = { index: target, tile: special };
      }
    }
    const source = next.reserves.length && !next.pool.length ? next.reserves : next.pool;
    next.cells[index] = source.length ? source.splice(indexOfRandom(source.length, rng), 1)[0] : null;
    draws.push({ index, tile, replacement: next.cells[index], upgrade });
  }
  return { grid: next, draws, tokens, spins };
}
