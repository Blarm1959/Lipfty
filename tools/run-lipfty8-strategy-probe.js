"use strict";

// Lipfty 8 strategy probe.
//
// Purpose: test whether the very balanced Config 5 result survives when we
// look beyond the single tactical choice made on the baseline path. At each
// free normal-turn decision we compare the baseline tactical action with the
// strongest few alternatives, then roll each option forward with ordinary
// Lipfty 7 tactical play. We also test the two-colour handover choice from the
// opponent/chooser's point of view.
//
// This is deliberately analysis-only. It does NOT alter Lipfty rules or the
// released tactical chooser, and it is not an exhaustive proof/game-tree solve.

const fs = require("fs");
const path = require("path");
const L8 = require("./lipfty8-simulator.js");
const S = require("./lipfty7-simulator.js");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i+1] !== undefined ? process.argv[i+1] : fallback;
}

const seedArg = arg("seeds", "10001,10002,10003,10005");
const rollouts = Number(arg("rollouts", "2"));
const topActions = Number(arg("top-actions", "4"));
const maxActions = Number(arg("max-turns", "500")); // compatibility with existing simulator option name
const outDir = arg("out", "C:\\bxd\\Lipfty-Simulation-Results");

const seeds = String(seedArg).split(",").map(v=>v.trim()).filter(Boolean).map(Number);
if(!seeds.length || seeds.some(v=>!Number.isInteger(v))) throw new Error("--seeds must be a comma-separated list of integers.");
if(!Number.isInteger(rollouts) || rollouts < 1) throw new Error("--rollouts must be a positive integer.");
if(!Number.isInteger(topActions) || topActions < 1) throw new Error("--top-actions must be a positive integer.");
if(!Number.isInteger(maxActions) || maxActions < 1) throw new Error("--max-turns must be a positive integer.");

const rules = S.normaliseRules({
  allowJump:true,
  allowMove:true,
  allowDiagonal:true,
  allowSquare:true,
  allowSpacedSquare:true,
  spacedSquareOnly:false,
  allowDiamond:false,
  allowSpacedDiamond:false
});

const fixed = {
  jumpPolicy:"opposite",
  responsePolicy:"sequential",
  boundaryPolicy:"responder-choice",
  jumpConsequence:"redeploy-pass",
  finalFourColourPolicy:"tactical",
  oneColourPolicy:"placement-only",
  openingPolicy:"corners-diagonal"
};

function other(p) { return 1-p; }
function actorName(p) { return p === 0 ? "P1" : p === 1 ? "P2" : "draw"; }
function squareName(i) { return i === undefined || i === null ? "" : `R${Math.floor(i/6)+1}C${i%6+1}`; }
function actionLabel(a) {
  if(!a) return "none";
  if(a.type.includes("place")) return `${a.type}:${a.colour}->${squareName(a.to)}`;
  if(a.type === "move") return `move:${a.colour}:${squareName(a.from)}->${squareName(a.to)}`;
  if(a.type === "jump") return `jump:${a.colour}:${squareName(a.from)}>${squareName(a.over)}>${squareName(a.to)}`;
  return JSON.stringify(a);
}
function actionKey(a) {
  if(!a) return "none";
  return [a.type,a.colour,a.from??"",a.over??"",a.to??""].join(":");
}
function scoreText(v) { return `${(100*v).toFixed(0)}%`; }
function formatNum(v) { return Number.isFinite(v) ? v.toFixed(2) : String(v); }

function mulberry32(seed) {
  let a=seed>>>0;
  return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
}
function hash32(text) {
  let h=2166136261>>>0;
  for(let i=0;i<text.length;i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h,16777619)>>>0;
  }
  return h>>>0;
}
function rolloutSeed(gameSeed, actionNumber, kind, option, index) {
  return (gameSeed ^ hash32(`${actionNumber}|${kind}|${option}|${index}`) ^ Math.imul(index+1,0x9E3779B1))>>>0;
}

function cloneStateForRollout(s, seed) {
  return {
    ...s,
    board:s.board.map(p=>p?{...p}:null),
    cornerRemaining:{...s.cornerRemaining},
    normalRemaining:{...s.normalRemaining},
    finalPieces:[...s.finalPieces],
    forcedQueue:s.forcedQueue.map(q=>({...q})),
    rng:mulberry32(seed)
  };
}

function normalReserveCount(s) { return s.normalRemaining.black+s.normalRemaining.white; }
function normalColourCount(s) { return ["black","white"].filter(c=>s.normalRemaining[c]>0).length; }

