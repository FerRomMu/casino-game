import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { seededRandom, selectCategory, wheelSectors } from '../src/domain/random.js';
import { validateConfig } from '../src/domain/config.js';
import { createGame, transition } from '../src/domain/game.js';
import { createGrid, executeGrid } from '../src/domain/grid.js';
import { createReels, insertTokens, evaluateLine, analyzeSlots } from '../src/domain/slots.js';
import { translator } from '../src/ui/content.js';

const load = async name => JSON.parse(await readFile(new URL(`../content/${name}.json`,import.meta.url),'utf8'));
const config = await load('game.config');
const decks = {wheel_1:await load('cards_wheel_1'),wheel_2:await load('cards_wheel_2')};
const setup = (seed=1) => {
  const rng = seededRandom(seed);
  return {state:createGame(config,rng),context:{config,decks,rng}};
};
const forced = id => {
  const clone = structuredClone(config);
  for (const wheel of Object.values(clone.wheels)) for (const cat of wheel.categories) cat.weight = cat.id === id ? 1 : 0;
  return clone;
};

test('configuration validates inventory, reel sizes and deck structures',()=>{
  assert.equal(validateConfig(config,decks),config);
  const invalid = structuredClone(config);
  invalid.grid.reserves[0].units++;
  assert.throws(()=>validateConfig(invalid,decks),/INVENTORY/);
});

test('weighted geometry and category selection use identical boundaries including zero weights',()=>{
  const cats=[{id:'a',weight:33},{id:'b',weight:67},{id:'c',weight:0}];
  const sectors=wheelSectors(cats);
  assert.equal(sectors[0].probability,.33);
  assert.equal(sectors[0].end,sectors[1].start);
  assert.equal(selectCategory(cats,()=>.329999).id,'a');
  assert.equal(selectCategory(cats,()=>.33).id,'b');
  assert.equal(selectCategory(cats,()=>.999999).id,'b');
  const rng=seededRandom(9);
  let first=0;
  for(let i=0;i<100000;i++) if(selectCategory(cats,rng).id==='a')first++;
  assert.ok(Math.abs(first/100000-.33)<.005);
  assert.throws(()=>wheelSectors([{weight:0}]),/WEIGHTS/);
  assert.throws(()=>wheelSectors([{weight:-1}]),/WEIGHTS/);
});

test('seeded game transitions are reproducible and do not mutate input',()=>{
  const a=setup(42),b=setup(42);
  const original=structuredClone(a.state);
  const one=transition(a.state,{type:'SPIN_WHEEL'},a.context);
  const two=transition(b.state,{type:'SPIN_WHEEL'},b.context);
  assert.deepEqual(one,two);
  assert.deepEqual(a.state,original);
  assert.throws(()=>transition(one,{type:'SPIN_WHEEL'},a.context),/INVALID_ACTION/);
});

test('third progression offers a choice, fourth forces transition, independent participants',()=>{
  const {context,state:initial}=setup();
  context.config=forced('cat_7_progression');
  let state=initial;
  for(let i=1;i<=3;i++) {
    state=transition(state,{type:'SPIN_WHEEL'},context);
    assert.equal(state.phase,'progression');
    assert.throws(()=>transition(state,{type:'SPIN_WHEEL'},context),/INVALID_ACTION/);
    state=transition(state,{type:'END_PROGRESSION'},context);
    assert.equal(state.progression,i);
  }
  assert.equal(state.phase,'decision');
  const passed=transition(state,{type:'CHOOSE_PROGRESSION',continue:false},context);
  assert.equal(passed.wheel,'wheel_2');
  state=transition(state,{type:'CHOOSE_PROGRESSION',continue:true},context);
  assert.equal(state.wheel,'wheel_1');
  state=transition(state,{type:'SPIN_WHEEL'},context);
  state=transition(state,{type:'END_PROGRESSION'},context);
  assert.equal(state.wheel,'wheel_2');
  assert.equal(state.progression,3);
  assert.equal(initial.progression,0);
});

test('rejecting a card at offer or during challenge preserves inventory, points and spins',()=>{
  const {state:initial,context}=setup();
  context.config=forced('cat_1');
  let state=transition(initial,{type:'SPIN_WHEEL'},context);
  state=transition(state,{type:'SHOW_CARDS'},context);
  state=transition(state,{type:'PICK_CARD'},context);
  for(const offered of [state,transition(state,{type:'ACCEPT'},context)]){
    const rejected=transition(offered,{type:'REJECT'},context);
    assert.equal(rejected.phase,'wheel');
    for(const key of ['grid','reels','spins','points','total','progression'])assert.deepEqual(rejected[key],initial[key]);
  }
});

