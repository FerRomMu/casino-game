import {createGrid, executeGrid} from '../../src/domain/grid.js';
import {createReels, insertTokens, spinSlots} from '../../src/domain/slots.js';
import {selectCategory, indexOfRandom, seededRandom} from '../../src/domain/random.js';

export const filled = (reels, config) => reels.flat().filter(s => s !== config.slots.stone).length;

function interpolate(points, x) {
  for (let i = 1; i < points.length; i++) {
    const [a, pa] = points[i - 1], [b, pb] = points[i];
    if (x <= b) return pa + (pb - pa) * Math.max(0, (x - a) / (b - a));
  }
  return points.at(-1)[1];
}

export function categoriesFor(config, model, state) {
  const categories = config.wheels[config.progression.initialWheel].categories;
  if (model.kind === 'current') return categories;
  let p = model.kind === 'threshold' ? 0 : model.kind === 'waiting'
    ? Math.min(model.ceiling, model.base + state.misses * model.perMiss)
    : interpolate(model.curve, state.fraction);
  if (model.pityFrom !== undefined && state.fraction >= model.pityFrom) {
    p = Math.min(model.ceiling, p + state.eligibleMisses * model.perMiss);
  }
  if (model.gate && state.fraction < model.gate && state.appearances >= config.progression.choiceAt - 1) p = 0;
  const others = categories.filter(c => c.behavior !== 'progression').reduce((sum, c) => sum + c.weight, 0);
  return categories.map(c => ({...c, weight: c.behavior === 'progression' ? p : (1 - p) * c.weight / others}));
}

export function resolveCard(card, profile, rng) {
  if (card.resolution !== 'numeric') return {success: rng() < profile.success};
  const result = profile.numeric === 'uniform' ? indexOfRandom(card.maximum + 1, rng)
    : Array.from({length: card.maximum}, () => rng() < profile.success).filter(Boolean).length;
  return {result};
}

// This research runner omits UI phases and unpaid preview RNG draws. The real
// grid, insertion, weighted selection and payment functions remain authoritative.
// A trace equivalence test compares the unmodified policy with transition().
export function runGame(config, decks, experiment, model, profile, continueAtChoice, seed, trace = false) {
  const rng = seededRandom(seed), capacity = config.slots.reels * config.slots.positions;
  let grid = createGrid(config.grid, rng), reels = createReels(config.slots);
  let wheel = config.progression.initialWheel, appearances = 0, spins = 0;
  let misses = 0, eligibleMisses = 0, turn = 0, entry = null, forced = false, carried = [];
  let wheel1Turns = 0, wheel2Turns = 0, fullInWheel1 = false, continued = false, choiceOffered = false;
  const used = new Set(), events = [];
  const emit = value => {if (trace) events.push(value);};
  const enterNext = () => {
    entry = filled(reels, config);
    wheel = config.progression.nextWheel;
    wheel1Turns = turn;
  };
  const byCategory = Object.fromEntries(Object.values(decks).flat().map(card => [card.category, []]));
  for (const cards of Object.values(decks)) for (const card of cards) byCategory[card.category].push(card);
  let deferredUnits = 0;
  while (turn < experiment.maxTurns) {
    const first = wheel === config.progression.initialWheel;
    const fraction = filled(reels, config) / capacity;
    const categories = first ? categoriesFor(config, model, {fraction, appearances, misses, eligibleMisses}) : config.wheels[wheel].categories;
    const category = selectCategory(categories, rng);
    turn++;
    if (!first) wheel2Turns++;
    emit({type:'category', id:category.id});
    if (category.behavior === 'progression') {
      appearances++; misses = 0; eligibleMisses = 0;
      if (appearances === config.progression.choiceAt) {
        choiceOffered = true;
        continued = continueAtChoice;
        if (!continued) enterNext();
      } else if (appearances >= config.progression.forceAt) enterNext();
      continue;
    }
    if (category.behavior === 'finale') {
      // Overflow is credited at entry into wheel_2, before its first spin (below).
      const count = Math.max(config.final.minSpins, Math.min(config.final.maxSpins, spins));
      const outcomes = Array.from({length:count}, () => spinSlots(reels, config.slots, rng));
      return {entry, effectiveEntry:entry + deferredUnits, deferredUnits, forced, fullInWheel1,
        wheel1Turns, wheel2Turns, turns:turn, finalFill:filled(reels, config), finalSpins:count,
        total:outcomes.reduce((sum, s) => sum + s.payout, 0), timeout:false, choiceOffered, continued,
        ...(trace ? {events, reels, grid, outcomes} : {})};
    }
    if (first) {
      misses++;
      eligibleMisses = model.pityFrom !== undefined && fraction >= model.pityFrom ? eligibleMisses + 1 : 0;
    }
    const cards = byCategory[category.id];
    let available = cards.filter(c => !used.has(c.id));
    if (!available.length) {for (const card of cards) used.delete(card.id); available = cards;}
    const card = available[indexOfRandom(available.length, rng)];
    used.add(card.id); emit({type:'card', id:card.id});
    if (rng() >= profile.accept) {emit({type:'reject'}); continue;}
    const result = resolveCard(card, profile, rng);
    const points = card.resolution === 'numeric' ? card.reward.byResult[result.result] : result.success ? card.reward.success : card.reward.failure;
    emit({type:'resolve', ...result, points});
    if (points <= 0) continue;
    const extraction = executeGrid(grid, points, config.grid, rng);
    grid = extraction.grid;
    spins = Math.min(config.final.maxSpins, spins + extraction.spins);
    let tokens = extraction.tokens;
    if (first && model.cap) {
      let remaining = Math.floor(capacity * model.cap) - filled(reels, config);
      const allowed = [];
      for (const token of tokens) {
        const units = Math.min(token.units, remaining);
        if (units) allowed.push({...token, units});
        if (token.units > units) carried.push({...token, units:token.units - units});
        remaining -= units;
      }
      tokens = allowed;
    }
    const insertion = insertTokens(reels, tokens, config.slots, rng);
    reels = insertion.reels;
    emit({type:'reward', reels, grid, spins});
    if (first) {
      fullInWheel1 ||= filled(reels, config) === capacity;
      if (model.cap && filled(reels, config) >= Math.floor(capacity * model.cap)) {
        forced = true; enterNext();
        deferredUnits = carried.reduce((sum, token) => sum + token.units, 0);
        // Report both boundary fill and actual fill after crediting ALL winnings.
        // This prevents a nominal 90% cap from hiding a 100% effective entry.
        reels = insertTokens(reels, carried, config.slots, rng).reels;
        carried = [];
      }
    }
  }
  return {entry, effectiveEntry:entry === null ? null : entry + deferredUnits, deferredUnits,
    forced, fullInWheel1, wheel1Turns:entry === null ? turn : wheel1Turns, wheel2Turns, turns:turn,
    finalFill:filled(reels, config), finalSpins:0, total:null, timeout:true, choiceOffered, continued,
    ...(trace ? {events, reels, grid} : {})};
}
