"use strict";

// Analysis only.  This compares the current Lipfty 10 movement consequences
// with the proposed rule: a handed reserve piece is always placed and never
// returns to reserve.  It does not change any playable application files.

const fs = require("fs");
const path = require("path");
const L8 = require("./lipfty8-simulator.js");
const S = require("./lipfty7-simulator.js");

function arg(name, fallback) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; }
const games = Number(arg("games", "1000"));
const maxTurns = Number(arg("max-turns", "500"));
const outDir = arg("out", path.join(process.cwd(), "Simulation-Results"));
if (!Number.isInteger(games) || games < 1) throw new Error("--games must be a positive whole number.");
if (!Number.isInteger(maxTurns) || maxTurns < 1) throw new Error("--max-turns must be a positive whole number.");

const fixed = { strength:"tactical", maxTurns, jumpPolicy:"opposite", responsePolicy:"sequential", boundaryPolicy:"responder-choice", jumpConsequence:"redeploy-pass", finalFourColourPolicy:"tactical", oneColourPolicy:"placement-only", openingPolicy:"corners-diagonal" };
const versions = [
  ["Standard", {allowJump:true,allowMove:true,allowDiagonal:true,allowSquare:false,allowSpacedSquare:false}],
  ["Advanced", {allowJump:true,allowMove:true,allowDiagonal:true,allowSquare:true,allowSpacedSquare:false}],
  ["Extreme", {allowJump:true,allowMove:true,allowDiagonal:true,allowSquare:true,allowSpacedSquare:true}]
];
const fmtDuration = ms => { const s=Math.max(0,Math.round(ms/1000)); return s<60?`${s}s`:`${Math.floor(s/60)}m ${s%60}s`; };
const fmtFinish = ms => new Date(Date.now()+ms).toLocaleString("en-GB",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
const other = p => p === 0 ? 1 : 0;
const emptySquares = s => s.board.map((p,i)=>p ? -1 : i).filter(i=>i>=0);
const reserveColours = s => ["black","white"].filter(c=>s.normalRemaining[c]>0);
function newStats() { return {placements:0,moves:0,jumps:0,redeployments:0,oneColour:false,finalFour:false,formations:{}}; }
function noteAction(stats, action) { if(action.type === "move") stats.moves++; else if(action.type === "jump") stats.jumps++; else stats.placements++; }
function outcome(s, stats, winner, winType=null) { if(winType) stats.formations[winType]=(stats.formations[winType]||0)+1; return {winner:winner ?? "draw",turns:s.turns,stats}; }
function tacticalForcedPlace(s, colour, rules, stats, source="normal") {
  s.forcedQueue=[{colour,source,responseSlot:1}]; s.forcedPlacements=1;
  const action=S.chooseAction(s,colour,rules,"tactical");
  if(!action) return outcome(s,stats,"draw");
  noteAction(stats,action); const r=S.applyAction(s,action,rules);
  return r.ended ? outcome(s,stats,s.winner,r.winType) : null;
}
function proposedGame(seed, rules) {
  const s=L8.prepareState(seed,fixed.jumpPolicy,fixed.responsePolicy,fixed.boundaryPolicy,fixed.jumpConsequence,fixed.oneColourPolicy,fixed.openingPolicy);
  const stats=newStats();
  while(s.winner===null && s.turns<maxTurns) {
    if (s.finalFour) stats.finalFour=true;
    if (S.normalForcedColourInfo(s)) stats.oneColour=true;
    const colour=S.chooseColour(s,rules,"tactical",fixed.finalFourColourPolicy);
    const action=S.chooseAction(s,colour,rules,"tactical");
    if(!action) return outcome(s,stats,"draw");
    const mover=s.currentPlayer; noteAction(stats,action);
    const first=S.applyAction(s,action,rules);
    if(first.ended) return outcome(s,stats,s.winner,first.winType);

    if(action.type === "move") {
      // Opponent places the exact piece that was handed to the mover.
      s.awaitingMoveResponse=false; s.forcedPlacements=0; s.forcedQueue=[];
      let r=tacticalForcedPlace(s,action.colour,rules,stats);
      if(r) return r;
      // Opponent then selects a reserve colour for the original mover to place.
      const choices=reserveColours(s); if(!choices.length) continue;
      const give=S.chooseColour(s,rules,"tactical",fixed.finalFourColourPolicy);
      r=tacticalForcedPlace(s,give,rules,stats);
      if(r) return r;
    } else if(action.type === "jump") {
      // Opponent redeploys the jumped piece, then the jumper places the piece
      // they were originally handed.  No reserve piece is returned.
      const jumped=s.board[action.over]; if(!jumped) throw new Error("Missing jumped piece.");
      s.board[action.over]=null; s.awaitingJumpRedeploy=false; s.awaitingMoveResponse=false; s.forcedPlacements=0; s.forcedQueue=[];
      const plan=S.chooseRedeployOnlyPlan(s,jumped,rules,"tactical");
      const redeploy=S.applyRedeployPlacement(s,jumped,plan.to,rules); stats.redeployments++;
      if(redeploy.ended) return outcome(s,stats,s.winner,redeploy.winType);
      const r=tacticalForcedPlace(s,action.colour,rules,stats);
      if(r) return r;
    }
    if(s.currentPlayer!==other(mover) && !s.finalFour) throw new Error("Unexpected turn handover.");
  }
  return outcome(s,stats,"draw");
}
function normaliseCurrent(result) {
  const r={winner:result.winner,turns:result.turns,stats:newStats()};
  r.stats.placements=result.placements; r.stats.moves=result.moves; r.stats.jumps=result.jumps; r.stats.redeployments=result.redeployPlacements;
  r.stats.oneColour=!!result.phaseDiagnostics?.oneColourEntry; r.stats.finalFour=!!result.reachedFinalFour;
  if(result.winType) r.stats.formations[result.winType]=1;
  return r;
}
function aggregate(label, kind, play, rules, progress) {
  const a={label,kind,games,wins:[0,0],draws:0,turns:0,placements:0,moves:0,jumps:0,redeployments:0,oneColour:0,finalFour:0,formations:{}};
  for(let seed=1;seed<=games;seed++) {
    const r=play(seed,rules); if(r.winner===0) a.wins[0]++; else if(r.winner===1) a.wins[1]++; else a.draws++;
    a.turns+=r.turns; for(const key of ["placements","moves","jumps","redeployments"]) a[key]+=r.stats[key];
    if(r.stats.oneColour) a.oneColour++; if(r.stats.finalFour) a.finalFour++;
    for(const [name,n] of Object.entries(r.stats.formations)) a.formations[name]=(a.formations[name]||0)+n;
    progress();
  }
  a.p1ScorePct=100*(a.wins[0]+a.draws/2)/games; a.p2ScorePct=100-a.p1ScorePct; a.avgTurns=a.turns/games;
  return a;
}
function archivePrior() {
  fs.mkdirSync(outDir,{recursive:true}); const old=path.join(outDir,"old"); fs.mkdirSync(old,{recursive:true});
  for(const file of fs.readdirSync(outDir)) if(file.startsWith("lipfty10-tactical-no-return-")) fs.renameSync(path.join(outDir,file),path.join(old,`${Date.now()}-${file}`));
}
archivePrior();
const total=games*6, started=Date.now(); let done=0,last=0;
function progress() {
  done++; const now=Date.now(); if(done!==total && now-last<5000) return; last=now;
  const elapsed=now-started, rate=done/(elapsed||1), remaining=(total-done)/rate;
  console.log(`${done.toLocaleString()}/${total.toLocaleString()} | ${(100*done/total).toFixed(1)}% | elapsed ${fmtDuration(elapsed)} | ETA ${fmtDuration(remaining)} | finish ${fmtFinish(remaining)}`);
}
console.log(`Lipfty 10 full tactical comparison: ${games.toLocaleString()} games per set, ${total.toLocaleString()} total.`);
console.log(`Results: ${outDir}`); progress();
const report=[];
for(const [label,raw] of versions) {
  const rules=S.normaliseRules(raw);
  console.log(`Starting ${label}: current rules...`);
  report.push(aggregate(label,"current",seed=>normaliseCurrent(L8.playGame({...fixed,seed,rules})),rules,progress));
  console.log(`Starting ${label}: proposed no-return rules...`);
  report.push(aggregate(label,"proposed",seed=>proposedGame(seed,rules),rules,progress));
}
const runtime=Date.now()-started;
const stamp=`seed1-games${games}`;
const json=path.join(outDir,`lipfty10-tactical-no-return-${stamp}.json`);
const csv=path.join(outDir,`lipfty10-tactical-no-return-${stamp}.csv`);
fs.writeFileSync(json,JSON.stringify({method:"one-ply tactical policy; matched seeds; current versus no-return proposal",gamesPerSet:games,totalGames:total,runtimeMs:runtime,report},null,2));
const headings=["version","rules","p1Wins","p2Wins","draws","p1ScorePct","p2ScorePct","avgTurns","placements","moves","jumps","redeployments","oneColourGames","finalFourGames","formations"];
fs.writeFileSync(csv,[headings.join(","),...report.map(x=>[x.label,x.kind,x.wins[0],x.wins[1],x.draws,x.p1ScorePct.toFixed(3),x.p2ScorePct.toFixed(3),x.avgTurns.toFixed(3),x.placements,x.moves,x.jumps,x.redeployments,x.oneColour,x.finalFour,JSON.stringify(x.formations)].map(v=>`"${String(v).replaceAll('"','""')}"`).join(","))].join("\n"));
console.log("\nSUMMARY");
for(const r of report) console.log(`${r.label} ${r.kind}: P1/P2/draw ${r.wins[0]}/${r.wins[1]}/${r.draws} | score ${r.p1ScorePct.toFixed(2)}%/${r.p2ScorePct.toFixed(2)}% | avg turns ${r.avgTurns.toFixed(2)} | M/J ${r.moves}/${r.jumps}`);
console.log(`Final runtime: ${fmtDuration(runtime)} | JSON: ${json} | CSV: ${csv}`);
