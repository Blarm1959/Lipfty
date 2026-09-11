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

// CURRENT control: a normal Move creates an awaiting response, then commits both
// reserve pieces before either compulsory placement is made.
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

// CLEANER experiment: responder chooses/places the first reserve piece, then
// chooses the mover's piece only after that first placement has been made.
s=S.freshState(706,"opposite","sequential");
s.openingRemaining=0;s.cornerRemaining={black:0,white:0};s.normalRemaining={black:2,white:2};
s.board[0]={id:1,colour:"black"};s.nextPieceId=2;
S.applyAction(s,{type:"move",from:0,to:1,colour:"black"},standard);
const sequentialFirst=S.commitMoveResponse(s,standard,"tactical");
assert.equal(sequentialFirst.pair,"sequential-pending");
assert.equal(sequentialFirst.give,null);
assert.equal(s.sequentialSecondOwed,true);
assert.equal(s.forcedQueue.length,1,"second reserve piece must not be committed in advance");
const firstSequentialAction=S.chooseAction(s,s.forcedQueue[0].colour,standard,"tactical");
S.applyAction(s,firstSequentialAction,standard);
assert.equal(s.forcedQueue.length,0);
assert.equal(s.sequentialSecondOwed,true);
assert.equal(s.forcedPlacements,1);
assert.equal(S.enumerateActions(s,"black",standard).length,0,"mover cannot act until responder chooses the second piece");
assert.equal(S.enumerateActions(s,"white",standard).length,0,"mover cannot act until responder chooses the second piece");
const remainingBeforeSecond={...s.normalRemaining};
const sequentialSecond=S.commitSequentialSecond(s,standard,"tactical");
assert.ok(["black","white"].includes(sequentialSecond.give));
assert.equal(remainingBeforeSecond[sequentialSecond.give]>0,true,"second choice must come from the reserve remaining after the first placement");
assert.equal(s.sequentialSecondOwed,false);
assert.equal(s.forcedQueue.length,1);
assert.equal(s.forcedQueue[0].colour,sequentialSecond.give);
const secondSequentialAction=S.chooseAction(s,sequentialSecond.give,standard,"tactical");
S.applyAction(s,secondSequentialAction,standard);
assert.equal(s.forcedPlacements,0);
assert.equal(s.currentPlayer,1,"responder must take the next normal turn after both compulsory placements");

// Same-colour pair selection is available whenever reserve counts permit it.
s=S.freshState(702);s.openingRemaining=0;s.cornerRemaining={black:0,white:0};s.normalRemaining={black:3,white:1};
assert.ok(S.responseAllocations(s).some(x=>x.keep==="black"&&x.give==="black"));
assert.ok(S.responseAllocations(s).some(x=>x.keep==="black"&&x.give==="white"));
assert.ok(S.responseAllocations(s).some(x=>x.keep==="white"&&x.give==="black"));

// Boundary case: with one normal reserve piece left, responder must place that
// piece first; only then is a Final Four corner selected for the mover.
s=S.freshState(703,"opposite","sequential");s.openingRemaining=0;s.cornerRemaining={black:0,white:0};s.normalRemaining={black:1,white:0};
s.board[0]={id:1,colour:"black"};s.nextPieceId=2;
S.applyAction(s,{type:"move",from:0,to:1,colour:"black"},standard);
const boundaryPlan=S.commitMoveResponse(s,standard,"tactical");
assert.equal(boundaryPlan.pair,"boundary-one");
assert.equal(s.sequentialSecondOwed,false,"one-reserve boundary must not use the sequential normal-response path");
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
assert.equal(b1.jumpPolicy,"opposite");
assert.equal(Object.values(b1.responseCountDistribution).reduce((a,b)=>a+b,0),12);
assert.equal(b1.twoPieceResponses+b1.boundaryResponses,12*b1.averageResponsesPerGame);
assert.ok(b1.maxResponsesPerGame>=0);

// Explicit opposite-colour mode must remain regression-identical to the v7.0.1
// default so the new experiment does not alter the current Standard baseline.
const explicitOpposite=S.runBatch({rules:standard,games:12,seed:704,strength:"tactical",jumpPolicy:"opposite"});
assert.deepEqual(explicitOpposite,b1);
assert.equal(b1.responsePolicy,"committed");
const explicitCommitted=S.runBatch({rules:standard,games:12,seed:704,strength:"tactical",jumpPolicy:"opposite",responsePolicy:"committed"});
assert.deepEqual(explicitCommitted,b1);

