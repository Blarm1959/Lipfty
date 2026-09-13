"use strict";

// Lipfty 8 strategy probe.
// Analysis-only: no Lipfty rules or released tactical chooser are changed.
// Rollouts use common random numbers so options at the same decision are paired.
// Long-running work prints a start time plus live heartbeat/progress lines.

const fs = require("fs");
const path = require("path");
const L8 = require("./lipfty8-simulator.js");
const S = require("./lipfty7-simulator.js");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i+1] !== undefined ? process.argv[i+1] : fallback;
}

const seedArg = arg("seeds", "10001,10002,10003,10005");
const rollouts = Number(arg("rollouts", "20"));
const topActions = Number(arg("top-actions", "8"));
const reportGain = Number(arg("report-gain", "0.20"));
const maxActions = Number(arg("max-turns", "500")); // compatibility with existing simulator option name
const outDir = arg("out", "C:\\bxd\\Lipfty-Simulation-Results");
const heartbeatSeconds = Number(arg("heartbeat", "15"));

const seeds = String(seedArg).split(",").map(v=>v.trim()).filter(Boolean).map(Number);
if(!seeds.length || seeds.some(v=>!Number.isInteger(v))) throw new Error("--seeds must be a comma-separated list of integers.");
if(!Number.isInteger(rollouts) || rollouts < 1) throw new Error("--rollouts must be a positive integer.");
if(!Number.isInteger(topActions) || topActions < 1) throw new Error("--top-actions must be a positive integer.");
if(!Number.isFinite(reportGain) || reportGain < 0 || reportGain > 1) throw new Error("--report-gain must be between 0 and 1.");
if(!Number.isInteger(maxActions) || maxActions < 1) throw new Error("--max-turns must be a positive integer.");
if(!Number.isFinite(heartbeatSeconds) || heartbeatSeconds < 1) throw new Error("--heartbeat must be at least 1 second.");

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
function fmtClock(ms=Date.now()) {
  return new Date(ms).toLocaleTimeString("en-GB", {hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false});
}
function fmtDateTime(ms=Date.now()) {
  return new Date(ms).toLocaleString("en-GB", {weekday:"short",day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false});
}
function fmtDuration(ms) {
  const total=Math.max(0,Math.round(ms/1000));
  const h=Math.floor(total/3600),m=Math.floor((total%3600)/60),s=total%60;
  if(h)return `${h}h ${m}m ${s}s`;
  if(m)return `${m}m ${s}s`;
  return `${s}s`;
}