function commitPending(s) {
  const seq=S.commitSequentialSecond(s,rules,"tactical");
  const self=S.commitBoundarySelfCorner(s,rules,"tactical");
  const corner=S.commitBoundaryCorner(s,rules,"tactical");
  return {seq,self,corner};
}

function finishConsequencesAndContinue(s, action) {
  const result=S.applyAction(s,action,rules);
  if(result.ended) return {winner:s.winner,actions:s.turns,winType:result.winType||null,winningAction:action.type.includes("place")?"placement":action.type};

  if(action.type === "jump" && s.jumpConsequence !== "current") {
    const response=S.resolveJumpRedeploy(s,action,rules,"tactical");
    if(response.stage === "redeploy") {
      return {winner:s.winner,actions:s.turns,winType:response.firstResult.winType||null,winningAction:"redeploy"};
    }
  } else if(action.type === "move" || action.type === "jump") {
    S.commitMoveResponse(s,rules,"tactical");
  }
  return continueTactical(s);
}

function continueTactical(s) {
  while(!s.winner && s.turns < maxActions) {
    commitPending(s);
    const colour=S.chooseColour(s,rules,"tactical",fixed.finalFourColourPolicy);
    const action=S.chooseAction(s,colour,rules,"tactical");
    if(!action) return {winner:"draw",actions:s.turns,winType:null,winningAction:null};

    const result=S.applyAction(s,action,rules);
    if(result.ended) return {winner:s.winner,actions:s.turns,winType:result.winType||null,winningAction:action.type.includes("place")?"placement":action.type};

    if(action.type === "jump" && s.jumpConsequence !== "current") {
      const response=S.resolveJumpRedeploy(s,action,rules,"tactical");
      if(response.stage === "redeploy") {
        return {winner:s.winner,actions:s.turns,winType:response.firstResult.winType||null,winningAction:"redeploy"};
      }
    } else if(action.type === "move" || action.type === "jump") {
      S.commitMoveResponse(s,rules,"tactical");
    }
  }
  return {winner:s.winner??"draw",actions:s.turns,winType:null,winningAction:null};
}

function perspectiveScore(winner, player) {
  if(winner === "draw" || winner === null || winner === undefined) return 0.5;
  return winner === player ? 1 : 0;
}

function evaluateActionOption(s, action, player, gameSeed, actionNumber) {
  let wins=0,draws=0,losses=0,total=0;
  for(let r=0;r<rollouts;r++) {
    const rs=rolloutSeed(gameSeed,actionNumber,"action",actionKey(action),r);
    const t=cloneStateForRollout(s,rs);
    const result=finishConsequencesAndContinue(t,action);
    const sc=perspectiveScore(result.winner,player);
    total+=sc;
    if(sc===1)wins++;else if(sc===0.5)draws++;else losses++;
  }
  return {score:total/rollouts,wins,draws,losses};
}

function evaluateColourOption(s, colour, chooser, gameSeed, actionNumber) {
  let wins=0,draws=0,losses=0,total=0;
  for(let r=0;r<rollouts;r++) {
    const rs=rolloutSeed(gameSeed,actionNumber,"handover",colour,r);
    const t=cloneStateForRollout(s,rs);
    const action=S.chooseAction(t,colour,rules,"tactical");
    const result=action ? finishConsequencesAndContinue(t,action) : {winner:"draw"};
    const sc=perspectiveScore(result.winner,chooser);
    total+=sc;
    if(sc===1)wins++;else if(sc===0.5)draws++;else losses++;
  }
  return {score:total/rollouts,wins,draws,losses};
}

function topCandidateActions(s, colour, baselineAction) {
  const actions=S.enumerateActions(s,colour,rules);
  const scored=actions.map(a=>({a,score:S.actionPositionalScore(s,a,rules)}));
  scored.sort((x,y)=>y.score-x.score || actionKey(x.a).localeCompare(actionKey(y.a)));
  const out=scored.slice(0,topActions);
  if(baselineAction && !out.some(x=>actionKey(x.a)===actionKey(baselineAction))) {
    const hit=scored.find(x=>actionKey(x.a)===actionKey(baselineAction));
    if(hit)out.push(hit);
  }
  return {allCount:actions.length,candidates:out};
}

function isFreeNormalDecision(s) {
  return s.openingRemaining===0 && !s.forcedQueue.length && !s.awaitingMoveResponse && !s.awaitingJumpRedeploy &&
    !s.sequentialSecondOwed && !s.boundaryCornerOwed && !s.boundarySelfCornerOwed;
}

const decisionRows=[];
const optionRows=[];
const gameRows=[];

