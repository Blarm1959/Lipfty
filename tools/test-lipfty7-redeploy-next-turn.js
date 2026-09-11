"use strict";
const assert=require("node:assert/strict");
const S=require("./lipfty7-simulator.js");

const standard=S.recommendedRuleConfigurations().find(x=>x.name==="Standard").rules;
const noMove=S.normaliseRules({...standard,allowMove:false});
const fixed={jumpPolicy:"opposite",responsePolicy:"sequential",boundaryPolicy:"responder-choice"};

// v7.0.6 D behaviour remains available and unchanged.
const d=S.runBatch({rules:noMove,games:12,seed:1,strength:"tactical",...fixed,jumpConsequence:"redeploy-only"});
assert.equal(d.moves,0);
assert.equal(d.jumpReserveWins[0]+d.jumpReserveWins[1],0);
assert.equal(d.jumpConsequence,"redeploy-only");

// E rule: Jump is the only board movement. After the opponent redeploys the
// exact jumped piece, that opponent receives the next normal turn. No reserve
// piece is consumed by the Jump itself.
let s=S.freshState(1101,"opposite","sequential","responder-choice","redeploy-pass");
s.openingRemaining=0;s.cornerRemaining={black:0,white:0};s.normalRemaining={black:2,white:2};
s.board[0]={id:1,colour:"black"};s.board[1]={id:2,colour:"white"};s.nextPieceId=3;
let actions=S.enumerateActions(s,"black",noMove);
assert.equal(actions.some(a=>a.type==="move"),false);
assert.equal(actions.some(a=>a.type==="jump"&&a.from===0&&a.to===2&&a.over===1),true);
let jump={type:"jump",from:0,to:2,over:1,colour:"black"};
let result=S.applyAction(s,jump,noMove);
assert.equal(result.ended,false);
assert.equal(s.currentPlayer,1,"P2 must be the redeployer after P1 jumps");
assert.equal(s.awaitingJumpRedeploy,true);
assert.equal(s.forcedPlacements,1,"redeploy-pass contains only the redeployment as a compulsory action");
const reserveBefore={...s.normalRemaining};
const response=S.resolveJumpRedeploy(s,jump,noMove,"random");
assert.equal(response.stage,"complete");
assert.equal(response.secondAction,null);
assert.deepEqual(s.normalRemaining,reserveBefore,"Jump/redeploy must not consume a reserve piece");
assert.equal(s.board.filter(p=>p&&p.id===2).length,1,"exact jumped piece must be redeployed exactly once");
assert.equal(s.forcedPlacements,0);
assert.equal(s.forcedQueue.length,0);
assert.equal(s.currentPlayer,1,"after redeployment P2 must also receive the next normal turn");

// The next colour is selected for P2 using normal Lipfty handover logic; this
// models P1 choosing the reserve piece that P2 must use.
const nextColour=S.chooseColour(s,noMove,"tactical");
assert.ok(["black","white"].includes(nextColour));
const nextActions=S.enumerateActions(s,nextColour,noMove);
assert.ok(nextActions.length>0);
assert.equal(nextActions.some(a=>a.type==="move"),false);

// With exactly one normal reserve left, it remains untouched by the Jump and is
// therefore the piece P1 hands to P2 for P2's next normal turn.
s=S.freshState(1102,"opposite","sequential","responder-choice","redeploy-pass");
s.openingRemaining=0;s.cornerRemaining={black:0,white:0};s.normalRemaining={black:0,white:1};
s.board[0]={id:1,colour:"black"};s.board[1]={id:2,colour:"white"};s.nextPieceId=3;
jump={type:"jump",from:0,to:2,over:1,colour:"black"};
S.applyAction(s,jump,noMove);
const oneReserve=S.resolveJumpRedeploy(s,jump,noMove,"random");
assert.equal(oneReserve.stage,"complete");
assert.equal(s.normalRemaining.white,1);
assert.equal(s.finalFour,false);
assert.equal(s.currentPlayer,1);
assert.equal(S.chooseColour(s,noMove,"tactical"),"white");

// A winning redeployment still ends the game before any next normal turn.
s=S.freshState(1103,"opposite","sequential","responder-choice","redeploy-pass");
s.openingRemaining=0;s.cornerRemaining={black:0,white:0};s.normalRemaining={black:2,white:2};
s.board[0]={id:1,colour:"black"};s.board[1]={id:2,colour:"white"};
s.board[6]={id:3,colour:"white"};s.board[12]={id:4,colour:"white"};s.board[18]={id:5,colour:"white"};s.nextPieceId=6;
jump={type:"jump",from:0,to:2,over:1,colour:"black"};
S.applyAction(s,jump,noMove);
const winning=S.resolveJumpRedeploy(s,jump,noMove,"tactical");
assert.equal(winning.stage,"redeploy");
assert.equal(s.winner,1);


// v7.0.8 tactical-evaluation regression: the jumper controls the reserve
// colour handed to the responder. One dangerous colour plus one safe colour
// must therefore score much better than a position where both colours give the
// responder an immediate win.
let hand=S.freshState(1201,"opposite","sequential","responder-choice","redeploy-pass");
hand.openingRemaining=0;hand.cornerRemaining={black:0,white:0};hand.normalRemaining={black:2,white:2};
hand.board[0]={id:1,colour:"black"};hand.board[1]={id:2,colour:"black"};hand.board[2]={id:3,colour:"black"};hand.nextPieceId=4;
const oneDanger=S.redeployPassHandoverScore(hand,noMove);
hand.board[6]={id:4,colour:"white"};hand.board[7]={id:5,colour:"white"};hand.board[8]={id:6,colour:"white"};hand.nextPieceId=7;
const bothDanger=S.redeployPassHandoverScore(hand,noMove);
assert.ok(oneDanger>bothDanger,"jumper's safe-colour handover choice must materially improve the E forecast");

// Batch diagnostics: no ordinary Move and no post-Jump forced reserve action.
const tactical=S.runBatch({rules:noMove,games:30,seed:1,strength:"tactical",...fixed,jumpConsequence:"redeploy-pass"});
assert.equal(tactical.moves,0);
assert.equal(tactical.jumpReserveWins[0]+tactical.jumpReserveWins[1],0);
assert.equal(tactical.redeployPlacements,tactical.jumpRedeployResponses);
assert.equal(tactical.wins[0]+tactical.wins[1]+tactical.draws,30);
assert.equal(tactical.jumpConsequence,"redeploy-pass");
assert.equal(tactical.maxTurnDraws,0);

const random=S.runBatch({rules:noMove,games:30,seed:1,strength:"random",...fixed,jumpConsequence:"redeploy-pass"});
assert.equal(random.moves,0);
assert.ok(random.jumpRedeployResponses>0,"seeded random sample should exercise redeploy-pass responses");
assert.equal(random.redeployPlacements,random.jumpRedeployResponses);
assert.ok(random.gamesWithRedeployOnlyChain2Plus>0,"seeded random sample should exercise consecutive redeploy-pass Jumps");
assert.ok(random.maxConsecutiveRedeployOnlyJumps>=2);
assert.equal(random.maxTurnDraws,0);

assert.throws(()=>S.freshState(1,"opposite","sequential","responder-choice","bad-policy"),/jumpConsequence/);
console.log("Lipfty 7 redeploy-pass next-turn experiment tests passed.");
