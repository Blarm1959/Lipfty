"use strict";

// Lipfty 9 analysis-only progress-aware one-ply tactical comparison.
//
// A = Lipfty 8 Standard (H/V/D + tight square + Spaced Square)
// B = no Spaced Square (H/V/D + tight square)
// C = no squares (H/V/D only)
//
// Tactical order is deliberately rule-aware but pattern-neutral:
//   1. Take an immediate win under the ACTUAL A/B/C rules.
//   2. Minimise the next player's immediate actual-rule winning replies.
//   3. Among equally safe choices, avoid recently repeated states.
//   4. Among equally safe non-repeating choices, prefer progress:
//      ordinary placement > Move > Jump.
//   5. Use one fixed H/V/D static positional score only as the final tie-break.
//
// Repetition/progress are AI policy only. They are NOT Lipfty game rules.
// This runner changes no playable rules or shared modules.

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
const recentWindow = Number(arg("recent-window", "24"));

function defaultOutDir() {
  const drive = fs.existsSync("D:\\") ? "D:" : "C:";
  return path.win32.join(`${drive}\\`, "bxd", "Blarm1959", "Lipfty", "Simulation-Results");
}
const outDir = arg("out", defaultOutDir());

if(!Number.isInteger(games) || games < 1) throw new Error("--games must be a positive integer.");
if(!Number.isInteger(seed)) throw new Error("--seed must be an integer.");
if(!Number.isInteger(maxActions) || maxActions < 1) throw new Error("--max-turns must be a positive integer.");
if(!Number.isInteger(traceSeeds) || traceSeeds < 0) throw new Error("--trace-seeds must be a non-negative integer.");
if(!Number.isInteger(recentWindow) || recentWindow < 4) throw new Error("--recent-window must be an integer of at least 4.");

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

const RULESETS = {
  A:S.normaliseRules({
    allowJump:true, allowMove:true, allowDiagonal:true,
    allowSquare:true, allowSpacedSquare:true,
    spacedSquareOnly:false, allowDiamond:false, allowSpacedDiamond:false
  }),
  B:S.normaliseRules({
    allowJump:true, allowMove:true, allowDiagonal:true,
    allowSquare:true, allowSpacedSquare:false,
    spacedSquareOnly:false, allowDiamond:false, allowSpacedDiamond:false
  }),
  C:S.normaliseRules({
    allowJump:true, allowMove:true, allowDiagonal:true,
    allowSquare:false, allowSpacedSquare:false,
    spacedSquareOnly:false, allowDiamond:false, allowSpacedDiamond:false
  })
};
const CORE_RULES = RULESETS.C;
const CONDITIONS = [
  {id:"A", label:"Standard", rules:RULESETS.A},
  {id:"B", label:"No Spaced Square", rules:RULESETS.B},
  {id:"C", label:"No Squares", rules:RULESETS.C}
];

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
function enumerateLocked(s,colour,lockedIds,rules) {
  return S.enumerateActions(s,colour,rules).filter(a=>!isLockedAction(s,a,lockedIds));
}
function actionWinsUnder(s,a,rules) { return !!S.fastCheckWin(S.boardAfter(s,a),rules,a.to); }

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
function progressRank(a) {
  if(a.type.includes("place")) return 0;
  if(a.type==="move") return 1;
  if(a.type==="jump") return 2;
  return 3;
}
function placementActions(s,colour,source="normal") {
  const type=source==="final"?"final-place":"place";
  return emptySquares(s).map(to=>({type,to,colour}));
}

function stateSignature(s) {
  const board=s.board.map(p=>p?`${p.colour[0]}${p.id}`:".").join("/");
  const queue=s.forcedQueue.map(q=>`${q.colour[0]}:${q.source}:${q.responseSlot??""}:${q.plannedTo??""}`).join("+");
  return [board,`P${s.currentPlayer+1}`,`N${s.normalRemaining.black}/${s.normalRemaining.white}`,`F${s.finalPieces.join("+")}`,`Q${queue}`,`M${s.awaitingMoveResponse?1:0}`,`J${s.awaitingJumpRedeploy?1:0}`,`S${s.sequentialSecondOwed?1:0}`,`BC${s.boundaryCornerOwed?1:0}`,`BS${s.boundarySelfCornerOwed?1:0}`,`X${s.protectedPieceId??""}`].join("|");
}

function newRecentTracker() {
  return {queue:[],counts:new Map(),allCounts:new Map(),repeatStreak:0,maxRepeatStreak:0,repeatedEncounters:0};
}
function noteState(tracker,sig) {
  const previous=tracker.counts.get(sig)||0;
  if(previous>0) {
    tracker.repeatedEncounters++;
    tracker.repeatStreak++;
    tracker.maxRepeatStreak=Math.max(tracker.maxRepeatStreak,tracker.repeatStreak);
  } else tracker.repeatStreak=0;
  tracker.queue.push(sig);
  tracker.counts.set(sig,previous+1);
  tracker.allCounts.set(sig,(tracker.allCounts.get(sig)||0)+1);
  while(tracker.queue.length>recentWindow) {
    const old=tracker.queue.shift(),n=tracker.counts.get(old)||0;
    if(n<=1) tracker.counts.delete(old); else tracker.counts.set(old,n-1);
  }
}
function recentHits(tracker,sig) { return sig ? (tracker.counts.get(sig)||0) : 0; }

let heartbeatLast=0;
let runStartedAt=0;
let heartbeatSeed="";
let heartbeatCondition="";
function heartbeat(stage,force=false) {
  const now=Date.now();
  if(!force && now-heartbeatLast<5000) return;
  heartbeatLast=now;
  const elapsed=runStartedAt?fmtDuration(now-runStartedAt):"0s";
  console.log(`  ${fmtClock(now)} | working seed ${heartbeatSeed} ${heartbeatCondition} | ${stage} | elapsed ${elapsed}`);
}