let runStartedAt=Date.now();
let seedStartedAt=runStartedAt;
let lastHeartbeatAt=runStartedAt;
function progressLine(text, force=false) {
  const now=Date.now();
  if(!force && now-lastHeartbeatAt < heartbeatSeconds*1000) return;
  lastHeartbeatAt=now;
  console.log(`  ${fmtClock(now)} | ${text} | seed ${fmtDuration(now-seedStartedAt)} | total ${fmtDuration(now-runStartedAt)}`);
}

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
function rolloutSeed(gameSeed, actionNumber, kind, index) {
  // Excludes option identity: every option at a decision uses the same seed for rollout N.
  return (gameSeed ^ hash32(`${actionNumber}|${kind}|paired|${index}`) ^ Math.imul(index+1,0x9E3779B1))>>>0;
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

function evaluateActionOption(s, action, player, gameSeed, actionNumber, progress) {
  let wins=0,draws=0,losses=0,total=0;
  const outcomes=[];
  for(let r=0;r<rollouts;r++) {
    const rs=rolloutSeed(gameSeed,actionNumber,"action",r);
    const t=cloneStateForRollout(s,rs);
    const result=finishConsequencesAndContinue(t,action);
    const sc=perspectiveScore(result.winner,player);
    outcomes.push(sc);
    total+=sc;
    if(sc===1)wins++;else if(sc===0.5)draws++;else losses++;
    progressLine(`seed ${gameSeed} | action ${actionNumber} | ${progress} | rollout ${r+1}/${rollouts}`);
  }
  return {score:total/rollouts,wins,draws,losses,outcomes};
}

function evaluateColourOption(s, colour, chooser, gameSeed, actionNumber, progress) {
  let wins=0,draws=0,losses=0,total=0;
  const outcomes=[];
  for(let r=0;r<rollouts;r++) {
    const rs=rolloutSeed(gameSeed,actionNumber,"handover",r);
    const t=cloneStateForRollout(s,rs);
    const action=S.chooseAction(t,colour,rules,"tactical");
    const result=action ? finishConsequencesAndContinue(t,action) : {winner:"draw"};
    const sc=perspectiveScore(result.winner,chooser);
    outcomes.push(sc);
    total+=sc;
    if(sc===1)wins++;else if(sc===0.5)draws++;else losses++;
    progressLine(`seed ${gameSeed} | action ${actionNumber} | ${progress} | rollout ${r+1}/${rollouts}`);
  }
  return {score:total/rollouts,wins,draws,losses,outcomes};
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

function pairedCounts(option, baseline) {
  const a=option?.outcomes || [], b=baseline?.outcomes || [];
  const n=Math.min(a.length,b.length);
  let better=0,same=0,worse=0;
  for(let i=0;i<n;i++) {
    if(a[i] > b[i]) better++;
    else if(a[i] < b[i]) worse++;
    else same++;
  }
  return {better,same,worse,net:better-worse,n};
}

const decisionRows=[];
const optionRows=[];
const gameRows=[];

function recordDecision({gameSeed,baselineWinner,actionNumber,type,maker,recipient,baselineOption,options,meta={}}) {
  const baseline=options.find(o=>o.option===baselineOption);
  if(!baseline) throw new Error(`Baseline option missing at seed ${gameSeed}, action ${actionNumber}, ${type}.`);

  const ranked=options.map(o=>({o,pair:pairedCounts(o,baseline)})).sort((a,b)=>
    b.o.score-a.o.score || b.pair.net-a.pair.net || a.o.option.localeCompare(b.o.option)
  );
  const best=ranked[0].o;
  const bestPair=ranked[0].pair;
  const gain=best.score-baseline.score;
  const loser=baselineWinner===0||baselineWinner===1 ? other(baselineWinner) : null;

  decisionRows.push({
    seed:gameSeed,
    baseline_winner:actorName(baselineWinner),
    action_number:actionNumber,
    decision_type:type,
    decision_maker:actorName(maker),
    recipient:recipient===null||recipient===undefined?"":actorName(recipient),
    baseline_option:baselineOption,
    baseline_rollout_score:baseline.score.toFixed(4),
    best_option:best.option,
    best_rollout_score:best.score.toFixed(4),
    gain:gain.toFixed(4),
    best_paired_better:bestPair.better,
    best_paired_same:bestPair.same,
    best_paired_worse:bestPair.worse,
    best_paired_net:bestPair.net,
    option_count:options.length,
    baseline_is_best:Math.abs(gain)<1e-9?1:0,
    baseline_loser_decision:loser!==null&&maker===loser?1:0,
    ...meta
  });

  for(const o of options) {
    const pair=pairedCounts(o,baseline);
    optionRows.push({
      seed:gameSeed,action_number:actionNumber,decision_type:type,decision_maker:actorName(maker),
      option:o.option,is_baseline:o.option===baselineOption?1:0,rollout_score:o.score.toFixed(4),
      gain_vs_baseline:(o.score-baseline.score).toFixed(4),
      paired_better:pair.better,paired_same:pair.same,paired_worse:pair.worse,paired_net:pair.net,
      wins:o.wins,draws:o.draws,losses:o.losses,heuristic_score:o.heuristic===undefined?"":formatNum(o.heuristic)
    });
  }
}

function runBaselineAndProbe(gameSeed, seedIndex) {
  seedStartedAt=Date.now();
  lastHeartbeatAt=seedStartedAt;
  console.log(`\nStarting seed ${seedIndex+1}/${seeds.length} (${gameSeed}) at ${fmtClock(seedStartedAt)}...`);

  const s=L8.prepareState(gameSeed,fixed.jumpPolicy,fixed.responsePolicy,fixed.boundaryPolicy,fixed.jumpConsequence,fixed.oneColourPolicy,fixed.openingPolicy);
  let winType=null,winningAction=null;
  const localDecisions=[];
  let decisionNumber=0;

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
      decisionNumber++;
      const chooser=other(s.currentPlayer);
      const decisionStarted=Date.now();
      progressLine(`seed ${gameSeed} | decision ${decisionNumber} | action ${actionNumber} handover | starting ${available.length} options x ${rollouts}`,true);
      const colourOptions=[];
      for(let oi=0;oi<available.length;oi++) {
        const c=available[oi];
        progressLine(`seed ${gameSeed} | decision ${decisionNumber} | handover option ${oi+1}/${available.length} ${c} | starting`,true);
        colourOptions.push({option:c,...evaluateColourOption(beforeColourState,c,chooser,gameSeed,actionNumber,`decision ${decisionNumber} handover option ${oi+1}/${available.length} ${c}`)});
      }
      localDecisions.push({kind:"handover",actionNumber,maker:chooser,recipient:s.currentPlayer,baselineOption:colour,options:colourOptions});
      progressLine(`seed ${gameSeed} | decision ${decisionNumber} handover complete | ${fmtDuration(Date.now()-decisionStarted)}`,true);
    }

    if(free) {
      const actor=s.currentPlayer;
      const {allCount,candidates}=topCandidateActions(s,colour,action);
      if(allCount>1) {
        decisionNumber++;
        const decisionStarted=Date.now();
        progressLine(`seed ${gameSeed} | decision ${decisionNumber} | action ${actionNumber} action-choice | ${candidates.length} candidates x ${rollouts}`,true);
        const actionOptions=[];
        for(let oi=0;oi<candidates.length;oi++) {
          const {a,score}=candidates[oi];
          const label=actionLabel(a);
          progressLine(`seed ${gameSeed} | decision ${decisionNumber} | action option ${oi+1}/${candidates.length} ${label} | starting`,true);
          actionOptions.push({option:label,heuristic:score,...evaluateActionOption(s,a,actor,gameSeed,actionNumber,`decision ${decisionNumber} action option ${oi+1}/${candidates.length}`)});
        }
        localDecisions.push({kind:"action",actionNumber,maker:actor,recipient:null,baselineOption:actionLabel(action),options:actionOptions,allCount,colour});
        progressLine(`seed ${gameSeed} | decision ${decisionNumber} action-choice complete | ${fmtDuration(Date.now()-decisionStarted)}`,true);
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
  const material=improved.filter(r=>Number(r.gain)>=reportGain && r.best_paired_better>r.best_paired_worse);
  const loser=winner==="draw"?null:other(winner);
  const loserImprovements=loser===null?[]:improved.filter(r=>r.decision_maker===actorName(loser));
  const loserMaterial=loser===null?[]:material.filter(r=>r.decision_maker===actorName(loser));
  gameRows.push({
    seed:gameSeed,winner:actorName(winner),actions:s.turns,win_type:winType||check.winType||"",winning_action:winningAction||check.winningActionType||"",
    decisions:seedDecisions.length,improvable_decisions:improved.length,material_improvable_decisions:material.length,
    baseline_loser_improvable_decisions:loserImprovements.length,baseline_loser_material_leads:loserMaterial.length
  });

  const finished=Date.now();
  console.log(`Seed ${gameSeed} finished: ${fmtClock(finished)} | ${fmtDuration(finished-seedStartedAt)} | ${actorName(winner)} in ${s.turns} actions (${winType||check.winType||"n/a"}/${winningAction||check.winningActionType||"n/a"}) | decisions ${seedDecisions.length}, better ${improved.length}, substantial paired leads ${material.length}, loser leads ${loserMaterial.length}`);
}

function writeCsv(filePath, rows) {
  if(!rows.length)return;
  const keys=Object.keys(rows[0]);
  const esc=v=>`"${String(v??"").replace(/"/g,'""')}"`;
  fs.writeFileSync(filePath,[keys.join(","),...rows.map(row=>keys.map(k=>esc(row[k])).join(","))].join("\r\n")+"\r\n","utf8");
}

console.log("Lipfty 8 — Config 5 play-well / winning-strategy probe");
console.log(`Seeds: ${seeds.join(", ")} | ${rollouts} paired tactical rollout(s) per option | top ${topActions} action candidates + baseline.`);
console.log(`Substantial-lead reporting threshold: ${(100*reportGain).toFixed(0)} percentage points.`);
console.log("Common random numbers: ON — every option at the same decision uses the same rollout seed.");
console.log(`Live progress: ON — heartbeat at least every ${heartbeatSeconds}s during rollout evaluation.`);
console.log("Opening: 2.2 inner-board corners, colours diagonal. All Lipfty 7 rules remain frozen.");
console.log("This is a one-deviation rollout probe, not a full mathematical game-tree proof.");
runStartedAt=Date.now();
seedStartedAt=runStartedAt;
lastHeartbeatAt=runStartedAt;
console.log(`Run started: ${fmtDateTime(runStartedAt)}`);

for(const [i,gameSeed] of seeds.entries()) runBaselineAndProbe(gameSeed,i);

const improved=decisionRows.filter(r=>Number(r.gain)>1e-9);
const actionImproved=improved.filter(r=>r.decision_type==="action");
const handoverImproved=improved.filter(r=>r.decision_type==="handover");
const loserImproved=improved.filter(r=>r.baseline_loser_decision===1);
const material=improved.filter(r=>Number(r.gain)>=reportGain && r.best_paired_better>r.best_paired_worse);
const materialLoser=material.filter(r=>r.baseline_loser_decision===1);

console.log("\nSUMMARY");
console.log(`  Baseline games: ${gameRows.length} | P1 wins ${gameRows.filter(g=>g.winner==="P1").length} | P2 wins ${gameRows.filter(g=>g.winner==="P2").length} | draws ${gameRows.filter(g=>g.winner==="draw").length}`);
console.log(`  Decisions tested: ${decisionRows.length} | baseline not rollout-best: ${improved.length}`);
console.log(`  Action-choice improvements: ${actionImproved.length} | handover-colour improvements: ${handoverImproved.length}`);
console.log(`  Eventual baseline loser decisions with any better rollout option: ${loserImproved.length}`);
console.log(`  Substantial paired leads: ${material.length} | belonging to eventual baseline loser: ${materialLoser.length}`);

const critical=materialLoser.sort((a,b)=>Number(b.gain)-Number(a.gain) || b.best_paired_net-a.best_paired_net);
if(critical.length) {
  console.log(`\nPAIRED ESCAPE / STRATEGY LEADS (gain >= ${(100*reportGain).toFixed(0)}pp and paired better > worse)`);
  for(const r of critical.slice(0,16)) {
    console.log(`  Seed ${r.seed}, action ${r.action_number}, ${r.decision_maker} ${r.decision_type}: ${r.baseline_option} ${scoreText(Number(r.baseline_rollout_score))} -> ${r.best_option} ${scoreText(Number(r.best_rollout_score))} | paired ${r.best_paired_better} better / ${r.best_paired_same} same / ${r.best_paired_worse} worse`);
  }
} else {
  console.log(`\nNo substantial paired baseline-loser lead met the ${(100*reportGain).toFixed(0)}pp threshold.`);
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

const overallFinished=Date.now();
console.log(`Total probe time: ${fmtDuration(overallFinished-runStartedAt)} | finished ${fmtDateTime(overallFinished)}`);
