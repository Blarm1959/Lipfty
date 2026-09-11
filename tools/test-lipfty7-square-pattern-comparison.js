"use strict";

const assert=require("node:assert/strict");
const S=require("./lipfty7-simulator.js");
const C=require("./run-lipfty7-square-pattern-comparison.js");

const configs=C.comparisonRules();
assert.equal(configs.length,4);
const [current,tightOnly,noSquares,spacedOnly]=configs;

for(const c of configs){
  assert.equal(c.rules.allowMove,false,`${c.key}: Move must be OFF.`);
  assert.equal(c.rules.allowJump,true,`${c.key}: Jump must be ON.`);
  assert.equal(c.rules.allowDiagonal,true,`${c.key}: diagonal win must stay ON.`);
  assert.equal(c.rules.allowDiamond,false,`${c.key}: Diamond must stay OFF.`);
  assert.equal(c.rules.allowSpacedDiamond,false,`${c.key}: Spaced Diamond must stay OFF.`);
}
assert.equal(current.rules.allowSquare,true);
assert.equal(current.rules.allowSpacedSquare,true);
assert.equal(tightOnly.rules.allowSquare,true);
assert.equal(tightOnly.rules.allowSpacedSquare,false);
assert.equal(noSquares.rules.allowSquare,false);
assert.equal(noSquares.rules.allowSpacedSquare,false);
assert.equal(noSquares.rules.spacedSquareOnly,false);
assert.equal(spacedOnly.rules.allowSquare,false);
assert.equal(spacedOnly.rules.allowSpacedSquare,false);
assert.equal(spacedOnly.rules.spacedSquareOnly,true);

function boardWith(indices,colour="black"){
  const b=Array(36).fill(null);
  indices.forEach((i,n)=>{b[i]={id:n+1,colour};});
  return b;
}

const tightSquare=boardWith([0,1,7,6]);
assert.equal(S.classifyWin(S.fastCheckWin(tightSquare,current.rules)),"square");
assert.equal(S.classifyWin(S.fastCheckWin(tightSquare,tightOnly.rules)),"square");
assert.equal(S.fastCheckWin(tightSquare,noSquares.rules),null);
assert.equal(S.fastCheckWin(tightSquare,spacedOnly.rules),null);

const spacedSquare=boardWith([0,2,14,12]);
assert.equal(S.classifyWin(S.fastCheckWin(spacedSquare,current.rules)),"spaced-square");
assert.equal(S.fastCheckWin(spacedSquare,tightOnly.rules),null);
assert.equal(S.fastCheckWin(spacedSquare,noSquares.rules),null);
assert.equal(S.classifyWin(S.fastCheckWin(spacedSquare,spacedOnly.rules)),"spaced-square");

const line=boardWith([0,1,2,3]);
for(const c of configs)assert.equal(S.classifyWin(S.fastCheckWin(line,c.rules)),"horizontal");
const diagonal=boardWith([0,7,14,21]);
for(const c of configs)assert.equal(S.classifyWin(S.fastCheckWin(diagonal,c.rules)),"diagonal");

// Short deterministic random batches exercise the E mechanics while checking
// that disabled formations never appear in the reported results.
for(const c of configs){
  const r=S.runBatch({rules:c.rules,games:40,seed:1,strength:"random",jumpPolicy:"opposite",responsePolicy:"sequential",boundaryPolicy:"responder-choice",jumpConsequence:"redeploy-pass"});
  assert.equal(r.moves,0,`${c.key}: ordinary Move appeared.`);
  assert.ok(r.jumps>0,`${c.key}: expected Jump activity in random smoke batch.`);
  if(!c.rules.allowSpacedSquare&&!c.rules.spacedSquareOnly)assert.equal(r.formations["spaced-square"]||0,0,`${c.key}: Spaced Square win appeared while disabled.`);
  if(!c.rules.allowSquare)assert.equal(r.formations.square||0,0,`${c.key}: Square win appeared while disabled.`);
}

console.log("Lipfty 7 Square-pattern comparison tests passed.");
