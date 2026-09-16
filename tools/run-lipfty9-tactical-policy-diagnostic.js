"use strict";

// Lipfty 9 analysis-only tactical-policy diagnostic.
//
// Purpose:
//   Explain the extreme tactical A/B/C balance seen by the square-removal
//   comparison without changing the playable game.
//
// It separates:
//   ACTUAL RULES     - what really ends the game as a win.
//   EVALUATION RULES - what the tactical policy treats as a win/threat while
//                      choosing colours, actions and compulsory responses.
//
// Variants:
//   AA = Standard actual rules / Standard evaluator (baseline)
//   BB = No Spaced Square actual rules / No Spaced Square evaluator
//   BA = No Spaced Square actual rules / Standard evaluator
//   CC = No Squares actual rules / No Squares evaluator
//   CB = No Squares actual rules / No Spaced Square evaluator
//   CA = No Squares actual rules / Standard evaluator
//
// BA, CB and CA are diagnostics only. They are not proposed Lipfty rules.

const fs = require("fs");
const path = require("path");
const L8 = require("./lipfty8-simulator.js");
const S = require("./lipfty7-simulator.js");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}
function hasArg(name) { return process.argv.includes(`--${name}`); }

const games = Number(arg("games", "50"));
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

const VARIANTS = [
  {id:"AA", actual:"A", evaluate:"A", label:"Standard actual / Standard evaluator"},
  {id:"BB", actual:"B", evaluate:"B", label:"No Spaced actual / No Spaced evaluator"},
  {id:"BA", actual:"B", evaluate:"A", label:"No Spaced actual / Standard evaluator"},
  {id:"CC", actual:"C", evaluate:"C", label:"No Squares actual / No Squares evaluator"},
  {id:"CB", actual:"C", evaluate:"B", label:"No Squares actual / No Spaced evaluator"},
  {id:"CA", actual:"C", evaluate:"A", label:"No Squares actual / Standard evaluator"}
];

function fmtClock(ts = Date.now()) {
  return new Date(ts).toLocaleTimeString("en-GB", {hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false});
}
function fmtDateTime(ts = Date.now()) {
  return new Date(ts).toLocaleString("en-GB", {weekday:"short",day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false});
}
function fmtDuration(ms) {
  let s=Math.max(0,Math.round(ms/1000)); const h=Math.floor(s/3600); s%=3600; const m=Math.floor(s/60); s%=60;
  if(h) return `${h}h ${m}m ${s}s`; if(m) return `${m}m ${s}s`; return `${s}s`;
}
function actorName(v) { return v===0?"P1":v===1?"P2":"draw"; }
function scoreForWinner(v) { return v===0?1:v===1?0:0.5; }
function pct(n,d) { return d?100*n/d:0; }
function round4(v) { return Number(v).toFixed(4); }

function safeArchiveDestination(oldDir, fileName) {
  const direct=path.join(oldDir,fileName); if(!fs.existsSync(direct)) return direct;
  const ext=path.extname(fileName), base=path.basename(fileName,ext), d=new Date();
  const stamp=[d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0"),"-",String(d.getHours()).padStart(2,"0"),String(d.getMinutes()).padStart(2,"0"),String(d.getSeconds()).padStart(2,"0")].join("");
  let candidate=path.join(oldDir,`${base}-${stamp}${ext}`), n=2;
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
    const sq=ANCHOR_SQUARES[i], p=s.board[sq];
    if(!p || p.id!==anchorIds[i]) throw new Error(`Pinned-corner integrity failure at R${Math.floor(sq/6)+1}C${sq%6+1}.`);
  }
}
function isLockedAction(s,a,lockedIds) {
  if(a.type!=="move" && a.type!=="jump") return false;
  const mover=s.board[a.from]; if(mover && lockedIds.has(mover.id)) return true;
  if(a.type==="jump") { const jumped=s.board[a.over]; if(jumped && lockedIds.has(jumped.id)) return true; }
  return false;
}
function enumerateLocked(s,colour,lockedIds,legalRules) {
  return S.enumerateActions(s,colour,legalRules).filter(a=>!isLockedAction(s,a,lockedIds));
}
function actionWinsUnder(s,a,rules) { return !!S.fastCheckWin(S.boardAfter(s,a),rules,a.to); }