test('numeric results use configured lookup and reject invalid quantities',()=>{
  const {state,context}=setup();
  const card=decks.wheel_1.find(c=>c.resolution==='numeric');
  state.phase='challenge';state.card=card;
  const resolved=transition(state,{type:'RESOLVE',result:2},context);
  assert.equal(resolved.points,card.reward.byResult[2]);
  assert.throws(()=>transition(state,{type:'RESOLVE',result:card.maximum+1},context),/NUMERIC/);
});

test('grid preserves inventory and fills all 80 positions without quota overflow across seeds',()=>{
  for(let seed=1;seed<=30;seed++) {
    const rng=seededRandom(seed);
    let grid=createGrid(config.grid,rng);
    let reels=createReels(config.slots);
    let count=0;
    while(grid.cells.some(Boolean)){
      const before=structuredClone(grid);
      const extraction=executeGrid(grid,1,config.grid,rng);
      assert.deepEqual(grid,before);
      assert.equal(extraction.grid.cells.length,49);
      assert.ok(before.cells[extraction.draws[0].index]);
      reels=insertTokens(reels,extraction.tokens,config.slots,rng).reels;
      grid=extraction.grid;
      count++;
      assert.ok(count<200);
    }
    assert.equal(grid.reserves.length,0);
    assert.equal(grid.pool.length,0);
    assert.equal(reels.flat().filter(s=>s===config.slots.stone).length,0);
    for(const reel of reels) for(const [symbol,n] of Object.entries(config.slots.target)) assert.equal(reel.filter(s=>s===symbol).length,n);
    const empty=executeGrid(grid,5,config.grid,rng);
    assert.equal(empty.draws.length,0);
  }
});

test('wild substitutes, multiplier applies once, and exceptional jackpot requires four literal symbols',()=>{
  const cfg=config.slots;
  assert.equal(evaluateLine(['lemon','wild','stone','stone'],cfg),cfg.payout.table.lemon[2]);
  assert.equal(evaluateLine(['lemon','x2','x2','stone'],cfg),cfg.payout.table.lemon[1]*cfg.payout.multiplier);
  assert.equal(evaluateLine(['seven','seven','seven','seven'],cfg),cfg.payout.exceptional.value);
  assert.equal(evaluateLine(['seven','seven','seven','wild'],cfg),cfg.payout.table.seven[4]);
});

test('exact analysis finds attainable rounded-up preview and correct exceptional probability',()=>{
  const reels=createReels(config.slots);
  reels[0][0]='lemon';
  const before=structuredClone(reels);
  const preview=analyzeSlots(reels,config.slots);
  assert.equal(preview.expected,Math.ceil(config.slots.payout.table.lemon[1]/config.slots.positions));
  assert.equal(preview.representative.line[0],'lemon');
  assert.equal(preview.maximum.payout,config.slots.payout.table.lemon[1]);
  assert.deepEqual(reels,before);
  const full=Array.from({length:config.slots.reels},()=>Object.entries(config.slots.target).flatMap(([symbol,n])=>Array(n).fill(symbol)));
  const analyzed=analyzeSlots(full,config.slots);
  assert.ok(Math.abs(analyzed.exceptionalProbability-1/20**4)<1e-12);
  assert.equal(analyzed.maximum.payout,5000000);
  assert.ok(Math.abs(analyzed.distribution.reduce((s,o)=>s+o.probability,0)-1)<1e-12);
});

test('first finale appearance starts final directly and exhausts configured spins',()=>{
  const {state:initial,context}=setup();
  context.config=forced('w2_cat_4_finale');
  initial.wheel='wheel_2';
  let state=transition(initial,{type:'SPIN_WHEEL'},context);
  assert.equal(state.phase,'finale');
  assert.equal(state.card,null);
  assert.equal(state.spins,config.final.minSpins);
  state=transition(state,{type:'START_FINAL'},context);
  for(let i=0;i<config.final.minSpins;i++){
    state=transition(state,{type:'SPIN_FINAL'},context);
    state=transition(state,{type:'END_FINAL_RESULT'},context);
  }
  assert.equal(state.phase,'finished');
  assert.equal(state.spins,0);
  assert.equal(state.history.length,config.final.minSpins);
  assert.throws(()=>transition(state,{type:'SPIN_FINAL'},context),/INVALID_ACTION/);
});

test('missing content is visible in development and empty in production',()=>{
  assert.equal(translator({'ns.key':'TEST_STRING'})('ns.key'),'TEST_STRING');
  assert.equal(translator({})('ns.missing'),'MISSING:ns.missing');
  assert.equal(translator({},{production:true})('ns.missing'),'');
});
