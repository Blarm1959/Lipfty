"use strict";

// Lipfty 9 analysis-only actual-rule lookahead tactical comparison.
//
// A = Lipfty 8 Standard (H/V/D + tight square + Spaced Square)
// B = no Spaced Square (H/V/D + tight square)
// C = no squares (H/V/D only)
//
// Tactical order is deliberately rule-aware but pattern-neutral:
//   1. Take an immediate win under the ACTUAL A/B/C rules.
//   2. Avoid giving the next player an immediate actual-rule win.
//   3. Use one-ply actual-rule lookahead to minimise the next player's
//      immediate winning replies.
//   4. Use one fixed H/V/D positional score only as the final tie-breaker.
//
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

const games = Number(arg("games", "100"));
const seed = Number(arg("seed", "1"));
const maxActions = Number(arg("max-turns", "500"));
const traceSeeds = Number(arg("trace-seeds", "10"));

function defaultOutDir() {
  const drive = fs.existsSync("D:\\") ? "D:" : "C:";
  return path.win32.join(`${drive}\\`, "bxd", "Blarm1959", "Lipfty", "Simulation-Results");
}
const outDir = arg("out", defaultOutDir());

if(!Number.isInteger(games) || games < 1) throw new Error("--games must be a positive integer.");
if(!Number.isInteger(seed)) throw new Error("--seed must be an integer.");
if(!Number.isInteger(maxActions) || maxActions < 1) throw new Error("--max-turns must be a positive integer.");
if(!Number.isInteger(traceSeeds) || traceSeeds < 0) throw new Error("--trace-seeds must be a non-negative integer.");

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

// Common tie-breaker only. It never decides what is actually a win.
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
    const p=s.board[sq]; if(!p) throw new Error(`Pinned corner square ${sq} is unexpectedly empty.`); ids.add(p.id);
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
function neutralActionScore(s,a) { return S.baseActionPositionalScore(s,a,CORE_RULES); }

function placementActions(s,colour,source="normal") {
  const type=source==="final"?"final-place":"place";
  return emptySquares(s).map(to=>({type,to,colour}));
}
function staticCorePlacementScore(board,colour,to) {
  if(S.fastCheckWin(board,CORE_RULES,to)) return 1e9;
  const rr=Math.floor(to/6),cc=to%6;
  return (2.5-Math.abs(rr-2.5))+(2.5-Math.abs(cc-2.5))+S.neutralPatternPotential(board,CORE_RULES);
}