function handoverDangerLocked(s,colour,lockedIds,legalRules,evalRules) {
  const actions=enumerateLocked(s,colour,lockedIds,legalRules); if(!actions.length) return -Infinity;
  let best=-Infinity; for(const a of actions) best=Math.max(best,S.actionPositionalScore(s,a,evalRules)); return best;
}

function chooseColourDiagnostic(s,lockedIds,legalRules,evalRules) {
  if(s.forcedQueue.length) return {colour:s.forcedQueue[0].colour,mode:"forced",details:""};
  const colours=S.availableColours(s); if(!colours.length) return {colour:null,mode:"none",details:""};
  if(colours.length===1) return {colour:colours[0],mode:"single",details:""};
  if(s.finalFour) {
    const colour=S.chooseColour(s,evalRules,"tactical",fixed.finalFourColourPolicy);
    return {colour,mode:"final-four",details:`available=${colours.join("+")}`};
  }

  const info=[];
  for(const colour of colours) {
    const actions=enumerateLocked(s,colour,lockedIds,legalRules);
    const evalWins=actions.filter(a=>actionWinsUnder(s,a,evalRules)).length;
    const actualWins=actions.filter(a=>actionWinsUnder(s,a,legalRules)).length;
    const danger=handoverDangerLocked(s,colour,lockedIds,legalRules,evalRules);
    info.push({colour,evalWins,actualWins,danger});
  }
  const safe=info.filter(x=>x.evalWins===0); const candidates=safe.length?safe:info;
  let best=[],bestDanger=Infinity;
  for(const x of candidates) {
    if(x.danger<bestDanger-1e-9) { bestDanger=x.danger; best=[x.colour]; }
    else if(Math.abs(x.danger-bestDanger)<1e-9) best.push(x.colour);
  }
  const colour=best[Math.floor(s.rng()*best.length)];
  const details=info.map(x=>`${x.colour}:ew${x.evalWins}/aw${x.actualWins}/d${Number.isFinite(x.danger)?x.danger.toFixed(2):String(x.danger)}`).join(";");
  return {colour,mode:"handover",details};
}

function chooseActionDiagnostic(s,actions,actualRules,evalRules) {
  if(!actions.length) return {action:null,mode:"none",evalWins:0,actualWins:0,chosenScore:""};
  const planned=s.forcedQueue[0]?.plannedTo;
  const evalWins=actions.filter(a=>actionWinsUnder(s,a,evalRules));
  const actualWins=actions.filter(a=>actionWinsUnder(s,a,actualRules));
  if(planned!==undefined) {
    const action=actions.find(a=>a.to===planned);
    if(action) return {action,mode:"planned",evalWins:evalWins.length,actualWins:actualWins.length,chosenScore:""};
  }
  if(evalWins.length) {
    const action=evalWins[Math.floor(s.rng()*evalWins.length)];
    return {action,mode:"eval-win",evalWins:evalWins.length,actualWins:actualWins.length,chosenScore:"WIN"};
  }
  let best=[],bestScore=-Infinity;
  for(const a of actions) {
    const score=S.actionPositionalScore(s,a,evalRules)+s.rng()*0.01;
    if(score>bestScore+1e-9) { bestScore=score; best=[a]; }
    else if(Math.abs(score-bestScore)<1e-9) best.push(a);
  }
  const action=best[Math.floor(s.rng()*best.length)];
  return {action,mode:"score",evalWins:0,actualWins:actualWins.length,chosenScore:Number.isFinite(bestScore)?bestScore.toFixed(4):String(bestScore)};
}

function actionSignature(a) {
  if(!a) return "none";
  if(a.type==="move") return `move:${a.from}->${a.to}`;
  if(a.type==="jump") return `jump:${a.from}->${a.to}/${a.over}`;
  return `${a.type}:${a.to}`;
}
function boardSignature(board) {
  return board.map(p=>p?`${p.colour[0]}${p.id}`:".").join("/");
}
function stateSignature(s) {
  const queue=s.forcedQueue.map(q=>`${q.colour[0]}:${q.source}:${q.responseSlot??""}:${q.plannedTo??""}`).join("+");
  return [boardSignature(s.board),`P${s.currentPlayer+1}`,`N${s.normalRemaining.black}/${s.normalRemaining.white}`,`F${s.finalPieces.join("+")}`,`Q${queue}`,`M${s.awaitingMoveResponse?1:0}`,`J${s.awaitingJumpRedeploy?1:0}`,`S${s.sequentialSecondOwed?1:0}`,`BC${s.boundaryCornerOwed?1:0}`,`BS${s.boundarySelfCornerOwed?1:0}`,`X${s.protectedPieceId??""}`].join("|");
}

