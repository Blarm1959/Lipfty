"use strict";
const assert=require("node:assert/strict");
const S=require("./lipfty7-simulator.js");

const standard=S.recommendedRuleConfigurations().find(x=>x.name==="Standard").rules;
const noMove=S.normaliseRules({...standard,allowMove:false});
const fixed={jumpPolicy:"opposite",responsePolicy:"sequential",boundaryPolicy:"responder-choice"};

// Existing v7.0.5/current behaviour remains regression-identical for a known
// matched-seed batch. The new consequence is opt-in only.
const control=S.runBatch({rules:standard,games:12,seed:820,strength:"tactical",...fixed,jumpConsequence:"current"});
assert.deepEqual(control.wins,[6,6]);
assert.equal(control.draws,0);
assert.equal(control.averageTurns,26.666666666666668);
assert.equal(control.placements,301);
assert.equal(control.moves,16);
assert.equal(control.jumps,3);
assert.equal(control.forcedPlacements,24);
assert.equal(control.twoPieceResponses,12);
assert.equal(control.boundaryResponses,0);
assert.deepEqual(control.winningActionTypes,{placement:[2,3],move:[1,3],jump:[3,0],redeploy:[0,0]});

// D rule: Jump is the only board movement. A non-winning Jump hands the exact
// jumped piece to the responder for immediate redeployment. No reserve piece is
// consumed and normal play resumes with the jumper.
let s=S.freshState(901,"opposite","sequential","responder-choice","redeploy-only");
s.openingRemaining=0;s.cornerRemaining={black:0,white:0};s.normalRemaining={black:2,white:2};
s.board[0]={id:1,colour:"black"};s.board[1]={id:2,colour:"white"};s.nextPieceId=3;
let actions=S.enumerateActions(s,"black",noMove);
assert.equal(actions.some(a=>a.type==="move"),false);
assert.equal(actions.some(a=>a.type==="jump"&&a.from===0&&a.to===2&&a.over===1),true);
let jump={type:"jump",from:0,to:2,over:1,colour:"black"};
let result=S.applyAction(s,jump,noMove);
assert.equal(result.ended,false);
assert.equal(s.awaitingJumpRedeploy,true);
assert.equal(s.awaitingMoveResponse,false);
assert.equal(s.forcedPlacements,1,"redeploy-only consequence contains one compulsory action");
assert.equal(s.currentPlayer,1,"opponent must redeploy the jumped piece");
const reserveBefore={...s.normalRemaining};
const rr=S.resolveJumpRedeploy(s,jump,noMove,"random");
assert.equal(rr.stage,"complete");
assert.equal(rr.secondAction,null,"no reserve placement follows a redeploy-only Jump");
assert.deepEqual(s.normalRemaining,reserveBefore,"redeploy-only Jump must not consume a reserve piece");
assert.equal(s.board.filter(p=>p&&p.id===2).length,1,"exact jumped piece must be redeployed once");
assert.equal(s.forcedPlacements,0);
assert.equal(s.forcedQueue.length,0);
assert.equal(s.currentPlayer,0,"after opponent redeploys, normal play resumes with the jumper");

// With one normal reserve left, redeploy-only still does not consume it or
// enter Final Four. The reserve remains available for the jumper's next normal
// turn, where they may place it or Jump again if legal.
s=S.freshState(902,"opposite","sequential","responder-choice","redeploy-only");
s.openingRemaining=0;s.cornerRemaining={black:0,white:0};s.normalRemaining={black:0,white:1};
s.board[0]={id:1,colour:"black"};s.board[1]={id:2,colour:"white"};s.nextPieceId=3;
jump={type:"jump",from:0,to:2,over:1,colour:"black"};
S.applyAction(s,jump,noMove);
const oneReserve=S.resolveJumpRedeploy(s,jump,noMove,"random");
assert.equal(oneReserve.stage,"complete");
assert.equal(s.normalRemaining.white,1);
assert.equal(s.finalFour,false);
assert.equal(s.currentPlayer,0);

// If the responder can win by replaying the jumped piece, that win still ends
// the game immediately.
s=S.freshState(903,"opposite","sequential","responder-choice","redeploy-only");
s.openingRemaining=0;s.cornerRemaining={black:0,white:0};s.normalRemaining={black:2,white:2};
s.board[0]={id:1,colour:"black"};s.board[1]={id:2,colour:"white"};
s.board[6]={id:3,colour:"white"};s.board[12]={id:4,colour:"white"};s.board[18]={id:5,colour:"white"};s.nextPieceId=6;
jump={type:"jump",from:0,to:2,over:1,colour:"black"};
S.applyAction(s,jump,noMove);
const reserveBeforeWin={...s.normalRemaining};
const winningRedeploy=S.resolveJumpRedeploy(s,jump,noMove,"tactical");
assert.equal(winningRedeploy.stage,"redeploy");
assert.equal(s.winner,1);
assert.deepEqual(s.normalRemaining,reserveBeforeWin);
assert.equal(s.board.filter(p=>p&&p.id===2).length,1);

// Tactical Jump scoring recognises an immediately losing redeployment.
s=S.freshState(904,"opposite","sequential","responder-choice","redeploy-only");
s.openingRemaining=0;s.cornerRemaining={black:0,white:0};s.normalRemaining={black:2,white:2};
s.board[0]={id:1,colour:"black"};s.board[1]={id:2,colour:"white"};
s.board[6]={id:3,colour:"white"};s.board[12]={id:4,colour:"white"};s.board[18]={id:5,colour:"white"};s.nextPieceId=6;
jump={type:"jump",from:0,to:2,over:1,colour:"black"};
assert.ok(S.redeployJumpResponseScore(s,jump,noMove)<-1e8);

// Batch diagnostics prove Move stays disabled and expose repeated Jump chains
// rather than silently looping. The seeded random sample deliberately includes
// at least one 2-Jump chain.
const tactical=S.runBatch({rules:noMove,games:20,seed:1,strength:"tactical",...fixed,jumpConsequence:"redeploy-only"});
assert.equal(tactical.moves,0);
assert.equal(tactical.jumpReserveWins[0]+tactical.jumpReserveWins[1],0);
assert.equal(tactical.redeployPlacements,tactical.jumpRedeployResponses);
assert.equal(tactical.wins[0]+tactical.wins[1]+tactical.draws,20);
assert.equal(tactical.jumpConsequence,"redeploy-only");
assert.equal(tactical.maxTurnDraws,0);

const random=S.runBatch({rules:noMove,games:30,seed:1,strength:"random",...fixed,jumpConsequence:"redeploy-only"});
assert.equal(random.moves,0);
assert.ok(random.gamesWithRedeployOnlyChain2Plus>0,"seeded random sample should exercise repeated redeploy Jumps");
assert.ok(random.maxConsecutiveRedeployOnlyJumps>=2);
assert.equal(Object.values(random.redeployOnlyChainMaxDistribution).reduce((a,b)=>a+b,0),30);

assert.throws(()=>S.freshState(1,"opposite","sequential","responder-choice","invalid"),/jumpConsequence/);
console.log("Lipfty 7 redeploy-only / no-Move experiment tests passed.");
