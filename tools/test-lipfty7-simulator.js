"use strict";
const assert=require("node:assert/strict");
const Old=require("./lipfty6-simulator.js");
const S=require("./lipfty7-simulator.js");

const learning=S.recommendedRuleConfigurations().find(x=>x.name==="Learning").rules;
const core=S.recommendedRuleConfigurations().find(x=>x.name==="Core").rules;
const standard=S.recommendedRuleConfigurations().find(x=>x.name==="Standard").rules;

// Learning/Core must be regression-identical because neither permits movement.
for(const [name,rules] of [["Learning",learning],["Core",core]]){
  const oldRules=Old.recommendedRuleConfigurations().find(x=>x.name===name).rules;
  const oldBatch=Old.runBatch({rules:oldRules,games:30,seed:700,strength:"tactical"});
  const newBatch=S.runBatch({rules,games:30,seed:700,strength:"tactical"});
  for(const field of ["wins","draws","firstPlayerWinPct","secondPlayerWinPct","drawPct","firstPlayerScorePct","averageTurns","minTurns","maxTurns","finalFourPct","placements","moves","jumps","forcedPlacements","formations","resultCategories","winningActionTypes","forcedNormalColourWins","forcedNormalColourWinTotal","forcedNormalExhausted"]){
    assert.deepEqual(newBatch[field],oldBatch[field],`${name} changed field ${field}`);
  }
}

// A normal Move creates an awaiting response, then commits both reserve pieces
// before either compulsory placement is made.
let s=S.freshState(701);
s.openingRemaining=0;s.cornerRemaining={black:0,white:0};s.normalRemaining={black:1,white:1};
s.board[0]={id:1,colour:"black"};s.nextPieceId=2;
let result=S.applyAction(s,{type:"move",from:0,to:1,colour:"black"},standard);
assert.equal(result.ended,false);
assert.equal(s.awaitingMoveResponse,true);
assert.equal(s.forcedPlacements,2);
assert.equal(s.currentPlayer,1);
const plan=S.commitMoveResponse(s,standard,"tactical");
assert.equal(plan.pair,"black+white");
assert.equal(s.awaitingMoveResponse,false);
assert.equal(s.forcedQueue.length,2);
assert.notEqual(s.forcedQueue[0].colour,s.forcedQueue[1].colour);
const committedSecond=s.forcedQueue[1].colour;
const first=S.chooseAction(s,s.forcedQueue[0].colour,standard,"tactical");
S.applyAction(s,first,standard);
assert.equal(s.forcedPlacements,1);
assert.equal(s.forcedQueue.length,1);
assert.equal(s.forcedQueue[0].colour,committedSecond,"second piece was reconsidered after first placement");
assert.equal(S.availableColours(s).length,1);
assert.equal(S.availableColours(s)[0],committedSecond);

// Same-colour pair selection is available whenever reserve counts permit it.
s=S.freshState(702);s.openingRemaining=0;s.cornerRemaining={black:0,white:0};s.normalRemaining={black:3,white:1};
assert.ok(S.responseAllocations(s).some(x=>x.keep==="black"&&x.give==="black"));
assert.ok(S.responseAllocations(s).some(x=>x.keep==="black"&&x.give==="white"));
assert.ok(S.responseAllocations(s).some(x=>x.keep==="white"&&x.give==="black"));

// Boundary case: with one normal reserve piece left, responder must place that
// piece first; only then is a Final Four corner selected for the mover.
s=S.freshState(703);s.openingRemaining=0;s.cornerRemaining={black:0,white:0};s.normalRemaining={black:1,white:0};
s.board[0]={id:1,colour:"black"};s.nextPieceId=2;
S.applyAction(s,{type:"move",from:0,to:1,colour:"black"},standard);
const boundaryPlan=S.commitMoveResponse(s,standard,"tactical");
assert.equal(boundaryPlan.pair,"boundary-one");
assert.equal(s.boundaryCornerOwed,true);
assert.equal(s.forcedQueue.length,1);
assert.equal(s.forcedQueue[0].source,"normal");
assert.equal(s.forcedQueue[0].colour,"black");
const forcedNormal=S.chooseAction(s,"black",standard,"tactical");
S.applyAction(s,forcedNormal,standard);
assert.equal(s.normalRemaining.black,0);
assert.equal(s.finalFour,true);
assert.equal(s.currentPlayer,0,"mover must receive the compulsory corner");
assert.equal(s.boundaryCornerOwed,true);
assert.equal(s.forcedQueue.length,0);
const cornerColour=S.commitBoundaryCorner(s,standard,"tactical");
assert.ok(["black","white"].includes(cornerColour));
assert.equal(s.forcedQueue.length,1);
assert.equal(s.forcedQueue[0].source,"final");
assert.equal(s.forcedQueue[0].responseSlot,2);
const forcedCorner=S.chooseAction(s,cornerColour,standard,"tactical");
S.applyAction(s,forcedCorner,standard);
assert.equal(s.currentPlayer,1,"responder must take the next normal Final Four turn");
assert.equal(s.forcedPlacements,0);
assert.equal(s.boundaryCornerOwed,false);

// Seeded Standard batches remain deterministic and expose the new diagnostics.
const b1=S.runBatch({rules:standard,games:12,seed:704,strength:"tactical"});
const b2=S.runBatch({rules:standard,games:12,seed:704,strength:"tactical"});
assert.deepEqual(b1,b2);
assert.equal(b1.wins[0]+b1.wins[1]+b1.draws,12);
assert.equal(b1.twoPieceResponses+b1.boundaryResponses,b1.moves+b1.jumps-
  (b1.winningActionTypes.move[0]+b1.winningActionTypes.move[1]+b1.winningActionTypes.jump[0]+b1.winningActionTypes.jump[1]));
assert.equal(Object.values(b1.responsePairs).reduce((a,b)=>a+b,0),b1.twoPieceResponses);
assert.equal(Object.values(b1.responseAllocations).reduce((a,b)=>a+b,0),b1.twoPieceResponses);
assert.ok(b1.forcedPlacements>=0);

// Experimental isolation: do not silently fix the pre-existing v6.0.13 jump
// geometry discrepancy in the same package. Both old and new currently reject
// a same-colour jumped piece; this will be a separate bug-fix decision.
for(const sim of [Old,S]){
  s=sim.freshState(705);s.openingRemaining=0;s.cornerRemaining={black:0,white:0};
  s.board[0]={id:1,colour:"black"};s.board[1]={id:2,colour:"black"};s.nextPieceId=3;
  const jumps=sim.enumerateActions(s,"black",{allowJump:true}).filter(x=>x.type==="jump");
  assert.equal(jumps.some(x=>x.from===0&&x.to===2&&x.over===1),false);
}

console.log("Lipfty 7 two-piece response simulator tests passed.");