function recordDecision({gameSeed,baselineWinner,actionNumber,type,maker,recipient,baselineOption,options,meta={}}) {
  const baseline=options.find(o=>o.option===baselineOption);
  const sorted=[...options].sort((a,b)=>b.score-a.score || a.option.localeCompare(b.option));
  const best=sorted[0];
  const gain=best.score-(baseline?.score??0);
  decisionRows.push({
    seed:gameSeed,
    baseline_winner:actorName(baselineWinner),
    action_number:actionNumber,
    decision_type:type,
    decision_maker:actorName(maker),
    recipient:recipient===null||recipient===undefined?"":actorName(recipient),
    baseline_option:baselineOption,
    baseline_rollout_score:baseline?baseline.score.toFixed(4):"",
    best_option:best.option,
    best_rollout_score:best.score.toFixed(4),
    gain:gain.toFixed(4),
    option_count:options.length,
    baseline_is_best:Math.abs(gain)<1e-9?1:0,
    baseline_loser_decision:maker===other(baselineWinner)?1:0,
    ...meta
  });
  for(const o of options) {
    optionRows.push({
      seed:gameSeed,action_number:actionNumber,decision_type:type,decision_maker:actorName(maker),
      option:o.option,is_baseline:o.option===baselineOption?1:0,rollout_score:o.score.toFixed(4),
      wins:o.wins,draws:o.draws,losses:o.losses,heuristic_score:o.heuristic===undefined?"":formatNum(o.heuristic)
    });
  }
}

function runBaselineAndProbe(gameSeed) {
  const s=L8.prepareState(gameSeed,fixed.jumpPolicy,fixed.responsePolicy,fixed.boundaryPolicy,fixed.jumpConsequence,fixed.oneColourPolicy,fixed.openingPolicy);
  let winType=null,winningAction=null;
  const localDecisions=[];

  while(!s.winner && s.turns < maxActions) {
    commitPending(s);
    const free=isFreeNormalDecision(s);
    const actionNumber=s.turns+1;
    const beforeColourState=free ? cloneStateForRollout(s,gameSeed^0xA5A5A5A5) : null;
    const available=free ? S.availableColours(s) : [];

    const colour=S.chooseColour(s,rules,"tactical",fixed.finalFourColourPolicy);
    const action=S.chooseAction(s,colour,rules,"tactical");
    if(!action) { s.winner="draw"; break; }

    if(free && !s.finalFour && available.length>1 && normalColourCount(s)>1) {
      const chooser=other(s.currentPlayer);
      const colourOptions=available.map(c=>({option:c,...evaluateColourOption(beforeColourState,c,chooser,gameSeed,actionNumber)}));
      localDecisions.push({kind:"handover",actionNumber,maker:chooser,recipient:s.currentPlayer,baselineOption:colour,options:colourOptions});
    }

    if(free) {
      const actor=s.currentPlayer;
      const {allCount,candidates}=topCandidateActions(s,colour,action);
      if(allCount>1) {
        const actionOptions=candidates.map(({a,score})=>({option:actionLabel(a),heuristic:score,...evaluateActionOption(s,a,actor,gameSeed,actionNumber)}));
        localDecisions.push({kind:"action",actionNumber,maker:actor,recipient:null,baselineOption:actionLabel(action),options:actionOptions,allCount,colour});
      }
    }

    const result=S.applyAction(s,action,rules);
    if(result.ended) {
      winType=result.winType||null;
      winningAction=action.type.includes("place")?"placement":action.type;
      break;
    }
    if(action.type === "jump" && s.jumpConsequence !== "current") {
      const response=S.resolveJumpRedeploy(s,action,rules,"tactical");
      if(response.stage === "redeploy") {
        winType=response.firstResult.winType||null;
        winningAction="redeploy";
        break;
      }
    } else if(action.type === "move" || action.type === "jump") {
      S.commitMoveResponse(s,rules,"tactical");
    }
  }

  const winner=s.winner??"draw";
  const check=L8.playGame({rules,seed:gameSeed,strength:"tactical",maxTurns:maxActions,...fixed});
  if(check.winner!==winner || check.turns!==s.turns) {
    throw new Error(`Baseline replay mismatch for seed ${gameSeed}: probe ${actorName(winner)}/${s.turns}, simulator ${actorName(check.winner)}/${check.turns}.`);
  }

  for(const d of localDecisions) {
    recordDecision({
      gameSeed,baselineWinner:winner,actionNumber:d.actionNumber,type:d.kind,maker:d.maker,recipient:d.recipient,
      baselineOption:d.baselineOption,options:d.options,
      meta:d.kind==="action"?{legal_action_count:d.allCount,colour:d.colour}:{legal_action_count:"",colour:""}
    });
  }

  const seedDecisions=decisionRows.filter(r=>r.seed===gameSeed);
  const improved=seedDecisions.filter(r=>Number(r.gain)>1e-9);
  const loser=winner==="draw"?null:other(winner);
  const loserImprovements=loser===null?[]:improved.filter(r=>r.decision_maker===actorName(loser));
  gameRows.push({
    seed:gameSeed,winner:actorName(winner),actions:s.turns,win_type:winType||check.winType||"",winning_action:winningAction||check.winningActionType||"",
    decisions:seedDecisions.length,improvable_decisions:improved.length,baseline_loser_improvable_decisions:loserImprovements.length
  });

  console.log(`  Seed ${gameSeed}: ${actorName(winner)} in ${s.turns} actions (${winType||check.winType||"n/a"}/${winningAction||check.winningActionType||"n/a"}) | decisions ${seedDecisions.length}, better rollout option ${improved.length}, loser opportunities ${loserImprovements.length}`);
}