// Immediate next-decision threat only: no recursive search. This is the
// one-ply actual-rule information used before the common positional tie-break.
function colourImmediateInfo(s,colour,lockedIds,rules,{placementOnly=false,source="normal"}={}) {
  const actions=placementOnly?placementActions(s,colour,source):enumerateLocked(s,colour,lockedIds,rules);
  if(!actions.length) return {colour,wins:0,bestNeutral:-Infinity,actions:0};
  let wins=0,bestNeutral=-Infinity;
  for(const a of actions) {
    if(actionWinsUnder(s,a,rules)) wins++;
    const n=neutralActionScore(s,a); if(n>bestNeutral) bestNeutral=n;
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
  // Responder controls their first compulsory placement after a Move.
  if(s.awaitingMoveResponse) {
    const infos=availableNormalColours(s).map(c=>colourImmediateInfo(s,c,lockedIds,rules,{placementOnly:true,source:"normal"}));
    return chooseInfoByControl(infos,"actor");
  }

  // The responder chooses the second colour handed to the original mover.
  if(s.sequentialSecondOwed && !s.forcedQueue.length) {
    const infos=availableNormalColours(s).map(c=>colourImmediateInfo(s,c,lockedIds,rules,{placementOnly:true,source:"normal"}));
    return chooseInfoByControl(infos,"giver");
  }

  // Forced colour: no colour choice remains.
  if(s.forcedQueue.length) {
    const q=s.forcedQueue[0];
    const info=colourImmediateInfo(s,q.colour,lockedIds,rules);
    return {wins:info.wins,winningColours:info.wins>0?1:0,bestNeutral:info.bestNeutral,colour:q.colour};
  }

  // In Final Four the player chooses their own colour; during normal play the
  // previous player chooses which colour is handed to the receiver.
  const colours=S.availableColours(s);
  const infos=colours.map(c=>colourImmediateInfo(s,c,lockedIds,rules));
  return chooseInfoByControl(infos,s.finalFour?"actor":"giver");
}

function jumpRedeployThreatAfter(s,a,rules) {
  const t=cloneState(s),result=S.applyAction(t,a,rules);
  if(result.ended) return {wins:0,winningColours:0,bestNeutral:-Infinity,colour:null};
  const piece=t.board[a.over];
  if(!piece) return {wins:0,winningColours:0,bestNeutral:-Infinity,colour:null};
  t.board[a.over]=null;
  let wins=0,bestNeutral=-Infinity;
  for(const to of emptySquares(t)) {
    const b=t.board.slice(); b[to]=piece;
    if(S.fastCheckWin(b,rules,to)) wins++;
    const n=staticCorePlacementScore(b,piece.colour,to); if(n>bestNeutral) bestNeutral=n;
  }
  return {wins,winningColours:wins>0?1:0,bestNeutral,colour:piece.colour};
}

function profileAction(s,a,lockedIds,rules) {
  const actualWin=actionWinsUnder(s,a,rules);
  if(actualWin) return {action:a,actualWin:true,replyWins:0,replyWinningColours:0,replyPotential:-Infinity,neutral:neutralActionScore(s,a)};

  let threat;
  if(a.type==="jump" && s.jumpConsequence!=="current") {
    threat=jumpRedeployThreatAfter(s,a,rules);
  } else {
    const t=cloneState(s),result=S.applyAction(t,a,rules);
    threat=result.ended?{wins:0,winningColours:0,bestNeutral:-Infinity}:nextDecisionThreat(t,lockedIds,rules);
  }
  return {
    action:a,actualWin:false,
    replyWins:threat.wins,
    replyWinningColours:threat.winningColours,
    replyPotential:threat.bestNeutral,
    neutral:neutralActionScore(s,a)
  };
}

function compareForActor(a,b) {
  if(a.actualWin!==b.actualWin) return a.actualWin?-1:1;
  if(a.replyWins!==b.replyWins) return a.replyWins-b.replyWins;
  if(a.replyWinningColours!==b.replyWinningColours) return a.replyWinningColours-b.replyWinningColours;
  if(Math.abs(a.replyPotential-b.replyPotential)>1e-9) return a.replyPotential-b.replyPotential;
  if(Math.abs(a.neutral-b.neutral)>1e-9) return b.neutral-a.neutral;
  return 0;
}
function bestProfilesForActor(profiles) {
  if(!profiles.length) return [];
  const sorted=[...profiles].sort(compareForActor);
  const best=sorted[0];
  return sorted.filter(x=>compareForActor(x,best)===0);
}
function chooseActionLookahead(s,actions,lockedIds,rules,stats) {
  if(!actions.length) return {action:null,profile:null,mode:"none"};
  const planned=s.forcedQueue[0]?.plannedTo;
  const wins=actions.filter(a=>actionWinsUnder(s,a,rules));
  if(wins.length) {
    const action=wins[Math.floor(s.rng()*wins.length)];
    return {action,profile:profileAction(s,action,lockedIds,rules),mode:"actual-win"};
  }
  if(planned!==undefined) {
    const action=actions.find(a=>a.to===planned);
    if(action) return {action,profile:profileAction(s,action,lockedIds,rules),mode:"planned-lookahead"};
  }
  const profiles=actions.map(a=>profileAction(s,a,lockedIds,rules));
  const best=bestProfilesForActor(profiles);
  const chosen=best[Math.floor(s.rng()*best.length)];
  stats.lookaheadActionDecisions++;

  // Diagnostic: did actual-rule lookahead alter the pure common-core choice?
  let maxNeutral=Math.max(...profiles.map(x=>x.neutral));
  const neutralBest=profiles.filter(x=>Math.abs(x.neutral-maxNeutral)<1e-9);
  if(!neutralBest.some(x=>x.action.type===chosen.action.type&&x.action.to===chosen.action.to&&x.action.from===chosen.action.from)) stats.lookaheadChangedNeutralChoice++;
  return {action:chosen.action,profile:chosen,mode:"lookahead"};
}

function receiverDangerForColour(s,colour,lockedIds,rules,stats) {
  const actions=enumerateLocked(s,colour,lockedIds,rules);
  if(!actions.length) return {colour,immediateWins:0,best:null};
  const immediateWins=actions.filter(a=>actionWinsUnder(s,a,rules)).length;
  const profiles=actions.map(a=>profileAction(s,a,lockedIds,rules));
  const best=bestProfilesForActor(profiles)[0];
  return {colour,immediateWins,best};
}

function compareColourSafetyForGiver(a,b) {
  if(a.immediateWins!==b.immediateWins) return a.immediateWins-b.immediateWins;
  const ap=a.best,bp=b.best;
  if(!ap||!bp) return ap?1:bp?-1:0;
  // Receiver prefers fewer winning replies for the giver, so the giver prefers more.
  if(ap.replyWins!==bp.replyWins) return bp.replyWins-ap.replyWins;
  if(ap.replyWinningColours!==bp.replyWinningColours) return bp.replyWinningColours-ap.replyWinningColours;
  if(Math.abs(ap.replyPotential-bp.replyPotential)>1e-9) return bp.replyPotential-ap.replyPotential;
  if(Math.abs(ap.neutral-bp.neutral)>1e-9) return ap.neutral-bp.neutral;
  return 0;
}

function chooseNormalHandoverColour(s,lockedIds,rules,stats) {
  const colours=S.availableColours(s);
  if(!colours.length) return {colour:null,mode:"none",details:""};
  if(colours.length===1) return {colour:colours[0],mode:"single",details:""};
  const dangers=colours.map(c=>receiverDangerForColour(s,c,lockedIds,rules,stats));
  const sorted=[...dangers].sort(compareColourSafetyForGiver),best=sorted[0];
  const tied=sorted.filter(x=>compareColourSafetyForGiver(x,best)===0);
  const chosen=tied[Math.floor(s.rng()*tied.length)];
  stats.handoverLookaheadDecisions++;
  if(dangers.some(x=>x.immediateWins>0) && dangers.some(x=>x.immediateWins===0)) stats.avoidableImmediateHandoverThreats++;
  if(dangers.every(x=>x.immediateWins>0)) stats.unavoidableImmediateHandoverThreats++;
  return {
    colour:chosen.colour,mode:"handover-lookahead",
    details:dangers.map(x=>`${x.colour}:iw${x.immediateWins}/rw${x.best?.replyWins??0}/rp${Number.isFinite(x.best?.replyPotential)?Number(x.best.replyPotential).toFixed(2):String(x.best?.replyPotential)}`).join(";")
  };
}

function chooseFinalFourColour(s,lockedIds,rules,stats) {
  const colours=S.availableColours(s);
  if(!colours.length) return {colour:null,mode:"none",details:""};
  if(colours.length===1) return {colour:colours[0],mode:"single-final",details:""};
  const options=colours.map(c=>receiverDangerForColour(s,c,lockedIds,rules,stats));
  // Here the actor chooses their own colour, so choose the strongest receiver option.
  const strongest=[...options].sort((a,b)=>{
    if(a.immediateWins!==b.immediateWins) return b.immediateWins-a.immediateWins;
    if(!a.best||!b.best) return a.best?-1:b.best?1:0;
    return compareForActor(a.best,b.best);
  });
  const chosen=strongest[0];
  return {colour:chosen.colour,mode:"final-lookahead",details:options.map(x=>`${x.colour}:iw${x.immediateWins}`).join(";")};
}

function chooseColourLookahead(s,lockedIds,rules,stats) {
  if(s.forcedQueue.length) return {colour:s.forcedQueue[0].colour,mode:"forced",details:""};
  if(s.finalFour) return chooseFinalFourColour(s,lockedIds,rules,stats);
  return chooseNormalHandoverColour(s,lockedIds,rules,stats);
}

function chooseForcedSecondColour(s,lockedIds,rules,stats) {
  const colours=availableNormalColours(s);
  if(!colours.length) throw new Error("Sequential second piece is owed but no normal reserve colour remains.");
  const options=[];
  for(const colour of colours) {
    const t=cloneState(s);
    t.sequentialSecondOwed=false; t.sequentialFirstColour=null;
    t.forcedQueue=[{colour,source:"normal",responseSlot:2}]; t.forcedPlacements=1;
    options.push(receiverDangerForColour(t,colour,lockedIds,rules,stats));
  }
  const sorted=[...options].sort(compareColourSafetyForGiver),best=sorted[0];
  const tied=sorted.filter(x=>compareColourSafetyForGiver(x,best)===0);
  return tied[Math.floor(s.rng()*tied.length)];
}

function commitSequentialSecondLookahead(s,lockedIds,rules,stats) {
  if(!s.sequentialSecondOwed || s.forcedQueue.length) return null;
  const first=s.sequentialFirstColour;
  const chosen=chooseForcedSecondColour(s,lockedIds,rules,stats);
  s.forcedQueue=[{colour:chosen.colour,source:"normal",responseSlot:2}];
  s.sequentialSecondOwed=false; s.sequentialFirstColour=null; s.forcedPlacements=1;
  stats.sequentialLookaheadChoices++;
  return {kind:"lookahead-second",keep:first,give:chosen.colour,immediateWins:chosen.immediateWins};
}

function configureSequentialFirstState(s,colour,to) {
  const t=cloneState(s);
  t.awaitingMoveResponse=false;
  t.boundaryCornerOwed=false; t.boundarySelfCornerOwed=false;
  t.forcedQueue=[{colour,source:"normal",responseSlot:1,plannedTo:to}];
  t.sequentialSecondOwed=true; t.sequentialFirstColour=colour; t.forcedPlacements=2;
  return t;
}

function commitMoveResponseLookahead(s,lockedIds,rules,stats) {
  if(!s.awaitingMoveResponse) throw new Error("No Move response is awaiting commitment.");
  const count=normalReserveCount(s);
  if(count<1) throw new Error("Move response requested with no normal reserve piece remaining.");

  if(count>=2 && s.responsePolicy==="sequential") {
    const candidates=[];
    for(const colour of availableNormalColours(s)) {
      for(const to of emptySquares(s)) {
        const t=configureSequentialFirstState(s,colour,to);
        const a={type:"place",to,colour};
        candidates.push({colour,to,profile:profileAction(t,a,lockedIds,rules)});
      }
    }
    const bestProfiles=bestProfilesForActor(candidates.map(x=>x.profile));
    const bestSet=candidates.filter(x=>bestProfiles.some(p=>p.action.to===x.to&&p.action.colour===x.colour));
    const chosen=bestSet[Math.floor(s.rng()*bestSet.length)];
    s.forcedQueue=[{colour:chosen.colour,source:"normal",responseSlot:1,plannedTo:chosen.to}];
    s.boundaryCornerOwed=false; s.boundarySelfCornerOwed=false;
    s.sequentialSecondOwed=true; s.sequentialFirstColour=chosen.colour;
    s.awaitingMoveResponse=false; s.forcedPlacements=2;
    stats.moveResponseLookaheadChoices++;
    return {kind:"lookahead-first",keep:chosen.colour,firstTo:chosen.to,replyWins:chosen.profile.replyWins};
  }

  // Exactly-one-normal-reserve boundary is uncommon and has special source-order
  // semantics. Preserve any ACTUAL immediate win first; otherwise use the same
  // common-core planner in every A/B/C condition as a final tie-break fallback.
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

    if(s.boundaryPolicy==="responder-choice") {
      const finalWins=[];
      for(const colour of [...new Set(s.finalPieces)]) {
        for(const a of placementActions(s,colour,"final")) if(actionWinsUnder(s,a,rules)) finalWins.push(a);
      }
      if(finalWins.length) {
        const a=finalWins[Math.floor(s.rng()*finalWins.length)];
        s.forcedQueue=[
          {colour:a.colour,source:"final",responseSlot:1,plannedTo:a.to},
          {colour:normalColour,source:"normal",responseSlot:2}
        ];
        s.boundaryCornerOwed=false; s.boundarySelfCornerOwed=false;
        s.sequentialSecondOwed=false; s.sequentialFirstColour=null;
        s.awaitingMoveResponse=false; s.forcedPlacements=2;
        stats.boundaryActualWinOverrides++;
        return {kind:"boundary-actual-final-win",firstColour:a.colour,firstTo:a.to};
      }
    }
  }

  stats.boundaryCoreFallbacks++;
  return S.commitMoveResponse(s,CORE_RULES,"tactical");
}

