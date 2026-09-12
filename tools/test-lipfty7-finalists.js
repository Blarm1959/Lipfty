"use strict";

const assert=require("node:assert/strict");

// The selection test does not need to simulate a game. Supply the simulator's
// rule dependency so the existing comparison module can be loaded in isolation.
global.LipftyRules={
  WINNING_LINES:[],WINNING_SQUARES:[],WINNING_DIAMONDS:[],
  adjacentDestinations(){return[];},jumpDestinations(){return[];}
};

const F=require("./run-lipfty7-finalists.js");

function main(){
  assert.equal(F.parseArgs([]).games,5000);
  assert.equal(F.parseArgs(["--games","50"]).games,50);
  assert.equal(F.parseArgs(["--seed","7"]).seed,7);
  assert.throws(()=>F.parseArgs(["--games","0"]),/positive integer/);
  assert.throws(()=>F.parseArgs(["--bogus"]),/Unknown option/);

  const configs=F.finalistConfigs();
  assert.equal(configs.length,5);
  assert.deepEqual(configs.map(x=>x.key),F.FINALIST_KEYS);
  assert.deepEqual(F.FINALIST_KEYS,[
    "player-E1-current-squares-move-on",
    "opponent-E4-spaced-square-only-move-on",
    "player-E4-spaced-square-only-move-on",
    "player-E1-current-squares-move-off",
    "opponent-E2-tight-square-only-move-off"
  ]);

  const e1on=configs[0];
  assert.equal(e1on.squareKey,"E1-current-squares");
  assert.equal(e1on.rules.allowMove,true);
  assert.equal(e1on.policyKey,"player");

  const e4opp=configs[1];
  assert.equal(e4opp.squareKey,"E4-spaced-square-only");
  assert.equal(e4opp.rules.allowMove,true);
  assert.equal(e4opp.policyKey,"opponent");

  const e2opp=configs[4];
  assert.equal(e2opp.squareKey,"E2-tight-square-only");
  assert.equal(e2opp.rules.allowMove,false);
  assert.equal(e2opp.policyKey,"opponent");

  console.log("Lipfty 7 five-finalist runner tests passed.");
}

if(require.main===module)main();
module.exports={main};