function resolveJumpRedeploySplit(s,jumpAction,actualRules,evalRules) {
  if(!s.awaitingJumpRedeploy) throw new Error("No Jump redeploy response is awaiting resolution.");
  const piece=s.board[jumpAction.over]; if(!piece) throw new Error("Jumped piece missing when redeploy response begins.");
  s.board[jumpAction.over]=null;
  s.awaitingJumpRedeploy=false; s.awaitingMoveResponse=false;
  s.boundaryCornerOwed=false; s.boundarySelfCornerOwed=false; s.sequentialSecondOwed=false; s.sequentialFirstColour=null;
  const responder=s.currentPlayer;
  const plan=S.chooseRedeployPassPlan(s,piece,evalRules,"tactical");
  const first=S.applyRedeployPlacement(s,piece,plan.to,actualRules);
  if(first.ended) return {ended:true,stage:"redeploy",plan,firstResult:first,piece};
  s.forcedPlacements=0; s.forcedQueue=[]; s.currentPlayer=responder;
  return {ended:false,stage:"complete",plan,firstResult:first,piece};
}

function selfTest() {
  if(RULESETS.A.allowSpacedSquare!==true || RULESETS.B.allowSpacedSquare!==false || RULESETS.B.allowSquare!==true || RULESETS.C.allowSquare!==false) {
    throw new Error("Self-test failed: A/B/C rule configuration is wrong.");
  }
  if(Object.values(RULESETS).some(r=>r.allowDiamond||r.allowSpacedDiamond)) throw new Error("Self-test failed: Diamond rules must remain disabled.");
  const s=L8.prepareState(1,fixed.jumpPolicy,fixed.responsePolicy,fixed.boundaryPolicy,fixed.jumpConsequence,fixed.oneColourPolicy,fixed.openingPolicy);
  const expected=["black","white","white","black"], actual=ANCHOR_SQUARES.map(i=>s.board[i]?.colour);
  if(actual.some((c,i)=>c!==expected[i])) throw new Error(`Self-test failed: opening anchors are ${actual.join(",")}.`);
  checkAnchors(s,anchorIdsFromState(s));
  const ids=lockedIdsFromState(s); if(ids.size!==4) throw new Error("Self-test failed: four anchors were not locked.");
  const variantIds=VARIANTS.map(v=>v.id).join(","); if(variantIds!=="AA,BB,BA,CC,CB,CA") throw new Error("Self-test failed: diagnostic variants changed unexpectedly.");
}

function emptyGameStats() {
  return {
    placements:0,moves:0,jumps:0,redeployments:0,
    actorActions:[0,0], actorMoves:[0,0], actorJumps:[0,0],
    handovers:[{black:0,white:0},{black:0,white:0}],
    handoverDecisions:[0,0],
    evalWinButActualNotStates:[0,0], actualWinButEvalNotStates:[0,0],
    selectedEvalWinButActualNot:[0,0], selectedActualWinButEvalNot:[0,0],
    oneColourFirstActor:null, finalFourFirstActor:null
  };
}

