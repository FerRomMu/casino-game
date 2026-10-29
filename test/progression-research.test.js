import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {wheelSectors} from '../src/domain/random.js';
import {categoriesFor, runGame} from '../research/progression/engine.mjs';

const load = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const config = await load('../content/game.config.json');
// Historical research modeled a 10% finale sector. Keep that model stable.
const legacyConfig = structuredClone(config);
legacyConfig.wheels.wheel_2.categories[3] = {
  ...legacyConfig.wheels.wheel_2.categories[3],
  id:'w2_cat_4_finale', behavior:'finale',
};
const decks = {wheel_1:await load('../content/cards_wheel_1.json'), wheel_2:await load('../content/cards_wheel_2.json')};
const experiment = await load('../research/progression/models.json');

test('research gates, waiting increases and proportional wheel weights are respected', () => {
  const fast = experiment.models.find(m => m.id === 'bounded_fast');
  const at = (fraction, appearances, misses = 0) => wheelSectors(categoriesFor(config, fast, {fraction, appearances, misses, eligibleMisses:misses}));
  const progression = sectors => sectors.find(c => c.behavior === 'progression').probability;
  assert.equal(progression(at(.69, 2)), 0);
  assert.ok(Math.abs(progression(at(.7, 2)) - .35) < 1e-10);
  assert.ok(progression(at(.7, 2, 3)) > progression(at(.7, 2)));
  assert.ok(progression(at(.8, 2)) > progression(at(.7, 2)));
  const others = at(.8, 2).filter(c => c.behavior !== 'progression');
  assert.ok(others.every(c => Math.abs(c.probability - others[0].probability) < 1e-10));
});

test('bounded models preserve overflow and enforce limits including continued play', () => {
  let overflowSeen = false;
  for (const model of experiment.models.filter(m => m.cap)) for (const choice of [false, true]) for (let seed = 1; seed <= 50; seed++) {
    const r = runGame(legacyConfig, decks, experiment, model, experiment.profiles[2], choice, seed, true);
    assert.equal(r.timeout, false);
    assert.ok(r.entry >= 56 && r.entry <= model.cap * 80);
    assert.equal(r.fullInWheel1, false);
    assert.equal(r.effectiveEntry, r.entry + r.deferredUnits);
    assert.ok(r.finalFill >= r.effectiveEntry && r.finalFill <= 80);
    assert.ok(r.finalSpins >= 3 && r.finalSpins <= 5);
    const remaining = [...r.grid.cells, ...r.grid.pool, ...r.grid.reserves]
      .reduce((sum, tile) => sum + (tile?.kind === 'symbol' ? tile.units : 0), 0);
    assert.equal(r.finalFill + remaining, config.slots.reels * config.slots.positions);
    overflowSeen ||= r.deferredUnits > 0;
  }
  assert.ok(overflowSeen);
});

test('all-rejected play times out rather than claiming an impossible gated transition', () => {
  const model = experiment.models.find(m => m.id === 'bounded_fast');
  const r = runGame(config, decks, {...experiment, maxTurns:100}, model, {accept:0, success:0, numeric:'uniform'}, false, 42);
  assert.equal(r.timeout, true);
  assert.equal(r.entry, null);
  assert.equal(r.finalFill, 0);
});
