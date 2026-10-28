export function filledPositions(state, config) {
  return state.reels.reduce((n, reel) => n + reel.filter(s => s !== config.slots.stone).length, 0);
}

export function adaptiveProgression(state, config) {
  return state.wheel === config.progression.initialWheel && config.progression.adaptive?.enabled
    ? config.progression.adaptive : null;
}

export function progressionStatus(state, config) {
  const rules = adaptiveProgression(state, config);
  const capacity = config.slots.reels * config.slots.positions;
  const filled = filledPositions(state, config);
  return {
    rules, filled, fraction:filled / capacity,
    locked:!!rules && filled < Math.ceil(capacity * rules.minimumFill) && state.appearances >= config.progression.choiceAt - 1,
    atLimit:!!rules && filled >= Math.floor(capacity * rules.maximumFill),
  };
}

// Both SVG geometry and selection consume these weights. Other category ratios
// are preserved; zero-weight categories stay excluded.
export function wheelCategories(state, config) {
  const categories = config.wheels[state.wheel].categories;
  const {rules, fraction, locked} = progressionStatus(state, config);
  if (!rules) return categories;
  let probability = rules.curve.at(-1)[1];
  for (let i = 1; i < rules.curve.length; i++) {
    const [a, pa] = rules.curve[i - 1], [b, pb] = rules.curve[i];
    if (fraction <= b) { probability = pa + (pb - pa) * Math.max(0, (fraction - a) / (b - a)); break; }
  }
  if (fraction >= rules.pityFrom) probability += (state.progressionMisses ?? 0) * rules.perMiss;
  probability = locked ? 0 : Math.min(rules.probabilityCeiling, probability);
  const others = categories.filter(c => c.behavior !== 'progression').reduce((n, c) => n + c.weight, 0);
  return categories.map(c => ({...c, weight:c.behavior === 'progression' ? probability : (1 - probability) * c.weight / others}));
}

export function splitAtProgressionLimit(state, tokens, config) {
  const {rules, filled} = progressionStatus(state, config);
  if (!rules) return {tokens, pending:[]};
  let remaining = Math.max(0, Math.floor(config.slots.reels * config.slots.positions * rules.maximumFill) - filled);
  const allowed = [], pending = [];
  for (const token of tokens) {
    const units = Math.min(token.units, remaining);
    if (units) allowed.push({...token, units});
    if (token.units > units) pending.push({...token, units:token.units - units});
    remaining -= units;
  }
  return {tokens:allowed, pending};
}