function playVariant(gameSeed,variant,keepTrace) {
  const actualRules=RULESETS[variant.actual], evalRules=RULESETS[variant.evaluate];
  const s=L8.prepareState(gameSeed,fixed.jumpPolicy,fixed.responsePolicy,fixed.boundaryPolicy,fixed.jumpConsequence,fixed.oneColourPolicy,fixed.openingPolicy);
  const lockedIds=lockedIdsFromState(s), anchorIds=anchorIdsFromState(s); checkAnchors(s,anchorIds);
  const stats=emptyGameStats(), trace=[];
  let winType="", winningAction="", lastNormalColourCount=2;

  while(s.winner===null && s.turns<maxActions) {
    const seq=S.commitSequentialSecond(s,evalRules,"tactical");
    const bself=S.commitBoundarySelfCorner(s,evalRules,"tactical");
    const bcorner=S.commitBoundaryCorner(s,evalRules,"tactical");
    checkAnchors(s,anchorIds);

    const forcedColourInfo=S.normalForcedColourInfo(s);
    const normalColourCount=COLOURS.filter(c=>s.normalRemaining[c]>0).length;
    if(stats.oneColourFirstActor===null && s.openingRemaining===0 && !s.finalFour && lastNormalColourCount>=2 && normalColourCount===1) stats.oneColourFirstActor=s.currentPlayer;
    if(stats.finalFourFirstActor===null && s.finalFour) stats.finalFourFirstActor=s.currentPlayer;
    lastNormalColourCount=normalColourCount;

    const category=s.finalFour?"final-four":s.openingRemaining>0?"opening-four":forcedColourInfo?"normal-one-colour":"normal-both-colours";
    const actor=s.currentPlayer;
    const preState=stateSignature(s);
    const colourChoice=chooseColourDiagnostic(s,lockedIds,actualRules,evalRules);
    const colour=colourChoice.colour;
    if(!colour) { s.winner="draw"; break; }
    if(colourChoice.mode==="handover") { stats.handovers[actor][colour]++; stats.handoverDecisions[actor]++; }

    const actions=enumerateLocked(s,colour,lockedIds,actualRules);
    if(!actions.length) { s.winner="draw"; break; }
    const choice=chooseActionDiagnostic(s,actions,actualRules,evalRules), action=choice.action;
    if(!action) { s.winner="draw"; break; }

    const evalWins=actions.filter(a=>actionWinsUnder(s,a,evalRules)).length;
    const actualWins=actions.filter(a=>actionWinsUnder(s,a,actualRules)).length;
    if(evalWins>0 && actualWins===0) stats.evalWinButActualNotStates[actor]++;
    if(actualWins>0 && evalWins===0) stats.actualWinButEvalNotStates[actor]++;
    const chosenEvalWin=actionWinsUnder(s,action,evalRules), chosenActualWin=actionWinsUnder(s,action,actualRules);
    if(chosenEvalWin && !chosenActualWin) stats.selectedEvalWinButActualNot[actor]++;
    if(chosenActualWin && !chosenEvalWin) stats.selectedActualWinButEvalNot[actor]++;

    if(keepTrace) trace.push({
      index:trace.length+1, turn:s.turns+1, actor:actorName(actor), category,
      state:preState, plan_seq:seq?JSON.stringify(seq):"", plan_boundary_self:bself?JSON.stringify(bself):"", plan_boundary_corner:bcorner?JSON.stringify(bcorner):"",
      colour, colour_mode:colourChoice.mode, colour_details:colourChoice.details,
      action:actionSignature(action), action_mode:choice.mode, legal_actions:actions.length,
      eval_winning_actions:evalWins, actual_winning_actions:actualWins, chosen_score:choice.chosenScore,
      chosen_eval_win:chosenEvalWin?"yes":"no", chosen_actual_win:chosenActualWin?"yes":"no"
    });

    stats.actorActions[actor]++;
    if(action.type.includes("place")) stats.placements++;
    else if(action.type==="move") { stats.moves++; stats.actorMoves[actor]++; }
    else if(action.type==="jump") { stats.jumps++; stats.actorJumps[actor]++; }

    const result=S.applyAction(s,action,actualRules); checkAnchors(s,anchorIds);
    if(result.ended) {
      winType=result.winType||"";
      winningAction=s.winner==="draw"?"":(action.type.includes("place")?"placement":action.type);
      break;
    }

    if(action.type==="jump" && s.jumpConsequence!=="current") {
      const response=resolveJumpRedeploySplit(s,action,actualRules,evalRules); stats.redeployments++; checkAnchors(s,anchorIds);
      if(keepTrace && trace.length) trace[trace.length-1].redeploy_plan=JSON.stringify(response.plan||{});
      if(response.stage==="redeploy") {
        winType=response.firstResult.winType||""; winningAction="redeploy"; break;
      }
    } else if(action.type==="move" || action.type==="jump") {
      const plan=S.commitMoveResponse(s,evalRules,"tactical");
      if(keepTrace && trace.length) trace[trace.length-1].move_response_plan=JSON.stringify(plan||{});
    }
    checkAnchors(s,anchorIds);
  }

  if(s.winner===null) s.winner="draw";
  return {
    seed:gameSeed, variant:variant.id, actual_rules:variant.actual, evaluator_rules:variant.evaluate,
    winner:s.winner, winner_name:actorName(s.winner), p1_score:scoreForWinner(s.winner), actions:s.turns,
    placements:stats.placements,moves:stats.moves,jumps:stats.jumps,redeployments:stats.redeployments,
    p1_actions:stats.actorActions[0],p2_actions:stats.actorActions[1],p1_moves:stats.actorMoves[0],p2_moves:stats.actorMoves[1],p1_jumps:stats.actorJumps[0],p2_jumps:stats.actorJumps[1],
    p1_handed_black:stats.handovers[0].black,p1_handed_white:stats.handovers[0].white,p2_handed_black:stats.handovers[1].black,p2_handed_white:stats.handovers[1].white,
    p1_handover_decisions:stats.handoverDecisions[0],p2_handover_decisions:stats.handoverDecisions[1],
    p1_eval_win_actual_not_states:stats.evalWinButActualNotStates[0],p2_eval_win_actual_not_states:stats.evalWinButActualNotStates[1],
    p1_actual_win_eval_not_states:stats.actualWinButEvalNotStates[0],p2_actual_win_eval_not_states:stats.actualWinButEvalNotStates[1],
    p1_selected_eval_win_actual_not:stats.selectedEvalWinButActualNot[0],p2_selected_eval_win_actual_not:stats.selectedEvalWinButActualNot[1],
    p1_selected_actual_win_eval_not:stats.selectedActualWinButEvalNot[0],p2_selected_actual_win_eval_not:stats.selectedActualWinButEvalNot[1],
    one_colour_first_actor:stats.oneColourFirstActor===null?"":actorName(stats.oneColourFirstActor),
    final_four_first_actor:stats.finalFourFirstActor===null?"":actorName(stats.finalFourFirstActor),
    reached_final_four:s.reachedFinalFour?"yes":"no", recorded_win_type:winType, winning_action:winningAction,
    max_action_draw:s.winner==="draw"&&s.turns>=maxActions?"yes":"no", trace
  };
}

