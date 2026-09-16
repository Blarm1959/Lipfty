"use strict";

// Lipfty 9 analysis-only Standard-A stagnation-threshold diagnostic.
//
// Purpose:
//   Tune the tactical AI's anti-stagnation intervention on the proven
//   Standard A rules before using the policy for another A/B/C comparison.
//
// Standard A rules are unchanged: H/V/D + tight square + Spaced Square,
// pinned Opening Four, Move, Jump/redeploy-pass, one-colour placement-only,
// and Final Four exactly as in Lipfty 8.
//
// Tactical order:
//   1. Take an immediate ACTUAL Standard-A win.
//   2. Minimise the next player's immediate ACTUAL winning replies.
//   3. Normally use one fixed H/V/D static positional score as tie-breaker.
//   4. Only after N actions have passed without consuming a normal reserve
//      piece, prefer an equally-safe ordinary reserve placement if available.
//
// The stagnation preference is AI policy only, NOT a Lipfty game rule.

const fs = require("fs");
const path = require("path");
const L8 = require("./lipfty8-simulator.js");
const S = require("./lipfty7-simulator.js");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}
function hasArg(name) { return process.argv.includes(`--${name}`); }

const games = Number(arg("games", "20"));
const seed = Number(arg("seed", "1"));
const maxActions = Number(arg("max-turns", "500"));
const traceSeeds = Number(arg("trace-seeds", "10"));
const thresholdText = String(arg("thresholds", "6,8,12,16"));
const thresholds = thresholdText.split(",").map(x => Number(x.trim())).filter(Number.isFinite);

function defaultOutDir() {
  const drive = fs.existsSync("D:\\") ? "D:" : "C:";
  return path.win32.join(`${drive}\\`, "bxd", "Blarm1959", "Lipfty", "Simulation-Results");
}
const outDir = arg("out", defaultOutDir());

if(!Number.isInteger(games) || games < 1) throw new Error("--games must be a positive integer.");
if(!Number.isInteger(seed)) throw new Error("--seed must be an integer.");
if(!Number.isInteger(maxActions) || maxActions < 1) throw new Error("--max-turns must be a positive integer.");
if(!Number.isInteger(traceSeeds) || traceSeeds < 0) throw new Error("--trace-seeds must be a non-negative integer.");
if(!thresholds.length || thresholds.some(x => !Number.isInteger(x) || x < 1)) throw new Error("--thresholds must be a comma-separated list of positive integers.");
if(new Set(thresholds).size !== thresholds.length) throw new Error("--thresholds must not contain duplicates.");
thresholds.sort((a,b)=>a-b);

const COLOURS = ["black", "white"];
const ANCHOR_SQUARES = [0, 5, 30, 35];
const fixed = {
  jumpPolicy:"opposite",
  responsePolicy:"sequential",
  boundaryPolicy:"responder-choice",
  jumpConsequence:"redeploy-pass",
  finalFourColourPolicy:"tactical",
  oneColourPolicy:"placement-only",
  openingPolicy:"corners-diagonal"
};

const A_RULES = S.normaliseRules({
  allowJump:true, allowMove:true, allowDiagonal:true,
  allowSquare:true, allowSpacedSquare:true,
  spacedSquareOnly:false, allowDiamond:false, allowSpacedDiamond:false
});
const CORE_RULES = S.normaliseRules({
  allowJump:true, allowMove:true, allowDiagonal:true,
  allowSquare:false, allowSpacedSquare:false,
  spacedSquareOnly:false, allowDiamond:false, allowSpacedDiamond:false
});
const VARIANTS = thresholds.map(threshold => ({id:`T${threshold}`, threshold, label:`stagnation ${threshold}`}));

function fmtClock(ts=Date.now()) {
  return new Date(ts).toLocaleTimeString("en-GB", {hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false});
}
function fmtDateTime(ts=Date.now()) {
  return new Date(ts).toLocaleString("en-GB", {weekday:"short",day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false});
}
function fmtDuration(ms) {
  let s=Math.max(0,Math.round(ms/1000)); const h=Math.floor(s/3600); s%=3600; const m=Math.floor(s/60); s%=60;
  if(h) return `${h}h ${m}m ${s}s`; if(m) return `${m}m ${s}s`; return `${s}s`;
}
function actorName(v) { return v===0?"P1":v===1?"P2":"draw"; }
function scoreForWinner(v) { return v===0?1:v===1?0:0.5; }
function round4(v) { return Number(v).toFixed(4); }
function emptySquares(s) { const out=[]; for(let i=0;i<36;i++) if(!s.board[i]) out.push(i); return out; }
function normalReserveCount(s) { return s.normalRemaining.black+s.normalRemaining.white; }
function normalColourCount(s) { return COLOURS.filter(c=>s.normalRemaining[c]>0).length; }
function availableNormalColours(s) { return COLOURS.filter(c=>s.normalRemaining[c]>0); }

