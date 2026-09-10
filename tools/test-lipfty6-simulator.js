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

// Lipfty 6.0.7: the Tactical evaluator must treat colours as shared resources,
// not as player-owned sides. Swapping every colour leaves positional value and
// the geometry of the chosen action unchanged.
const recommended=S.recommendedRuleConfigurations();
assert.deepEqual(recommended.map(x=>x.name),["Learning","Core","Standard"]);
assert.equal(recommended[0].rules.allowDiagonal,true);
assert.equal(recommended[0].rules.allowMove,false);
assert.equal(recommended[1].rules.allowSquare,true);
assert.equal(recommended[1].rules.allowSpacedSquare,true);
assert.equal(recommended[2].rules.allowMove,true);
assert.equal(recommended[2].rules.allowJump,true);
assert.equal(recommended.every(x=>!x.rules.allowDiamond&&!x.rules.allowSpacedDiamond),true);

function colourSwapState(source,seed) {
  const t=S.freshState(seed);
  t.board=source.board.map(p=>p?{...p,colour:p.colour==="black"?"white":"black"}:null);
  t.currentPlayer=source.currentPlayer;
  t.openingRemaining=source.openingRemaining;
  t.cornerRemaining={black:source.cornerRemaining.white,white:source.cornerRemaining.black};
  t.normalRemaining={black:source.normalRemaining.white,white:source.normalRemaining.black};
  t.finalPieces=source.finalPieces.map(c=>c==="black"?"white":"black");
  t.forcedPlacements=source.forcedPlacements;
  t.protectedPieceId=source.protectedPieceId;
  t.nextPieceId=source.nextPieceId;
  t.finalFour=source.finalFour;
  t.reachedFinalFour=source.reachedFinalFour;
  return t;
}

const symmetryRules={allowDiagonal:true,allowSquare:true,allowSpacedSquare:true,allowMove:true,allowJump:true};
let original=S.freshState(607); original.openingRemaining=0; original.cornerRemaining={black:0,white:0}; original.normalRemaining={black:8,white:8};
original.board[7]={id:1,colour:"black"}; original.board[8]={id:2,colour:"black"}; original.board[14]={id:3,colour:"white"}; original.board[20]={id:4,colour:"white"}; original.nextPieceId=5;
let swapped=colourSwapState(original,607);
assert.equal(S.neutralPatternPotential(original.board,symmetryRules),S.neutralPatternPotential(swapped.board,symmetryRules));
assert.equal(S.handoverColourDanger(original,"black",symmetryRules),S.handoverColourDanger(swapped,"white",symmetryRules));
assert.equal(S.handoverColourDanger(original,"white",symmetryRules),S.handoverColourDanger(swapped,"black",symmetryRules));
const originalAction=S.chooseAction(original,"black",symmetryRules,"tactical");
const swappedAction=S.chooseAction(swapped,"white",symmetryRules,"tactical");
assert.equal(originalAction.type,swappedAction.type);
assert.equal(originalAction.from,swappedAction.from);
assert.equal(originalAction.to,swappedAction.to);

// When both colours are immediately safe, the giver should choose the colour
// whose best reply is less favourable to the receiver, rather than choosing
// randomly between the safe colours.
s=S.freshState(1); s.openingRemaining=0; s.cornerRemaining={black:0,white:0}; s.normalRemaining={black:8,white:8};
s.board[3]={id:1,colour:"black"}; s.board[5]={id:2,colour:"white"}; s.board[7]={id:3,colour:"black"}; s.board[9]={id:4,colour:"black"}; s.board[14]={id:5,colour:"white"}; s.board[16]={id:6,colour:"black"}; s.nextPieceId=7;
const handRules={allowDiagonal:true,allowSquare:true,allowSpacedSquare:true};
assert.equal(S.immediateWinningActions(s,"black",handRules).length,0);
assert.equal(S.immediateWinningActions(s,"white",handRules).length,0);
const blackDanger=S.handoverColourDanger(s,"black",handRules);
const whiteDanger=S.handoverColourDanger(s,"white",handRules);
assert.notEqual(blackDanger,whiteDanger);
assert.equal(S.chooseColour(s,handRules,"tactical"),blackDanger<whiteDanger?"black":"white");


// Lipfty 6.0.10: tactical action selection must reduce latent immediate
// winning threats in the colour that is currently being withheld.  With
// White already on C3-D4-E5 and Black handed, B2 or F6 blocks one of White's
// two immediate diagonal wins; an unrelated Black placement leaves both.
s=S.freshState(610);
s.openingRemaining=0;
s.cornerRemaining={black:0,white:0};
s.normalRemaining={black:10,white:10};
s.board[14]={id:1,colour:"white"}; // C3
s.board[21]={id:2,colour:"white"}; // D4
s.board[28]={id:3,colour:"white"}; // E5
s.nextPieceId=4;
assert.equal(S.immediateWinningActions(s,"white",{allowDiagonal:true}).length,2);
const defensiveAction=S.chooseAction(s,"black",{allowDiagonal:true},"tactical");
assert.equal(defensiveAction.type,"place");
assert.ok([7,35].includes(defensiveAction.to),`expected Black to block B2 or F6, got ${defensiveAction.to}`);

// Lipfty 6.0.11: diagnostic batches retain turn-by-turn result distributions.
const turnBatch=S.runBatch({games:40,seed:611,rules:{allowDiagonal:true}});
assert.equal(Object.values(turnBatch.winTurns[0]).reduce((a,b)=>a+b,0),turnBatch.wins[0]);
assert.equal(Object.values(turnBatch.winTurns[1]).reduce((a,b)=>a+b,0),turnBatch.wins[1]);
assert.equal(Object.values(turnBatch.drawTurns).reduce((a,b)=>a+b,0),turnBatch.draws);

// Lipfty 6.0.12: identify wins made while only one normal-reserve colour is
// available, and retain which colour had already been exhausted.
s=S.freshState(612);
s.openingRemaining=0;
s.cornerRemaining={black:0,white:0};
s.normalRemaining={black:0,white:3};
assert.deepEqual(S.normalForcedColourInfo(s),{colour:"white",exhaustedColour:"black"});
s.normalRemaining={black:2,white:0};
assert.deepEqual(S.normalForcedColourInfo(s),{colour:"black",exhaustedColour:"white"});
s.normalRemaining={black:2,white:2};
assert.equal(S.normalForcedColourInfo(s),null);
s.openingRemaining=1;
s.normalRemaining={black:0,white:2};
assert.equal(S.normalForcedColourInfo(s),null);
s.openingRemaining=0;
s.finalFour=true;
assert.equal(S.normalForcedColourInfo(s),null);

const forcedBatch=S.runBatch({games:80,seed:612,rules:{allowDiagonal:true,allowSquare:true,allowSpacedSquare:true}});
assert.equal(forcedBatch.forcedNormalColourWinTotal,forcedBatch.forcedNormalColourWins[0]+forcedBatch.forcedNormalColourWins[1]);
assert.equal(forcedBatch.forcedNormalColourWinTotal,
  forcedBatch.forcedNormalExhausted.black[0]+forcedBatch.forcedNormalExhausted.black[1]+
  forcedBatch.forcedNormalExhausted.white[0]+forcedBatch.forcedNormalExhausted.white[1]);
assert.ok(forcedBatch.forcedNormalColourWins[0]<=forcedBatch.wins[0]);
assert.ok(forcedBatch.forcedNormalColourWins[1]<=forcedBatch.wins[1]);
assert.equal(forcedBatch.forcedNormalColourWinPct,100*forcedBatch.forcedNormalColourWinTotal/forcedBatch.games);