function commitBoundarySelfCornerLookahead(s,lockedIds,rules,stats) {
  if(!s.boundarySelfCornerOwed || s.forcedQueue.length || !s.finalFour) return null;
  const candidates=[];
  for(const colour of [...new Set(s.finalPieces)]) {
    for(const to of emptySquares(s)) {
      const t=cloneState(s);
      t.boundarySelfCornerOwed=false;
      t.forcedQueue=[{colour,source:"final",responseSlot:2,plannedTo:to}]; t.forcedPlacements=1;
      const a={type:"final-place",to,colour};
      candidates.push({colour,to,profile:profileAction(t,a,lockedIds,rules)});
    }
  }
  if(!candidates.length) return null;
  const bestProfiles=bestProfilesForActor(candidates.map(x=>x.profile));
  const bestSet=candidates.filter(x=>bestProfiles.some(p=>p.action.to===x.to&&p.action.colour===x.colour));
  const chosen=bestSet[Math.floor(s.rng()*bestSet.length)];
  s.forcedQueue=[{colour:chosen.colour,source:"final",responseSlot:2,plannedTo:chosen.to}];
  s.boundarySelfCornerOwed=false; s.forcedPlacements=1;
  stats.boundaryLookaheadChoices++;
  return {colour:chosen.colour,to:chosen.to,kind:"boundary-self-lookahead"};
}

