"use strict";
const assert=require("node:assert/strict");
const S=require("./lipfty7-simulator.js");

const standard=S.recommendedRuleConfigurations().find(x=>x.name==="Standard").rules;
const fixed={jumpPolicy:"opposite",responsePolicy:"sequential",boundaryPolicy:"responder-choice"};

// New policy remains opt-in: explicit current mode must equal the default.
const d1=S.runBatch({rules:standard,games:8,seed:810,strength:"tactical",...fixed});
const d2=S.runBatch({rules:standard,games:8,seed:810,strength:"tactical",...fixed,jumpConsequence:"current"});
assert.deepEqual(d1,d2);
assert.equal(d1.jumpConsequence,"current");
assert.equal(d1.jumpRedeployResponses,0);

// A non-winning Jump enters the redeploy consequence rather than the normal
// two-reserve response. The jumped piece itself is not removed permanently.
let s=S.freshState(811,"opposite","sequential","responder-choice","redeploy");
s.openingRemaining=0;s.cornerRemaining={black:0,white:0};s.normalRemaining={black:2,white:2};
s.board[0]={id:1,colour:"black"};s.board[1]={id:2,colour:"white"};s.nextPieceId=3;
let jump={type:"jump",from:0,to:2,over:1,colour:"black"};
let result=S.applyAction(s,jump,standard);
assert.equal(result.ended,false);
assert.equal(s.awaitingJumpRedeploy,true);
assert.equal(s.awaitingMoveResponse,false);
assert.equal(s.currentPlayer,1);
const beforeReserve={...s.normalRemaining};
const rr=S.resolveJumpRedeploy(s,jump,standard,"random");
assert.equal(rr.stage,"complete");
assert.deepEqual(s.normalRemaining,{black:beforeReserve.black-(rr.plan.giveColour==="black"?1:0),white:beforeReserve.white-(rr.plan.giveColour==="white"?1:0)});
assert.equal(s.board.filter(p=>p&&p.id===2).length,1,"jumped piece must be redeployed, not captured or duplicated");
assert.equal(s.currentPlayer,1,"responder takes the next normal turn after redeploy + jumper reserve placement");
assert.equal(s.forcedPlacements,0);

// If replaying the jumped piece can win immediately, the responder takes that
// win before any reserve piece is handed to the jumper.
s=S.freshState(812,"opposite","sequential","responder-choice","redeploy");
s.openingRemaining=0;s.cornerRemaining={black:0,white:0};s.normalRemaining={black:2,white:2};
s.board[0]={id:1,colour:"black"};s.board[1]={id:2,colour:"white"};
s.board[6]={id:3,colour:"white"};s.board[12]={id:4,colour:"white"};s.board[18]={id:5,colour:"white"};s.nextPieceId=6;
jump={type:"jump",from:0,to:2,over:1,colour:"black"};
result=S.applyAction(s,jump,standard);
assert.equal(result.ended,false);
const reserveBeforeWin={...s.normalRemaining};
const winningRedeploy=S.resolveJumpRedeploy(s,jump,standard,"tactical");
assert.equal(winningRedeploy.stage,"redeploy");
assert.equal(s.winner,1);
assert.deepEqual(s.normalRemaining,reserveBeforeWin,"no reserve piece is consumed after an immediate replay win");
assert.equal(s.board.filter(p=>p&&p.id===2).length,1);

// With exactly one normal reserve piece left, a redeploy Jump uses that final
// reserve as the jumper's compulsory placement, then Final Four starts with the
// responder next. The 7.1 Move boundary choice is not invoked by this Jump.
s=S.freshState(813,"opposite","sequential","responder-choice","redeploy");
s.openingRemaining=0;s.cornerRemaining={black:0,white:0};s.normalRemaining={black:0,white:1};
s.board[0]={id:1,colour:"black"};s.board[1]={id:2,colour:"white"};s.nextPieceId=3;
jump={type:"jump",from:0,to:2,over:1,colour:"black"};
result=S.applyAction(s,jump,standard);
assert.equal(result.ended,false);
const boundaryJump=S.resolveJumpRedeploy(s,jump,standard,"random");
assert.equal(boundaryJump.stage,"complete");
assert.equal(s.normalRemaining.white,0);
assert.equal(s.finalFour,true);
assert.equal(s.currentPlayer,1);
assert.equal(s.boundaryCornerOwed,false);
assert.equal(s.boundarySelfCornerOwed,false);
assert.equal(s.board.filter(p=>p&&p.id===2).length,1);

// Tactical Jump scoring must recognise the danger of giving the responder an
// immediate winning redeployment square.
s=S.freshState(814,"opposite","sequential","responder-choice","redeploy");
s.openingRemaining=0;s.cornerRemaining={black:0,white:0};s.normalRemaining={black:2,white:2};
s.board[0]={id:1,colour:"black"};s.board[1]={id:2,colour:"white"};
s.board[6]={id:3,colour:"white"};s.board[12]={id:4,colour:"white"};s.board[18]={id:5,colour:"white"};s.nextPieceId=6;
jump={type:"jump",from:0,to:2,over:1,colour:"black"};
assert.ok(S.redeployJumpResponseScore(s,jump,standard)<-1e8);

// Removing ordinary Move really does leave Jump as the only board-movement
// action while keeping placement and winning rules unchanged.
s=S.freshState(815,"opposite","sequential","responder-choice","redeploy");
s.openingRemaining=0;s.cornerRemaining={black:0,white:0};s.normalRemaining={black:2,white:2};
s.board[0]={id:1,colour:"black"};s.board[1]={id:2,colour:"white"};s.nextPieceId=3;
const noMove=S.normaliseRules({...standard,allowMove:false});
const actions=S.enumerateActions(s,"black",noMove);
assert.equal(actions.some(a=>a.type==="move"),false);
assert.equal(actions.some(a=>a.type==="jump"&&a.from===0&&a.to===2),true);

// Batch diagnostics reconcile: every non-winning movement that creates a
// consequence is accounted for exactly once, including redeploy Jumps.
const rb=S.runBatch({rules:standard,games:12,seed:820,strength:"tactical",...fixed,jumpConsequence:"redeploy"});
const directMovementWins=rb.winningActionTypes.move[0]+rb.winningActionTypes.move[1]+rb.winningActionTypes.jump[0]+rb.winningActionTypes.jump[1];
assert.equal(rb.twoPieceResponses+rb.boundaryResponses+rb.jumpRedeployResponses,rb.moves+rb.jumps-directMovementWins);
assert.equal(rb.redeployPlacements,rb.jumpRedeployResponses);
assert.equal(rb.wins[0]+rb.wins[1]+rb.draws,12);
assert.equal(rb.responsePolicy,"sequential");
assert.equal(rb.boundaryPolicy,"responder-choice");
assert.equal(rb.jumpPolicy,"opposite");
assert.equal(rb.jumpConsequence,"redeploy");

const nm=S.runBatch({rules:noMove,games:12,seed:820,strength:"tactical",...fixed,jumpConsequence:"redeploy"});
assert.equal(nm.moves,0);
assert.equal(nm.wins[0]+nm.wins[1]+nm.draws,12);
assert.throws(()=>S.freshState(1,"opposite","sequential","responder-choice","invalid"),/jumpConsequence/);

console.log("Lipfty 7 redeploy-Jump experiment tests passed.");