function colourImmediateInfo(s,colour,lockedIds,rules,{placementOnly=false,source="normal"}={}) {
  const actions=placementOnly?placementActions(s,colour,source):enumerateLocked(s,colour,lockedIds,rules);
  if(!actions.length) return {colour,wins:0,bestNeutral:-Infinity,actions:0};
  let wins=0,bestNeutral=-Infinity;
  for(let i=0;i<actions.length;i++) {
    const a=actions[i];
    if(actionWinsUnder(s,a,rules)) wins++;
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
function nextDecisionThreat(s,lockedIds,rules) {
  if(s.awaitingMoveResponse) {
    const infos=availableNormalColours(s).map(c=>colourImmediateInfo(s,c,lockedIds,rules,{placementOnly:true,source:"normal"}));
    return chooseInfoByControl(infos,"actor");
  }
  if(s.sequentialSecondOwed && !s.forcedQueue.length) {
    const infos=availableNormalColours(s).map(c=>colourImmediateInfo(s,c,lockedIds,rules,{placementOnly:true,source:"normal"}));
    return chooseInfoByControl(infos,"giver");
  }
  if(s.forcedQueue.length) {
    const q=s.forcedQueue[0],info=colourImmediateInfo(s,q.colour,lockedIds,rules);
    return {wins:info.wins,winningColours:info.wins>0?1:0,bestNeutral:info.bestNeutral,colour:q.colour};
  }
  const colours=S.availableColours(s),infos=colours.map(c=>colourImmediateInfo(s,c,lockedIds,rules));
  return chooseInfoByControl(infos,s.finalFour?"actor":"giver");
}

function predictedStateAfterAction(s,a,rules) {
  const t=cloneState(s),result=S.applyAction(t,a,rules);
  if(result.ended) return null;
  return stateSignature(t);
}
function jumpRedeployThreatAfter(s,a,rules) {
  const t=cloneState(s),result=S.applyAction(t,a,rules);
  if(result.ended) return {wins:0,winningColours:0,bestNeutral:-Infinity};
  const piece=t.board[a.over];
  if(!piece) return {wins:0,winningColours:0,bestNeutral:-Infinity};
  t.board[a.over]=null;
  let wins=0,bestNeutral=-Infinity;
  const empties=emptySquares(t);
  for(let i=0;i<empties.length;i++) {
    const to=empties[i],b=t.board.slice(); b[to]=piece;
    if(S.fastCheckWin(b,rules,to)) wins++;
    const n=staticCorePlacementScore(b,to); if(n>bestNeutral) bestNeutral=n;
    if((i&63)===0) heartbeat(`scan Jump redeploy ${i+1}/${empties.length}`);
  }
  return {wins,winningColours:wins>0?1:0,bestNeutral};
}

function profileAction(s,a,lockedIds,rules,tracker) {
  const actualWin=actionWinsUnder(s,a,rules);
  if(actualWin) return {action:a,actualWin:true,replyWins:0,replyWinningColours:0,repeatHits:0,progress:progressRank(a),neutral:staticCoreActionScore(s,a)};
  let threat;
  if(a.type==="jump" && s.jumpConsequence!=="current") threat=jumpRedeployThreatAfter(s,a,rules);
  else {
    const t=cloneState(s),result=S.applyAction(t,a,rules);
    threat=result.ended?{wins:0,winningColours:0,bestNeutral:-Infinity}:nextDecisionThreat(t,lockedIds,rules);
  }
  const predicted=predictedStateAfterAction(s,a,rules);
  return {
    action:a,actualWin:false,
    replyWins:threat.wins,
    replyWinningColours:threat.winningColours,
    repeatHits:recentHits(tracker,predicted),
    progress:progressRank(a),
    neutral:staticCoreActionScore(s,a)
  };
}
function compareSafetyOnly(a,b) {
  if(a.actualWin!==b.actualWin) return a.actualWin?-1:1;
  if(a.replyWins!==b.replyWins) return a.replyWins-b.replyWins;
  if(a.replyWinningColours!==b.replyWinningColours) return a.replyWinningColours-b.replyWinningColours;
  return 0;
}
function compareProgressAware(a,b) {
  const safe=compareSafetyOnly(a,b); if(safe) return safe;
  if(a.repeatHits!==b.repeatHits) return a.repeatHits-b.repeatHits;
  if(a.progress!==b.progress) return a.progress-b.progress;
  if(Math.abs(a.neutral-b.neutral)>1e-9) return b.neutral-a.neutral;
  return 0;
}
function chooseActionProgressAware(s,actions,lockedIds,rules,stats,tracker) {
  if(!actions.length) return {action:null,profile:null,mode:"none"};
  const planned=s.forcedQueue[0]?.plannedTo;
  const wins=actions.filter(a=>actionWinsUnder(s,a,rules));
  if(wins.length) {
    const action=wins[Math.floor(s.rng()*wins.length)];
    return {action,profile:profileAction(s,action,lockedIds,rules,tracker),mode:"actual-win"};
  }
  if(planned!==undefined) {
    const action=actions.find(a=>a.to===planned);
    if(action) return {action,profile:profileAction(s,action,lockedIds,rules,tracker),mode:"planned-progress"};
  }

  const profiles=[];
  for(let i=0;i<actions.length;i++) {
    profiles.push(profileAction(s,actions[i],lockedIds,rules,tracker));
    if((i&31)===0) heartbeat(`profile candidate actions ${i+1}/${actions.length}`);
  }
  profiles.sort(compareProgressAware);
  const best=profiles[0],tied=profiles.filter(x=>compareProgressAware(x,best)===0);
  const chosen=tied[Math.floor(s.rng()*tied.length)];
  stats.lookaheadActionDecisions++;

  const safetyBest=profiles.filter(x=>compareSafetyOnly(x,best)===0);
  const minRepeat=Math.min(...safetyBest.map(x=>x.repeatHits));
  if(safetyBest.some(x=>x.repeatHits>minRepeat) && chosen.repeatHits===minRepeat) stats.repeatedStateChoicesAvoided++;
  const repeatBest=safetyBest.filter(x=>x.repeatHits===minRepeat);
  const minProgress=Math.min(...repeatBest.map(x=>x.progress));
  if(repeatBest.some(x=>x.progress>minProgress) && chosen.progress===0 && minProgress===0) stats.progressPlacementsPreferred++;

  return {action:chosen.action,profile:chosen,mode:"progress-one-ply"};
}

function receiverDangerForColour(s,colour,lockedIds,rules) {
  const info=colourImmediateInfo(s,colour,lockedIds,rules);
  return {colour,immediateWins:info.wins,bestNeutral:info.bestNeutral,actions:info.actions};
}
function compareColourSafetyForGiver(a,b) {
  if(a.immediateWins!==b.immediateWins) return a.immediateWins-b.immediateWins;
  if(Math.abs(a.bestNeutral-b.bestNeutral)>1e-9) return a.bestNeutral-b.bestNeutral;
  return 0;
}
function chooseNormalHandoverColour(s,lockedIds,rules,stats) {
  const colours=S.availableColours(s);
  if(!colours.length) return {colour:null,mode:"none",details:""};
  if(colours.length===1) return {colour:colours[0],mode:"single",details:""};
  const dangers=colours.map(c=>receiverDangerForColour(s,c,lockedIds,rules));
  const sorted=[...dangers].sort(compareColourSafetyForGiver),best=sorted[0];
  const tied=sorted.filter(x=>compareColourSafetyForGiver(x,best)===0),chosen=tied[Math.floor(s.rng()*tied.length)];
  stats.handoverLookaheadDecisions++;
  if(dangers.some(x=>x.immediateWins>0)&&dangers.some(x=>x.immediateWins===0)) stats.avoidableImmediateHandoverThreats++;
  if(dangers.every(x=>x.immediateWins>0)) stats.unavoidableImmediateHandoverThreats++;
  return {colour:chosen.colour,mode:"handover-one-ply",details:dangers.map(x=>`${x.colour}:iw${x.immediateWins}/n${Number.isFinite(x.bestNeutral)?x.bestNeutral.toFixed(2):x.bestNeutral}`).join(";")};
}
function chooseFinalFourColour(s,lockedIds,rules) {
  const colours=S.availableColours(s);
  if(!colours.length) return {colour:null,mode:"none",details:""};
  if(colours.length===1) return {colour:colours[0],mode:"single-final",details:""};
  const options=colours.map(c=>receiverDangerForColour(s,c,lockedIds,rules));
  const maxWins=Math.max(...options.map(x=>x.immediateWins));
  let pool=options.filter(x=>x.immediateWins===maxWins);
  const maxNeutral=Math.max(...pool.map(x=>x.bestNeutral));
  pool=pool.filter(x=>Math.abs(x.bestNeutral-maxNeutral)<1e-9);
  const chosen=pool[Math.floor(s.rng()*pool.length)];
  return {colour:chosen.colour,mode:"final-one-ply",details:options.map(x=>`${x.colour}:iw${x.immediateWins}`).join(";")};
}
function chooseColourLookahead(s,lockedIds,rules,stats) {
  if(s.forcedQueue.length) return {colour:s.forcedQueue[0].colour,mode:"forced",details:""};
  if(s.finalFour) return chooseFinalFourColour(s,lockedIds,rules);
  return chooseNormalHandoverColour(s,lockedIds,rules,stats);
}

function chooseForcedSecondColour(s,lockedIds,rules) {
  const colours=availableNormalColours(s);
  if(!colours.length) throw new Error("Sequential second piece is owed but no normal reserve colour remains.");
  const options=colours.map(colour=>{
    const t=cloneState(s);
    t.sequentialSecondOwed=false; t.sequentialFirstColour=null;
    t.forcedQueue=[{colour,source:"normal",responseSlot:2}]; t.forcedPlacements=1;
    return receiverDangerForColour(t,colour,lockedIds,rules);
  });
  const sorted=[...options].sort(compareColourSafetyForGiver),best=sorted[0];
  const tied=sorted.filter(x=>compareColourSafetyForGiver(x,best)===0);
  return tied[Math.floor(s.rng()*tied.length)];
}
function commitSequentialSecondLookahead(s,lockedIds,rules,stats) {
  if(!s.sequentialSecondOwed || s.forcedQueue.length) return null;
  const first=s.sequentialFirstColour,chosen=chooseForcedSecondColour(s,lockedIds,rules);
  s.forcedQueue=[{colour:chosen.colour,source:"normal",responseSlot:2}];
  s.sequentialSecondOwed=false; s.sequentialFirstColour=null; s.forcedPlacements=1;
  stats.sequentialLookaheadChoices++;
  return {kind:"one-ply-second",keep:first,give:chosen.colour,immediateWins:chosen.immediateWins};
}

function commitMoveResponseLookahead(s,lockedIds,rules,stats) {
  if(!s.awaitingMoveResponse) throw new Error("No Move response is awaiting commitment.");
  const count=normalReserveCount(s);
  if(count<1) throw new Error("Move response requested with no normal reserve piece remaining.");
  if(count>=2 && s.responsePolicy==="sequential") {
    const candidates=[],empties=emptySquares(s);
    for(const colour of availableNormalColours(s)) {
      for(let i=0;i<empties.length;i++) {
        const to=empties[i],a={type:"place",to,colour},actualWin=actionWinsUnder(s,a,rules);
        const t=cloneState(s);
        t.awaitingMoveResponse=false;
        t.boundaryCornerOwed=false; t.boundarySelfCornerOwed=false;
        t.forcedQueue=[{colour,source:"normal",responseSlot:1,plannedTo:to}];
        t.sequentialSecondOwed=true; t.sequentialFirstColour=colour; t.forcedPlacements=2;
        const first=S.applyAction(t,a,rules);
        let secondThreat={wins:0,winningColours:0};
        if(!first.ended) { t.forcedQueue=[]; secondThreat=nextDecisionThreat(t,lockedIds,rules); }
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

  if(count===1) {
    const normalColour=COLOURS.find(c=>s.normalRemaining[c]>0);
    const normalWins=placementActions(s,normalColour,"normal").filter(a=>actionWinsUnder(s,a,rules));
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

function commitBoundarySelfCornerLookahead(s,lockedIds,rules,stats) {
  if(!s.boundarySelfCornerOwed || s.forcedQueue.length || !s.finalFour) return null;
  const candidates=[];
  for(const colour of [...new Set(s.finalPieces)]) for(const to of emptySquares(s)) {
    const a={type:"final-place",to,colour};
    candidates.push({colour,to,actualWin:actionWinsUnder(s,a,rules),neutral:staticCoreActionScore(s,a)});
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
function commitBoundaryCornerLookahead(s,lockedIds,rules,stats) {
  if(!s.boundaryCornerOwed || s.forcedQueue.length || !s.finalFour) return null;
  const options=[...new Set(s.finalPieces)].map(colour=>receiverDangerForColour(s,colour,lockedIds,rules));
  if(!options.length) return null;
  const sorted=[...options].sort(compareColourSafetyForGiver),best=sorted[0];
  const tied=sorted.filter(x=>compareColourSafetyForGiver(x,best)===0),chosen=tied[Math.floor(s.rng()*tied.length)];
  s.forcedQueue=[{colour:chosen.colour,source:"final",responseSlot:2}];
  s.boundaryCornerOwed=false; s.forcedPlacements=1;
  stats.boundaryLookaheadChoices++;
  return {colour:chosen.colour,kind:"boundary-give-one-ply"};
}

function redeployCandidateProfile(s,piece,to,lockedIds,rules,tracker) {
  const b=s.board.slice(); b[to]=piece;
  const actualWin=!!S.fastCheckWin(b,rules,to);
  if(actualWin) return {to,actualWin:true,nextWins:0,repeatHits:0,neutral:staticCorePlacementScore(b,to),stateKey:null};
  const t=cloneState(s),responder=s.currentPlayer;
  const first=S.applyRedeployPlacement(t,piece,to,rules);
  if(first.ended) return {to,actualWin:true,nextWins:0,repeatHits:0,neutral:staticCorePlacementScore(b,to),stateKey:null};
  t.forcedPlacements=0; t.forcedQueue=[];
  if(t.jumpConsequence==="redeploy-pass") t.currentPlayer=responder;
  const threat=nextDecisionThreat(t,lockedIds,rules),key=stateSignature(t);
  return {to,actualWin:false,nextWins:threat.wins,repeatHits:recentHits(tracker,key),neutral:staticCorePlacementScore(b,to),stateKey:key};
}
function resolveJumpRedeployLookahead(s,jumpAction,lockedIds,rules,stats,tracker) {
  if(!s.awaitingJumpRedeploy) throw new Error("No Jump redeploy response is awaiting resolution.");
  const piece=s.board[jumpAction.over]; if(!piece) throw new Error("Jumped piece missing when redeploy response begins.");
  s.board[jumpAction.over]=null;
  s.awaitingJumpRedeploy=false; s.awaitingMoveResponse=false;
  s.boundaryCornerOwed=false; s.boundarySelfCornerOwed=false; s.sequentialSecondOwed=false; s.sequentialFirstColour=null;
  const responder=s.currentPlayer,empties=emptySquares(s),candidates=[];
  for(let i=0;i<empties.length;i++) {
    candidates.push(redeployCandidateProfile(s,piece,empties[i],lockedIds,rules,tracker));
    if((i&31)===0) heartbeat(`redeploy candidates ${i+1}/${empties.length}`);
  }
  const winning=candidates.filter(x=>x.actualWin);
  let pool=winning.length?winning:candidates;
  if(!winning.length) {
    const minNext=Math.min(...pool.map(x=>x.nextWins)); pool=pool.filter(x=>x.nextWins===minNext);
    const minRepeat=Math.min(...pool.map(x=>x.repeatHits));
    if(pool.some(x=>x.repeatHits>minRepeat)) stats.redeployRepeatedStateChoicesAvoided++;
    pool=pool.filter(x=>x.repeatHits===minRepeat);
  }
  const maxNeutral=Math.max(...pool.map(x=>x.neutral)); pool=pool.filter(x=>Math.abs(x.neutral-maxNeutral)<1e-9);
  const plan=pool[Math.floor(s.rng()*pool.length)];
  if(winning.length) stats.redeployActualWinChoices++; else stats.redeployLookaheadChoices++;
  const first=S.applyRedeployPlacement(s,piece,plan.to,rules);
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
  if(RULESETS.A.allowSpacedSquare!==true || RULESETS.B.allowSpacedSquare!==false || RULESETS.B.allowSquare!==true || RULESETS.C.allowSquare!==false) throw new Error("Self-test failed: A/B/C rules are wrong.");
  if(Object.values(RULESETS).some(r=>r.allowDiamond||r.allowSpacedDiamond)) throw new Error("Self-test failed: Diamond rules must remain disabled.");
  if(CORE_RULES.allowSquare || CORE_RULES.allowSpacedSquare || !CORE_RULES.allowDiagonal) throw new Error("Self-test failed: common positional tie-breaker must be H/V/D only.");
  const s=L8.prepareState(1,fixed.jumpPolicy,fixed.responsePolicy,fixed.boundaryPolicy,fixed.jumpConsequence,fixed.oneColourPolicy,fixed.openingPolicy);
  const expected=["black","white","white","black"],actual=ANCHOR_SQUARES.map(i=>s.board[i]?.colour);
  if(actual.some((c,i)=>c!==expected[i])) throw new Error(`Self-test failed: opening anchors are ${actual.join(",")}.`);
  checkAnchors(s,anchorIdsFromState(s));
  if(lockedIdsFromState(s).size!==4) throw new Error("Self-test failed: four anchors were not locked.");
  const tight=Array(36).fill(null); [0,1,6,7].forEach(i=>tight[i]={id:i+1,colour:"black"});
  if(!S.fastCheckWin(tight,RULESETS.A,7) || !S.fastCheckWin(tight,RULESETS.B,7) || S.fastCheckWin(tight,RULESETS.C,7)) throw new Error("Self-test failed: tight-square actual-rule split is wrong.");
  const spaced=Array(36).fill(null); [0,2,12,14].forEach(i=>spaced[i]={id:i+1,colour:"white"});
  if(!S.fastCheckWin(spaced,RULESETS.A,14) || S.fastCheckWin(spaced,RULESETS.B,14)) throw new Error("Self-test failed: Spaced Square actual-rule split is wrong.");
  const rect=Array(36).fill(null); [0,2,18,20].forEach(i=>rect[i]={id:i+1,colour:"white"});
  if(S.fastCheckWin(rect,RULESETS.A,20)) throw new Error("Self-test failed: rectangle incorrectly treated as a Spaced Square.");
  const p0={actualWin:false,replyWins:0,replyWinningColours:0,repeatHits:0,progress:0,neutral:1};
  const p1={...p0,repeatHits:1};
  const p2={...p0,progress:2};
  if(compareProgressAware(p0,p1)>=0) throw new Error("Self-test failed: non-repeating profile was not preferred.");
  if(compareProgressAware(p0,p2)>=0) throw new Error("Self-test failed: placement progress was not preferred.");
}

function emptyStats() {
  return {
    placements:0,moves:0,jumps:0,redeployments:0,
    lookaheadActionDecisions:0,handoverLookaheadDecisions:0,avoidableImmediateHandoverThreats:0,unavoidableImmediateHandoverThreats:0,
    moveResponseLookaheadChoices:0,sequentialLookaheadChoices:0,boundaryLookaheadChoices:0,boundaryCoreFallbacks:0,boundaryActualWinOverrides:0,
    redeployLookaheadChoices:0,redeployActualWinChoices:0,
    repeatedStateChoicesAvoided:0,redeployRepeatedStateChoicesAvoided:0,progressPlacementsPreferred:0,
    repeatedStateEncounters:0,maxRepeatStreak:0,jumpSequences:0,maxConsecutiveJumps:0,currentConsecutiveJumps:0,
    reachedOneColour:false
  };
}

function playGame(gameSeed,condition,keepTrace) {
  const rules=condition.rules;
  const s=L8.prepareState(gameSeed,fixed.jumpPolicy,fixed.responsePolicy,fixed.boundaryPolicy,fixed.jumpConsequence,fixed.oneColourPolicy,fixed.openingPolicy);
  const lockedIds=lockedIdsFromState(s),anchorIds=anchorIdsFromState(s); checkAnchors(s,anchorIds);
  const stats=emptyStats(),trace=[],tracker=newRecentTracker();
  let winType="",winningAction="";

  while(s.winner===null && s.turns<maxActions) {
    const seq=commitSequentialSecondLookahead(s,lockedIds,rules,stats);
    const bself=commitBoundarySelfCornerLookahead(s,lockedIds,rules,stats);
    const bcorner=commitBoundaryCornerLookahead(s,lockedIds,rules,stats);
    checkAnchors(s,anchorIds);

    const currentSig=stateSignature(s),alreadyRecent=recentHits(tracker,currentSig)>0;
    noteState(tracker,currentSig);
    stats.repeatedStateEncounters=tracker.repeatedEncounters;
    stats.maxRepeatStreak=tracker.maxRepeatStreak;

    const forcedInfo=S.normalForcedColourInfo(s);
    if(forcedInfo) stats.reachedOneColour=true;
    const category=s.finalFour?"final-four":forcedInfo?"normal-one-colour":"normal-both-colours";
    const actor=s.currentPlayer,preState=keepTrace?currentSig:"";
    const colourChoice=chooseColourLookahead(s,lockedIds,rules,stats),colour=colourChoice.colour;
    if(!colour) { s.winner="draw"; break; }
    const actions=enumerateLocked(s,colour,lockedIds,rules);
    if(!actions.length) { s.winner="draw"; break; }
    const choice=chooseActionProgressAware(s,actions,lockedIds,rules,stats,tracker),action=choice.action;
    if(!action) { s.winner="draw"; break; }

    if(keepTrace) trace.push({
      index:trace.length+1,turn:s.turns+1,actor:actorName(actor),category,state:preState,current_state_repeated:alreadyRecent?"yes":"no",
      plan_seq:seq?JSON.stringify(seq):"",plan_boundary_self:bself?JSON.stringify(bself):"",plan_boundary_corner:bcorner?JSON.stringify(bcorner):"",
      colour,colour_mode:colourChoice.mode,colour_details:colourChoice.details,
      action:actionSignature(action),action_mode:choice.mode,
      reply_immediate_wins:choice.profile?.replyWins??"",reply_winning_colours:choice.profile?.replyWinningColours??"",
      repeat_hits:choice.profile?.repeatHits??"",progress_rank:choice.profile?.progress??"",neutral_tiebreak:choice.profile?.neutral??""
    });

    if(action.type.includes("place")) {
      stats.placements++;
      stats.currentConsecutiveJumps=0;
    } else if(action.type==="move") {
      stats.moves++;
      stats.currentConsecutiveJumps=0;
    } else if(action.type==="jump") {
      stats.jumps++;
      if(stats.currentConsecutiveJumps===0) stats.jumpSequences++;
      stats.currentConsecutiveJumps++;
      stats.maxConsecutiveJumps=Math.max(stats.maxConsecutiveJumps,stats.currentConsecutiveJumps);
    }

    const result=S.applyAction(s,action,rules); checkAnchors(s,anchorIds);
    if(result.ended) {
      winType=result.winType||"";
      winningAction=s.winner==="draw"?"":(action.type.includes("place")?"placement":action.type);
      break;
    }

    if(action.type==="jump" && s.jumpConsequence!=="current") {
      const response=resolveJumpRedeployLookahead(s,action,lockedIds,rules,stats,tracker); stats.redeployments++; checkAnchors(s,anchorIds);
      if(keepTrace && trace.length) trace[trace.length-1].redeploy_plan=JSON.stringify(response.plan||{});
      if(response.stage==="redeploy") { winType=response.firstResult.winType||""; winningAction="redeploy"; break; }
    } else if(action.type==="move" || action.type==="jump") {
      const plan=commitMoveResponseLookahead(s,lockedIds,rules,stats);
      if(keepTrace && trace.length) trace[trace.length-1].move_response_plan=JSON.stringify(plan||{});
    }
    checkAnchors(s,anchorIds);
  }

  if(s.winner===null) s.winner="draw";
  return {
    seed:gameSeed,condition:condition.id,label:condition.label,winner:s.winner,winner_name:actorName(s.winner),p1_score:scoreForWinner(s.winner),actions:s.turns,
    placements:stats.placements,moves:stats.moves,jumps:stats.jumps,redeployments:stats.redeployments,reached_one_colour:stats.reachedOneColour?"yes":"no",reached_final_four:s.reachedFinalFour?"yes":"no",
    recorded_win_type:winType,winning_action:winningAction,max_action_draw:s.winner==="draw"&&s.turns>=maxActions?"yes":"no",
    lookahead_action_decisions:stats.lookaheadActionDecisions,handover_lookahead_decisions:stats.handoverLookaheadDecisions,
    avoidable_immediate_handover_threats:stats.avoidableImmediateHandoverThreats,unavoidable_immediate_handover_threats:stats.unavoidableImmediateHandoverThreats,
    move_response_lookahead_choices:stats.moveResponseLookaheadChoices,sequential_lookahead_choices:stats.sequentialLookaheadChoices,boundary_lookahead_choices:stats.boundaryLookaheadChoices,boundary_core_fallbacks:stats.boundaryCoreFallbacks,boundary_actual_win_overrides:stats.boundaryActualWinOverrides,
    redeploy_lookahead_choices:stats.redeployLookaheadChoices,redeploy_actual_win_choices:stats.redeployActualWinChoices,
    repeated_state_choices_avoided:stats.repeatedStateChoicesAvoided,redeploy_repeated_state_choices_avoided:stats.redeployRepeatedStateChoicesAvoided,progress_placements_preferred:stats.progressPlacementsPreferred,
    repeated_state_encounters:stats.repeatedStateEncounters,max_repeat_streak:stats.maxRepeatStreak,jump_sequences:stats.jumpSequences,max_consecutive_jumps:stats.maxConsecutiveJumps,
    trace
  };
}

function firstDivergence(left,right) {
  const lt=left.trace,rt=right.trace,n=Math.max(lt.length,rt.length);
  for(let i=0;i<n;i++) {
    const l=lt[i],r=rt[i];
    if(!l||!r) return {index:i+1,type:"trace-length",left:l||null,right:r||null};
    if(l.state!==r.state) return {index:i+1,type:"state",left:l,right:r};
    if(l.colour!==r.colour) return {index:i+1,type:"handed-colour",left:l,right:r};
    if(l.action!==r.action) return {index:i+1,type:"action",left:l,right:r};
    if((l.move_response_plan||"")!==(r.move_response_plan||"") || (l.redeploy_plan||"")!==(r.redeploy_plan||"")) return {index:i+1,type:"response-plan",left:l,right:r};
  }
  return {index:0,type:"none",left:null,right:null};
}

function newAggregate(c) {
  return {condition:c,n:0,wins:[0,0],draws:0,score:0,actions:0,moves:0,jumps:0,redeployments:0,oneColour:0,finalFour:0,maxDraws:0,formations:{},
    repeatedStateChoicesAvoided:0,redeployRepeatedStateChoicesAvoided:0,progressPlacementsPreferred:0,repeatedStateEncounters:0,maxRepeatStreak:0,jumpSequences:0,maxConsecutiveJumps:0};
}
function addAggregate(a,g) {
  a.n++; if(g.winner_name==="draw") a.draws++; else if(g.winner_name==="P1") a.wins[0]++; else a.wins[1]++;
  a.score+=g.p1_score; a.actions+=g.actions; a.moves+=g.moves; a.jumps+=g.jumps; a.redeployments+=g.redeployments;
  if(g.reached_one_colour==="yes") a.oneColour++;
  if(g.reached_final_four==="yes") a.finalFour++;
  if(g.max_action_draw==="yes") a.maxDraws++;
  if(g.recorded_win_type) a.formations[g.recorded_win_type]=(a.formations[g.recorded_win_type]||0)+1;
  a.repeatedStateChoicesAvoided+=g.repeated_state_choices_avoided;
  a.redeployRepeatedStateChoicesAvoided+=g.redeploy_repeated_state_choices_avoided;
  a.progressPlacementsPreferred+=g.progress_placements_preferred;
  a.repeatedStateEncounters+=g.repeated_state_encounters;
  a.maxRepeatStreak=Math.max(a.maxRepeatStreak,g.max_repeat_streak);
  a.jumpSequences+=g.jump_sequences;
  a.maxConsecutiveJumps=Math.max(a.maxConsecutiveJumps,g.max_consecutive_jumps);
}
function aggregateRow(a) {
  const n=a.n||1;
  return {
    condition:a.condition.id,label:a.condition.label,games:a.n,p1_wins:a.wins[0],p2_wins:a.wins[1],draws:a.draws,p1_score_pct:round4(100*a.score/n),average_actions:round4(a.actions/n),moves:a.moves,jumps:a.jumps,redeployments:a.redeployments,
    one_colour_games:a.oneColour,final_four_games:a.finalFour,max_action_draws:a.maxDraws,
    horizontal_wins:a.formations.horizontal||0,vertical_wins:a.formations.vertical||0,diagonal_wins:a.formations.diagonal||0,tight_square_wins:a.formations.square||0,spaced_square_wins:a.formations["spaced-square"]||0,
    repeated_state_choices_avoided:a.repeatedStateChoicesAvoided,redeploy_repeated_state_choices_avoided:a.redeployRepeatedStateChoicesAvoided,progress_placements_preferred:a.progressPlacementsPreferred,
    repeated_state_encounters:a.repeatedStateEncounters,max_repeat_streak:a.maxRepeatStreak,jump_sequences:a.jumpSequences,max_consecutive_jumps:a.maxConsecutiveJumps
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
if(hasArg("self-test")) { console.log("Lipfty 9 progress-aware tactical comparison self-test passed."); process.exit(0); }

const started=Date.now(); runStartedAt=started; heartbeatLast=started; archivePreviousResults();
console.log("");
console.log("Lipfty 9 — progress-aware one-ply tactical comparison");
console.log(`Run started: ${fmtDateTime(started)}`);
console.log(`Results: ${outDir}`);
console.log(`Matched seeds: ${seed}-${seed+games-1} (${games})`);
console.log(`Recent-state window: ${recentWindow} decision states`);
console.log("A/B/C use real winning rules for immediate wins and one-ply threat avoidance.");
console.log("Among equally safe actions: avoid recent repetition, prefer placement over Move over Jump, then use common static H/V/D tie-break.\n");

const aggregates=new Map(CONDITIONS.map(c=>[c.id,newAggregate(c)]));
const allGames=[],traceRows=[],divergenceRows=[];
const pairDefs=[["A","B"],["B","C"],["A","C"]];
const pairStats=new Map(pairDefs.map(([l,r])=>[`${l}|${r}`,{n:0,changedWinner:0,sameWinner:0,divTypes:{},divTotal:0,divN:0}]));

for(let i=0;i<games;i++) {
  const gameSeed=seed+i,byId={};
  for(const c of CONDITIONS) {
    heartbeatSeed=gameSeed; heartbeatCondition=c.id; heartbeat("start condition",true);
    const g=playGame(gameSeed,c,true); byId[c.id]=g; allGames.push(gameRow(g)); addAggregate(aggregates.get(c.id),g);
    if(i<traceSeeds) for(const t of g.trace) traceRows.push({seed:gameSeed,condition:c.id,...t});
  }
  for(const [l,r] of pairDefs) {
    const left=byId[l],right=byId[r],d=firstDivergence(left,right),p=pairStats.get(`${l}|${r}`); p.n++;
    if(left.winner_name===right.winner_name) p.sameWinner++; else p.changedWinner++;
    p.divTypes[d.type]=(p.divTypes[d.type]||0)+1; if(d.index) { p.divTotal+=d.index; p.divN++; }
    divergenceRows.push({seed:gameSeed,comparison:`${l}->${r}`,left_winner:left.winner_name,right_winner:right.winner_name,left_actions:left.actions,right_actions:right.actions,first_divergence_action:d.index,divergence_type:d.type,actor:d.left?.actor||d.right?.actor||"",category:d.left?.category||d.right?.category||"",left_colour:d.left?.colour||"",right_colour:d.right?.colour||"",left_action:d.left?.action||"",right_action:d.right?.action||"",left_reply_wins:d.left?.reply_immediate_wins??"",right_reply_wins:d.right?.reply_immediate_wins??""});
  }
  if(i===0 || i+1===games || (i+1)%Math.max(1,Math.ceil(games/10))===0) {
    const elapsed=Date.now()-started,eta=elapsed/(i+1)*(games-i-1);
    const status=CONDITIONS.map(c=>`${c.id} ${round4(100*aggregates.get(c.id).score/aggregates.get(c.id).n)}%`).join(" | ");
    console.log(`  ${fmtClock()} | seeds ${i+1}/${games} | ${status} | elapsed ${fmtDuration(elapsed)} | ETA ${fmtDuration(eta)}`);
  }
}

const summaryRows=CONDITIONS.map(c=>aggregateRow(aggregates.get(c.id)));
const pairRows=pairDefs.map(([l,r])=>{
  const p=pairStats.get(`${l}|${r}`),L=summaryRows.find(x=>x.condition===l),R=summaryRows.find(x=>x.condition===r);
  return {comparison:`${l}->${r}`,seeds:p.n,left_p1_score_pct:L.p1_score_pct,right_p1_score_pct:R.p1_score_pct,p1_score_delta_pp:round4(Number(R.p1_score_pct)-Number(L.p1_score_pct)),same_winner:p.sameWinner,changed_winner:p.changedWinner,average_first_divergence_action:p.divN?round4(p.divTotal/p.divN):"0.0000",divergence_types:Object.entries(p.divTypes).sort((a,b)=>b[1]-a[1]).map(([k,n])=>`${k}:${n}`).join(";")};
});

const tag=`seed${seed}-games${games}`;
const summaryPath=path.join(outDir,`lipfty9-progress-tactical-summary-${tag}.csv`);
const pairsPath=path.join(outDir,`lipfty9-progress-tactical-pairs-${tag}.csv`);
const gamesPath=path.join(outDir,`lipfty9-progress-tactical-games-${tag}.csv`);
const divergencePath=path.join(outDir,`lipfty9-progress-tactical-divergences-${tag}.csv`);
const tracePath=path.join(outDir,`lipfty9-progress-tactical-trace-${tag}.csv`);
const reportPath=path.join(outDir,`lipfty9-progress-tactical-report-${tag}.txt`);
writeCsv(summaryPath,summaryRows); writeCsv(pairsPath,pairRows); writeCsv(gamesPath,allGames); writeCsv(divergencePath,divergenceRows); writeCsv(tracePath,traceRows);

const report=[
  "Lipfty 9 — Progress-aware one-ply tactical comparison",
  `Started: ${fmtDateTime(started)}`,
  `Finished: ${fmtDateTime()}`,
  `Seeds: ${seed}-${seed+games-1} (${games} matched seeds)`,
  `Recent-state window: ${recentWindow}`,
  "",
  "METHOD",
  "A/B/C enforce their own real winning rules.",
  "Immediate actual-rule wins are always taken.",
  "Candidate actions minimise immediate actual-rule winning replies.",
  "Only among equally safe choices, recent repeated states are avoided.",
  "Only among equally safe non-repeating choices, progress is preferred: placement, then Move, then Jump.",
  "The same cheap static H/V/D common-core score is the final tie-breaker in all conditions.",
  "Repetition/progress are AI policy only; they are not Lipfty game rules.",
  "Pinned opening anchors and all other Lipfty 8 Standard mechanics remain unchanged.",
  "",
  "BALANCE",
  ...summaryRows.map(x=>`${x.condition} (${x.label}): P1 ${x.p1_wins}, P2 ${x.p2_wins}, draws ${x.draws}; P1 score ${x.p1_score_pct}%; avg actions ${x.average_actions}; one-colour ${x.one_colour_games}; Final Four ${x.final_four_games}; max-action draws ${x.max_action_draws}; H/V/D/Sq/SS ${x.horizontal_wins}/${x.vertical_wins}/${x.diagonal_wins}/${x.tight_square_wins}/${x.spaced_square_wins}.`),
  "",
  "MATCHED-SEED EFFECTS",
  ...pairRows.map(x=>`${x.comparison}: P1 score ${x.left_p1_score_pct}% -> ${x.right_p1_score_pct}% (${Number(x.p1_score_delta_pp)>=0?"+":""}${x.p1_score_delta_pp} pp); changed winner ${x.changed_winner}/${x.seeds}; avg first divergence action ${x.average_first_divergence_action}; ${x.divergence_types}.`),
  "",
  "PROGRESS / CYCLE DIAGNOSTICS",
  ...summaryRows.map(x=>`${x.condition}: repeated-state choices avoided ${x.repeated_state_choices_avoided}; redeploy repeats avoided ${x.redeploy_repeated_state_choices_avoided}; progress placements preferred ${x.progress_placements_preferred}; repeated states encountered ${x.repeated_state_encounters}; max repeat streak ${x.max_repeat_streak}; Jump sequences ${x.jump_sequences}; max consecutive Jumps ${x.max_consecutive_jumps}.`),
  "",
  "INTERPRETATION",
  "This tester keeps actual-rule tactical safety primary but prevents equally safe Move/Jump cycles from dominating the simulation.",
  "A useful result should return Standard A to ordinary game lengths with genuine wins instead of max-action draw loops.",
  "",
  `Total runtime: ${fmtDuration(Date.now()-started)}`,
  ""
].join("\r\n");
fs.writeFileSync(reportPath,report,"utf8");

console.log("\nSUMMARY");
for(const x of summaryRows) console.log(`  ${x.condition}: P1 score ${x.p1_score_pct}% | P1/P2/draw ${x.p1_wins}/${x.p2_wins}/${x.draws} | avg actions ${x.average_actions} | Final Four ${x.final_four_games} | max draws ${x.max_action_draws}`);
console.log("\nPROGRESS / CYCLES");
for(const x of summaryRows) console.log(`  ${x.condition}: repeat avoided ${x.repeated_state_choices_avoided}+${x.redeploy_repeated_state_choices_avoided} | placement-progress ${x.progress_placements_preferred} | repeats seen ${x.repeated_state_encounters} | max Jump run ${x.max_consecutive_jumps}`);
console.log("\nMATCHED-SEED");
for(const x of pairRows) console.log(`  ${x.comparison}: ${x.left_p1_score_pct}% -> ${x.right_p1_score_pct}% | delta ${x.p1_score_delta_pp} pp | changed winner ${x.changed_winner}/${x.seeds} | first divergence ${x.average_first_divergence_action}`);
console.log(`\nReport: ${reportPath}`);
console.log(`Summary CSV: ${summaryPath}`);
console.log(`Pair CSV: ${pairsPath}`);
console.log(`Divergence CSV: ${divergencePath}`);
console.log(`Per-game CSV: ${gamesPath}`);
console.log(`Trace CSV (first ${Math.min(traceSeeds,games)} seeds): ${tracePath}`);
console.log(`Total time: ${fmtDuration(Date.now()-started)} | finished ${fmtDateTime()}`);