function newAggregate(v) {
  return {variant:v,n:0,wins:[0,0],draws:0,score:0,actions:0,moves:0,jumps:0,redeployments:0,finalFour:0,
    handovers:[{black:0,white:0},{black:0,white:0}],handoverDecisions:[0,0],
    evalWinActualNot:[0,0],actualWinEvalNot:[0,0],selectedEvalWinActualNot:[0,0],selectedActualWinEvalNot:[0,0],
    oneColourFirst:[0,0],finalFourFirst:[0,0]};
}
function addAggregate(a,g) {
  a.n++; if(g.winner==="draw") a.draws++; else a.wins[g.winner]++; a.score+=g.p1_score; a.actions+=g.actions; a.moves+=g.moves; a.jumps+=g.jumps; a.redeployments+=g.redeployments;
  if(g.reached_final_four==="yes") a.finalFour++;
  a.handovers[0].black+=g.p1_handed_black; a.handovers[0].white+=g.p1_handed_white; a.handovers[1].black+=g.p2_handed_black; a.handovers[1].white+=g.p2_handed_white;
  a.handoverDecisions[0]+=g.p1_handover_decisions; a.handoverDecisions[1]+=g.p2_handover_decisions;
  a.evalWinActualNot[0]+=g.p1_eval_win_actual_not_states; a.evalWinActualNot[1]+=g.p2_eval_win_actual_not_states;
  a.actualWinEvalNot[0]+=g.p1_actual_win_eval_not_states; a.actualWinEvalNot[1]+=g.p2_actual_win_eval_not_states;
  a.selectedEvalWinActualNot[0]+=g.p1_selected_eval_win_actual_not; a.selectedEvalWinActualNot[1]+=g.p2_selected_eval_win_actual_not;
  a.selectedActualWinEvalNot[0]+=g.p1_selected_actual_win_eval_not; a.selectedActualWinEvalNot[1]+=g.p2_selected_actual_win_eval_not;
  if(g.one_colour_first_actor==="P1") a.oneColourFirst[0]++; else if(g.one_colour_first_actor==="P2") a.oneColourFirst[1]++;
  if(g.final_four_first_actor==="P1") a.finalFourFirst[0]++; else if(g.final_four_first_actor==="P2") a.finalFourFirst[1]++;
}
function aggregateRow(a) {
  const n=a.n||1;
  return {
    variant:a.variant.id,actual_rules:a.variant.actual,evaluator_rules:a.variant.evaluate,label:a.variant.label,games:n,
    p1_wins:a.wins[0],p2_wins:a.wins[1],draws:a.draws,p1_score_pct:round4(100*a.score/n),average_actions:round4(a.actions/n),moves:a.moves,jumps:a.jumps,redeployments:a.redeployments,final_four_games:a.finalFour,
    p1_handed_black:a.handovers[0].black,p1_handed_white:a.handovers[0].white,p2_handed_black:a.handovers[1].black,p2_handed_white:a.handovers[1].white,
    p1_handover_decisions:a.handoverDecisions[0],p2_handover_decisions:a.handoverDecisions[1],
    p1_eval_win_actual_not_states:a.evalWinActualNot[0],p2_eval_win_actual_not_states:a.evalWinActualNot[1],
    p1_actual_win_eval_not_states:a.actualWinEvalNot[0],p2_actual_win_eval_not_states:a.actualWinEvalNot[1],
    p1_selected_eval_win_actual_not:a.selectedEvalWinActualNot[0],p2_selected_eval_win_actual_not:a.selectedEvalWinActualNot[1],
    p1_selected_actual_win_eval_not:a.selectedActualWinEvalNot[0],p2_selected_actual_win_eval_not:a.selectedActualWinEvalNot[1],
    one_colour_first_p1:a.oneColourFirst[0],one_colour_first_p2:a.oneColourFirst[1],final_four_first_p1:a.finalFourFirst[0],final_four_first_p2:a.finalFourFirst[1]
  };
}

