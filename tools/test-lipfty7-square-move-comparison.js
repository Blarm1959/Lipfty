"use strict";

const assert=require("node:assert/strict");
const S=require("./lipfty7-simulator.js");
const R=require("./run-lipfty7-square-move-comparison.js");

function testConfigurations(){
  const configs=R.comparisonRules();
  assert.equal(configs.length,8,"expected four Square variants with Move OFF/ON");
  for(let i=0;i<configs.length;i+=2){
    const off=configs[i],on=configs[i+1];
    assert.equal(off.pairKey,on.pairKey,"paired configs should describe the same Square rule");
    assert.equal(off.rules.allowMove,false,"first config in each pair must have Move OFF");
    assert.equal(on.rules.allowMove,true,"second config in each pair must have Move ON");
    for(const k of ["allowJump","allowDiagonal","allowSquare","allowSpacedSquare","spacedSquareOnly","allowDiamond","allowSpacedDiamond"])
      assert.equal(off.rules[k],on.rules[k],`${off.pairKey}: only allowMove should differ within a pair (${k})`);
  }
  assert.equal(configs[0].rules.allowSquare,true); assert.equal(configs[0].rules.allowSpacedSquare,true);
  assert.equal(configs[2].rules.allowSquare,true); assert.equal(configs[2].rules.allowSpacedSquare,false);
  assert.equal(configs[4].rules.allowSquare,false); assert.equal(configs[4].rules.spacedSquareOnly,false);
  assert.equal(configs[6].rules.allowSquare,false); assert.equal(configs[6].rules.spacedSquareOnly,true);
}

function testMoveOnActuallyMoves(){
  const configs=R.comparisonRules();
  for(let i=1;i<configs.length;i+=2){
    const c=configs[i];
    const r=S.runBatch({rules:c.rules,games:1,seed:1,strength:"tactical",jumpPolicy:"opposite",responsePolicy:"sequential",boundaryPolicy:"responder-choice",jumpConsequence:"redeploy-pass"});
    assert.ok(r.moves>0,`${c.label}: Move ON tactical smoke run should actually use Move`);
  }
}

function testMoveOffNeverMoves(){
  const configs=R.comparisonRules();
  for(let i=0;i<configs.length;i+=2){
    const c=configs[i];
    const r=S.runBatch({rules:c.rules,games:1,seed:1,strength:"tactical",jumpPolicy:"opposite",responsePolicy:"sequential",boundaryPolicy:"responder-choice",jumpConsequence:"redeploy-pass"});
    assert.equal(r.moves,0,`${c.label}: Move OFF must never record Move actions`);
  }
}

function testParse(){
  const o=R.parseArgs(["--games","123","--seed","7","--strength","random","--progress-every","11","--no-csv"]);
  assert.equal(o.games,123); assert.equal(o.seed,7); assert.equal(o.strength,"random"); assert.equal(o.progressEvery,11); assert.equal(o.csv,false);
}

function main(){
  testConfigurations();
  testParse();
  testMoveOffNeverMoves();
  testMoveOnActuallyMoves();
  console.log("Lipfty 7 Square-pattern + Move comparison tests passed.");
}

if(require.main===module){main();}
module.exports={main};
