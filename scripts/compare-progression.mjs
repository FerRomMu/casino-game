import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {validateConfig} from '../src/domain/config.js';
import {runGame} from '../research/progression/engine.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
};
const content = arg('content', 'content');
const experimentPath = arg('experiment', 'research/progression/models.json');
const experiment = JSON.parse(await readFile(experimentPath, 'utf8'));
const files = ['game.config', 'cards_wheel_1', 'cards_wheel_2'];
const sources = await Promise.all(files.map(name => readFile(`${content}/${name}.json`, 'utf8')));
const [config, wheel_1, wheel_2] = sources.map(JSON.parse), decks = {wheel_1, wheel_2};
validateConfig(config, decks);
const games = Number(arg('games', experiment.gamesPerScenario));
const seed = Number(arg('seed', experiment.seed));
if (!Number.isSafeInteger(games) || games < 1 || !Number.isSafeInteger(seed)) throw Error('INVALID_ARGUMENTS');
const capacity = config.slots.reels * config.slots.positions;

function stats(values) {
  const sorted = values.filter(v => v !== null).sort((a, b) => a - b);
  const q = p => sorted.length ? sorted[Math.floor((sorted.length - 1) * p)] : null;
  return {n:sorted.length, mean:sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : null,
    min:q(0), p10:q(.1), q1:q(.25), median:q(.5), q3:q(.75), p90:q(.9), p95:q(.95), max:q(1)};
}
function rate(results, predicate) {
  const n = results.length, hits = results.filter(predicate).length, p = hits / n, z = 1.96;
  const denominator = 1 + z*z/n, center = (p + z*z/(2*n))/denominator;
  const delta = z*Math.sqrt(p*(1-p)/n + z*z/(4*n*n))/denominator;
  return {hits, n, percent:p*100, ci95:[Math.max(0, center-delta)*100, Math.min(1, center+delta)*100]};
}
function summarize(results) {
  const min = Math.ceil(experiment.target.minimum * capacity), max = Math.floor(experiment.target.maximum * capacity);
  return {
    samples:results.length,
    inRange:rate(results, r => r.entry !== null && r.entry >= min && r.entry <= max),
    effectiveInRange:rate(results, r => r.effectiveEntry !== null && r.effectiveEntry >= min && r.effectiveEntry <= max),
    belowRange:rate(results, r => r.entry !== null && r.entry < min),
    aboveRange:rate(results, r => r.entry !== null && r.entry > max),
    fullInWheel1:rate(results, r => r.fullInWheel1),
    forced:rate(results, r => r.forced),
    choiceOffered:rate(results, r => r.choiceOffered),
    timeouts:rate(results, r => r.timeout),
    completedAtFinal:rate(results, r => !r.timeout && r.finalFill === capacity),
    fullEffectiveEntry:rate(results, r => r.effectiveEntry === capacity),
    entry:stats(results.map(r => r.entry)), effectiveEntry:stats(results.map(r => r.effectiveEntry)),
    deferredUnits:stats(results.map(r => r.deferredUnits)),
    wheel1Turns:stats(results.map(r => r.wheel1Turns)), wheel2Turns:stats(results.map(r => r.wheel2Turns)),
    finalFill:stats(results.filter(r => !r.timeout).map(r => r.finalFill)),
    finalSpins:stats(results.filter(r => !r.timeout).map(r => r.finalSpins)),
    finalTotal:stats(results.map(r => r.total)),
    entryHistogram:Array.from({length:capacity + 1}, (_, i) => results.filter(r => r.entry === i).length),
  };
}

const scenarios = [], pooled = new Map();
for (const model of experiment.models) {
  const all = [];
  for (let p = 0; p < experiment.profiles.length; p++) for (const choice of experiment.choices) {
    const profile = experiment.profiles[p], results = [];
    for (let game = 0; game < games; game++) {
      // Same independent game seeds across policies; different profile/choice blocks.
      const gameSeed = (seed + Math.imul(game + 1, 0x9e3779b1) + Math.imul(p + 1, 0x85ebca6b) + (choice ? 0xc2b2ae35 : 0)) >>> 0;
      results.push(runGame(config, decks, experiment, model, profile, choice, gameSeed));
    }
    all.push(...results);
    const summary = summarize(results);
    scenarios.push({model:model.id, profile:profile.id, continueAtChoice:choice, ...summary});
    console.log(`${model.id} / ${profile.id} / continue=${choice}: range=${summary.inRange.percent.toFixed(1)}% effective=${summary.effectiveInRange.percent.toFixed(1)}% full=${summary.fullInWheel1.percent.toFixed(1)}% turns=${summary.wheel1Turns.median} timeout=${summary.timeouts.hits}`);
  }
  pooled.set(model.id, summarize(all));
}
const report = {
  seed, gamesPerScenario:games, totalGames:scenarios.length * games, capacity,
  sourceHashes:Object.fromEntries(files.map((name, i) => [name, createHash('sha256').update(sources[i]).digest('hex')])),
  experiment,
  assumptions:{
    contentMode:config.contentMode,
    simulation:'domain grid/insertion/selection/payments; UI and unpaid previews omitted',
    acceptance:'independent Bernoulli per offered card; rejection has no reward penalty',
    numeric:'uniform for typical (existing simulator); binomial(maximum, success) for other profiles',
    choices:'always pass and always continue are separate scenarios',
    overflow:'split reward at cap; remainder credited immediately on entry; effectiveEntry includes remainder',
    timing:'wheel spins, not minutes: challenge durations are unspecified',
    wheel2:'unchanged; 10% finale on every spin, including first',
    aggregate:'equal-weight synthetic profile/choice mixture; not a measured player population',
    intervals:'Wilson marginal 95%; probabilities estimated from independent seeded games',
  },
  aggregates:[...pooled].map(([model, summary]) => ({model, ...summary})), scenarios,
};
const out = arg('out', 'artifacts/progression-comparison.json');
await mkdir(new URL('.', new URL(out, `file://${process.cwd()}/`)), {recursive:true});
await writeFile(out, JSON.stringify(report, null, 2) + '\n');
console.log(`Saved ${report.totalGames} games to ${out}`);
