"use strict";

const assert=require("node:assert/strict");
const S=require("./lipfty7-simulator.js");

const rules=S.recommendedRuleConfigurations().find(x=>x.name==="Standard").rules;
const base={rules,games:20,seed:1,strength:"tactical",jumpPolicy:"opposite",responsePolicy:"sequential",boundaryPolicy:"responder-choice",jumpConsequence:"redeploy-pass"};

assert.equal(S.normaliseFinalFourColourPolicy("random"),"random");
assert.equal(S.normaliseFinalFourColourPolicy("tactical"),"tactical");
assert.throws(()=>S.normaliseFinalFourColourPolicy("bad"),/finalFourColourPolicy/);

// Default remains exactly the previous random Final Four policy.
const implicit=S.runBatch(base);
const explicit=S.runBatch({...base,finalFourColourPolicy:"random"});
for(const key of ["wins","draws","resultCategories","winningActionTypes","placements","moves","jumps","redeployPlacements","formations","finalFourPct"])
  assert.deepEqual(implicit[key],explicit[key],`default/random regression mismatch in ${key}`);

// Tactical Final Four colour choice must take an immediate winning colour when available.
const s=S.freshState(1,"opposite","sequential","responder-choice","redeploy-pass");
s.openingRemaining=0;s.normalRemaining={black:0,white:0};s.finalFour=true;s.finalPieces=["black","white"];
s.board[0]={id:1,colour:"black"};s.board[1]={id:2,colour:"black"};s.board[2]={id:3,colour:"black"};
assert.equal(S.chooseFinalFourColour(s,rules,"tactical","tactical"),"black");

// Phase-action cross-tabs must exactly reconstruct phase winner totals.
for(const [phase,key] of [["normalBoth","normalBoth"],["normalOne","normalOne"],["finalFour","finalFour"]]){
  for(const player of [0,1]){
    const p=implicit.phaseWinningActionTypes[phase];
    const sum=p.placement[player]+p.move[player]+p.jump[player]+p.redeploy[player];
    assert.equal(sum,implicit.resultCategories[key][player],`${phase} action cross-tab mismatch for P${player+1}`);
  }
}

// Every game reported as reaching Final Four must have exactly one recorded first actor.
const finalEntries=implicit.phaseEntryOutcomes.finalFour[0].entries+implicit.phaseEntryOutcomes.finalFour[1].entries;
assert.equal(finalEntries,Math.round(implicit.games*implicit.finalFourPct/100));
const distTotal=Object.values(implicit.finalFourPlacementCountDistribution).reduce((a,b)=>a+b,0);
assert.equal(distTotal,finalEntries);

// Tactical policy keeps pre-Final play matched: same number of games reach Final Four.
const tactical=S.runBatch({...base,finalFourColourPolicy:"tactical"});
assert.equal(tactical.phaseEntryOutcomes.finalFour[0].entries+tactical.phaseEntryOutcomes.finalFour[1].entries,finalEntries);
assert.equal(tactical.finalFourPct,implicit.finalFourPct);

console.log("Lipfty 7 phase/Final-Four diagnostic tests passed.");
