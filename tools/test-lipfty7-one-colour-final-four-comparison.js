"use strict";

const assert=require("node:assert/strict");
const S=require("./lipfty7-simulator.js");
const R=require("./run-lipfty7-one-colour-final-four-comparison.js");

function cloneBoardState(oneColourPolicy){
  const s=S.freshState(1,"opposite","sequential","responder-choice","redeploy-pass",oneColourPolicy);
  s.openingRemaining=0;
  s.cornerRemaining={black:0,white:0};
  s.normalRemaining={black:3,white:0};
  s.finalFour=false;
  s.reachedFinalFour=false;
  s.forcedPlacements=0;
  s.forcedQueue=[];
  s.board=Array(36).fill(null);
  s.board[7]={id:1,colour:"black"};
  s.board[8]={id:2,colour:"white"};
  s.nextPieceId=3;
  return s;
}

function main(){
  assert.equal(S.normaliseOneColourPolicy("current"),"current");
  assert.equal(S.normaliseOneColourPolicy("placement-only"),"placement-only");
  assert.throws(()=>S.normaliseOneColourPolicy("bad"),/oneColourPolicy/);
  assert.equal(S.normaliseFinalFourColourPolicy("opponent"),"opponent");

  const configs=R.comparisonRules();
  assert.equal(configs.length,16);
  assert.deepEqual(configs.slice(0,8).map(x=>x.policyKey),Array(8).fill("player"));
  assert.deepEqual(configs.slice(8).map(x=>x.policyKey),Array(8).fill("opponent"));
  for(const policy of ["player","opponent"]){
    const group=configs.filter(x=>x.policyKey===policy);
    assert.equal(group.length,8);
    for(const squareKey of ["E1-current-squares","E2-tight-square-only","E3-no-squares","E4-spaced-square-only"]){
      const pair=group.filter(x=>x.squareKey===squareKey);
      assert.equal(pair.length,2);
      assert.deepEqual(pair.map(x=>x.rules.allowMove).sort(),[false,true]);
    }
  }

  const rules=R.standardRules();
  const current=cloneBoardState("current");
  const currentTypes=new Set(S.enumerateActions(current,"black",rules).map(a=>a.type));
  assert(currentTypes.has("place"));
  assert(currentTypes.has("move"));
  assert(currentTypes.has("jump"));

  const placementOnly=cloneBoardState("placement-only");
  const placementOnlyActions=S.enumerateActions(placementOnly,"black",rules);
  assert(placementOnlyActions.length>0);
  assert(placementOnlyActions.every(a=>a.type==="place"),"one-colour placement-only phase must not offer Move or Jump");

  const ff=S.freshState(7,"opposite","sequential","responder-choice","redeploy-pass","placement-only");
  ff.openingRemaining=0;
  ff.cornerRemaining={black:0,white:0};
  ff.normalRemaining={black:0,white:0};
  ff.finalFour=true;
  ff.reachedFinalFour=true;
  ff.finalPieces=["black","white"];
  ff.board=Array(36).fill(null);
  ff.board[0]={id:1,colour:"black"};
  ff.board[1]={id:2,colour:"black"};
  ff.board[2]={id:3,colour:"black"};
  ff.nextPieceId=4;
  assert.equal(S.chooseFinalFourColour(ff,rules,"tactical","tactical"),"black","player should choose the immediately winning Final Four colour");
  assert.equal(S.chooseFinalFourColour(ff,rules,"tactical","opponent"),"white","opponent should deny the immediately winning Final Four colour when another colour is available");

  const smoke=S.runBatch({rules,games:3,seed:1,strength:"tactical",jumpPolicy:"opposite",responsePolicy:"sequential",boundaryPolicy:"responder-choice",jumpConsequence:"redeploy-pass",oneColourPolicy:"placement-only",finalFourColourPolicy:"opponent"});
  assert.equal(smoke.games,3);
  assert.equal(smoke.oneColourPolicy,"placement-only");
  assert.equal(smoke.finalFourColourPolicy,"opponent");
  assert.equal(smoke.phaseWinningActionTypes.normalOne.move[0]+smoke.phaseWinningActionTypes.normalOne.move[1],0);
  assert.equal(smoke.phaseWinningActionTypes.normalOne.jump[0]+smoke.phaseWinningActionTypes.normalOne.jump[1],0);

  console.log("Lipfty 7 one-colour placement-only + Final Four choice comparison tests passed.");
}

if(require.main===module)main();
module.exports={main};