function firstDivergence(left,right) {
  const lt=left.trace, rt=right.trace, n=Math.max(lt.length,rt.length);
  for(let i=0;i<n;i++) {
    const l=lt[i], r=rt[i];
    if(!l||!r) return {index:i+1,type:"trace-length",left:l||null,right:r||null};
    if(l.state!==r.state) return {index:i+1,type:"response-plan/state",left:l,right:r};
    if(l.colour!==r.colour) return {index:i+1,type:"handed-colour",left:l,right:r};
    if(l.action!==r.action) return {index:i+1,type:"action",left:l,right:r};
    if((l.move_response_plan||"")!==(r.move_response_plan||"") || (l.redeploy_plan||"")!==(r.redeploy_plan||"")) return {index:i+1,type:"response-plan",left:l,right:r};
  }
  return {index:0,type:"none",left:null,right:null};
}

function csvEscape(v) { return `"${String(v??"").replace(/"/g,'""')}"`; }
function writeCsv(filePath,rows) {
  if(!rows.length) { fs.writeFileSync(filePath,"","utf8"); return; }
  const keys=Object.keys(rows[0]);
  fs.writeFileSync(filePath,keys.join(",")+"\r\n"+rows.map(r=>keys.map(k=>csvEscape(r[k])).join(",")).join("\r\n")+"\r\n","utf8");
}
function gameRow(g) { const x={...g}; delete x.winner; delete x.trace; return x; }

selfTest();
if(hasArg("self-test")) { console.log("Lipfty 9 tactical-policy diagnostic self-test passed."); process.exit(0); }

const started=Date.now(); archivePreviousResults();
console.log("");
console.log("Lipfty 9 — tactical-policy diagnostic");
console.log(`Run started: ${fmtDateTime(started)}`);
console.log(`Results: ${outDir}`);
console.log(`Matched seeds: ${seed}-${seed+games-1} (${games})`);
console.log("AA/BB/CC reproduce each ruleset with its own tactical evaluator.");
console.log("BA/CB/CA keep the actual rules but deliberately use a broader evaluator to isolate tactical-policy effects.\n");

const aggregates=new Map(VARIANTS.map(v=>[v.id,newAggregate(v)]));
const allGames=[], traceRows=[], divergenceRows=[];
const pairDefs=[
  ["AA","BB","Standard vs No-Spaced normal tactical"],
  ["BB","BA","B actual rules: B evaluator vs Standard evaluator"],
  ["AA","BA","Standard baseline vs B actual with Standard evaluator"],
  ["CC","CB","C actual rules: C evaluator vs B evaluator"],
  ["CB","CA","C actual rules: B evaluator vs Standard evaluator"],
  ["AA","CA","Standard baseline vs C actual with Standard evaluator"]
];
const pairCounts=new Map(pairDefs.map(([l,r,label])=>[`${l}|${r}`,{left:l,right:r,label,n:0,sameWinner:0,changedWinner:0,divergence:{},divIndexTotal:0,divIndexN:0}]));

