"use strict";
// Analysis only: compare the released consequence rules with the proposed
// rule that a handed piece is always placed, never returned to reserve.
const L8 = require("./lipfty8-simulator.js");
const S = require("./lipfty7-simulator.js");

function readGames(args) {
  const i = args.indexOf("--games");
  const value = i >= 0 ? args[i + 1] : args[0] || 1000;
  const games = Number(value);
  if (!Number.isInteger(games) || games < 1) {
    console.error("Usage: node .\\tools\\run-lipfty10-no-return-comparison.js --games <positive whole number>");
    process.exit(1);
  }
  return games;
}
const GAMES = readGames(process.argv.slice(2));
const versions = [
  ["Standard", {allowJump:true,allowMove:true,allowDiagonal:true,allowSquare:false,allowSpacedSquare:false}],
  ["Advanced", {allowJump:true,allowMove:true,allowDiagonal:true,allowSquare:true,allowSpacedSquare:false}],
  ["Extreme", {allowJump:true,allowMove:true,allowDiagonal:true,allowSquare:true,allowSpacedSquare:true}]
];
const fixed = {strength:"random", maxTurns:500, jumpPolicy:"opposite", responsePolicy:"sequential", boundaryPolicy:"responder-choice", jumpConsequence:"redeploy-pass", finalFourColourPolicy:"random", oneColourPolicy:"placement-only", openingPolicy:"corners-diagonal"};
const other = p => p === 0 ? 1 : 0;
const reserveTotal = s => s.normalRemaining.black + s.normalRemaining.white;
const empty = s => s.board.map((p,i) => p ? -1 : i).filter(i => i >= 0);
const pick = (s, values) => values[Math.floor(s.rng() * values.length)];
const reserveColours = s => ["black","white"].filter(c => s.normalRemaining[c] > 0);
function result(s, winner, draw=false) { return {winner:draw ? "draw" : winner, turns:s.turns}; }
function forcedNormalPlace(s, colour, rules) {
  const squares = empty(s); if (!squares.length) return result(s, null, true);
  const r = S.applyAction(s, {type:"place", colour, to:pick(s,squares)}, rules);
  return r.ended ? result(s,s.winner) : null;
}
function customGame(seed, rules) {
  const s = L8.prepareState(seed, fixed.jumpPolicy, fixed.responsePolicy, fixed.boundaryPolicy, fixed.jumpConsequence, fixed.oneColourPolicy, fixed.openingPolicy);
  while (!s.winner && s.turns < fixed.maxTurns) {
    const colours = S.availableColours(s); if (!colours.length) return result(s,null,true);
    const colour = S.chooseColour(s,rules,"random","random");
    const action = S.chooseAction(s,colour,rules,"random"); if (!action) return result(s,null,true);
    const mover = s.currentPlayer;
    const first = S.applyAction(s,action,rules); if (first.ended) return result(s,s.winner);
    if (action.type === "move") {
      s.awaitingMoveResponse = false;
      s.forcedPlacements = 0;
      // Opponent places the exact handed piece, then chooses a reserve piece
      // (random policy) for the mover's compulsory second placement.
      let r = forcedNormalPlace(s, action.colour, rules); if (r) return r;
      const choices = reserveColours(s); if (!choices.length) continue;
      r = forcedNormalPlace(s, pick(s,choices), rules); if (r) return r;
    } else if (action.type === "jump") {
      s.awaitingMoveResponse = false;
      s.awaitingJumpRedeploy = false;
      s.forcedPlacements = 0;
      // Opponent redeploys the jumped piece; the jumper then places the piece
      // they were holding when they chose the Jump.
      const jumped = s.board[action.over]; if (!jumped) throw new Error("Missing jumped piece");
      s.board[action.over] = null;
      const squares = empty(s); if (!squares.length) return result(s,null,true);
      const redeploy = S.applyRedeployPlacement(s,jumped,pick(s,squares),rules);
      if (redeploy.ended) return result(s,s.winner);
      const r = forcedNormalPlace(s, action.colour, rules); if (r) return r;
    }
    if (s.currentPlayer !== other(mover) && !s.finalFour) throw new Error("Unexpected turn handover");
  }
  return result(s,null,true);
}
function tally(play, rules) { const t=[0,0,0], turns=[]; for(let seed=1;seed<=GAMES;seed++){const r=play(seed,rules); if(r.winner===0)t[0]++;else if(r.winner===1)t[1]++;else t[2]++;turns.push(r.turns);} return {p1:t[0],p2:t[1],draw:t[2],p1Pct:100*t[0]/GAMES,p2Pct:100*t[1]/GAMES,drawPct:100*t[2]/GAMES,avgTurns:turns.reduce((a,b)=>a+b,0)/GAMES}; }
const started=Date.now(), report=[];
console.log(`Running ${GAMES.toLocaleString()} games for each of 6 sets (${(GAMES*6).toLocaleString()} total).`);
for (let i=0;i<versions.length;i++) { const [name, raw]=versions[i], rules=S.normaliseRules(raw); const current=tally(seed=>L8.playGame({...fixed,seed,rules}),rules); const proposed=tally(seed=>customGame(seed,rules),rules); report.push({name,current,proposed}); console.log(`${i+1}/3 ${name} complete`); }
console.log(JSON.stringify({gamesPerSet:GAMES, totalGames:GAMES*6, runtimeMs:Date.now()-started, report},null,2));
