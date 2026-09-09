"use strict";
const assert=require("node:assert/strict");
const S=require("./lipfty6-simulator.js");

assert.equal(S.allRuleConfigurations().length,72);
assert.equal(new Set(S.allRuleConfigurations().map(JSON.stringify)).size,72);
assert.equal(S.normaliseRules({allowSpacedSquare:true}).allowSpacedSquare,false);
assert.equal(S.normaliseRules({allowSpacedDiamond:true}).allowSpacedDiamond,false);

let s=S.freshState(1);
assert.equal(s.openingRemaining,4);
let a={type:"opening-place",to:0,colour:"black"};
S.applyAction(s,a,{}); assert.equal(s.openingRemaining,3); assert.equal(s.cornerRemaining.black,1);

// A move creates exactly two compulsory placements while normal reserve remains.
s=S.freshState(2); s.openingRemaining=0;s.cornerRemaining={black:0,white:0};s.board[0]={id:1,colour:"black"};s.nextPieceId=2;
S.applyAction(s,{type:"move",from:0,to:1,colour:"black"},{allowMove:true});
assert.equal(s.forcedPlacements,2);assert.equal(s.protectedPieceId,1);
assert.ok(S.enumerateActions(s,"black",{allowMove:true}).every(x=>x.type==="place"));
S.applyAction(s,{type:"place",to:2,colour:"black"},{allowMove:true});assert.equal(s.forcedPlacements,1);
S.applyAction(s,{type:"place",to:3,colour:"black"},{allowMove:true});assert.equal(s.forcedPlacements,0);

// Jump is single and non-capturing, and has the same two-placement consequence.
s=S.freshState(3);s.openingRemaining=0;s.cornerRemaining={black:0,white:0};s.board[0]={id:1,colour:"black"};s.board[1]={id:2,colour:"white"};s.nextPieceId=3;
const jumps=S.enumerateActions(s,"black",{allowJump:true}).filter(x=>x.type==="jump");assert.ok(jumps.some(x=>x.from===0&&x.to===2&&x.over===1));
S.applyAction(s,jumps.find(x=>x.to===2),{allowJump:true});assert.equal(s.board[1].colour,"white");assert.equal(s.forcedPlacements,2);

// Exhaustion of the 28 playable pieces enters Final Four; four no-win placements draw.
s=S.freshState(4);s.openingRemaining=0;s.cornerRemaining={black:0,white:0};s.normalRemaining={black:0,white:1};s.board=Array(36).fill(null);
S.applyAction(s,{type:"place",to:0,colour:"white"},{});assert.equal(s.finalFour,true);assert.equal(s.reachedFinalFour,true);

// Smoke tests for deterministic seeded batches and both player strengths.
const r1=S.runBatch({games:20,seed:100,rules:{}}), r2=S.runBatch({games:20,seed:100,rules:{}});
assert.deepEqual(r1,r2);assert.equal(r1.games,20);assert.equal(r1.wins[0]+r1.wins[1]+r1.draws,20);
const rr=S.runBatch({games:10,seed:200,strength:"random",rules:{allowMove:true,allowJump:true,allowDiagonal:true}});
assert.equal(rr.games,10);
// Tactical hand-over regression: with three black pieces in a row and both
// reserve colours available, never give black when white is safe.
s=S.freshState(300);s.openingRemaining=0;s.cornerRemaining={black:0,white:0};s.normalRemaining={black:10,white:10};
s.board[14]={id:1,colour:"black"};s.board[15]={id:2,colour:"black"};s.board[16]={id:3,colour:"black"};s.nextPieceId=4;
assert.ok(S.immediateWinningActions(s,"black",{}).length>0);
assert.equal(S.immediateWinningActions(s,"white",{}).length,0);
assert.equal(S.chooseColour(s,{},"tactical"),"white");

// Reporting regression: aggregate action counts and chess-style P1 score.
const reportBatch=S.runBatch({games:12,seed:400,rules:{allowJump:true,allowMove:true,allowDiagonal:true,allowSquare:true,allowSpacedSquare:true}});
assert.equal(reportBatch.wins[0]+reportBatch.wins[1]+reportBatch.draws,12);
assert.equal(reportBatch.firstPlayerScorePct,100*(reportBatch.wins[0]+reportBatch.draws/2)/12);
assert.ok(Number.isInteger(reportBatch.placements)&&reportBatch.placements>0);
assert.ok(Number.isInteger(reportBatch.moves)&&reportBatch.moves>=0);
assert.ok(Number.isInteger(reportBatch.jumps)&&reportBatch.jumps>=0);
assert.ok(Number.isInteger(reportBatch.forcedPlacements)&&reportBatch.forcedPlacements>=0);
assert.ok(reportBatch.minTurns<=reportBatch.maxTurns);

console.log("Lipfty 6 analysis simulator tests passed.");

// Optimisation regression: the analysis-only fast win checker must agree with
// the authoritative Lipfty 5 rules checker for every configuration on seeded
// generated boards.
const R=global.LipftyRules;
for(const rules of S.allRuleConfigurations()) {
  for(let seed=1;seed<=12;seed++) {
    const rng=(function(a){return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};})(seed*7919);
    const board=Array.from({length:36},(_,i)=>{const x=rng();return x<0.45?null:{id:i+1,colour:x<0.725?"black":"white"};});
    assert.deepEqual(S.fastCheckWin(board,rules),R.checkWin(board,rules));
  }
}
