import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createGame, transition, shouldFinishOnCompletion} from '../src/domain/game.js';
import {seededRandom, wheelSectors} from '../src/domain/random.js';
import {categoriesFor, filled, resolveCard, runGame} from '../research/progression/engine.mjs';

const load = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const config = await load('../content/game.config.json');
const decks = {wheel_1:await load('../content/cards_wheel_1.json'), wheel_2:await load('../content/cards_wheel_2.json')};
const experiment = await load('../research/progression/models.json');

test('research baseline agrees with production transitions, excluding unpaid previews', () => {
  const profile = experiment.profiles[0], model = experiment.models[0];
  for (const choice of [false, true]) for (const seed of [7, 42, 71, 130]) {
    const rng = seededRandom(seed), context = {config, decks, rng}, events = [];
    let state = createGame(config, rng), entry = null, firstTurns = 0, fullInWheel1 = false;
    const send = action => {state = transition(state, action, context);};
    while (state.phase !== 'finished' && state.turn < experiment.maxTurns) {
      const oldWheel = state.wheel;
      switch (state.phase) {
        case 'wheel':send({type:'SPIN_WHEEL'}); events.push({type:'category', id:state.category.id}); break;
        case 'category':send({type:'SHOW_CARDS'}); break;
        case 'cards':send({type:'PICK_CARD'}); events.push({type:'card', id:state.card.id}); break;
        case 'offer':
          if (rng() < profile.accept) send({type:'ACCEPT'});
          else {send({type:'REJECT'}); events.push({type:'reject'});}
          break;
        case 'challenge': {
          const result = resolveCard(state.card, profile, rng);
          send({type:'RESOLVE', ...result}); events.push({type:'resolve', ...result, points:state.points}); break;
        }
        case 'reward':send({type:'EXECUTE_GRID'}); break;
        case 'grid':
          send({type:'INSERT_TOKENS'});
          events.push({type:'reward', reels:state.reels, grid:state.grid, spins:state.spins});
          fullInWheel1 ||= state.wheel === config.progression.initialWheel && filled(state.reels, config) === 80;
          break;
        case 'machine':
          if (shouldFinishOnCompletion(state, config)) send({type:'SHOW_PREVIEW'});
          else state = {...state, phase:'wheel', card:null, extraction:null};
          break;
        case 'progression':send({type:'END_PROGRESSION'}); break;
        case 'decision':send({type:'CHOOSE_PROGRESSION', continue:choice}); break;
        case 'finale':send({type:'START_FINAL'}); break;
        case 'final_ready':send({type:'SPIN_FINAL'}); break;
        case 'final_result':send({type:'END_FINAL_RESULT'}); break;
        default:throw Error(state.phase);
      }
      if (state.wheel !== oldWheel) {entry = filled(state.reels, config); firstTurns = state.turn;}
    }
    const actual = runGame(config, decks, {...experiment, autoFinishWhenComplete:config.final.autoFinishWhenComplete}, model, profile, choice, seed, true);
    assert.deepEqual(actual.events, events);
    assert.deepEqual(actual.reels, state.reels);
    assert.deepEqual(actual.grid, state.grid);
    assert.deepEqual(actual.outcomes, state.history);
    assert.equal(actual.total, state.total);
    assert.equal(actual.entry, entry);
    assert.equal(actual.wheel1Turns, firstTurns);
    assert.equal(actual.fullInWheel1, fullInWheel1);
  }
});

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
    const r = runGame(config, decks, experiment, model, experiment.profiles[2], choice, seed, true);
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