for(let i=0;i<games;i++) {
  const gameSeed=seed+i, byId={};
  for(const v of VARIANTS) {
    const g=playVariant(gameSeed,v,true); byId[v.id]=g; allGames.push(gameRow(g)); addAggregate(aggregates.get(v.id),g);
    if(i<traceSeeds) for(const t of g.trace) traceRows.push({seed:gameSeed,variant:v.id,actual_rules:v.actual,evaluator_rules:v.evaluate,...t});
  }
  for(const [l,r,label] of pairDefs) {
    const left=byId[l], right=byId[r], d=firstDivergence(left,right), p=pairCounts.get(`${l}|${r}`); p.n++;
    if(left.winner_name===right.winner_name) p.sameWinner++; else p.changedWinner++;
    p.divergence[d.type]=(p.divergence[d.type]||0)+1; if(d.index) { p.divIndexTotal+=d.index; p.divIndexN++; }
    divergenceRows.push({
      seed:gameSeed,comparison:`${l}->${r}`,label,left_winner:left.winner_name,right_winner:right.winner_name,left_actions:left.actions,right_actions:right.actions,
      first_divergence_index:d.index,divergence_type:d.type,
      actor:d.left?.actor||d.right?.actor||"",category:d.left?.category||d.right?.category||"",
      left_colour:d.left?.colour||"",right_colour:d.right?.colour||"",left_action:d.left?.action||"",right_action:d.right?.action||"",
      left_colour_details:d.left?.colour_details||"",right_colour_details:d.right?.colour_details||"",
      left_eval_winning_actions:d.left?.eval_winning_actions??"",right_eval_winning_actions:d.right?.eval_winning_actions??"",
      left_actual_winning_actions:d.left?.actual_winning_actions??"",right_actual_winning_actions:d.right?.actual_winning_actions??"",
      left_chosen_score:d.left?.chosen_score||"",right_chosen_score:d.right?.chosen_score||""
    });
  }
  if(i===0 || i+1===games || (i+1)%Math.max(1,Math.ceil(games/10))===0) {
    const elapsed=Date.now()-started, eta=(i+1)?elapsed/(i+1)*(games-i-1):0;
    const status=VARIANTS.map(v=>`${v.id} ${round4(100*aggregates.get(v.id).score/aggregates.get(v.id).n)}%`).join(" | ");
    console.log(`  ${fmtClock()} | seeds ${i+1}/${games} | ${status} | elapsed ${fmtDuration(elapsed)} | ETA ${fmtDuration(eta)}`);
  }
}

const summaryRows=VARIANTS.map(v=>aggregateRow(aggregates.get(v.id)));
const pairRows=pairDefs.map(([l,r,label])=>{
  const p=pairCounts.get(`${l}|${r}`); const dtypes=Object.entries(p.divergence).sort((a,b)=>b[1]-a[1]).map(([k,n])=>`${k}:${n}`).join(";");
  const lg=summaryRows.find(x=>x.variant===l), rg=summaryRows.find(x=>x.variant===r);
  return {comparison:`${l}->${r}`,label,seeds:p.n,left_p1_score_pct:lg.p1_score_pct,right_p1_score_pct:rg.p1_score_pct,p1_score_delta_pp:round4(Number(rg.p1_score_pct)-Number(lg.p1_score_pct)),same_winner:p.sameWinner,changed_winner:p.changedWinner,average_first_divergence_action:p.divIndexN?round4(p.divIndexTotal/p.divIndexN):"0.0000",divergence_types:dtypes};
});