function safeArchiveDestination(oldDir,fileName) {
  const direct=path.join(oldDir,fileName); if(!fs.existsSync(direct)) return direct;
  const ext=path.extname(fileName),base=path.basename(fileName,ext),d=new Date();
  const stamp=[d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0"),"-",String(d.getHours()).padStart(2,"0"),String(d.getMinutes()).padStart(2,"0"),String(d.getSeconds()).padStart(2,"0")].join("");
  let candidate=path.join(oldDir,`${base}-${stamp}${ext}`),n=2;
  while(fs.existsSync(candidate)) candidate=path.join(oldDir,`${base}-${stamp}-${n++}${ext}`);
  return candidate;
}
function archivePreviousResults() {
  fs.mkdirSync(outDir,{recursive:true});
  const oldDir=path.join(outDir,"old"); fs.mkdirSync(oldDir,{recursive:true});
  console.log("Archiving previous results..."); let moved=0;
  for(const entry of fs.readdirSync(outDir,{withFileTypes:true})) {
    if(!entry.isFile()) continue;
    fs.renameSync(path.join(outDir,entry.name),safeArchiveDestination(oldDir,entry.name)); moved++;
  }
  console.log(`  moved ${moved} file${moved===1?"":"s"} to ${oldDir}`);
}

function cloneState(s) {
  return {
    ...s,
    board:s.board.slice(),
    cornerRemaining:{...s.cornerRemaining},
    normalRemaining:{...s.normalRemaining},
    finalPieces:[...s.finalPieces],
    forcedQueue:s.forcedQueue.map(x=>({...x}))
  };
}
function lockedIdsFromState(s) {
  const ids=new Set();
  for(const sq of ANCHOR_SQUARES) {
    const p=s.board[sq];
    if(!p) throw new Error(`Pinned corner square ${sq} is unexpectedly empty.`);
    ids.add(p.id);
  }
  if(ids.size!==4) throw new Error("Opening did not create four distinct pinned pieces.");
  return ids;
}
function anchorIdsFromState(s) { return ANCHOR_SQUARES.map(sq=>s.board[sq]?.id); }
function checkAnchors(s,anchorIds) {
  for(let i=0;i<ANCHOR_SQUARES.length;i++) {
    const sq=ANCHOR_SQUARES[i],p=s.board[sq];
    if(!p || p.id!==anchorIds[i]) throw new Error(`Pinned-corner integrity failure at R${Math.floor(sq/6)+1}C${sq%6+1}.`);
  }
}
function isLockedAction(s,a,lockedIds) {
  if(a.type!=="move" && a.type!=="jump") return false;
  const mover=s.board[a.from]; if(mover && lockedIds.has(mover.id)) return true;
  if(a.type==="jump") { const jumped=s.board[a.over]; if(jumped && lockedIds.has(jumped.id)) return true; }
  return false;
}
function enumerateLocked(s,colour,lockedIds,rules=A_RULES) {
  return S.enumerateActions(s,colour,rules).filter(a=>!isLockedAction(s,a,lockedIds));
}
function actionWinsUnder(s,a,rules=A_RULES) { return !!S.fastCheckWin(S.boardAfter(s,a),rules,a.to); }
function placementActions(s,colour,source="normal") {
  const type=source==="final"?"final-place":"place";
  return emptySquares(s).map(to=>({type,to,colour}));
}
function ordinaryReservePlacement(a) { return a.type==="place"; }

function staticCoreActionScore(s,a) {
  const board=S.boardAfter(s,a);
  if(S.fastCheckWin(board,CORE_RULES,a.to)) return 1e9;
  const rr=Math.floor(a.to/6),cc=a.to%6;
  let score=(2.5-Math.abs(rr-2.5))+(2.5-Math.abs(cc-2.5));
  if(a.type==="jump") score+=0.25;
  score+=S.neutralPatternPotential(board,CORE_RULES);
  return score;
}
function staticCorePlacementScore(board,to) {
  if(S.fastCheckWin(board,CORE_RULES,to)) return 1e9;
  const rr=Math.floor(to/6),cc=to%6;
  return (2.5-Math.abs(rr-2.5))+(2.5-Math.abs(cc-2.5))+S.neutralPatternPotential(board,CORE_RULES);
}

function stateSignature(s) {
  const board=s.board.map(p=>p?`${p.colour[0]}${p.id}`:".").join("/");
  const queue=s.forcedQueue.map(q=>`${q.colour[0]}:${q.source}:${q.responseSlot??""}:${q.plannedTo??""}`).join("+");
  return [board,`P${s.currentPlayer+1}`,`N${s.normalRemaining.black}/${s.normalRemaining.white}`,`F${s.finalPieces.join("+")}`,`Q${queue}`,`M${s.awaitingMoveResponse?1:0}`,`J${s.awaitingJumpRedeploy?1:0}`,`S${s.sequentialSecondOwed?1:0}`,`BC${s.boundaryCornerOwed?1:0}`,`BS${s.boundarySelfCornerOwed?1:0}`,`X${s.protectedPieceId??""}`].join("|");
}

let heartbeatLast=0,runStartedAt=0,heartbeatSeed="",heartbeatVariant="";
function heartbeat(stage,force=false) {
  const now=Date.now();
  if(!force && now-heartbeatLast<5000) return;
  heartbeatLast=now;
  const elapsed=runStartedAt?fmtDuration(now-runStartedAt):"0s";
  console.log(`  ${fmtClock(now)} | working seed ${heartbeatSeed} ${heartbeatVariant} | ${stage} | elapsed ${elapsed}`);
}

function colourImmediateInfo(s,colour,lockedIds,{placementOnly=false,source="normal"}={}) {
  const actions=placementOnly?placementActions(s,colour,source):enumerateLocked(s,colour,lockedIds,A_RULES);
  if(!actions.length) return {colour,wins:0,bestNeutral:-Infinity,actions:0};
  let wins=0,bestNeutral=-Infinity;
  for(let i=0;i<actions.length;i++) {
    const a=actions[i];
    if(actionWinsUnder(s,a,A_RULES)) wins++;
    const n=staticCoreActionScore(s,a); if(n>bestNeutral) bestNeutral=n;
    if((i&63)===0) heartbeat(`scan immediate actions ${i+1}/${actions.length}`);
  }
  return {colour,wins,bestNeutral,actions:actions.length};
}
function chooseInfoByControl(infos,control) {
  if(!infos.length) return {wins:0,winningColours:0,bestNeutral:-Infinity,colour:null};
  if(control==="actor") {
    const maxWins=Math.max(...infos.map(x=>x.wins));
    let pool=infos.filter(x=>x.wins===maxWins);
    const maxNeutral=Math.max(...pool.map(x=>x.bestNeutral));
    pool=pool.filter(x=>Math.abs(x.bestNeutral-maxNeutral)<1e-9);
    return {wins:maxWins,winningColours:infos.filter(x=>x.wins>0).length,bestNeutral:maxNeutral,colour:pool[0]?.colour||null};
  }
  const minWins=Math.min(...infos.map(x=>x.wins));
  let pool=infos.filter(x=>x.wins===minWins);
  const minNeutral=Math.min(...pool.map(x=>x.bestNeutral));
  pool=pool.filter(x=>Math.abs(x.bestNeutral-minNeutral)<1e-9);
  return {wins:minWins,winningColours:infos.filter(x=>x.wins>0).length,bestNeutral:minNeutral,colour:pool[0]?.colour||null};
}
function nextDecisionThreat(s,lockedIds) {
  if(s.awaitingMoveResponse) {
    const infos=availableNormalColours(s).map(c=>colourImmediateInfo(s,c,lockedIds,{placementOnly:true,source:"normal"}));
    return chooseInfoByControl(infos,"actor");
  }
  if(s.sequentialSecondOwed && !s.forcedQueue.length) {
    const infos=availableNormalColours(s).map(c=>colourImmediateInfo(s,c,lockedIds,{placementOnly:true,source:"normal"}));
    return chooseInfoByControl(infos,"giver");
  }
  if(s.forcedQueue.length) {
    const q=s.forcedQueue[0],info=colourImmediateInfo(s,q.colour,lockedIds);
    return {wins:info.wins,winningColours:info.wins>0?1:0,bestNeutral:info.bestNeutral,colour:q.colour};
  }
  const colours=S.availableColours(s),infos=colours.map(c=>colourImmediateInfo(s,c,lockedIds));
  return chooseInfoByControl(infos,s.finalFour?"actor":"giver");
}
function jumpRedeployThreatAfter(s,a) {
  const t=cloneState(s),result=S.applyAction(t,a,A_RULES);
  if(result.ended) return {wins:0,winningColours:0,bestNeutral:-Infinity};
  const piece=t.board[a.over];
  if(!piece) return {wins:0,winningColours:0,bestNeutral:-Infinity};
  t.board[a.over]=null;
  let wins=0,bestNeutral=-Infinity;
  const empties=emptySquares(t);
  for(let i=0;i<empties.length;i++) {
    const to=empties[i],b=t.board.slice(); b[to]=piece;
    if(S.fastCheckWin(b,A_RULES,to)) wins++;
    const n=staticCorePlacementScore(b,to); if(n>bestNeutral) bestNeutral=n;
    if((i&63)===0) heartbeat(`scan Jump redeploy ${i+1}/${empties.length}`);
  }
  return {wins,winningColours:wins>0?1:0,bestNeutral};
}
function profileAction(s,a,lockedIds) {
  const actualWin=actionWinsUnder(s,a,A_RULES);
  if(actualWin) return {action:a,actualWin:true,replyWins:0,replyWinningColours:0,neutral:staticCoreActionScore(s,a)};
  let threat;
  if(a.type==="jump" && s.jumpConsequence!=="current") threat=jumpRedeployThreatAfter(s,a);
  else {
    const t=cloneState(s),result=S.applyAction(t,a,A_RULES);
    threat=result.ended?{wins:0,winningColours:0,bestNeutral:-Infinity}:nextDecisionThreat(t,lockedIds);
  }
  return {action:a,actualWin:false,replyWins:threat.wins,replyWinningColours:threat.winningColours,neutral:staticCoreActionScore(s,a)};
}
function compareSafety(a,b) {
  if(a.actualWin!==b.actualWin) return a.actualWin?-1:1;
  if(a.replyWins!==b.replyWins) return a.replyWins-b.replyWins;
  if(a.replyWinningColours!==b.replyWinningColours) return a.replyWinningColours-b.replyWinningColours;
  return 0;
}
function chooseActionThreshold(s,actions,lockedIds,threshold,stagnation,stats) {
  if(!actions.length) return {action:null,profile:null,mode:"none",intervened:false};
  const planned=s.forcedQueue[0]?.plannedTo;
  const wins=actions.filter(a=>actionWinsUnder(s,a,A_RULES));
  if(wins.length) {
    const action=wins[Math.floor(s.rng()*wins.length)];
    return {action,profile:profileAction(s,action,lockedIds),mode:"actual-win",intervened:false};
  }
  if(planned!==undefined) {
    const action=actions.find(a=>a.to===planned);
    if(action) return {action,profile:profileAction(s,action,lockedIds),mode:"planned",intervened:false};
  }

  const profiles=[];
  for(let i=0;i<actions.length;i++) {
    profiles.push(profileAction(s,actions[i],lockedIds));
    if((i&31)===0) heartbeat(`profile candidate actions ${i+1}/${actions.length}`);
  }
  profiles.sort(compareSafety);
  const safeBest=profiles.filter(x=>compareSafety(x,profiles[0])===0);
  let pool=safeBest,intervened=false;
  const eligible = !s.finalFour && !s.forcedQueue.length && !s.awaitingMoveResponse && !s.awaitingJumpRedeploy && normalColourCount(s)>=2;
  if(eligible && stagnation>=threshold) {
    stats.thresholdOpportunities++;
    const placements=pool.filter(x=>ordinaryReservePlacement(x.action));
    if(placements.length && placements.length<pool.length) {
      pool=placements; intervened=true;
      stats.thresholdInterventions++;
      stats.thresholdPlacementChoices++;
    }
  }
  const maxNeutral=Math.max(...pool.map(x=>x.neutral));
  pool=pool.filter(x=>Math.abs(x.neutral-maxNeutral)<1e-9);
  const chosen=pool[Math.floor(s.rng()*pool.length)];
  stats.lookaheadActionDecisions++;
  return {action:chosen.action,profile:chosen,mode:intervened?"threshold-placement":"one-ply",intervened};
}

function receiverDangerForColour(s,colour,lockedIds) {
  const info=colourImmediateInfo(s,colour,lockedIds);
  return {colour,immediateWins:info.wins,bestNeutral:info.bestNeutral,actions:info.actions};
}
function compareColourSafetyForGiver(a,b) {
  if(a.immediateWins!==b.immediateWins) return a.immediateWins-b.immediateWins;
  if(Math.abs(a.bestNeutral-b.bestNeutral)>1e-9) return a.bestNeutral-b.bestNeutral;
  return 0;
}
function chooseNormalHandoverColour(s,lockedIds,stats) {
  const colours=S.availableColours(s);
  if(!colours.length) return {colour:null,mode:"none",details:""};
  if(colours.length===1) return {colour:colours[0],mode:"single",details:""};
  const dangers=colours.map(c=>receiverDangerForColour(s,c,lockedIds));
  const sorted=[...dangers].sort(compareColourSafetyForGiver),best=sorted[0];
  const tied=sorted.filter(x=>compareColourSafetyForGiver(x,best)===0),chosen=tied[Math.floor(s.rng()*tied.length)];
  stats.handoverLookaheadDecisions++;
  if(dangers.some(x=>x.immediateWins>0)&&dangers.some(x=>x.immediateWins===0)) stats.avoidableImmediateHandoverThreats++;
  if(dangers.every(x=>x.immediateWins>0)) stats.unavoidableImmediateHandoverThreats++;
  return {colour:chosen.colour,mode:"handover-one-ply",details:dangers.map(x=>`${x.colour}:iw${x.immediateWins}/n${Number.isFinite(x.bestNeutral)?x.bestNeutral.toFixed(2):x.bestNeutral}`).join(";")};
}
function chooseFinalFourColour(s,lockedIds) {
  const colours=S.availableColours(s);
  if(!colours.length) return {colour:null,mode:"none",details:""};
  if(colours.length===1) return {colour:colours[0],mode:"single-final",details:""};
  const options=colours.map(c=>receiverDangerForColour(s,c,lockedIds));
  const maxWins=Math.max(...options.map(x=>x.immediateWins));
  let pool=options.filter(x=>x.immediateWins===maxWins);
  const maxNeutral=Math.max(...pool.map(x=>x.bestNeutral));
  pool=pool.filter(x=>Math.abs(x.bestNeutral-maxNeutral)<1e-9);
  const chosen=pool[Math.floor(s.rng()*pool.length)];
  return {colour:chosen.colour,mode:"final-one-ply",details:options.map(x=>`${x.colour}:iw${x.immediateWins}`).join(";")};
}
function chooseColourLookahead(s,lockedIds,stats) {
  if(s.forcedQueue.length) return {colour:s.forcedQueue[0].colour,mode:"forced",details:""};
  if(s.finalFour) return chooseFinalFourColour(s,lockedIds);
  return chooseNormalHandoverColour(s,lockedIds,stats);
}

function chooseForcedSecondColour(s,lockedIds) {
  const colours=availableNormalColours(s);
  if(!colours.length) throw new Error("Sequential second piece is owed but no normal reserve colour remains.");
  const options=colours.map(colour=>{
    const t=cloneState(s);
    t.sequentialSecondOwed=false; t.sequentialFirstColour=null;
    t.forcedQueue=[{colour,source:"normal",responseSlot:2}]; t.forcedPlacements=1;
    return receiverDangerForColour(t,colour,lockedIds);
  });
  const sorted=[...options].sort(compareColourSafetyForGiver),best=sorted[0];
  const tied=sorted.filter(x=>compareColourSafetyForGiver(x,best)===0);
  return tied[Math.floor(s.rng()*tied.length)];
}
function commitSequentialSecondLookahead(s,lockedIds,stats) {
  if(!s.sequentialSecondOwed || s.forcedQueue.length) return null;
  const first=s.sequentialFirstColour,chosen=chooseForcedSecondColour(s,lockedIds);
  s.forcedQueue=[{colour:chosen.colour,source:"normal",responseSlot:2}];
  s.sequentialSecondOwed=false; s.sequentialFirstColour=null; s.forcedPlacements=1;
  stats.sequentialLookaheadChoices++;
  return {kind:"one-ply-second",keep:first,give:chosen.colour,immediateWins:chosen.immediateWins};
}
function commitMoveResponseLookahead(s,lockedIds,stats) {
  if(!s.awaitingMoveResponse) throw new Error("No Move response is awaiting commitment.");
  const count=normalReserveCount(s);
  if(count<1) throw new Error("Move response requested with no normal reserve piece remaining.");
  if(count>=2 && s.responsePolicy==="sequential") {
    const candidates=[],empties=emptySquares(s);
    for(const colour of availableNormalColours(s)) {
      for(let i=0;i<empties.length;i++) {
        const to=empties[i],a={type:"place",to,colour},actualWin=actionWinsUnder(s,a,A_RULES);
        const t=cloneState(s);
        t.awaitingMoveResponse=false;
        t.boundaryCornerOwed=false; t.boundarySelfCornerOwed=false;
        t.forcedQueue=[{colour,source:"normal",responseSlot:1,plannedTo:to}];
        t.sequentialSecondOwed=true; t.sequentialFirstColour=colour; t.forcedPlacements=2;
        const first=S.applyAction(t,a,A_RULES);
        let secondThreat={wins:0,winningColours:0};
        if(!first.ended) { t.forcedQueue=[]; secondThreat=nextDecisionThreat(t,lockedIds); }
        candidates.push({colour,to,actualWin,replyWins:secondThreat.wins,replyWinningColours:secondThreat.winningColours,neutral:staticCoreActionScore(s,a)});
        if((i&31)===0) heartbeat(`Move response candidates ${i+1}/${empties.length}`);
      }
    }
    candidates.sort((a,b)=>{
      if(a.actualWin!==b.actualWin) return a.actualWin?-1:1;
      if(a.replyWins!==b.replyWins) return a.replyWins-b.replyWins;
      if(a.replyWinningColours!==b.replyWinningColours) return a.replyWinningColours-b.replyWinningColours;
      return b.neutral-a.neutral;
    });
    const best=candidates[0];
    const tied=candidates.filter(x=>x.actualWin===best.actualWin&&x.replyWins===best.replyWins&&x.replyWinningColours===best.replyWinningColours&&Math.abs(x.neutral-best.neutral)<1e-9);
    const chosen=tied[Math.floor(s.rng()*tied.length)];
    s.forcedQueue=[{colour:chosen.colour,source:"normal",responseSlot:1,plannedTo:chosen.to}];
    s.boundaryCornerOwed=false; s.boundarySelfCornerOwed=false;
    s.sequentialSecondOwed=true; s.sequentialFirstColour=chosen.colour;
    s.awaitingMoveResponse=false; s.forcedPlacements=2;
    stats.moveResponseLookaheadChoices++;
    return {kind:"one-ply-first",keep:chosen.colour,firstTo:chosen.to,replyWins:chosen.replyWins};
  }

  // Rare exactly-one-normal-reserve boundary. Preserve an actual immediate
  // Standard-A win first, otherwise use the same fixed H/V/D fallback planner.
  if(count===1) {
    const normalColour=COLOURS.find(c=>s.normalRemaining[c]>0);
    const normalWins=placementActions(s,normalColour,"normal").filter(a=>actionWinsUnder(s,a,A_RULES));
    if(normalWins.length) {
      const a=normalWins[Math.floor(s.rng()*normalWins.length)];
      s.forcedQueue=[{colour:normalColour,source:"normal",responseSlot:1,plannedTo:a.to}];
      s.boundaryCornerOwed=s.boundaryPolicy!=="responder-choice";
      s.boundarySelfCornerOwed=s.boundaryPolicy==="responder-choice";
      s.sequentialSecondOwed=false; s.sequentialFirstColour=null;
      s.awaitingMoveResponse=false; s.forcedPlacements=2;
      stats.boundaryActualWinOverrides++;
      return {kind:"boundary-actual-normal-win",keep:normalColour,firstTo:a.to};
    }
  }
  stats.boundaryCoreFallbacks++;
  return S.commitMoveResponse(s,CORE_RULES,"tactical");
}
function commitBoundarySelfCornerLookahead(s,lockedIds,stats) {
  if(!s.boundarySelfCornerOwed || s.forcedQueue.length || !s.finalFour) return null;
  const candidates=[];
  for(const colour of [...new Set(s.finalPieces)]) for(const to of emptySquares(s)) {
    const a={type:"final-place",to,colour};
    candidates.push({colour,to,actualWin:actionWinsUnder(s,a,A_RULES),neutral:staticCoreActionScore(s,a)});
  }
  if(!candidates.length) return null;
  candidates.sort((a,b)=>a.actualWin!==b.actualWin?(a.actualWin?-1:1):b.neutral-a.neutral);
  const best=candidates[0],tied=candidates.filter(x=>x.actualWin===best.actualWin&&Math.abs(x.neutral-best.neutral)<1e-9);
  const chosen=tied[Math.floor(s.rng()*tied.length)];
  s.forcedQueue=[{colour:chosen.colour,source:"final",responseSlot:2,plannedTo:chosen.to}];
  s.boundarySelfCornerOwed=false; s.forcedPlacements=1;
  stats.boundaryLookaheadChoices++;
  return {colour:chosen.colour,to:chosen.to,kind:"boundary-self-one-ply"};
}
function commitBoundaryCornerLookahead(s,lockedIds,stats) {
  if(!s.boundaryCornerOwed || s.forcedQueue.length || !s.finalFour) return null;
  const options=[...new Set(s.finalPieces)].map(colour=>receiverDangerForColour(s,colour,lockedIds));
  if(!options.length) return null;
  const sorted=[...options].sort(compareColourSafetyForGiver),best=sorted[0];
  const tied=sorted.filter(x=>compareColourSafetyForGiver(x,best)===0),chosen=tied[Math.floor(s.rng()*tied.length)];
  s.forcedQueue=[{colour:chosen.colour,source:"final",responseSlot:2}];
  s.boundaryCornerOwed=false; s.forcedPlacements=1;
  stats.boundaryLookaheadChoices++;
  return {colour:chosen.colour,kind:"boundary-give-one-ply"};
}

function redeployCandidateProfile(s,piece,to,lockedIds) {
  const b=s.board.slice(); b[to]=piece;
  const actualWin=!!S.fastCheckWin(b,A_RULES,to);
  if(actualWin) return {to,actualWin:true,nextWins:0,neutral:staticCorePlacementScore(b,to)};
  const t=cloneState(s),responder=s.currentPlayer;
  const first=S.applyRedeployPlacement(t,piece,to,A_RULES);
  if(first.ended) return {to,actualWin:true,nextWins:0,neutral:staticCorePlacementScore(b,to)};
  t.forcedPlacements=0; t.forcedQueue=[];
  if(t.jumpConsequence==="redeploy-pass") t.currentPlayer=responder;
  const threat=nextDecisionThreat(t,lockedIds);
  return {to,actualWin:false,nextWins:threat.wins,neutral:staticCorePlacementScore(b,to)};
}
function resolveJumpRedeployLookahead(s,jumpAction,lockedIds,stats) {
  if(!s.awaitingJumpRedeploy) throw new Error("No Jump redeploy response is awaiting resolution.");
  const piece=s.board[jumpAction.over]; if(!piece) throw new Error("Jumped piece missing when redeploy response begins.");
  s.board[jumpAction.over]=null;
  s.awaitingJumpRedeploy=false; s.awaitingMoveResponse=false;
  s.boundaryCornerOwed=false; s.boundarySelfCornerOwed=false; s.sequentialSecondOwed=false; s.sequentialFirstColour=null;
  const responder=s.currentPlayer,empties=emptySquares(s),candidates=[];
  for(let i=0;i<empties.length;i++) {
    candidates.push(redeployCandidateProfile(s,piece,empties[i],lockedIds));
    if((i&31)===0) heartbeat(`redeploy candidates ${i+1}/${empties.length}`);
  }
  const winning=candidates.filter(x=>x.actualWin);
  let pool=winning.length?winning:candidates;
  if(!winning.length) {
    const minNext=Math.min(...pool.map(x=>x.nextWins));
    pool=pool.filter(x=>x.nextWins===minNext);
  }
  const maxNeutral=Math.max(...pool.map(x=>x.neutral));
  pool=pool.filter(x=>Math.abs(x.neutral-maxNeutral)<1e-9);
  const plan=pool[Math.floor(s.rng()*pool.length)];
  if(winning.length) stats.redeployActualWinChoices++; else stats.redeployLookaheadChoices++;
  const first=S.applyRedeployPlacement(s,piece,plan.to,A_RULES);
  if(first.ended) return {ended:true,stage:"redeploy",plan,firstResult:first,piece};
  s.forcedPlacements=0; s.forcedQueue=[];
  if(s.jumpConsequence==="redeploy-pass") s.currentPlayer=responder;
  return {ended:false,stage:"complete",plan,firstResult:first,piece};
}

function actionSignature(a) {
  if(!a) return "none";
  if(a.type==="move") return `move:${a.from}->${a.to}`;
  if(a.type==="jump") return `jump:${a.from}->${a.to}/${a.over}`;
  return `${a.type}:${a.to}`;
}

function selfTest() {
  if(!A_RULES.allowSquare || !A_RULES.allowSpacedSquare || !A_RULES.allowDiagonal || !A_RULES.allowMove || !A_RULES.allowJump) throw new Error("Self-test failed: Standard A rules are incomplete.");
  if(A_RULES.allowDiamond || A_RULES.allowSpacedDiamond) throw new Error("Self-test failed: Diamond rules must remain disabled.");
  if(CORE_RULES.allowSquare || CORE_RULES.allowSpacedSquare || !CORE_RULES.allowDiagonal) throw new Error("Self-test failed: common positional tie-breaker must be H/V/D only.");
  const s=L8.prepareState(1,fixed.jumpPolicy,fixed.responsePolicy,fixed.boundaryPolicy,fixed.jumpConsequence,fixed.oneColourPolicy,fixed.openingPolicy);
  const expected=["black","white","white","black"],actual=ANCHOR_SQUARES.map(i=>s.board[i]?.colour);
  if(actual.some((c,i)=>c!==expected[i])) throw new Error(`Self-test failed: opening anchors are ${actual.join(",")}.`);
  checkAnchors(s,anchorIdsFromState(s));
  if(lockedIdsFromState(s).size!==4) throw new Error("Self-test failed: four anchors were not locked.");
  const tight=Array(36).fill(null); [0,1,6,7].forEach(i=>tight[i]={id:i+1,colour:"black"});
  if(!S.fastCheckWin(tight,A_RULES,7)) throw new Error("Self-test failed: Standard A tight square was not a win.");
  const spaced=Array(36).fill(null); [0,2,12,14].forEach(i=>spaced[i]={id:i+1,colour:"white"});
  if(!S.fastCheckWin(spaced,A_RULES,14)) throw new Error("Self-test failed: Standard A Spaced Square was not a win.");
  const rect=Array(36).fill(null); [0,2,18,20].forEach(i=>rect[i]={id:i+1,colour:"white"});
  if(S.fastCheckWin(rect,A_RULES,20)) throw new Error("Self-test failed: rectangle incorrectly treated as a Spaced Square.");
  if(VARIANTS.map(v=>v.threshold).join(",")!==thresholds.join(",")) throw new Error("Self-test failed: threshold variants changed unexpectedly.");
}

function emptyStats() {
  return {
    placements:0,moves:0,jumps:0,redeployments:0,
    lookaheadActionDecisions:0,handoverLookaheadDecisions:0,
    avoidableImmediateHandoverThreats:0,unavoidableImmediateHandoverThreats:0,
    moveResponseLookaheadChoices:0,sequentialLookaheadChoices:0,boundaryLookaheadChoices:0,boundaryCoreFallbacks:0,boundaryActualWinOverrides:0,
    redeployLookaheadChoices:0,redeployActualWinChoices:0,
    thresholdOpportunities:0,thresholdInterventions:0,thresholdPlacementChoices:0,
    maxStagnation:0,interventionGames:0,reachedOneColour:false,
    jumpSequences:0,maxConsecutiveJumps:0,currentConsecutiveJumps:0
  };
}

function playGame(gameSeed,variant,keepTrace) {
  const s=L8.prepareState(gameSeed,fixed.jumpPolicy,fixed.responsePolicy,fixed.boundaryPolicy,fixed.jumpConsequence,fixed.oneColourPolicy,fixed.openingPolicy);
  const lockedIds=lockedIdsFromState(s),anchorIds=anchorIdsFromState(s); checkAnchors(s,anchorIds);
  const stats=emptyStats(),trace=[];
  let winType="",winningAction="",lastReserveConsumptionTurn=0,intervenedThisGame=false;

  while(s.winner===null && s.turns<maxActions) {
    const seq=commitSequentialSecondLookahead(s,lockedIds,stats);
    const bself=commitBoundarySelfCornerLookahead(s,lockedIds,stats);
    const bcorner=commitBoundaryCornerLookahead(s,lockedIds,stats);
    checkAnchors(s,anchorIds);

    const forcedInfo=S.normalForcedColourInfo(s);
    if(forcedInfo) stats.reachedOneColour=true;
    const category=s.finalFour?"final-four":forcedInfo?"normal-one-colour":"normal-both-colours";
    const actor=s.currentPlayer,preState=keepTrace?stateSignature(s):"";
    const stagnation=Math.max(0,s.turns-lastReserveConsumptionTurn);
    stats.maxStagnation=Math.max(stats.maxStagnation,stagnation);

    const colourChoice=chooseColourLookahead(s,lockedIds,stats),colour=colourChoice.colour;
    if(!colour) { s.winner="draw"; break; }
    const actions=enumerateLocked(s,colour,lockedIds,A_RULES);
    if(!actions.length) { s.winner="draw"; break; }
    const choice=chooseActionThreshold(s,actions,lockedIds,variant.threshold,stagnation,stats),action=choice.action;
    if(!action) { s.winner="draw"; break; }
    if(choice.intervened) intervenedThisGame=true;

    if(keepTrace) trace.push({
      index:trace.length+1,turn:s.turns+1,actor:actorName(actor),category,state:preState,
      threshold:variant.threshold,stagnation_before:stagnation,threshold_active:stagnation>=variant.threshold?"yes":"no",
      plan_seq:seq?JSON.stringify(seq):"",plan_boundary_self:bself?JSON.stringify(bself):"",plan_boundary_corner:bcorner?JSON.stringify(bcorner):"",
      colour,colour_mode:colourChoice.mode,colour_details:colourChoice.details,
      action:actionSignature(action),action_mode:choice.mode,
      reply_immediate_wins:choice.profile?.replyWins??"",reply_winning_colours:choice.profile?.replyWinningColours??"",neutral_tiebreak:choice.profile?.neutral??""
    });

    if(action.type.includes("place")) { stats.placements++; stats.currentConsecutiveJumps=0; }
    else if(action.type==="move") { stats.moves++; stats.currentConsecutiveJumps=0; }
    else if(action.type==="jump") {
      stats.jumps++;
      if(stats.currentConsecutiveJumps===0) stats.jumpSequences++;
      stats.currentConsecutiveJumps++;
      stats.maxConsecutiveJumps=Math.max(stats.maxConsecutiveJumps,stats.currentConsecutiveJumps);
    }

    const beforeReserve=normalReserveCount(s);
    const result=S.applyAction(s,action,A_RULES); checkAnchors(s,anchorIds);
    if(normalReserveCount(s)<beforeReserve) lastReserveConsumptionTurn=s.turns;
    if(result.ended) {
      winType=result.winType||"";
      winningAction=s.winner==="draw"?"":(action.type.includes("place")?"placement":action.type);
      break;
    }

    if(action.type==="jump" && s.jumpConsequence!=="current") {
      const response=resolveJumpRedeployLookahead(s,action,lockedIds,stats); stats.redeployments++; checkAnchors(s,anchorIds);
      if(keepTrace && trace.length) trace[trace.length-1].redeploy_plan=JSON.stringify(response.plan||{});
      if(response.stage==="redeploy") { winType=response.firstResult.winType||""; winningAction="redeploy"; break; }
    } else if(action.type==="move" || action.type==="jump") {
      const plan=commitMoveResponseLookahead(s,lockedIds,stats);
      if(keepTrace && trace.length) trace[trace.length-1].move_response_plan=JSON.stringify(plan||{});
    }
    checkAnchors(s,anchorIds);
  }

  if(intervenedThisGame) stats.interventionGames=1;
  stats.maxStagnation=Math.max(stats.maxStagnation,Math.max(0,s.turns-lastReserveConsumptionTurn));
  if(s.winner===null) s.winner="draw";
  return {
    seed:gameSeed,variant:variant.id,threshold:variant.threshold,winner:s.winner,winner_name:actorName(s.winner),p1_score:scoreForWinner(s.winner),actions:s.turns,
    placements:stats.placements,moves:stats.moves,jumps:stats.jumps,redeployments:stats.redeployments,
    reached_one_colour:stats.reachedOneColour?"yes":"no",reached_final_four:s.reachedFinalFour?"yes":"no",
    recorded_win_type:winType,winning_action:winningAction,max_action_draw:s.winner==="draw"&&s.turns>=maxActions?"yes":"no",
    threshold_opportunities:stats.thresholdOpportunities,threshold_interventions:stats.thresholdInterventions,threshold_placement_choices:stats.thresholdPlacementChoices,intervention_game:stats.interventionGames?"yes":"no",max_stagnation:stats.maxStagnation,
    lookahead_action_decisions:stats.lookaheadActionDecisions,handover_lookahead_decisions:stats.handoverLookaheadDecisions,
    move_response_lookahead_choices:stats.moveResponseLookaheadChoices,sequential_lookahead_choices:stats.sequentialLookaheadChoices,
    redeploy_lookahead_choices:stats.redeployLookaheadChoices,redeploy_actual_win_choices:stats.redeployActualWinChoices,
    jump_sequences:stats.jumpSequences,max_consecutive_jumps:stats.maxConsecutiveJumps,
    trace
  };
}

function firstDivergence(left,right) {
  const lt=left.trace,rt=right.trace,n=Math.max(lt.length,rt.length);
  for(let i=0;i<n;i++) {
    const l=lt[i],r=rt[i];
    if(!l||!r) return {index:i+1,type:"trace-length"};
    if(l.state!==r.state) return {index:i+1,type:"state"};
    if(l.colour!==r.colour) return {index:i+1,type:"handed-colour"};
    if(l.action!==r.action) return {index:i+1,type:"action"};
    if((l.move_response_plan||"")!==(r.move_response_plan||"") || (l.redeploy_plan||"")!==(r.redeploy_plan||"")) return {index:i+1,type:"response-plan"};
  }
  return {index:0,type:"none"};
}

function newAggregate(v) {
  return {variant:v,n:0,wins:[0,0],draws:0,score:0,actions:0,minActions:Infinity,maxActions:0,placements:0,moves:0,jumps:0,redeployments:0,oneColour:0,finalFour:0,maxDraws:0,formations:{},
    thresholdOpportunities:0,thresholdInterventions:0,thresholdPlacementChoices:0,interventionGames:0,maxStagnation:0,jumpSequences:0,maxConsecutiveJumps:0};
}
function addAggregate(a,g) {
  a.n++; if(g.winner_name==="draw") a.draws++; else if(g.winner_name==="P1") a.wins[0]++; else a.wins[1]++;
  a.score+=g.p1_score; a.actions+=g.actions; a.minActions=Math.min(a.minActions,g.actions); a.maxActions=Math.max(a.maxActions,g.actions);
  a.placements+=g.placements; a.moves+=g.moves; a.jumps+=g.jumps; a.redeployments+=g.redeployments;
  if(g.reached_one_colour==="yes") a.oneColour++;
  if(g.reached_final_four==="yes") a.finalFour++;
  if(g.max_action_draw==="yes") a.maxDraws++;
  if(g.recorded_win_type) a.formations[g.recorded_win_type]=(a.formations[g.recorded_win_type]||0)+1;
  a.thresholdOpportunities+=g.threshold_opportunities; a.thresholdInterventions+=g.threshold_interventions; a.thresholdPlacementChoices+=g.threshold_placement_choices;
  if(g.intervention_game==="yes") a.interventionGames++;
  a.maxStagnation=Math.max(a.maxStagnation,g.max_stagnation);
  a.jumpSequences+=g.jump_sequences; a.maxConsecutiveJumps=Math.max(a.maxConsecutiveJumps,g.max_consecutive_jumps);
}
function aggregateRow(a) {
  const n=a.n||1;
  return {
    variant:a.variant.id,threshold:a.variant.threshold,games:a.n,p1_wins:a.wins[0],p2_wins:a.wins[1],draws:a.draws,p1_score_pct:round4(100*a.score/n),average_actions:round4(a.actions/n),min_actions:a.minActions===Infinity?0:a.minActions,max_actions:a.maxActions,
    placements:a.placements,moves:a.moves,jumps:a.jumps,redeployments:a.redeployments,one_colour_games:a.oneColour,final_four_games:a.finalFour,max_action_draws:a.maxDraws,
    horizontal_wins:a.formations.horizontal||0,vertical_wins:a.formations.vertical||0,diagonal_wins:a.formations.diagonal||0,tight_square_wins:a.formations.square||0,spaced_square_wins:a.formations["spaced-square"]||0,
    threshold_opportunities:a.thresholdOpportunities,threshold_interventions:a.thresholdInterventions,threshold_placement_choices:a.thresholdPlacementChoices,intervention_games:a.interventionGames,max_stagnation:a.maxStagnation,
    jump_sequences:a.jumpSequences,max_consecutive_jumps:a.maxConsecutiveJumps
  };
}

function csvEscape(v) { return `"${String(v??"").replace(/"/g,'""')}"`; }
function writeCsv(filePath,rows) {
  if(!rows.length) { fs.writeFileSync(filePath,"","utf8"); return; }
  const keys=Object.keys(rows[0]);
  fs.writeFileSync(filePath,keys.join(",")+"\r\n"+rows.map(r=>keys.map(k=>csvEscape(r[k])).join(",")).join("\r\n")+"\r\n","utf8");
}
function gameRow(g) { const x={...g}; delete x.winner; delete x.trace; return x; }

selfTest();
if(hasArg("self-test")) { console.log("Lipfty 9 Standard-A stagnation-threshold diagnostic self-test passed."); process.exit(0); }

const started=Date.now(); runStartedAt=started; heartbeatLast=started; archivePreviousResults();
console.log("");
console.log("Lipfty 9 — Standard-A stagnation-threshold diagnostic");
console.log(`Run started: ${fmtDateTime(started)}`);
console.log(`Results: ${outDir}`);
console.log(`Matched seeds: ${seed}-${seed+games-1} (${games})`);
console.log(`Thresholds: ${thresholds.join(", ")} actions without normal-reserve consumption`);
console.log("Standard A rules only. Tactical safety stays primary; the placement preference activates only at the threshold.\n");

const aggregates=new Map(VARIANTS.map(v=>[v.id,newAggregate(v)]));
const allGames=[],traceRows=[],divergenceRows=[];
const pairDefs=[];
for(let i=0;i<VARIANTS.length-1;i++) pairDefs.push([VARIANTS[i].id,VARIANTS[i+1].id]);
if(VARIANTS.length>2) pairDefs.push([VARIANTS[0].id,VARIANTS[VARIANTS.length-1].id]);
const pairStats=new Map(pairDefs.map(([l,r])=>[`${l}|${r}`,{n:0,changedWinner:0,sameWinner:0,divTypes:{},divTotal:0,divN:0}]));

for(let i=0;i<games;i++) {
  const gameSeed=seed+i,byId={};
  for(const v of VARIANTS) {
    heartbeatSeed=gameSeed; heartbeatVariant=v.id; heartbeat("start threshold",true);
    const g=playGame(gameSeed,v,true); byId[v.id]=g; allGames.push(gameRow(g)); addAggregate(aggregates.get(v.id),g);
    if(i<traceSeeds) for(const t of g.trace) traceRows.push({seed:gameSeed,variant:v.id,threshold:v.threshold,...t});
  }
  for(const [l,r] of pairDefs) {
    const left=byId[l],right=byId[r],d=firstDivergence(left,right),p=pairStats.get(`${l}|${r}`); p.n++;
    if(left.winner_name===right.winner_name) p.sameWinner++; else p.changedWinner++;
    p.divTypes[d.type]=(p.divTypes[d.type]||0)+1; if(d.index) { p.divTotal+=d.index; p.divN++; }
    divergenceRows.push({seed:gameSeed,comparison:`${l}->${r}`,left_winner:left.winner_name,right_winner:right.winner_name,left_actions:left.actions,right_actions:right.actions,first_divergence_action:d.index,divergence_type:d.type,left_max_stagnation:left.max_stagnation,right_max_stagnation:right.max_stagnation,left_interventions:left.threshold_interventions,right_interventions:right.threshold_interventions});
  }
  if(i===0 || i+1===games || (i+1)%Math.max(1,Math.ceil(games/10))===0) {
    const elapsed=Date.now()-started,eta=elapsed/(i+1)*(games-i-1);
    const status=VARIANTS.map(v=>`${v.id} ${round4(100*aggregates.get(v.id).score/aggregates.get(v.id).n)}%`).join(" | ");
    console.log(`  ${fmtClock()} | seeds ${i+1}/${games} | ${status} | elapsed ${fmtDuration(elapsed)} | ETA ${fmtDuration(eta)}`);
  }
}

const summaryRows=VARIANTS.map(v=>aggregateRow(aggregates.get(v.id)));
const pairRows=pairDefs.map(([l,r])=>{
  const p=pairStats.get(`${l}|${r}`),L=summaryRows.find(x=>x.variant===l),R=summaryRows.find(x=>x.variant===r);
  return {comparison:`${l}->${r}`,seeds:p.n,left_p1_score_pct:L.p1_score_pct,right_p1_score_pct:R.p1_score_pct,p1_score_delta_pp:round4(Number(R.p1_score_pct)-Number(L.p1_score_pct)),same_winner:p.sameWinner,changed_winner:p.changedWinner,average_first_divergence_action:p.divN?round4(p.divTotal/p.divN):"0.0000",divergence_types:Object.entries(p.divTypes).sort((a,b)=>b[1]-a[1]).map(([k,n])=>`${k}:${n}`).join(";")};
});

const tag=`seed${seed}-games${games}`;
const summaryPath=path.join(outDir,`lipfty9-stagnation-threshold-summary-${tag}.csv`);
const pairsPath=path.join(outDir,`lipfty9-stagnation-threshold-pairs-${tag}.csv`);
const gamesPath=path.join(outDir,`lipfty9-stagnation-threshold-games-${tag}.csv`);
const divergencePath=path.join(outDir,`lipfty9-stagnation-threshold-divergences-${tag}.csv`);
const tracePath=path.join(outDir,`lipfty9-stagnation-threshold-trace-${tag}.csv`);
const reportPath=path.join(outDir,`lipfty9-stagnation-threshold-report-${tag}.txt`);
writeCsv(summaryPath,summaryRows); writeCsv(pairsPath,pairRows); writeCsv(gamesPath,allGames); writeCsv(divergencePath,divergenceRows); writeCsv(tracePath,traceRows);

const report=[
  "Lipfty 9 — Standard-A stagnation-threshold diagnostic",
  `Started: ${fmtDateTime(started)}`,
  `Finished: ${fmtDateTime()}`,
  `Seeds: ${seed}-${seed+games-1} (${games} matched seeds)`,
  `Thresholds: ${thresholds.join(", ")}`,
  "",
  "METHOD",
  "Standard A winning rules only: H/V/D + tight square + Spaced Square.",
  "Immediate actual-rule wins are always taken and immediate opponent wins are minimised first.",
  "Normally the common static H/V/D score breaks tactical ties.",
  "Only after the threshold number of actions without consuming a normal reserve piece does an equally-safe ordinary reserve placement receive preference.",
  "The threshold preference is AI policy only; it is not a Lipfty game rule.",
  "Pinned opening anchors and all other Lipfty 8 Standard mechanics remain unchanged.",
  "",
  "BALANCE / LENGTH",
  ...summaryRows.map(x=>`${x.variant} (threshold ${x.threshold}): P1 ${x.p1_wins}, P2 ${x.p2_wins}, draws ${x.draws}; P1 score ${x.p1_score_pct}%; avg/min/max actions ${x.average_actions}/${x.min_actions}/${x.max_actions}; one-colour ${x.one_colour_games}; Final Four ${x.final_four_games}; max-action draws ${x.max_action_draws}; H/V/D/Sq/SS ${x.horizontal_wins}/${x.vertical_wins}/${x.diagonal_wins}/${x.tight_square_wins}/${x.spaced_square_wins}.`),
  "",
  "STAGNATION DIAGNOSTICS",
  ...summaryRows.map(x=>`${x.variant}: intervention games ${x.intervention_games}/${x.games}; threshold opportunities ${x.threshold_opportunities}; actual placement interventions ${x.threshold_interventions}; max stagnation ${x.max_stagnation}; Move/Jump counts ${x.moves}/${x.jumps}; Jump sequences ${x.jump_sequences}; max consecutive Jumps ${x.max_consecutive_jumps}.`),
  "",
  "MATCHED THRESHOLD COMPARISONS",
  ...pairRows.map(x=>`${x.comparison}: P1 score ${x.left_p1_score_pct}% -> ${x.right_p1_score_pct}% (${Number(x.p1_score_delta_pp)>=0?"+":""}${x.p1_score_delta_pp} pp); changed winner ${x.changed_winner}/${x.seeds}; avg first divergence action ${x.average_first_divergence_action}; ${x.divergence_types}.`),
  "",
  "INTERPRETATION",
  "The useful threshold is the one that restores ordinary game lengths without creating a large P1/P2 imbalance in Standard A.",
  "Do not select a threshold from intervention count alone; balance, game length, max-action draws, Final Four reach and Move/Jump activity should be considered together.",
  "",
  `Total runtime: ${fmtDuration(Date.now()-started)}`,
  ""
].join("\r\n");
fs.writeFileSync(reportPath,report,"utf8");

console.log("\nSUMMARY");
for(const x of summaryRows) console.log(`  ${x.variant}: P1 score ${x.p1_score_pct}% | P1/P2/draw ${x.p1_wins}/${x.p2_wins}/${x.draws} | avg ${x.average_actions} | Final Four ${x.final_four_games} | max draws ${x.max_action_draws}`);
console.log("\nSTAGNATION");
for(const x of summaryRows) console.log(`  ${x.variant}: interventions ${x.threshold_interventions} in ${x.intervention_games}/${x.games} games | max stagnation ${x.max_stagnation} | Move/Jump ${x.moves}/${x.jumps}`);
console.log("\nMATCHED THRESHOLDS");
for(const x of pairRows) console.log(`  ${x.comparison}: ${x.left_p1_score_pct}% -> ${x.right_p1_score_pct}% | delta ${x.p1_score_delta_pp} pp | changed ${x.changed_winner}/${x.seeds} | first divergence ${x.average_first_divergence_action}`);
console.log(`\nReport: ${reportPath}`);
console.log(`Summary CSV: ${summaryPath}`);
console.log(`Pair CSV: ${pairsPath}`);
console.log(`Divergence CSV: ${divergencePath}`);
console.log(`Per-game CSV: ${gamesPath}`);
console.log(`Trace CSV (first ${Math.min(traceSeeds,games)} seeds): ${tracePath}`);
console.log(`Total time: ${fmtDuration(Date.now()-started)} | finished ${fmtDateTime()}`);
