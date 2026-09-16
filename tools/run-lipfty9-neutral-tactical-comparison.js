"use strict";

// Lipfty 9 analysis-only fixed-neutral tactical comparison.
//
// A = Lipfty 8 Standard (H/V/D + tight square + Spaced Square)
// B = no Spaced Square (H/V/D + tight square)
// C = no squares (H/V/D only)
//
// The actual rules determine legal wins and when a game ends.
// A single fixed CORE tactical evaluator (H/V/D only) is used for non-winning
// positional scoring in all three conditions. Actual-rule immediate wins and
// handover safety always take priority over the neutral evaluator.
//
// Purpose: compare A/B/C tactically without silently changing the AI's
// positional personality when a winning pattern is removed.

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

// The fixed evaluator is deliberately the common winning-pattern core shared by
// A, B and C. Therefore it can never mistake a removed square for a win.
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
function normalReserveCount(s) { return s.normalRemaining.black+s.normalRemaining.white; }
function availableNormalColours(s) { return COLOURS.filter(c=>s.normalRemaining[c]>0); }
function emptySquares(s) { const out=[]; for(let i=0;i<36;i++) if(!s.board[i]) out.push(i); return out; }

function safeArchiveDestination(oldDir,fileName) {
  const direct=path.join(oldDir,fileName); if(!fs.existsSync(direct)) return direct;
  const ext=path.extname(fileName),base=path.basename(fileName,ext),d=new Date();
  const stamp=[d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0"),"-",String(d.getHours()).padStart(2,"0"),String(d.getMinutes()).padStart(2,"0"),String(d.getSeconds()).padStart(2,"0")].join("");
  let candidate=path.join(oldDir,`${base}-${stamp}${ext}`),n=2;
  while(fs.existsSync(candidate)) candidate=path.join(oldDir,`${base}-${stamp}-${n++}${ext}`);
  return candidate;
}
function archivePreviousResults() {
  fs.mkdirSync(outDir,{recursive:true}); const oldDir=path.join(outDir,"old"); fs.mkdirSync(oldDir,{recursive:true});
  console.log("Archiving previous results..."); let moved=0;
  for(const entry of fs.readdirSync(outDir,{withFileTypes:true})) {
    if(!entry.isFile()) continue;
    fs.renameSync(path.join(outDir,entry.name),safeArchiveDestination(oldDir,entry.name)); moved++;
  }
  console.log(`  moved ${moved} file${moved===1?"":"s"} to ${oldDir}`);
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
function enumerateLocked(s,colour,lockedIds,actualRules) {
  return S.enumerateActions(s,colour,actualRules).filter(a=>!isLockedAction(s,a,lockedIds));
}
function actionWinsUnder(s,a,rules) { return !!S.fastCheckWin(S.boardAfter(s,a),rules,a.to); }
function actualWinningActions(s,actions,actualRules) { return actions.filter(a=>actionWinsUnder(s,a,actualRules)); }

// Fixed non-winning positional score. It is identical for A/B/C.
function neutralActionScore(s,a) {
  return S.actionPositionalScore(s,a,CORE_RULES);
}
function bestNeutralActionScore(s,actions) {
  if(!actions.length) return -Infinity;
  let best=-Infinity;
  for(const a of actions) best=Math.max(best,neutralActionScore(s,a));
  return best;
}

function chooseNormalHandoverColour(s,lockedIds,actualRules) {
  const colours=S.availableColours(s);
  if(!colours.length) return {colour:null,mode:"none",details:""};
  if(colours.length===1) return {colour:colours[0],mode:"single",details:""};

  const info=colours.map(colour=>{
    const actions=enumerateLocked(s,colour,lockedIds,actualRules);
    const wins=actualWinningActions(s,actions,actualRules).length;
    const danger=bestNeutralActionScore(s,actions);
    return {colour,wins,danger};
  });
  const minWins=Math.min(...info.map(x=>x.wins));
  const safest=info.filter(x=>x.wins===minWins);
  let bestDanger=Math.min(...safest.map(x=>x.danger));
  const best=safest.filter(x=>Math.abs(x.danger-bestDanger)<1e-9);
  const chosen=best[Math.floor(s.rng()*best.length)];
  return {colour:chosen.colour,mode:"handover",details:info.map(x=>`${x.colour}:aw${x.wins}/d${Number.isFinite(x.danger)?x.danger.toFixed(2):x.danger}`).join(";")};
}

function chooseFinalFourColour(s,lockedIds,actualRules) {
  const colours=S.availableColours(s);
  if(!colours.length) return {colour:null,mode:"none",details:""};
  if(colours.length===1) return {colour:colours[0],mode:"single-final",details:""};
  const info=colours.map(colour=>{
    const actions=enumerateLocked(s,colour,lockedIds,actualRules);
    const wins=actualWinningActions(s,actions,actualRules).length;
    const score=bestNeutralActionScore(s,actions);
    return {colour,wins,score};
  });
  const winning=info.filter(x=>x.wins>0);
  const pool=winning.length?winning:info;
  const bestScore=Math.max(...pool.map(x=>x.score));
  const best=pool.filter(x=>Math.abs(x.score-bestScore)<1e-9);
  const chosen=best[Math.floor(s.rng()*best.length)];
  return {colour:chosen.colour,mode:winning.length?"final-actual-win":"final-neutral",details:info.map(x=>`${x.colour}:aw${x.wins}/s${Number.isFinite(x.score)?x.score.toFixed(2):x.score}`).join(";")};
}

function chooseColourNeutral(s,lockedIds,actualRules) {
  if(s.forcedQueue.length) return {colour:s.forcedQueue[0].colour,mode:"forced",details:""};
  if(s.finalFour) return chooseFinalFourColour(s,lockedIds,actualRules);
  return chooseNormalHandoverColour(s,lockedIds,actualRules);
}

function chooseActionNeutral(s,actions,actualRules) {
  if(!actions.length) return {action:null,mode:"none",actualWins:0,chosenScore:""};
  const wins=actualWinningActions(s,actions,actualRules);
  if(wins.length) {
    const action=wins[Math.floor(s.rng()*wins.length)];
    return {action,mode:"actual-win",actualWins:wins.length,chosenScore:"WIN"};
  }

  const planned=s.forcedQueue[0]?.plannedTo;
  if(planned!==undefined) {
    const action=actions.find(a=>a.to===planned);
    if(action) return {action,mode:"planned-neutral",actualWins:0,chosenScore:"planned"};
  }

  let best=[],bestScore=-Infinity;
  for(const a of actions) {
    const score=neutralActionScore(s,a)+s.rng()*0.01;
    if(score>bestScore+1e-9) { bestScore=score; best=[a]; }
    else if(Math.abs(score-bestScore)<1e-9) best.push(a);
  }
  const action=best[Math.floor(s.rng()*best.length)];
  return {action,mode:"neutral-score",actualWins:0,chosenScore:Number.isFinite(bestScore)?bestScore.toFixed(4):String(bestScore)};
}

function placementWinTargets(s,colour,rules) {
  const out=[];
  for(const to of emptySquares(s)) {
    const b=s.board.slice(); b[to]={id:-1,colour};
    if(S.fastCheckWin(b,rules,to)) out.push(to);
  }
  return out;
}

// For a sequential Move response, preserve an immediate actual-rule winning
// first placement if one exists. Otherwise use the same fixed CORE response
// planner in every condition.
function commitMoveResponseNeutral(s,actualRules,stats) {
  const count=normalReserveCount(s);
  if(count>=2 && s.responsePolicy==="sequential") {
    const winning=[];
    for(const colour of availableNormalColours(s)) {
      for(const to of placementWinTargets(s,colour,actualRules)) winning.push({colour,to});
    }
    if(winning.length) {
      const pick=winning[Math.floor(s.rng()*winning.length)];
      s.forcedQueue=[{colour:pick.colour,source:"normal",responseSlot:1,plannedTo:pick.to}];
      s.boundaryCornerOwed=false; s.boundarySelfCornerOwed=false;
      s.sequentialSecondOwed=true; s.sequentialFirstColour=pick.colour;
      s.awaitingMoveResponse=false; s.forcedPlacements=2;
      stats.actualResponseWinOverrides++;
      return {kind:"actual-win-first",keep:pick.colour,firstTo:pick.to};
    }
  }
  if(count===1) stats.boundaryCoreFallbacks++;
  return S.commitMoveResponse(s,CORE_RULES,"tactical");
}

// The responder chooses the second normal reserve colour for the original mover.
// Avoid actual-rule immediate wins first; then use fixed neutral danger.
function commitSequentialSecondNeutral(s,actualRules,stats) {
  if(!s.sequentialSecondOwed || s.forcedQueue.length) return null;
  const colours=availableNormalColours(s);
  if(!colours.length) throw new Error("Sequential second piece is owed but no normal reserve colour remains.");
  const info=colours.map(colour=>{
    const wins=placementWinTargets(s,colour,actualRules).length;
    const actions=emptySquares(s).map(to=>({type:"place",to,colour}));
    return {colour,wins,danger:bestNeutralActionScore(s,actions)};
  });
  const minWins=Math.min(...info.map(x=>x.wins));
  const safe=info.filter(x=>x.wins===minWins);
  const bestDanger=Math.min(...safe.map(x=>x.danger));
  const best=safe.filter(x=>Math.abs(x.danger-bestDanger)<1e-9);
  const chosen=best[Math.floor(s.rng()*best.length)];
  s.forcedQueue=[{colour:chosen.colour,source:"normal",responseSlot:2}];
  s.sequentialSecondOwed=false; s.sequentialFirstColour=null; s.forcedPlacements=1;
  if(minWins>0) stats.unavoidableSecondHandoverWins++;
  return {kind:"neutral-second",colour:chosen.colour,wins:chosen.wins,danger:chosen.danger};
}

function buildCorePatterns() {
  const patterns=[];
  const dirs=[[0,1],[1,0],[1,1],[1,-1]];
  for(const [dr,dc] of dirs) {
    for(let r=0;r<6;r++) for(let c=0;c<6;c++) {
      const endR=r+3*dr,endC=c+3*dc;
      if(endR<0||endR>=6||endC<0||endC>=6) continue;
      patterns.push([0,1,2,3].map(k=>(r+k*dr)*6+(c+k*dc)));
    }
  }
  return patterns;
}
const CORE_PATTERNS=buildCorePatterns();
function staticCoreBoardScore(board,colour,to) {
  const other=colour==="black"?"white":"black";
  const weights=[0,1,5,24,80];
  let score=0;
  for(const p of CORE_PATTERNS) {
    let own=0,opp=0;
    for(const i of p) {
      const q=board[i]; if(!q) continue;
      if(q.colour===colour) own++; else if(q.colour===other) opp++;
    }
    if(own&&opp) continue;
    if(own) score+=weights[own]; else if(opp) score-=0.7*weights[opp];
  }
  const rr=Math.floor(to/6),cc=to%6;
  score+=(2.5-Math.abs(rr-2.5))+(2.5-Math.abs(cc-2.5));
  return score;
}

function resolveJumpRedeployNeutral(s,jumpAction,actualRules,stats) {
  if(!s.awaitingJumpRedeploy) throw new Error("No Jump redeploy response is awaiting resolution.");
  const piece=s.board[jumpAction.over]; if(!piece) throw new Error("Jumped piece missing when redeploy response begins.");
  s.board[jumpAction.over]=null;
  s.awaitingJumpRedeploy=false; s.awaitingMoveResponse=false;
  s.boundaryCornerOwed=false; s.boundarySelfCornerOwed=false; s.sequentialSecondOwed=false; s.sequentialFirstColour=null;
  const responder=s.currentPlayer;

  const candidates=[];
  for(const to of emptySquares(s)) {
    const b=s.board.slice(); b[to]=piece;
    const actualWin=!!S.fastCheckWin(b,actualRules,to);
    const score=staticCoreBoardScore(b,piece.colour,to);
    candidates.push({to,actualWin,score});
  }
  const winning=candidates.filter(x=>x.actualWin);
  const pool=winning.length?winning:candidates;
  const bestScore=Math.max(...pool.map(x=>x.score));
  const best=pool.filter(x=>Math.abs(x.score-bestScore)<1e-9);
  const plan=best[Math.floor(s.rng()*best.length)];
  if(winning.length) stats.actualRedeployWinOverrides++;

  const first=S.applyRedeployPlacement(s,piece,plan.to,actualRules);
  if(first.ended) return {ended:true,stage:"redeploy",plan,firstResult:first,piece};
  s.forcedPlacements=0; s.forcedQueue=[]; s.currentPlayer=responder;
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
  if(CORE_RULES.allowSquare || CORE_RULES.allowSpacedSquare || !CORE_RULES.allowDiagonal) throw new Error("Self-test failed: fixed neutral core evaluator must be H/V/D only.");
  const s=L8.prepareState(1,fixed.jumpPolicy,fixed.responsePolicy,fixed.boundaryPolicy,fixed.jumpConsequence,fixed.oneColourPolicy,fixed.openingPolicy);
  const expected=["black","white","white","black"],actual=ANCHOR_SQUARES.map(i=>s.board[i]?.colour);
  if(actual.some((c,i)=>c!==expected[i])) throw new Error(`Self-test failed: opening anchors are ${actual.join(",")}.`);
  checkAnchors(s,anchorIdsFromState(s));
  if(lockedIdsFromState(s).size!==4) throw new Error("Self-test failed: four anchors were not locked.");

  // Ensure a tight-square-only position is a win in A/B but not CORE/C.
  const b=Array(36).fill(null); [0,1,6,7].forEach(i=>b[i]={id:i+1,colour:"black"});
  if(!S.fastCheckWin(b,RULESETS.A,7) || !S.fastCheckWin(b,RULESETS.B,7) || S.fastCheckWin(b,CORE_RULES,7)) throw new Error("Self-test failed: tight-square separation is wrong.");
  // Genuine spaced square; a 2x3 rectangle must not count.
  const q=Array(36).fill(null); [0,2,12,14].forEach(i=>q[i]={id:i+1,colour:"white"});
  if(!S.fastCheckWin(q,RULESETS.A,14) || S.fastCheckWin(q,RULESETS.B,14)) throw new Error("Self-test failed: Spaced Square separation is wrong.");
  const r=Array(36).fill(null); [0,2,18,20].forEach(i=>r[i]={id:i+1,colour:"white"});
  if(S.fastCheckWin(r,RULESETS.A,20)) throw new Error("Self-test failed: rectangle incorrectly treated as a Spaced Square.");
}

function emptyStats() {
  return {placements:0,moves:0,jumps:0,redeployments:0,actualResponseWinOverrides:0,actualRedeployWinOverrides:0,unavoidableSecondHandoverWins:0,boundaryCoreFallbacks:0};
}

function playGame(gameSeed,condition,keepTrace) {
  const actualRules=condition.rules;
  const s=L8.prepareState(gameSeed,fixed.jumpPolicy,fixed.responsePolicy,fixed.boundaryPolicy,fixed.jumpConsequence,fixed.oneColourPolicy,fixed.openingPolicy);
  const lockedIds=lockedIdsFromState(s),anchorIds=anchorIdsFromState(s); checkAnchors(s,anchorIds);
  const stats=emptyStats(),trace=[];
  let winType="",winningAction="";

  while(s.winner===null && s.turns<maxActions) {
    const seq=commitSequentialSecondNeutral(s,actualRules,stats);
    const bself=S.commitBoundarySelfCorner(s,CORE_RULES,"tactical");
    const bcorner=S.commitBoundaryCorner(s,CORE_RULES,"tactical");
    if(bself||bcorner) stats.boundaryCoreFallbacks++;
    checkAnchors(s,anchorIds);

    const forcedInfo=S.normalForcedColourInfo(s);
    const category=s.finalFour?"final-four":forcedInfo?"normal-one-colour":"normal-both-colours";
    const actor=s.currentPlayer,preState=keepTrace?stateSignature(s):"";
    const colourChoice=chooseColourNeutral(s,lockedIds,actualRules),colour=colourChoice.colour;
    if(!colour) { s.winner="draw"; break; }
    const actions=enumerateLocked(s,colour,lockedIds,actualRules);
    if(!actions.length) { s.winner="draw"; break; }
    const choice=chooseActionNeutral(s,actions,actualRules),action=choice.action;
    if(!action) { s.winner="draw"; break; }

    if(keepTrace) trace.push({
      index:trace.length+1,turn:s.turns+1,actor:actorName(actor),category,state:preState,
      plan_seq:seq?JSON.stringify(seq):"",plan_boundary_self:bself?JSON.stringify(bself):"",plan_boundary_corner:bcorner?JSON.stringify(bcorner):"",
      colour,colour_mode:colourChoice.mode,colour_details:colourChoice.details,
      action:actionSignature(action),action_mode:choice.mode,actual_winning_actions:choice.actualWins,chosen_score:choice.chosenScore
    });

    if(action.type.includes("place")) stats.placements++;
    else if(action.type==="move") stats.moves++;
    else if(action.type==="jump") stats.jumps++;

    const result=S.applyAction(s,action,actualRules); checkAnchors(s,anchorIds);
    if(result.ended) {
      winType=result.winType||"";
      winningAction=s.winner==="draw"?"":(action.type.includes("place")?"placement":action.type);
      break;
    }

    if(action.type==="jump" && s.jumpConsequence!=="current") {
      const response=resolveJumpRedeployNeutral(s,action,actualRules,stats); stats.redeployments++; checkAnchors(s,anchorIds);
      if(keepTrace && trace.length) trace[trace.length-1].redeploy_plan=JSON.stringify(response.plan||{});
      if(response.stage==="redeploy") { winType=response.firstResult.winType||""; winningAction="redeploy"; break; }
    } else if(action.type==="move" || action.type==="jump") {
      const plan=commitMoveResponseNeutral(s,actualRules,stats);
      if(keepTrace && trace.length) trace[trace.length-1].move_response_plan=JSON.stringify(plan||{});
    }
    checkAnchors(s,anchorIds);
  }

  if(s.winner===null) s.winner="draw";
  return {
    seed:gameSeed,condition:condition.id,label:condition.label,winner:s.winner,winner_name:actorName(s.winner),p1_score:scoreForWinner(s.winner),actions:s.turns,
    placements:stats.placements,moves:stats.moves,jumps:stats.jumps,redeployments:stats.redeployments,reached_final_four:s.reachedFinalFour?"yes":"no",
    recorded_win_type:winType,winning_action:winningAction,max_action_draw:s.winner==="draw"&&s.turns>=maxActions?"yes":"no",
    actual_response_win_overrides:stats.actualResponseWinOverrides,actual_redeploy_win_overrides:stats.actualRedeployWinOverrides,
    unavoidable_second_handover_wins:stats.unavoidableSecondHandoverWins,boundary_core_fallbacks:stats.boundaryCoreFallbacks,trace
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
  return {condition:c,n:0,wins:[0,0],draws:0,score:0,actions:0,moves:0,jumps:0,redeployments:0,finalFour:0,formations:{},responseOverrides:0,redeployOverrides:0,boundaryFallbacks:0};
}
function addAggregate(a,g) {
  a.n++; if(g.winner==="draw") a.draws++; else a.wins[g.winner]++; a.score+=g.p1_score; a.actions+=g.actions; a.moves+=g.moves; a.jumps+=g.jumps; a.redeployments+=g.redeployments;
  if(g.reached_final_four==="yes") a.finalFour++;
  if(g.recorded_win_type) a.formations[g.recorded_win_type]=(a.formations[g.recorded_win_type]||0)+1;
  a.responseOverrides+=g.actual_response_win_overrides; a.redeployOverrides+=g.actual_redeploy_win_overrides; a.boundaryFallbacks+=g.boundary_core_fallbacks;
}
function aggregateRow(a) {
  const n=a.n||1;
  return {condition:a.condition.id,label:a.condition.label,games:a.n,p1_wins:a.wins[0],p2_wins:a.wins[1],draws:a.draws,p1_score_pct:round4(100*a.score/n),average_actions:round4(a.actions/n),moves:a.moves,jumps:a.jumps,redeployments:a.redeployments,final_four_games:a.finalFour,
    horizontal_wins:a.formations.horizontal||0,vertical_wins:a.formations.vertical||0,diagonal_wins:a.formations.diagonal||0,tight_square_wins:a.formations.square||0,spaced_square_wins:a.formations["spaced-square"]||0,
    actual_response_win_overrides:a.responseOverrides,actual_redeploy_win_overrides:a.redeployOverrides,boundary_core_fallbacks:a.boundaryFallbacks};
}
function csvEscape(v) { return `"${String(v??"").replace(/"/g,'""')}"`; }
function writeCsv(filePath,rows) {
  if(!rows.length) { fs.writeFileSync(filePath,"","utf8"); return; }
  const keys=Object.keys(rows[0]);
  fs.writeFileSync(filePath,keys.join(",")+"\r\n"+rows.map(r=>keys.map(k=>csvEscape(r[k])).join(",")).join("\r\n")+"\r\n","utf8");
}
function gameRow(g) { const x={...g}; delete x.winner; delete x.trace; return x; }

selfTest();
if(hasArg("self-test")) { console.log("Lipfty 9 fixed-neutral tactical comparison self-test passed."); process.exit(0); }

const started=Date.now(); archivePreviousResults();
console.log("");
console.log("Lipfty 9 — fixed-neutral tactical comparison");
console.log(`Run started: ${fmtDateTime(started)}`);
console.log(`Results: ${outDir}`);
console.log(`Matched seeds: ${seed}-${seed+games-1} (${games})`);
console.log("A/B/C use their real winning rules, but all non-winning positional scoring uses the same H/V/D core evaluator.");
console.log("Immediate actual-rule wins and handover safety always override the neutral positional score.\n");

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
    divergenceRows.push({seed:gameSeed,comparison:`${l}->${r}`,left_winner:left.winner_name,right_winner:right.winner_name,left_actions:left.actions,right_actions:right.actions,first_divergence_action:d.index,divergence_type:d.type,actor:d.left?.actor||d.right?.actor||"",category:d.left?.category||d.right?.category||"",left_colour:d.left?.colour||"",right_colour:d.right?.colour||"",left_action:d.left?.action||"",right_action:d.right?.action||"",left_colour_details:d.left?.colour_details||"",right_colour_details:d.right?.colour_details||""});
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
const summaryPath=path.join(outDir,`lipfty9-neutral-tactical-summary-${tag}.csv`);
const pairsPath=path.join(outDir,`lipfty9-neutral-tactical-pairs-${tag}.csv`);
const gamesPath=path.join(outDir,`lipfty9-neutral-tactical-games-${tag}.csv`);
const divergencePath=path.join(outDir,`lipfty9-neutral-tactical-divergences-${tag}.csv`);
const tracePath=path.join(outDir,`lipfty9-neutral-tactical-trace-${tag}.csv`);
const reportPath=path.join(outDir,`lipfty9-neutral-tactical-report-${tag}.txt`);
writeCsv(summaryPath,summaryRows); writeCsv(pairsPath,pairRows); writeCsv(gamesPath,allGames); writeCsv(divergencePath,divergenceRows); writeCsv(tracePath,traceRows);

const report=[
  "Lipfty 9 — Fixed-neutral tactical comparison",
  `Started: ${fmtDateTime(started)}`,
  `Finished: ${fmtDateTime()}`,
  `Seeds: ${seed}-${seed+games-1} (${games} matched seeds)`,
  "",
  "METHOD",
  "A/B/C enforce their own real winning rules.",
  "All non-winning positional scoring uses one fixed H/V/D common-core evaluator.",
  "Immediate wins, handover safety and redeployment wins are checked with the actual condition rules first.",
  "The four opening anchors remain permanently pinned and all other Lipfty 8 Standard mechanics are unchanged.",
  "",
  "BALANCE",
  ...summaryRows.map(x=>`${x.condition} (${x.label}): P1 ${x.p1_wins}, P2 ${x.p2_wins}, draws ${x.draws}; P1 score ${x.p1_score_pct}%; avg actions ${x.average_actions}; Final Four ${x.final_four_games}; H/V/D/Sq/SS ${x.horizontal_wins}/${x.vertical_wins}/${x.diagonal_wins}/${x.tight_square_wins}/${x.spaced_square_wins}.`),
  "",
  "MATCHED-SEED EFFECTS",
  ...pairRows.map(x=>`${x.comparison}: P1 score ${x.left_p1_score_pct}% -> ${x.right_p1_score_pct}% (${Number(x.p1_score_delta_pp)>=0?"+":""}${x.p1_score_delta_pp} pp); changed winner ${x.changed_winner}/${x.seeds}; avg first divergence action ${x.average_first_divergence_action}; ${x.divergence_types}.`),
  "",
  "DIAGNOSTIC COUNTERS",
  ...summaryRows.map(x=>`${x.condition}: actual first-response win overrides ${x.actual_response_win_overrides}; actual redeployment win overrides ${x.actual_redeploy_win_overrides}; boundary/common-core fallbacks ${x.boundary_core_fallbacks}.`),
  "",
  "INTERPRETATION",
  "Unlike the previous tactical-policy diagnostic, the positional evaluator does not change between A, B and C.",
  "A divergence can therefore be traced to an actual-rule tactical consequence (such as an immediate win/threat or game ending), rather than a different positional pattern set from move 1.",
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
