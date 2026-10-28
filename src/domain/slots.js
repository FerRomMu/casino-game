import { indexOfRandom } from './random.js';

export function createReels(config) {
  return Array.from({ length: config.reels }, () => Array(config.positions).fill(config.stone));
}

export function insertTokens(reels, tokens, config, rng) {
  const result = reels.map(reel => [...reel]);
  const inserted = [];
  for (const token of tokens) {
    for (let unit = 0; unit < token.units; unit++) {
      const eligible = result.map((reel, index) => ({ reel, index })).filter(({ reel }) =>
        reel.includes(config.stone) && reel.filter(s => s === token.symbol).length < config.target[token.symbol]);
      if (!eligible.length) throw new Error(`SYMBOL_CAPACITY:${token.symbol}`);
      // Balance insertions across reels without exceeding the target distribution.
      const minimum = Math.min(...eligible.map(({ reel }) => reel.filter(s => s === token.symbol).length));
      const balanced = eligible.filter(({ reel }) => reel.filter(s => s === token.symbol).length === minimum);
      const { reel, index } = balanced[indexOfRandom(balanced.length, rng)];
      const stones = reel.flatMap((s, i) => s === config.stone ? [i] : []);
      const position = stones[indexOfRandom(stones.length, rng)];
      reel[position] = token.symbol;
      inserted.push({ symbol: token.symbol, reel: index, position });
    }
  }
  return { reels: result, inserted };
}

// The same evaluator drives payment and the explanation shown by the UI.
function scoreLine(line, config, details = false) {
  const rules = config.payout;
  const exceptional = line.every(s => s === rules.exceptional.symbol);
  const wilds = line.filter(s => s === config.wild).length;
  let base = 0, winningSymbol = null;
  if (exceptional) {
    base = rules.exceptional.value;
    winningSymbol = rules.exceptional.symbol;
  } else {
    for (const [symbol, values] of Object.entries(rules.table)) {
      const natural = line.filter(s => s === symbol).length;
      if (rules.wildRequiresNatural && natural === 0) continue;
      const prize = values[natural + wilds] ?? 0;
      // Ties use the first paying combination, rather than highlighting unpaid ones.
      if (prize > base) { base = prize; winningSymbol = symbol; }
    }
  }
  const multiplier = !exceptional && line.includes(config.multiplier) ? rules.multiplier : 1;
  const payout = base * multiplier;
  if (!details) return payout;
  return {
    payout, base, multiplier, winningSymbol, exceptional,
    winningIndices: payout > 0 ? line.flatMap((symbol, i) => symbol === winningSymbol || (!exceptional && symbol === config.wild) ? [i] : []) : [],
    // Repeated multipliers do not stack. Highlight the single applied multiplier.
    multiplierIndices: payout > 0 && multiplier !== 1 ? [line.indexOf(config.multiplier)] : [],
  };
}

export function evaluateLine(line, config) {
  return scoreLine(line, config);
}

export function explainLine(line, config) {
  return scoreLine(line, config, true);
}

export function spinSlots(reels, config, rng) {
  const stops = reels.map(reel => indexOfRandom(reel.length, rng));
  const line = reels.map((reel, i) => reel[stops[i]]);
  return { stops, line, ...explainLine(line, config) };
}

// Enumerate symbol combinations, aggregating identical positions. Exact, not Monte Carlo.
export function analyzeSlots(reels, config) {
  const distributions = reels.map(reel => {
    const counts = new Map();
    for (const symbol of reel) counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
    return [...counts].map(([symbol, count]) => ({ symbol, probability: count / reel.length }));
  });
  const outcomes = [];
  function visit(reel, line, probability) {
    if (reel === distributions.length) {
      outcomes.push({ line, probability, payout: evaluateLine(line, config) });
      return;
    }
    for (const entry of distributions[reel]) visit(reel + 1, [...line, entry.symbol], probability * entry.probability);
  }
  visit(0, [], 1);
  const expected = outcomes.reduce((sum, o) => sum + o.payout * o.probability, 0);
  const ordinary = config.payout.ordinary;
  const exceptional = config.payout.exceptional;
  const probabilities = new Map();
  for (const outcome of outcomes) probabilities.set(outcome.payout, (probabilities.get(outcome.payout) ?? 0) + outcome.probability);
  return {
    expected: Math.ceil(Number(expected.toFixed(8))),
    representative: outcomes.filter(o => o.payout >= expected - 1e-8).sort((a, b) => a.payout - b.payout)[0],
    maximum: outcomes.reduce((best, o) => o.payout > best.payout ? o : best),
    ordinaryProbability: outcomes.filter(o => o.payout >= ordinary && !o.line.every(s => s === exceptional.symbol)).reduce((s, o) => s + o.probability, 0),
    exceptionalProbability: outcomes.filter(o => o.line.every(s => s === exceptional.symbol)).reduce((s, o) => s + o.probability, 0),
    distribution: [...probabilities].map(([payout, probability]) => ({payout, probability})).sort((a,b) => a.payout-b.payout)
  };
}

// Reachability depends on which symbols exist on each reel, not their frequency.
// Enumerate actual lines so wilds, multipliers and competing payouts obey exactly
// the same rules as a paid spin. No random numbers or UI state are involved.
export function attainablePrizes(reels, config) {
  const rows = Object.keys(config.payout.table).map(symbol => ({
    symbol,
    counts: Array.from({length: reels.length}, (_, i) => ({count: i + 1, normal: null, multiplied: null})),
  }));
  const bySymbol = new Map(rows.map(row => [row.symbol, row]));
  const jackpot = {payout: config.payout.exceptional.value, available: false};
  let maximum = 0;
  const symbols = reels.map(reel => [...new Set(reel)]);
  function visit(index, line) {
    if (index < symbols.length) {
      for (const symbol of symbols[index]) visit(index + 1, [...line, symbol]);
      return;
    }
    const result = explainLine(line, config);
    maximum = Math.max(maximum, result.payout);
    if (result.payout <= 0) return;
    if (result.exceptional) { jackpot.available = true; return; }
    const cell = bySymbol.get(result.winningSymbol)?.counts[result.winningIndices.length - 1];
    if (cell) cell[result.multiplier === 1 ? 'normal' : 'multiplied'] = result.payout;
  }
  visit(0, []);
  return {rows, jackpot, maximum};
}