// Sequential mode is deterministic, keeps the one-reserve boundary rule, and
// chooses the second normal reserve piece only after the first placement.
const seq1=S.runBatch({rules:standard,games:12,seed:704,strength:"tactical",jumpPolicy:"opposite",responsePolicy:"sequential"});
const seq2=S.runBatch({rules:standard,games:12,seed:704,strength:"tactical",jumpPolicy:"opposite",responsePolicy:"sequential"});
assert.deepEqual(seq1,seq2);
assert.equal(seq1.responsePolicy,"sequential");
assert.equal(seq1.wins[0]+seq1.wins[1]+seq1.draws,12);
assert.ok(seq1.sequentialSecondChoices<=seq1.twoPieceResponses);
assert.equal(Object.values(seq1.responsePairs).reduce((a,b)=>a+b,0),seq1.sequentialSecondChoices);
assert.equal(Object.values(seq1.responseAllocations).reduce((a,b)=>a+b,0),seq1.sequentialSecondChoices);

// Progress is opt-in and reports completed game counts without affecting results.
const progressMarks=[];
const progressBatch=S.runBatch({rules:standard,games:5,seed:740,strength:"random",jumpPolicy:"opposite",progressEvery:2,onProgress:x=>progressMarks.push(x.completed)});
assert.deepEqual(progressMarks,[2,4,5]);
const progressControl=S.runBatch({rules:standard,games:5,seed:740,strength:"random",jumpPolicy:"opposite"});
assert.deepEqual(progressBatch,progressControl);

// The one-response-per-game result in the 5,000 tactical run is not an engine
// limit: random play can legitimately produce repeated non-winning movements.
const multiResponse=S.playGame({rules:standard,seed:9000,strength:"random",jumpPolicy:"opposite"});
assert.ok(multiResponse.twoPieceResponses+multiResponse.boundaryResponses>1);

// Jump colour is now a simulation-only parameter. Released/default Lipfty keeps
// checkers-style opposite-colour jumping; experimental any-colour mode also
// permits a jump over a same-colour piece.
s=Old.freshState(705);s.openingRemaining=0;s.cornerRemaining={black:0,white:0};
s.board[0]={id:1,colour:"black"};s.board[1]={id:2,colour:"black"};s.nextPieceId=3;
let jumps=Old.enumerateActions(s,"black",{allowJump:true}).filter(x=>x.type==="jump");
assert.equal(jumps.some(x=>x.from===0&&x.to===2&&x.over===1),false);

s=S.freshState(705,"opposite");s.openingRemaining=0;s.cornerRemaining={black:0,white:0};
s.board[0]={id:1,colour:"black"};s.board[1]={id:2,colour:"black"};s.nextPieceId=3;
jumps=S.enumerateActions(s,"black",{allowJump:true}).filter(x=>x.type==="jump");
assert.equal(jumps.some(x=>x.from===0&&x.to===2&&x.over===1),false);

s=S.freshState(705,"any");s.openingRemaining=0;s.cornerRemaining={black:0,white:0};
s.board[0]={id:1,colour:"black"};s.board[1]={id:2,colour:"black"};s.nextPieceId=3;
jumps=S.enumerateActions(s,"black",{allowJump:true}).filter(x=>x.type==="jump");
assert.equal(jumps.some(x=>x.from===0&&x.to===2&&x.over===1),true);