const tag=`seed${seed}-games${games}`;
const summaryPath=path.join(outDir,`lipfty9-tactical-policy-summary-${tag}.csv`);
const pairsPath=path.join(outDir,`lipfty9-tactical-policy-pairs-${tag}.csv`);
const gamesPath=path.join(outDir,`lipfty9-tactical-policy-games-${tag}.csv`);
const divergencePath=path.join(outDir,`lipfty9-tactical-policy-divergences-${tag}.csv`);
const tracePath=path.join(outDir,`lipfty9-tactical-policy-trace-${tag}.csv`);
const reportPath=path.join(outDir,`lipfty9-tactical-policy-report-${tag}.txt`);
writeCsv(summaryPath,summaryRows); writeCsv(pairsPath,pairRows); writeCsv(gamesPath,allGames); writeCsv(divergencePath,divergenceRows); writeCsv(tracePath,traceRows);

const report=[
  "Lipfty 9 — Tactical-policy diagnostic",
  `Started: ${fmtDateTime(started)}`,
  `Finished: ${fmtDateTime()}`,
  `Seeds: ${seed}-${seed+games-1} (${games} matched seeds)`,
  "",
  "PURPOSE",
  "Separate the win rules actually enforced from the win rules used by the tactical evaluator.",
  "BA/CB/CA are counterfactual diagnostics only; they are not proposed game rules.",
  "",
  "VARIANTS",
  ...VARIANTS.map(v=>`${v.id}: actual ${v.actual}, evaluator ${v.evaluate} — ${v.label}`),
  "",
  "BALANCE"
];
for(const r of summaryRows) {
  report.push(`${r.variant}: P1 ${r.p1_wins}, P2 ${r.p2_wins}, draws ${r.draws}; P1 score ${r.p1_score_pct}%; avg actions ${r.average_actions}; Final Four ${r.final_four_games}.`);
  report.push(`    Handovers received — P1 black/white ${r.p1_handed_black}/${r.p1_handed_white}; P2 black/white ${r.p2_handed_black}/${r.p2_handed_white}.`);
  if(r.actual_rules!==r.evaluator_rules) report.push(`    Evaluator/actual mismatch states P1/P2: eval-win-only ${r.p1_eval_win_actual_not_states}/${r.p2_eval_win_actual_not_states}; actual-win-only ${r.p1_actual_win_eval_not_states}/${r.p2_actual_win_eval_not_states}.`);
}
report.push("","MATCHED-SEED / FIRST-DIVERGENCE DIAGNOSTICS");
for(const r of pairRows) report.push(`${r.comparison}: P1 score ${r.left_p1_score_pct}% -> ${r.right_p1_score_pct}% (${r.p1_score_delta_pp} pp); changed winner ${r.changed_winner}/${r.seeds}; avg first divergence action ${r.average_first_divergence_action}; ${r.divergence_types}.`);
report.push(
  "",
  "INTERPRETATION GUIDE",
  "If BB is extreme but BA moves back toward AA, the collapse is primarily caused by the tactical evaluator changing when Spaced Square is removed, not by B's actual win condition alone.",
  "If CC is extreme but CB/CA move toward AA, the same conclusion applies to the no-squares tactical evaluation.",
  "First-divergence rows show where matched games stop making the same tactical decisions.",
  "Pinned anchors and all non-winning Lipfty 8 Standard mechanics remain unchanged.",
  "",
  `Total runtime: ${fmtDuration(Date.now()-started)}`
);
fs.writeFileSync(reportPath,report.join("\r\n")+"\r\n","utf8");

console.log("\nSUMMARY");
for(const r of summaryRows) console.log(`  ${r.variant}: P1 score ${r.p1_score_pct}% | P1/P2/draw ${r.p1_wins}/${r.p2_wins}/${r.draws} | avg actions ${r.average_actions}`);
console.log("\nKEY COMPARISONS");
for(const r of pairRows) console.log(`  ${r.comparison}: ${r.left_p1_score_pct}% -> ${r.right_p1_score_pct}% | delta ${r.p1_score_delta_pp} pp | changed winner ${r.changed_winner}/${r.seeds}`);
console.log("");
console.log(`Report: ${reportPath}`);
console.log(`Summary CSV: ${summaryPath}`);
console.log(`Pair CSV: ${pairsPath}`);
console.log(`Divergence CSV: ${divergencePath}`);
console.log(`Per-game CSV: ${gamesPath}`);
console.log(`Trace CSV (first ${Math.min(traceSeeds,games)} seeds): ${tracePath}`);
console.log(`Total time: ${fmtDuration(Date.now()-started)} | finished ${fmtDateTime()}`);