function commitBoundaryCornerLookahead(s,lockedIds,rules,stats) {
  if(!s.boundaryCornerOwed || s.forcedQueue.length || !s.finalFour) return null;
  const colours=[...new Set(s.finalPieces)];
  const options=[];
  for(const colour of colours) {
    const t=cloneState(s);
    t.boundaryCornerOwed=false;
    t.forcedQueue=[{colour,source:"final",responseSlot:2}]; t.forcedPlacements=1;
    options.push(receiverDangerForColour(t,colour,lockedIds,rules,stats));
  }
  if(!options.length) return null;
  const sorted=[...options].sort(compareColourSafetyForGiver),best=sorted[0];
  const tied=sorted.filter(x=>compareColourSafetyForGiver(x,best)===0);
  const chosen=tied[Math.floor(s.rng()*tied.length)];
  s.forcedQueue=[{colour:chosen.colour,source:"final",responseSlot:2}];
  s.boundaryCornerOwed=false; s.forcedPlacements=1;
  stats.boundaryLookaheadChoices++;
  return {colour:chosen.colour,kind:"boundary-give-lookahead"};
}

function redeployCandidateProfile(s,piece,to,lockedIds,rules) {
  const b=s.board.slice(); b[to]=piece;
  const win=!!S.fastCheckWin(b,rules,to);
  if(win) return {to,actualWin:true,receiverDanger:null,neutral:staticCorePlacementScore(b,piece.colour,to)};

  const t=cloneState(s);
  const responder=s.currentPlayer;
  const result=S.applyRedeployPlacement(t,piece,to,rules);
  if(result.ended) return {to,actualWin:true,receiverDanger:null,neutral:staticCorePlacementScore(b,piece.colour,to)};
  t.forcedPlacements=0; t.forcedQueue=[];
  if(t.jumpConsequence==="redeploy-pass") t.currentPlayer=responder;
  // redeploy-pass: responder gets the next normal turn; original jumper chooses
  // the colour handed to them. Evaluate that maximin handover explicitly.
  const dangers=S.availableColours(t).map(c=>receiverDangerForColour(t,c,lockedIds,rules,{lookaheadActionDecisions:0,lookaheadChangedNeutralChoice:0}));
  const sorted=[...dangers].sort(compareColourSafetyForGiver);
  return {to,actualWin:false,receiverDanger:sorted[0]||null,neutral:staticCorePlacementScore(b,piece.colour,to)};
}

