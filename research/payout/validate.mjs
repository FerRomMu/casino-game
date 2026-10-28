// Cross-check search results with the authoritative domain; never change content.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {analyzeSlots, spinSlots} from '../../src/domain/slots.js';
import {seededRandom} from '../../src/domain/random.js';

const path = process.argv[2] ?? 'artifacts/payout-search.json';
const report = JSON.parse(await readFile(path, 'utf8'));
const source = await readFile('content/game.config.json');
const config = JSON.parse(source);
assert.equal(createHash('sha256').update(source).digest('hex'), report.sourceHash);
const reels = Array.from({length:config.slots.reels}, () => Object.entries(config.slots.target)
  .flatMap(([symbol, count]) => Array(count).fill(symbol)));
for (const model of report.models) {
  const slots = {...config.slots, payout:{...config.slots.payout, table:model.table}};
  const exact = analyzeSlots(reels, slots);
  assert.equal(exact.distribution.length, model.perSpinDistribution.length);
  for (const [i, item] of exact.distribution.entries()) {
    assert.equal(item.payout, model.perSpinDistribution[i].payout);
    assert.ok(Math.abs(item.probability - model.perSpinDistribution[i].probability) < 1e-12);
  }
  assert.ok(Math.abs(exact.ordinaryProbability - model.perSpinOrdinaryJackpot) < 1e-12);
  assert.ok(Math.abs(exact.exceptionalProbability - model.perSpinExceptionalJackpot) < 1e-12);
  console.log(`${model.model}: domain distribution verified`);
}

const best = report.models.reduce((a, b) => b.objective < a.objective ? b : a);
const slots = {...config.slots, payout:{...config.slots.payout, table:best.table}};
const rng = seededRandom(report.experiment.seed + 1);
const samples = report.experiment.validationFinals;
const totals = new Uint32Array(samples);
let ordinary = 0, exceptional = 0, million = 0;
for (let i = 0; i < samples; i++) {
  for (let spin = 0; spin < config.final.maxSpins; spin++) {
    const result = spinSlots(reels, slots, rng);
    totals[i] += result.payout;
    if (result.exceptional) exceptional++;
    else if (result.payout >= config.slots.payout.ordinary) ordinary++;
  }
  if (totals[i] >= config.slots.payout.ordinary) million++;
}
totals.sort();
const quantiles = Object.fromEntries(Object.keys(best.quantiles).map(p => [p, totals[Math.ceil(Number(p) * samples) - 1]]));
const predictedRate = best.probabilityMillionOrMore;
const standardError = Math.sqrt(predictedRate * (1 - predictedRate) / samples);
assert.ok(Math.abs(million / samples - predictedRate) < 6 * standardError);
// DKW-style conservative bound checks the whole sampled CDF against convolution.
const tolerance = Math.sqrt(Math.log(2 / 1e-6) / (2 * samples));
let seen = 0, expected = 0, maximumCdfError = 0;
for (const point of best.totalDistribution) {
  while (seen < samples && totals[seen] < point.payout) seen++;
  maximumCdfError = Math.max(maximumCdfError, Math.abs(seen / samples - expected));
  while (seen < samples && totals[seen] === point.payout) seen++;
  expected += point.probability;
  maximumCdfError = Math.max(maximumCdfError, Math.abs(seen / samples - expected));
}
assert.ok(maximumCdfError < tolerance, `CDF error ${maximumCdfError} > ${tolerance}`);
report.validation = {model:best.model, seed:report.experiment.seed + 1, samples,
  paidSpins:samples * config.final.maxSpins, quantiles, millionOrMore: million / samples,
  ordinarySpinHits:ordinary, exceptionalSpinHits:exceptional, maximumCdfError, tolerance,
  perSpinDomainDistributionsVerified:report.models.length};
await writeFile(path, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.validation));