function writeCsv(filePath, rows) {
  if(!rows.length)return;
  const keys=Object.keys(rows[0]);
  const esc=v=>`"${String(v??"").replace(/"/g,'""')}"`;
  fs.writeFileSync(filePath,[keys.join(","),...rows.map(row=>keys.map(k=>esc(row[k])).join(","))].join("\r\n")+"\r\n","utf8");
}

console.log("Lipfty 8 — Config 5 play-well / winning-strategy probe");
console.log(`Seeds: ${seeds.join(", ")} | ${rollouts} tactical rollout(s) per option | top ${topActions} action candidates + baseline.`);
console.log("Opening: 2.2 inner-board corners, colours diagonal. All Lipfty 7 rules remain frozen.");
console.log("This is a one-deviation rollout probe, not a full mathematical game-tree proof.\n");

const started=Date.now();
for(const gameSeed of seeds)runBaselineAndProbe(gameSeed);

const improved=decisionRows.filter(r=>Number(r.gain)>1e-9);
const actionImproved=improved.filter(r=>r.decision_type==="action");
const handoverImproved=improved.filter(r=>r.decision_type==="handover");
const loserImproved=improved.filter(r=>r.baseline_loser_decision===1);

console.log("\nSUMMARY");
console.log(`  Baseline games: ${gameRows.length} | P1 wins ${gameRows.filter(g=>g.winner==="P1").length} | P2 wins ${gameRows.filter(g=>g.winner==="P2").length} | draws ${gameRows.filter(g=>g.winner==="draw").length}`);
console.log(`  Decisions tested: ${decisionRows.length} | baseline not rollout-best: ${improved.length}`);
console.log(`  Action-choice improvements: ${actionImproved.length} | handover-colour improvements: ${handoverImproved.length}`);
console.log(`  Decisions belonging to the eventual baseline loser with a better rollout option: ${loserImproved.length}`);

const critical=loserImproved.filter(r=>Number(r.gain)>=0.5).sort((a,b)=>Number(b.gain)-Number(a.gain));
if(critical.length) {
  console.log("\nPOTENTIAL ESCAPE / WINNING-STRATEGY LEADS (gain >= 50 percentage points in this small rollout sample)");
  for(const r of critical.slice(0,12)) {
    console.log(`  Seed ${r.seed}, action ${r.action_number}, ${r.decision_maker} ${r.decision_type}: ${r.baseline_option} ${scoreText(Number(r.baseline_rollout_score))} -> ${r.best_option} ${scoreText(Number(r.best_rollout_score))}`);
  }
} else {
  console.log("\nNo >=50pp baseline-loser escape was found in this first probe.");
}

try {
  fs.mkdirSync(outDir,{recursive:true});
  const tag=`seeds${seeds.join("-")}-r${rollouts}-top${topActions}`;
  const gamePath=path.join(outDir,`lipfty8-strategy-games-${tag}.csv`);
  const decisionPath=path.join(outDir,`lipfty8-strategy-decisions-${tag}.csv`);
  const optionPath=path.join(outDir,`lipfty8-strategy-options-${tag}.csv`);
  writeCsv(gamePath,gameRows);
  writeCsv(decisionPath,decisionRows);
  writeCsv(optionPath,optionRows);
  console.log(`\nGame summary CSV: ${gamePath}`);
  console.log(`Decision summary CSV: ${decisionPath}`);
  console.log(`Option detail CSV: ${optionPath}`);
} catch(err) {
  console.warn(`\nCSV not written: ${err.message}`);
}

console.log(`Total probe time: ${Math.round((Date.now()-started)/1000)}s`);
