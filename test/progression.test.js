import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createGame, transition} from '../src/domain/game.js';
import {wheelCategories, filledPositions, progressionStatus} from '../src/domain/progression.js';
import {seededRandom, wheelSectors} from '../src/domain/random.js';
import {validateConfig} from '../src/domain/config.js';

const load = async name => JSON.parse(await readFile(new URL(`../content/${name}.json`, import.meta.url),'utf8'));
const config = await load('game.config');
const decks = {wheel_1:await load('cards_wheel_1'), wheel_2:await load('cards_wheel_2')};
const full = () => Array.from({length:config.slots.reels}, () => Object.entries(config.slots.target).flatMap(([symbol,n])=>Array(n).fill(symbol)));
function stateWithFill(n) {
  const state = createGame(config, seededRandom(42));
  state.reels = full().map((reel,r)=>reel.map((symbol,p)=>r*config.slots.positions+p<n?symbol:config.slots.stone));
  return state;
}
const probability = state => wheelSectors(wheelCategories(state, config)).find(c=>c.behavior==='progression').probability;

test('adaptive weights match the smooth curve and pity while preserving other category ratios', () => {
  for (const [filled,p] of [[0,.005],[40,.02],[48,.06],[56,.18],[64,.4],[72,.65]]) assert.ok(Math.abs(probability(stateWithFill(filled))-p)<1e-10);
  const state=stateWithFill(55); state.appearances=2;
  assert.ok(probability(state)>0);
  state.reels=stateWithFill(56).reels; state.progressionMisses=3;
  assert.ok(Math.abs(probability(state)-.1875)<1e-10);
  state.progressionMisses=100;
  assert.ok(Math.abs(probability(state)-.43)<1e-10);
  const modified=structuredClone(config);
  modified.wheels.wheel_1.categories[0].weight=3;
  modified.wheels.wheel_1.categories[1].weight=0;
  const sectors=wheelSectors(wheelCategories(state,modified));
  assert.equal(sectors[1].probability,0);
  assert.ok(Math.abs(sectors[0].probability/sectors[2].probability-3)<1e-10);
  state.wheel=config.progression.nextWheel;
  assert.deepEqual(wheelCategories(state,config),config.wheels[state.wheel].categories);
});

test('early third flames remain possible and misses use pre-spin geometry', () => {
  const context={config,decks,rng:()=>.99999};
  let state=stateWithFill(0);
  for (let i=0;i<2;i++) {
    state=transition(state,{type:'SPIN_WHEEL'},context);
    state=transition(state,{type:'END_PROGRESSION'},context);
  }
  state=transition(state,{type:'SPIN_WHEEL'},context);
  assert.equal(state.appearances,3);
  assert.equal(state.phase,'progression');
  state=transition(state,{type:'END_PROGRESSION'},context);
  assert.equal(state.phase,'decision');
  assert.equal(state.wheel,config.progression.initialWheel);
  state=stateWithFill(56);
  const before=structuredClone(state);
  state=transition(state,{type:'SPIN_WHEEL'},{...context,rng:()=>0});
  assert.equal(state.progressionMisses,1);
  assert.ok(Math.abs(wheelSectors(state.spinCategories).at(-1).probability-.18)<1e-10);
  assert.ok(Math.abs(probability(state)-.1825)<1e-10);
  assert.equal(before.progressionMisses,0);
  state.phase='wheel';
  state=transition(state,{type:'SPIN_WHEEL'},context);
  assert.equal(state.progressionMisses,0);
});

test('smooth progression stays positive and has no gate jump or change after a flame', () => {
  let previous=0;
  for(let filled=0;filled<72;filled++){
    const state=stateWithFill(filled);
    const before=probability(state);state.appearances=2;
    assert.equal(probability(state),before);
    assert.ok(before>0 && before>=previous && before-previous<=.032);
    previous=before;
  }
});