// NEW boundary experiment: with exactly one normal reserve left, the responder
// may choose the last normal piece first OR choose/place a Final Four corner
// first. The mover must then place the other type. The cleaner sequential rule
// remains in force for ordinary 2+-reserve responses.
//
// Random seed 3 chooses the normal-first branch. After the responder places the
// last reserve, the mover chooses their own corner for the second placement.
s=S.freshState(3,"opposite","sequential","responder-choice");
s.openingRemaining=0;s.cornerRemaining={black:0,white:0};s.normalRemaining={black:1,white:0};
s.board[0]={id:1,colour:"black"};s.nextPieceId=2;
S.applyAction(s,{type:"move",from:0,to:1,colour:"black"},standard);
let boundaryChoice=S.commitMoveResponse(s,standard,"random");
assert.equal(boundaryChoice.pair,"boundary-choice");
assert.equal(boundaryChoice.boundaryFirstSource,"normal");
assert.equal(s.forcedQueue.length,1);
assert.equal(s.forcedQueue[0].source,"normal");
assert.equal(s.boundarySelfCornerOwed,true);
let boundaryFirst=S.chooseAction(s,s.forcedQueue[0].colour,standard,"random");
S.applyAction(s,boundaryFirst,standard);
assert.equal(s.normalRemaining.black,0);
assert.equal(s.finalFour,true);
assert.equal(s.currentPlayer,0,"mover must make the second compulsory placement");
assert.equal(s.boundarySelfCornerOwed,true);
const selfCorner=S.commitBoundarySelfCorner(s,standard,"random");
assert.ok(selfCorner&&["black","white"].includes(selfCorner.colour));
assert.equal(s.forcedQueue[0].source,"final");
assert.equal(s.forcedQueue[0].responseSlot,2);
const selfCornerAction=S.chooseAction(s,selfCorner.colour,standard,"random");
S.applyAction(s,selfCornerAction,standard);
assert.equal(s.currentPlayer,1,"responder must take the next normal Final Four turn after normal-first boundary response");
assert.equal(s.forcedPlacements,0);
assert.equal(s.finalPieces.length,3);

// Random seed 1 chooses the corner-first branch. The responder chooses/places
// that corner, then the mover is forced to place the last normal reserve.
s=S.freshState(1,"opposite","sequential","responder-choice");
s.openingRemaining=0;s.cornerRemaining={black:0,white:0};s.normalRemaining={black:1,white:0};
s.board[0]={id:1,colour:"black"};s.nextPieceId=2;
S.applyAction(s,{type:"move",from:0,to:1,colour:"black"},standard);
boundaryChoice=S.commitMoveResponse(s,standard,"random");
assert.equal(boundaryChoice.boundaryFirstSource,"corner");
assert.equal(s.forcedQueue.length,2);
assert.equal(s.forcedQueue[0].source,"final");
assert.equal(s.forcedQueue[1].source,"normal");
assert.equal(s.forcedQueue[1].colour,"black");
boundaryFirst=S.chooseAction(s,s.forcedQueue[0].colour,standard,"random");
S.applyAction(s,boundaryFirst,standard);
assert.equal(s.finalPieces.length,3);
assert.equal(s.normalRemaining.black,1);
assert.equal(s.currentPlayer,0,"mover must place the last reserve second");
const lastNormal=S.chooseAction(s,"black",standard,"random");
assert.equal(lastNormal.type,"place");
S.applyAction(s,lastNormal,standard);
assert.equal(s.normalRemaining.black,0);
assert.equal(s.finalFour,true);
assert.equal(s.currentPlayer,1,"responder must take the next normal Final Four turn after corner-first boundary response");
assert.equal(s.forcedPlacements,0);

// The new boundary policy is deterministic in tactical batches and does not
// alter the 2+-reserve sequential response mechanism.
const boundaryNew1=S.runBatch({rules:standard,games:8,seed:760,strength:"tactical",jumpPolicy:"opposite",responsePolicy:"sequential",boundaryPolicy:"responder-choice"});
const boundaryNew2=S.runBatch({rules:standard,games:8,seed:760,strength:"tactical",jumpPolicy:"opposite",responsePolicy:"sequential",boundaryPolicy:"responder-choice"});
assert.deepEqual(boundaryNew1,boundaryNew2);
assert.equal(boundaryNew1.boundaryPolicy,"responder-choice");
assert.equal(boundaryNew1.boundaryFirstSources.normal+boundaryNew1.boundaryFirstSources.corner,boundaryNew1.boundaryResponses);

assert.throws(()=>S.freshState(705,"invalid"),/jumpPolicy/);
assert.throws(()=>S.freshState(705,"opposite","invalid"),/responsePolicy/);
assert.throws(()=>S.freshState(705,"opposite","sequential","invalid"),/boundaryPolicy/);

console.log("Lipfty 7 boundary-choice, response-choice and Jump-colour experiment tests passed.");