function resolveJumpRedeployLookahead(s,jumpAction,lockedIds,rules,stats) {
  if(!s.awaitingJumpRedeploy) throw new Error("No Jump redeploy response is awaiting resolution.");
  const piece=s.board[jumpAction.over]; if(!piece) throw new Error("Jumped piece missing when redeploy response begins.");
  s.board[jumpAction.over]=null;
  s.awaitingJumpRedeploy=false; s.awaitingMoveResponse=false;
  s.boundaryCornerOwed=false; s.boundarySelfCornerOwed=false; s.sequentialSecondOwed=false; s.sequentialFirstColour=null;
  const responder=s.currentPlayer;

  const candidates=emptySquares(s).map(to=>redeployCandidateProfile(s,piece,to,lockedIds,rules));
  const winning=candidates.filter(x=>x.actualWin);
  let pool=winning.length?winning:candidates;
  if(!winning.length) {
    // Redeployer is the future receiver, so maximise the danger that remains
    // after the jumper has chosen the safest colour to hand them.
    pool.sort((a,b)=>{
      const ad=a.receiverDanger,bd=b.receiverDanger;
      if(!ad||!bd) return ad?-1:bd?1:0;
      // Reverse giver-safety ordering: greater receiver danger is better here.
      const c=compareColourSafetyForGiver(ad,bd);
      if(c!==0) return -c;
      return b.neutral-a.neutral;
    });
    const best=pool[0];
    pool=pool.filter(x=>{
      const c=compareColourSafetyForGiver(x.receiverDanger,best.receiverDanger);
      return c===0 && Math.abs(x.neutral-best.neutral)<1e-9;
    });
  }
  const plan=pool[Math.floor(s.rng()*pool.length)];
  if(winning.length) stats.redeployActualWinChoices++;
  else stats.redeployLookaheadChoices++;

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
function stateSignature(s) {
  const board=s.board.map(p=>p?`${p.colour[0]}${p.id}`:".").join("/");
  const queue=s.forcedQueue.map(q=>`${q.colour[0]}:${q.source}:${q.responseSlot??""}:${q.plannedTo??""}`).join("+");
  return [board,`P${s.currentPlayer+1}`,`N${s.normalRemaining.black}/${s.normalRemaining.white}`,`F${s.finalPieces.join("+")}`,`Q${queue}`,`M${s.awaitingMoveResponse?1:0}`,`J${s.awaitingJumpRedeploy?1:0}`,`S${s.sequentialSecondOwed?1:0}`,`BC${s.boundaryCornerOwed?1:0}`,`BS${s.boundarySelfCornerOwed?1:0}`,`X${s.protectedPieceId??""}`].join("|");
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
}

function emptyStats() {
  return {
    placements:0,moves:0,jumps:0,redeployments:0,
    lookaheadActionDecisions:0,lookaheadChangedNeutralChoice:0,
    handoverLookaheadDecisions:0,avoidableImmediateHandoverThreats:0,unavoidableImmediateHandoverThreats:0,
    moveResponseLookaheadChoices:0,sequentialLookaheadChoices:0,boundaryLookaheadChoices:0,boundaryCoreFallbacks:0,boundaryActualWinOverrides:0,
    redeployLookaheadChoices:0,redeployActualWinChoices:0
  };
}

function playGame(gameSeed,condition,keepTrace) {
  const rules=condition.rules;
  const s=L8.prepareState(gameSeed,fixed.jumpPolicy,fixed.responsePolicy,fixed.boundaryPolicy,fixed.jumpConsequence,fixed.oneColourPolicy,fixed.openingPolicy);
  const lockedIds=lockedIdsFromState(s),anchorIds=anchorIdsFromState(s); checkAnchors(s,anchorIds);
  const stats=emptyStats(),trace=[];
  let winType="",winningAction="";

  while(s.winner===null && s.turns<maxActions) {
    const seq=commitSequentialSecondLookahead(s,lockedIds,rules,stats);
    const bself=commitBoundarySelfCornerLookahead(s,lockedIds,rules,stats);
    const bcorner=commitBoundaryCornerLookahead(s,lockedIds,rules,stats);
    checkAnchors(s,anchorIds);

    const forcedInfo=S.normalForcedColourInfo(s);
    const category=s.finalFour?"final-four":forcedInfo?"normal-one-colour":"normal-both-colours";
    const actor=s.currentPlayer,preState=keepTrace?stateSignature(s):"";
    const colourChoice=chooseColourLookahead(s,lockedIds,rules,stats),colour=colourChoice.colour;
    if(!colour) { s.winner="draw"; break; }
    const actions=enumerateLocked(s,colour,lockedIds,rules);
    if(!actions.length) { s.winner="draw"; break; }
    const choice=chooseActionLookahead(s,actions,lockedIds,rules,stats),action=choice.action;
    if(!action) { s.winner="draw"; break; }

    if(keepTrace) trace.push({
      index:trace.length+1,turn:s.turns+1,actor:actorName(actor),category,state:preState,
      plan_seq:seq?JSON.stringify(seq):"",plan_boundary_self:bself?JSON.stringify(bself):"",plan_boundary_corner:bcorner?JSON.stringify(bcorner):"",
      colour,colour_mode:colourChoice.mode,colour_details:colourChoice.details,
      action:actionSignature(action),action_mode:choice.mode,
      reply_immediate_wins:choice.profile?.replyWins??"",reply_winning_colours:choice.profile?.replyWinningColours??"",reply_potential:choice.profile?.replyPotential??"",neutral_tiebreak:choice.profile?.neutral??""
    });

    if(action.type.includes("place")) stats.placements++;
    else if(action.type==="move") stats.moves++;
    else if(action.type==="jump") stats.jumps++;

    const result=S.applyAction(s,action,rules); checkAnchors(s,anchorIds);
    if(result.ended) {
      winType=result.winType||"";
      winningAction=s.winner==="draw"?"":(action.type.includes("place")?"placement":action.type);
      break;
    }

    if(action.type==="jump" && s.jumpConsequence!=="current") {
      const response=resolveJumpRedeployLookahead(s,action,lockedIds,rules,stats); stats.redeployments++; checkAnchors(s,anchorIds);
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
    placements:stats.placements,moves:stats.moves,jumps:stats.jumps,redeployments:stats.redeployments,reached_final_four:s.reachedFinalFour?"yes":"no",
    recorded_win_type:winType,winning_action:winningAction,max_action_draw:s.winner==="draw"&&s.turns>=maxActions?"yes":"no",
    lookahead_action_decisions:stats.lookaheadActionDecisions,lookahead_changed_neutral_choice:stats.lookaheadChangedNeutralChoice,
    handover_lookahead_decisions:stats.handoverLookaheadDecisions,avoidable_immediate_handover_threats:stats.avoidableImmediateHandoverThreats,unavoidable_immediate_handover_threats:stats.unavoidableImmediateHandoverThreats,
    move_response_lookahead_choices:stats.moveResponseLookaheadChoices,sequential_lookahead_choices:stats.sequentialLookaheadChoices,boundary_lookahead_choices:stats.boundaryLookaheadChoices,boundary_core_fallbacks:stats.boundaryCoreFallbacks,boundary_actual_win_overrides:stats.boundaryActualWinOverrides,
    redeploy_lookahead_choices:stats.redeployLookaheadChoices,redeploy_actual_win_choices:stats.redeployActualWinChoices,trace
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
  return {condition:c,n:0,wins:[0,0],draws:0,score:0,actions:0,moves:0,jumps:0,redeployments:0,finalFour:0,formations:{},
    lookaheadActionDecisions:0,lookaheadChangedNeutralChoice:0,handoverLookaheadDecisions:0,avoidableImmediateHandoverThreats:0,unavoidableImmediateHandoverThreats:0,
    moveResponseLookaheadChoices:0,sequentialLookaheadChoices:0,boundaryLookaheadChoices:0,boundaryCoreFallbacks:0,boundaryActualWinOverrides:0,redeployLookaheadChoices:0,redeployActualWinChoices:0};
}
function addAggregate(a,g) {
  a.n++; if(g.winner==="draw") a.draws++; else a.wins[g.winner]++; a.score+=g.p1_score; a.actions+=g.actions; a.moves+=g.moves; a.jumps+=g.jumps; a.redeployments+=g.redeployments;
  if(g.reached_final_four==="yes") a.finalFour++;
  if(g.recorded_win_type) a.formations[g.recorded_win_type]=(a.formations[g.recorded_win_type]||0)+1;
  for(const k of ["lookaheadActionDecisions","lookaheadChangedNeutralChoice","handoverLookaheadDecisions","avoidableImmediateHandoverThreats","unavoidableImmediateHandoverThreats","moveResponseLookaheadChoices","sequentialLookaheadChoices","boundaryLookaheadChoices","boundaryCoreFallbacks","boundaryActualWinOverrides","redeployLookaheadChoices","redeployActualWinChoices"]) {
    const snake=k.replace(/[A-Z]/g,m=>"_"+m.toLowerCase()); a[k]+=g[snake]||0;
  }
}
function aggregateRow(a) {
  const n=a.n||1;
  return {
    condition:a.condition.id,label:a.condition.label,games:a.n,p1_wins:a.wins[0],p2_wins:a.wins[1],draws:a.draws,p1_score_pct:round4(100*a.score/n),average_actions:round4(a.actions/n),moves:a.moves,jumps:a.jumps,redeployments:a.redeployments,final_four_games:a.finalFour,
    horizontal_wins:a.formations.horizontal||0,vertical_wins:a.formations.vertical||0,diagonal_wins:a.formations.diagonal||0,tight_square_wins:a.formations.square||0,spaced_square_wins:a.formations["spaced-square"]||0,
    lookahead_action_decisions:a.lookaheadActionDecisions,lookahead_changed_neutral_choice:a.lookaheadChangedNeutralChoice,handover_lookahead_decisions:a.handoverLookaheadDecisions,
    avoidable_immediate_handover_threats:a.avoidableImmediateHandoverThreats,unavoidable_immediate_handover_threats:a.unavoidableImmediateHandoverThreats,
    move_response_lookahead_choices:a.moveResponseLookaheadChoices,sequential_lookahead_choices:a.sequentialLookaheadChoices,boundary_lookahead_choices:a.boundaryLookaheadChoices,boundary_core_fallbacks:a.boundaryCoreFallbacks,boundary_actual_win_overrides:a.boundaryActualWinOverrides,
    redeploy_lookahead_choices:a.redeployLookaheadChoices,redeploy_actual_win_choices:a.redeployActualWinChoices
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
if(hasArg("self-test")) { console.log("Lipfty 9 actual-rule lookahead tactical comparison self-test passed."); process.exit(0); }

const started=Date.now(); archivePreviousResults();
console.log("");
console.log("Lipfty 9 — actual-rule lookahead tactical comparison");
console.log(`Run started: ${fmtDateTime(started)}`);
console.log(`Results: ${outDir}`);
console.log(`Matched seeds: ${seed}-${seed+games-1} (${games})`);
console.log("A/B/C use their real winning rules for immediate wins and one-ply threat avoidance.");
console.log("The common H/V/D positional score is used only after actual-rule lookahead ties.\n");

const aggregates=new Map(CONDITIONS.map(c=>[c.id,newAggregate(c)]));
const allGames=[],traceRows=[],divergenceRows=[];
const pairDefs=[["A","B"],["B","C"],["A","C"]];
const pairStats=new Map(pairDefs.map(([l,r])=>[`${l}|${r}`,{n:0,changedWinner:0,sameWinner:0,divTypes:{},divTotal:0,divN:0}]));

for(let i=0;i<games;i++) {
  const gameSeed=seed+i,byId={};
  for(const c of CONDITIONS) {
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
const summaryPath=path.join(outDir,`lipfty9-lookahead-tactical-summary-${tag}.csv`);
const pairsPath=path.join(outDir,`lipfty9-lookahead-tactical-pairs-${tag}.csv`);
const gamesPath=path.join(outDir,`lipfty9-lookahead-tactical-games-${tag}.csv`);
const divergencePath=path.join(outDir,`lipfty9-lookahead-tactical-divergences-${tag}.csv`);
const tracePath=path.join(outDir,`lipfty9-lookahead-tactical-trace-${tag}.csv`);
const reportPath=path.join(outDir,`lipfty9-lookahead-tactical-report-${tag}.txt`);
writeCsv(summaryPath,summaryRows); writeCsv(pairsPath,pairRows); writeCsv(gamesPath,allGames); writeCsv(divergencePath,divergenceRows); writeCsv(tracePath,traceRows);

const report=[
  "Lipfty 9 — Actual-rule lookahead tactical comparison",
  `Started: ${fmtDateTime(started)}`,
  `Finished: ${fmtDateTime()}`,
  `Seeds: ${seed}-${seed+games-1} (${games} matched seeds)`,
  "",
  "METHOD",
  "A/B/C enforce their own real winning rules.",
  "Immediate actual-rule wins are always taken.",
  "Normal handovers avoid an immediate actual-rule win where possible.",
  "Candidate actions use one-ply actual-rule threat avoidance before any positional tie-break.",
  "The same H/V/D common-core positional score is used only as the final tie-breaker in all conditions.",
  "Pinned opening anchors and all other Lipfty 8 Standard mechanics remain unchanged.",
  "",
  "BALANCE",
  ...summaryRows.map(x=>`${x.condition} (${x.label}): P1 ${x.p1_wins}, P2 ${x.p2_wins}, draws ${x.draws}; P1 score ${x.p1_score_pct}%; avg actions ${x.average_actions}; Final Four ${x.final_four_games}; H/V/D/Sq/SS ${x.horizontal_wins}/${x.vertical_wins}/${x.diagonal_wins}/${x.tight_square_wins}/${x.spaced_square_wins}.`),
  "",
  "MATCHED-SEED EFFECTS",
  ...pairRows.map(x=>`${x.comparison}: P1 score ${x.left_p1_score_pct}% -> ${x.right_p1_score_pct}% (${Number(x.p1_score_delta_pp)>=0?"+":""}${x.p1_score_delta_pp} pp); changed winner ${x.changed_winner}/${x.seeds}; avg first divergence action ${x.average_first_divergence_action}; ${x.divergence_types}.`),
  "",
  "LOOKAHEAD DIAGNOSTICS",
  ...summaryRows.map(x=>`${x.condition}: action lookahead ${x.lookahead_action_decisions}; changed-vs-neutral ${x.lookahead_changed_neutral_choice}; handover lookahead ${x.handover_lookahead_decisions}; avoidable/unavoidable immediate handover threats ${x.avoidable_immediate_handover_threats}/${x.unavoidable_immediate_handover_threats}; Move-response lookahead ${x.move_response_lookahead_choices}; boundary common-core fallbacks ${x.boundary_core_fallbacks}; redeploy lookahead ${x.redeploy_lookahead_choices}.`),
  "",
  "INTERPRETATION",
  "This tester is intended to answer whether the square-rule changes remain biased when players explicitly see and avoid immediate consequences under the rules they actually have.",
  "The common positional evaluator cannot create a square-specific opening personality because it is used only after the actual-rule lookahead criteria tie.",
  "",
  `Total runtime: ${fmtDuration(Date.now()-started)}`,
  ""
].join("\r\n");
fs.writeFileSync(reportPath,report,"utf8");

console.log("\nSUMMARY");
for(const x of summaryRows) console.log(`  ${x.condition}: P1 score ${x.p1_score_pct}% | P1/P2/draw ${x.p1_wins}/${x.p2_wins}/${x.draws} | avg actions ${x.average_actions}`);
console.log("\nMATCHED-SEED");
for(const x of pairRows) console.log(`  ${x.comparison}: ${x.left_p1_score_pct}% -> ${x.right_p1_score_pct}% | delta ${x.p1_score_delta_pp} pp | changed winner ${x.changed_winner}/${x.seeds} | first divergence ${x.average_first_divergence_action}`);
console.log(`\nReport: ${reportPath}`);
console.log(`Summary CSV: ${summaryPath}`);
console.log(`Pair CSV: ${pairsPath}`);
console.log(`Divergence CSV: ${divergencePath}`);
console.log(`Per-game CSV: ${gamesPath}`);
console.log(`Trace CSV (first ${Math.min(traceSeeds,games)} seeds): ${tracePath}`);
console.log(`Total time: ${fmtDuration(Date.now()-started)} | finished ${fmtDateTime()}`);