test('large rewards stop at the cap and preserve every overflow symbol until the next wheel', () => {
  const rng=seededRandom(91),context={config,decks,rng};
  let state=stateWithFill(70);
  const tokens=full().flat().slice(70).map(symbol=>({symbol,units:1}));
  state.phase='grid'; state.extraction={tokens,draws:[]}; state.spins=config.final.maxSpins;
  state.appearances=config.progression.choiceAt; state.continued=true;
  state=transition(state,{type:'INSERT_TOKENS'},context);
  assert.equal(filledPositions(state,config),72);
  assert.equal(state.pendingTokens.reduce((n,t)=>n+t.units,0),8);
  assert.equal(state.wheel,config.progression.initialWheel);
  assert.equal(state.insertion.length,2);
  const turn=state.turn;
  state=transition(state,{type:'SHOW_PREVIEW'},{...context,rng:()=>{throw Error('UNEXPECTED_RANDOM');}});
  if(state.phase==='preview') state=transition(state,{type:'END_PREVIEW'},context);
  assert.equal(state.phase,'wheel_transition');
  assert.throws(()=>transition(state,{type:'SPIN_WHEEL'},context),/INVALID_ACTION/);
  state=transition(state,{type:'ADVANCE_WHEEL'},context);
  assert.equal(state.wheel,config.progression.nextWheel);
  assert.equal(filledPositions(state,config),72);
  state=transition(state,{type:'INSERT_TOKENS'},context);
  assert.equal(filledPositions(state,config),80);
  assert.equal(state.insertion.length,8);
  assert.deepEqual(state.pendingTokens,[]);
  assert.equal(state.turn,turn);
  state=transition(state,{type:'SHOW_PREVIEW'},context);
  if(state.phase==='preview') state=transition(state,{type:'END_PREVIEW'},context);
  assert.equal(state.phase,'finale');
  for(const reel of state.reels) for(const [symbol,n] of Object.entries(config.slots.target)) assert.equal(reel.filter(s=>s===symbol).length,n);
});

test('an earned spin waits for overflow symbols to finish installing on the next wheel', () => {
  const context={config,decks,rng:seededRandom(91)};
  let state=stateWithFill(70);
  state.phase='grid';
  state.extraction={tokens:full().flat().slice(70).map(symbol=>({symbol,units:1})),draws:[]};
  state.spins=1;state.pendingSpins=1;
  state=transition(state,{type:'INSERT_TOKENS'},context);
  state=transition(state,{type:'SHOW_PREVIEW'},context);
  if(state.phase==='preview') state=transition(state,{type:'END_PREVIEW'},context);
  assert.equal(state.phase,'wheel_transition');
  assert.equal(state.history.length,0);
  state=transition(state,{type:'ADVANCE_WHEEL'},context);
  state=transition(state,{type:'INSERT_TOKENS'},context);
  assert.equal(filledPositions(state,config),80);
  state=transition(state,{type:'SHOW_PREVIEW'},context);
  if(state.phase==='preview') state=transition(state,{type:'END_PREVIEW'},context);
  assert.equal(state.phase,'earned_ready');
  state=transition(state,{type:'SPIN_EARNED'},context);
  assert.equal(state.history.length,1);
  assert.equal(state.lastSpin.line.includes(config.slots.stone),false);
});

test('exact cap without overflow advances once and skips an unchanged maximum in wheel two', () => {
  const rng=seededRandom(5),context={config,decks,rng};
  let state=stateWithFill(71);
  state.phase='grid'; state.extraction={tokens:[{symbol:full().flat()[71],units:1}],draws:[]};
  state=transition(state,{type:'INSERT_TOKENS'},context);
  state=transition(state,{type:'SHOW_PREVIEW'},context);
  if(state.phase==='preview') state=transition(state,{type:'END_PREVIEW'},context);
  assert.equal(state.phase,'wheel_transition');
  state=transition(state,{type:'ADVANCE_WHEEL'},context);
  state=transition(state,{type:'INSERT_TOKENS'},context);
  assert.equal(state.insertion.length,0);
  state=transition(state,{type:'SHOW_PREVIEW'},context);
  assert.equal(state.newMaximum,false);
  assert.equal(state.phase,'wheel');
  assert.equal(state.wheel,config.progression.nextWheel);
});

test('invalid adaptive curves, limits and unavailable challenge weights are rejected', () => {
  const changes=[a=>a.minimumFill=.95,a=>a.maximumFill=1,a=>a.perMiss=-1,a=>a.probabilityCeiling=2,a=>a.curve=[[0,.1],[0,.2],[1,.9]]];
  for(const change of changes) {
    const invalid=structuredClone(config); change(invalid.progression.adaptive);
    assert.throws(()=>validateConfig(invalid,decks),/CONFIG:ADAPTIVE/);
  }
  const invalid=structuredClone(config);
  invalid.wheels.wheel_1.categories.forEach(c=>c.weight=c.behavior==='progression'?1:0);
  assert.throws(()=>validateConfig(invalid,decks),/ADAPTIVE_CATEGORIES/);
});
