"use strict";

const fs = require("fs");
const path = require("path");
const L8 = require("./lipfty8-simulator.js");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i+1] !== undefined ? process.argv[i+1] : fallback;
}
function flag(name) { return process.argv.includes(`--${name}`); }

const games = Number(arg("games", "50"));
const seed = Number(arg("seed", "1"));
const maxTurns = Number(arg("max-turns", "500"));
const strength = arg("strength", "tactical");
const outDir = arg("out", "C:\\bxd\\Lipfty-Simulation-Results");
const configArg = arg("config", null);
const trace = flag("trace");

if(!Number.isInteger(games) || games < 1) throw new Error("--games must be a positive integer.");
if(!Number.isInteger(seed)) throw new Error("--seed must be an integer.");
if(!Number.isInteger(maxTurns) || maxTurns < 1) throw new Error("--max-turns must be a positive integer.");
if(!["tactical","random"].includes(strength)) throw new Error("--strength must be tactical or random.");

const rules = {
  allowJump:true,
  allowMove:true,
  allowDiagonal:true,
  allowSquare:true,
  allowSpacedSquare:true,
  spacedSquareOnly:false,
  allowDiamond:false,
  allowSpacedDiamond:false
};

const fixed = {
  jumpPolicy:"opposite",
  responsePolicy:"sequential",
  boundaryPolicy:"responder-choice",
  jumpConsequence:"redeploy-pass",
  finalFourColourPolicy:"tactical",
  oneColourPolicy:"placement-only"
};

const configs = [
  {id:"lipfty7", label:"LIPFTY 7 CONTROL — PLAYER-PLACED OPENING FOUR"},
  {id:"centre-adjacent", label:"1.1 CENTRE — COLOURS ADJACENT"},
  {id:"centre-diagonal", label:"1.2 CENTRE — COLOURS DIAGONAL"},
  {id:"corners-adjacent", label:"2.1 INNER-BOARD CORNERS — COLOURS ADJACENT"},
  {id:"corners-diagonal", label:"2.2 INNER-BOARD CORNERS — COLOURS DIAGONAL"}
];

function parseConfigSelection(value) {
  if(value === null) return null;
  const raw = String(value).trim();
  if(!raw) throw new Error("--config must be a comma-separated list of configuration numbers.");
  const parts = raw.split(",").map(v => v.trim());
  if(parts.some(v => !/^\d+$/.test(v))) {
    throw new Error(`--config must contain only configuration numbers separated by commas (1-${configs.length}).`);
  }
  const numbers = parts.map(Number);
  const invalid = numbers.find(n => n < 1 || n > configs.length);
  if(invalid !== undefined) throw new Error(`--config ${invalid} is invalid; valid configuration numbers are 1-${configs.length}.`);
  const seen = new Set();
  const duplicate = numbers.find(n => seen.has(n) ? true : (seen.add(n), false));
  if(duplicate !== undefined) throw new Error(`--config contains duplicate configuration ${duplicate}.`);
  return numbers;
}

const requestedConfigNumbers = parseConfigSelection(configArg);
const selectedConfigNumbers = requestedConfigNumbers
  ? configs.map((_,i)=>i+1).filter(n => requestedConfigNumbers.includes(n))
  : configs.map((_,i)=>i+1);

function pp(n) { return `${n >= 0 ? "+" : ""}${n.toFixed(2)} pp`; }
function fmtFormation(obj) {
  const order = ["horizontal","vertical","diagonal","square","spaced-square","diamond","spaced-diamond","other"];
  const names = {horizontal:"H",vertical:"V",diagonal:"D",square:"Square","spaced-square":"Spaced Square",diamond:"Diamond","spaced-diamond":"Spaced Diamond",other:"Other"};
  return order.filter(k => obj[k]).map(k => `${names[k]} ${obj[k]}`).join(", ") || "none";
}
function fmtClock(ms=Date.now()) {
  return new Date(ms).toLocaleTimeString("en-GB", {hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false});
}
function fmtFinish(ms) {
  return new Date(ms).toLocaleString("en-GB", {weekday:"short",day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false});
}
function fmtDuration(ms) {
  const total = Math.max(0,Math.round(ms/1000));
  const h = Math.floor(total/3600), m = Math.floor((total%3600)/60), s = total%60;
  if(h) return `${h}h ${m}m ${s}s`;
  if(m) return `${m}m ${s}s`;
  return `${s}s`;
}
function avg(total,count,digits=2) { return count ? (total/count).toFixed(digits) : "n/a"; }
function actorName(value) { return value === 0 ? "P1" : value === 1 ? "P2" : ""; }
function inc(obj,key) { obj[key] = (obj[key] || 0) + 1; }
function fmtCounts(obj) {
  const entries=Object.entries(obj);
  return entries.length ? entries.map(([k,v])=>`${k} ${v}`).join(", ") : "none";
}

function aggregate(openingPolicy) {
  const wins=[0,0], formations={}, resultCategories={"normal-both-colours":[0,0],"normal-one-colour":[0,0],"final-four":[0,0],"opening-four":[0,0]};
  const winningActions={placement:[0,0],move:[0,0],jump:[0,0],redeploy:[0,0]};
  const oneColourFirst=[0,0], finalFourFirst=[0,0], oneColourOutcomes=[{wins:[0,0],draws:0},{wins:[0,0],draws:0}], finalFourOutcomes=[{wins:[0,0],draws:0},{wins:[0,0],draws:0}];
  const turnDist={}, comparableTurnDist={};
  const structural = {
    gamesWithJump:0,
    gamesWithExactlyOneJump:0,
    gamesWithMultipleJumps:0,
    gamesWithRedeploy:0,
    jumpGamesWithEqualRedeployCount:0,
    jumpGamesEndingDiagonal:0,
    jumpGamesNotEndingDiagonal:0,
    diagonalWinsWithoutJump:0,
    p2WinsWithOneColourP2First:0,
    p2WinsWithoutOneColourP2First:0,
    oneColourP2FirstNotP2Win:0
  };
  const detail = {
    movesByPlayer:[0,0], jumpsByPlayer:[0,0], placementsByPlayer:[0,0],
    p2MoveGames:0, p2MoveGamesWonByP1:0, p2MoveGamesWonByP2:0, p2MoveGamesDrawn:0,
    p2MovesInP1Wins:0, p2MovesInP2Wins:0,
    jumpEvents:0, jumpTurnTotal:0, jumpTurnMin:Infinity, jumpTurnMax:0, jumpActor:[0,0],
    jumpDiagonalGames:0, jumpToWinGapTotal:0, jumpToWinGapMin:Infinity, jumpToWinGapMax:0,
    jumpDiagonalWinningActions:{}, jumpDiagonalWinners:[0,0],
    oneColourEntries:0, oneColourTurnTotal:0, oneColourTurnMin:Infinity, oneColourTurnMax:0,
    oneColourCauses:{}, oneColourTransitionActors:[0,0], oneColourRemainingColours:{black:0,white:0}
  };
  const traceRows=[];
  let draws=0,totalTurns=0,totalComparableTurns=0,minTurns=Infinity,maxTurnsSeen=0,finalFour=0,moves=0,jumps=0,redeployments=0,maxTurnDraws=0,repetitionGames=0,repetitionEvents=0;

  const progressMilestones = Array.from({length:10},(_,i)=>Math.max(1,Math.ceil(games*(i+1)/10)));
  const start = Date.now();
  let blockStart = start;
  let progressIndex = 0;

  for(let i=0;i<games;i++) {
    const gameSeed=seed+i;
    const g = L8.playGame({rules,seed:gameSeed,strength,maxTurns,openingPolicy,...fixed});
    if(g.winner === "draw") draws++; else wins[g.winner]++;
    if(g.winner !== "draw") {
      if(g.winType) formations[g.winType] = (formations[g.winType] || 0) + 1;
      if(g.resultCategory in resultCategories) resultCategories[g.resultCategory][g.winner]++;
      if(g.winningActionType && winningActions[g.winningActionType]) winningActions[g.winningActionType][g.winner]++;
    }

    totalTurns += g.turns;
    totalComparableTurns += g.comparableTurns;
    minTurns = Math.min(minTurns,g.turns);
    maxTurnsSeen = Math.max(maxTurnsSeen,g.turns);
    turnDist[g.turns] = (turnDist[g.turns] || 0) + 1;
    comparableTurnDist[g.comparableTurns] = (comparableTurnDist[g.comparableTurns] || 0) + 1;
    finalFour += g.reachedFinalFour ? 1 : 0;
    moves += g.moves; jumps += g.jumps; redeployments += g.redeployPlacements;
    if(g.maxTurnDraw) maxTurnDraws++;
    if(g.repetitionObserved) repetitionGames++;
    repetitionEvents += g.repetitionEvents || 0;

    const movesByPlayer=g.movesByPlayer || [0,0];
    const jumpsByPlayer=g.jumpsByPlayer || [0,0];
    const placementsByPlayer=g.placementsByPlayer || [0,0];
    for(let p=0;p<2;p++) {
      detail.movesByPlayer[p]+=movesByPlayer[p]||0;
      detail.jumpsByPlayer[p]+=jumpsByPlayer[p]||0;
      detail.placementsByPlayer[p]+=placementsByPlayer[p]||0;
    }
    if((movesByPlayer[1]||0)>0) {
      detail.p2MoveGames++;
      if(g.winner===0) detail.p2MoveGamesWonByP1++;
      else if(g.winner===1) detail.p2MoveGamesWonByP2++;
      else detail.p2MoveGamesDrawn++;
    }
    if(g.winner===0) detail.p2MovesInP1Wins += movesByPlayer[1]||0;
    if(g.winner===1) detail.p2MovesInP2Wins += movesByPlayer[1]||0;

    const jumpEvents=g.jumpEvents || [];
    const hadJump = jumpEvents.length > 0 || g.jumps > 0;
    const diagonalWin = g.winner !== "draw" && g.winType === "diagonal";
    if(hadJump) {
      structural.gamesWithJump++;
      if(g.jumps === 1) structural.gamesWithExactlyOneJump++;
      else structural.gamesWithMultipleJumps++;
      if(g.jumps === g.redeployPlacements) structural.jumpGamesWithEqualRedeployCount++;
      if(diagonalWin) structural.jumpGamesEndingDiagonal++;
      else structural.jumpGamesNotEndingDiagonal++;
    }
    if(g.redeployPlacements > 0) structural.gamesWithRedeploy++;
    if(diagonalWin && !hadJump) structural.diagonalWinsWithoutJump++;

    for(const ev of jumpEvents) {
      detail.jumpEvents++;
      detail.jumpTurnTotal += ev.turn;
      detail.jumpTurnMin = Math.min(detail.jumpTurnMin,ev.turn);
      detail.jumpTurnMax = Math.max(detail.jumpTurnMax,ev.turn);
      if(ev.actor===0 || ev.actor===1) detail.jumpActor[ev.actor]++;
    }
    if(diagonalWin && jumpEvents.length) {
      const lastJump=jumpEvents[jumpEvents.length-1];
      const gap=g.turns-lastJump.turn;
      detail.jumpDiagonalGames++;
      detail.jumpToWinGapTotal += gap;
      detail.jumpToWinGapMin = Math.min(detail.jumpToWinGapMin,gap);
      detail.jumpToWinGapMax = Math.max(detail.jumpToWinGapMax,gap);
      inc(detail.jumpDiagonalWinningActions,g.winningActionType || "unknown");
      if(g.winner===0 || g.winner===1) detail.jumpDiagonalWinners[g.winner]++;
    }

    const one = g.phaseDiagnostics?.oneColourEntry;
    if(one) {
      oneColourFirst[one.firstActor]++;
      if(g.winner === "draw") oneColourOutcomes[one.firstActor].draws++;
      else oneColourOutcomes[one.firstActor].wins[g.winner]++;
      detail.oneColourEntries++;
      detail.oneColourTurnTotal += one.turn;
      detail.oneColourTurnMin = Math.min(detail.oneColourTurnMin,one.turn);
      detail.oneColourTurnMax = Math.max(detail.oneColourTurnMax,one.turn);
      inc(detail.oneColourCauses,one.cause || "unknown");
      if(one.transitionActor===0 || one.transitionActor===1) detail.oneColourTransitionActors[one.transitionActor]++;
      if(one.remainingColour) inc(detail.oneColourRemainingColours,one.remainingColour);
    }
    if(g.winner === 1) {
      if(one?.firstActor === 1) structural.p2WinsWithOneColourP2First++;
      else structural.p2WinsWithoutOneColourP2First++;
    }
    if(one?.firstActor === 1 && g.winner !== 1) structural.oneColourP2FirstNotP2Win++;

    const ff = g.phaseDiagnostics?.finalFourEntry;
    if(ff) {
      finalFourFirst[ff.firstActor]++;
      if(g.winner === "draw") finalFourOutcomes[ff.firstActor].draws++;
      else finalFourOutcomes[ff.firstActor].wins[g.winner]++;
    }

    if(trace) {
      const lastJump=jumpEvents.length ? jumpEvents[jumpEvents.length-1] : null;
      traceRows.push({
        seed:gameSeed,
        winner:g.winner === "draw" ? "draw" : actorName(g.winner),
        turns:g.turns,
        comparable_turns:g.comparableTurns,
        win_type:g.winType || "",
        winning_action:g.winningActionType || "",
        p1_moves:movesByPlayer[0]||0,
        p2_moves:movesByPlayer[1]||0,
        p1_jumps:jumpsByPlayer[0]||0,
        p2_jumps:jumpsByPlayer[1]||0,
        jump_count:jumpEvents.length,
        jump_turns:jumpEvents.map(e=>e.turn).join(";"),
        jump_actors:jumpEvents.map(e=>actorName(e.actor)).join(";"),
        jump_colours:jumpEvents.map(e=>e.colour).join(";"),
        jump_from:jumpEvents.map(e=>e.from).join(";"),
        jump_over:jumpEvents.map(e=>e.over).join(";"),
        jump_to:jumpEvents.map(e=>e.to).join(";"),
        actions_after_last_jump:lastJump ? g.turns-lastJump.turn : "",
        one_colour_turn:one?.turn ?? "",
        one_colour_first_actor:one ? actorName(one.firstActor) : "",
        one_colour_transition_actor:one ? actorName(one.transitionActor) : "",
        one_colour_cause:one?.cause || "",
        one_colour_remaining:one?.remainingColour || "",
        one_colour_black_left:one?.remainingBlack ?? "",
        one_colour_white_left:one?.remainingWhite ?? ""
      });
    }

    const done=i+1;
    if(progressIndex < progressMilestones.length && done === progressMilestones[progressIndex]) {
      const now=Date.now();
      const scorePct=100*(wins[0]+draws/2)/done;
      process.stdout.write(
        `  ${done}/${games} | ${fmtClock(now)} | ${fmtDuration(now-blockStart)} | ${fmtDuration(now-start)}`+
        ` | P1 ${wins[0]} P2 ${wins[1]} D${draws} | Score ${scorePct.toFixed(1)}%\n`
      );
      blockStart=now;
      progressIndex++;
    }
  }

  const finishedAt=Date.now();
  return {
    openingPolicy,games,wins,draws,
    p1WinPct:100*wins[0]/games,p2WinPct:100*wins[1]/games,drawPct:100*draws/games,
    p1ScorePct:100*(wins[0]+draws/2)/games,
    averageTurns:totalTurns/games,averageComparableTurns:totalComparableTurns/games,minTurns,maxTurns:maxTurnsSeen,
    finalFourPct:100*finalFour/games,moves,jumps,redeployments,
    movesPerGame:moves/games,jumpsPerGame:jumps/games,redeploymentsPerGame:redeployments/games,
    formations,resultCategories,winningActions,
    oneColourFirst,finalFourFirst,oneColourOutcomes,finalFourOutcomes,
    structural,detail,traceRows,
    maxTurnDraws,repetitionGames,repetitionEvents,turnDist,comparableTurnDist,
    runtimeMs:finishedAt-start,finishedAt
  };
}

function printSummary(c, r, baseline=null) {
  console.log(`\n${c.label}`);
  console.log(`  Result: P1 ${r.wins[0]} (${r.p1WinPct.toFixed(2)}%), P2 ${r.wins[1]} (${r.p2WinPct.toFixed(2)}%), Draw ${r.draws} (${r.drawPct.toFixed(2)}%) | P1 score ${r.p1ScorePct.toFixed(2)}%`);
  console.log(`  Turns: avg ${r.averageTurns.toFixed(3)}, min ${r.minTurns}, max ${r.maxTurns} | comparable board-development avg ${r.averageComparableTurns.toFixed(3)}`);
  console.log(`  Actions: Move ${r.moves} (${r.movesPerGame.toFixed(3)}/game), Jump ${r.jumps} (${r.jumpsPerGame.toFixed(3)}/game), redeployments ${r.redeployments} (${r.redeploymentsPerGame.toFixed(3)}/game)`);
  console.log(`  Final Four reached: ${r.finalFourPct.toFixed(2)}%`);
  console.log(`  Winning actions: placement ${r.winningActions.placement[0]}/${r.winningActions.placement[1]}, move ${r.winningActions.move[0]}/${r.winningActions.move[1]}, jump ${r.winningActions.jump[0]}/${r.winningActions.jump[1]}, redeploy ${r.winningActions.redeploy[0]}/${r.winningActions.redeploy[1]}`);
  console.log(`  Formations: ${fmtFormation(r.formations)}`);
  console.log(`  Phase entry — one-colour first actor P1/P2: ${r.oneColourFirst[0]}/${r.oneColourFirst[1]} | Final Four first actor P1/P2: ${r.finalFourFirst[0]}/${r.finalFourFirst[1]}`);
  console.log(`  Structural diagnostics — jump games ${r.structural.gamesWithJump} (exactly 1: ${r.structural.gamesWithExactlyOneJump}, 2+: ${r.structural.gamesWithMultipleJumps}); jump/redeploy counts equal in ${r.structural.jumpGamesWithEqualRedeployCount}/${r.structural.gamesWithJump} jump games`);
  console.log(`  Jump/diagonal overlap — jump games ending diagonal ${r.structural.jumpGamesEndingDiagonal}; jump games not diagonal ${r.structural.jumpGamesNotEndingDiagonal}; diagonal wins without a jump ${r.structural.diagonalWinsWithoutJump}`);
  console.log(`  P2/one-colour overlap — P2 wins with P2 first in one-colour ${r.structural.p2WinsWithOneColourP2First}; P2 wins without it ${r.structural.p2WinsWithoutOneColourP2First}; P2-first one-colour games not won by P2 ${r.structural.oneColourP2FirstNotP2Win}`);
  console.log(`  Player action detail — moves P1/P2 ${r.detail.movesByPlayer[0]}/${r.detail.movesByPlayer[1]}, jumps P1/P2 ${r.detail.jumpsByPlayer[0]}/${r.detail.jumpsByPlayer[1]}`);
  console.log(`  P2 move detail — P2 moved in ${r.detail.p2MoveGames} games: P1 won ${r.detail.p2MoveGamesWonByP1}, P2 won ${r.detail.p2MoveGamesWonByP2}, draws ${r.detail.p2MoveGamesDrawn}; P2 move actions in P1/P2 wins ${r.detail.p2MovesInP1Wins}/${r.detail.p2MovesInP2Wins}`);
  if(r.detail.jumpEvents) {
    console.log(`  Jump timing — ${r.detail.jumpEvents} jumps; turn avg ${avg(r.detail.jumpTurnTotal,r.detail.jumpEvents)}, range ${r.detail.jumpTurnMin}-${r.detail.jumpTurnMax}; actor P1/P2 ${r.detail.jumpActor[0]}/${r.detail.jumpActor[1]}`);
  } else {
    console.log(`  Jump timing — no jumps`);
  }
  if(r.detail.jumpDiagonalGames) {
    console.log(`  After-jump diagonal wins — ${r.detail.jumpDiagonalGames}; winning action ${fmtCounts(r.detail.jumpDiagonalWinningActions)}; winner P1/P2 ${r.detail.jumpDiagonalWinners[0]}/${r.detail.jumpDiagonalWinners[1]}; actions after last jump avg ${avg(r.detail.jumpToWinGapTotal,r.detail.jumpDiagonalGames)}, range ${r.detail.jumpToWinGapMin}-${r.detail.jumpToWinGapMax}`);
  }
  if(r.detail.oneColourEntries) {
    console.log(`  One-colour timing — ${r.detail.oneColourEntries} entries; turn avg ${avg(r.detail.oneColourTurnTotal,r.detail.oneColourEntries)}, range ${r.detail.oneColourTurnMin}-${r.detail.oneColourTurnMax}; transition actor P1/P2 ${r.detail.oneColourTransitionActors[0]}/${r.detail.oneColourTransitionActors[1]}; causes ${fmtCounts(r.detail.oneColourCauses)}`);
  }
  console.log(`  Loops/repetition observed: ${r.repetitionGames} games, ${r.repetitionEvents} repeated states | max-turn draws ${r.maxTurnDraws}`);
  console.log(`  Time: ${fmtDuration(r.runtimeMs)} | finished ${fmtFinish(r.finishedAt)}`);
  if(baseline) {
    console.log(`  Vs Lipfty 7: P1 score ${pp(r.p1ScorePct-baseline.p1ScorePct)} | P1 win ${pp(r.p1WinPct-baseline.p1WinPct)} | P2 win ${pp(r.p2WinPct-baseline.p2WinPct)} | Draw ${pp(r.drawPct-baseline.drawPct)}`);
    console.log(`               avg comparable turns ${(r.averageComparableTurns-baseline.averageComparableTurns)>=0?"+":""}${(r.averageComparableTurns-baseline.averageComparableTurns).toFixed(3)} | Final Four ${pp(r.finalFourPct-baseline.finalFourPct)}`);
  }
}

function writeCsv(filePath, rows) {
  if(!rows.length) return;
  const keys=Object.keys(rows[0]);
  const esc=v=>`"${String(v ?? "").replace(/"/g,'""')}"`;
  fs.writeFileSync(filePath,[keys.join(","),...rows.map(row=>keys.map(k=>esc(row[k])).join(","))].join("\r\n")+"\r\n","utf8");
}

const overallStart=Date.now();
console.log("Lipfty 8 — automatic Opening Four comparison");
console.log(`${games} games each; tactical strength ${strength}; base seed ${seed}; max turns ${maxTurns}.`);
console.log(`Configurations: ${selectedConfigNumbers.join(",")} of ${configs.length}.`);
console.log(`Run started: ${fmtFinish(overallStart)} | progress output: 10% intervals (10 lines per configuration for normal run sizes).`);
if(trace) console.log("Per-game structural trace: ON (--trace).");
console.log("Fixed Lipfty 7 Standard rules: Move ON, opposite-colour Jump, redeploy-pass, sequential Move response, responder-choice boundary, one-colour placement-only, player/tactical Final Four choice, H/V/Diagonal + tight/spaced square wins, no diamonds.");
console.log("Each configuration uses exactly the same seed range.");
console.log("For automatic openings, 'avg turns' counts player turns after setup; 'comparable board-development avg' adds the four setup placements back so game length can also be compared directly with Lipfty 7.");

const results=[];
let baseline=null;
for(const [selectedIndex,configNumber] of selectedConfigNumbers.entries()) {
  const configIndex=configNumber-1;
  const c=configs[configIndex];
  console.log(`\nStarting ${selectedIndex+1}/${selectedConfigNumbers.length} (${configNumber}) ${c.label} at ${fmtClock()}...`);
  const r=aggregate(c.id);
  const result={configNumber,...c,...r};
  results.push(result);
  if(configNumber === 1) baseline=result;
  printSummary(c,r,baseline);
}

console.log("\nRANKING BY DISTANCE FROM 50% P1 SCORE");
const ranked = baseline ? results.filter(r=>r.configNumber !== 1) : results;
for(const [i,r] of ranked.sort((a,b)=>Math.abs(a.p1ScorePct-50)-Math.abs(b.p1ScorePct-50)).entries()) {
  const vs = baseline ? `, vs Lipfty 7 ${pp(r.p1ScorePct-baseline.p1ScorePct)}` : "";
  console.log(`  ${i+1}. ${r.label}: P1 score ${r.p1ScorePct.toFixed(2)}%, distance ${Math.abs(r.p1ScorePct-50).toFixed(2)} pp${vs}`);
}

const rows=results.map(r=>({
  config_number:r.configNumber,opening:r.openingPolicy,label:r.label,games:r.games,p1_wins:r.wins[0],p2_wins:r.wins[1],draws:r.draws,
  p1_win_pct:r.p1WinPct.toFixed(4),p2_win_pct:r.p2WinPct.toFixed(4),draw_pct:r.drawPct.toFixed(4),p1_score_pct:r.p1ScorePct.toFixed(4),
  distance_from_50_pp:Math.abs(r.p1ScorePct-50).toFixed(4),delta_vs_lipfty7_score_pp:baseline ? (r.p1ScorePct-baseline.p1ScorePct).toFixed(4) : "",
  average_turns:r.averageTurns.toFixed(4),average_comparable_turns:r.averageComparableTurns.toFixed(4),final_four_pct:r.finalFourPct.toFixed(4),
  moves:r.moves,jumps:r.jumps,redeployments:r.redeployments,moves_per_game:r.movesPerGame.toFixed(4),jumps_per_game:r.jumpsPerGame.toFixed(4),redeployments_per_game:r.redeploymentsPerGame.toFixed(4),
  p1_moves:r.detail.movesByPlayer[0],p2_moves:r.detail.movesByPlayer[1],p1_jumps:r.detail.jumpsByPlayer[0],p2_jumps:r.detail.jumpsByPlayer[1],
  p2_move_games:r.detail.p2MoveGames,p2_move_games_won_p1:r.detail.p2MoveGamesWonByP1,p2_move_games_won_p2:r.detail.p2MoveGamesWonByP2,
  jump_turn_avg:r.detail.jumpEvents ? (r.detail.jumpTurnTotal/r.detail.jumpEvents).toFixed(4) : "",jump_turn_min:r.detail.jumpEvents?r.detail.jumpTurnMin:"",jump_turn_max:r.detail.jumpEvents?r.detail.jumpTurnMax:"",
  jump_after_gap_avg:r.detail.jumpDiagonalGames ? (r.detail.jumpToWinGapTotal/r.detail.jumpDiagonalGames).toFixed(4) : "",jump_after_gap_min:r.detail.jumpDiagonalGames?r.detail.jumpToWinGapMin:"",jump_after_gap_max:r.detail.jumpDiagonalGames?r.detail.jumpToWinGapMax:"",
  jump_diagonal_win_by_placement:r.detail.jumpDiagonalWinningActions.placement||0,jump_diagonal_win_by_move:r.detail.jumpDiagonalWinningActions.move||0,
  one_colour_turn_avg:r.detail.oneColourEntries ? (r.detail.oneColourTurnTotal/r.detail.oneColourEntries).toFixed(4) : "",one_colour_turn_min:r.detail.oneColourEntries?r.detail.oneColourTurnMin:"",one_colour_turn_max:r.detail.oneColourEntries?r.detail.oneColourTurnMax:"",
  max_turn_draws:r.maxTurnDraws,repetition_games:r.repetitionGames,repetition_events:r.repetitionEvents,
  horizontal:r.formations.horizontal||0,vertical:r.formations.vertical||0,diagonal:r.formations.diagonal||0,square:r.formations.square||0,spaced_square:r.formations["spaced-square"]||0,
  one_colour_first_p1:r.oneColourFirst[0],one_colour_first_p2:r.oneColourFirst[1],final_four_first_p1:r.finalFourFirst[0],final_four_first_p2:r.finalFourFirst[1],
  jump_games:r.structural.gamesWithJump,one_jump_games:r.structural.gamesWithExactlyOneJump,multi_jump_games:r.structural.gamesWithMultipleJumps,
  jump_redeploy_equal_games:r.structural.jumpGamesWithEqualRedeployCount,jump_games_ending_diagonal:r.structural.jumpGamesEndingDiagonal,
  jump_games_not_diagonal:r.structural.jumpGamesNotEndingDiagonal,diagonal_wins_without_jump:r.structural.diagonalWinsWithoutJump,
  p2_wins_with_one_colour_p2_first:r.structural.p2WinsWithOneColourP2First,p2_wins_without_one_colour_p2_first:r.structural.p2WinsWithoutOneColourP2First,
  one_colour_p2_first_not_p2_win:r.structural.oneColourP2FirstNotP2Win,
  runtime_seconds:(r.runtimeMs/1000).toFixed(1),finished_at:new Date(r.finishedAt).toISOString()
}));

try {
  fs.mkdirSync(outDir,{recursive:true});
  const configTag=requestedConfigNumbers ? `-config${selectedConfigNumbers.join("-")}` : "";
  const csvPath=path.join(outDir,`lipfty8-opening-comparison-${strength}-${games}-seed${seed}${configTag}.csv`);
  writeCsv(csvPath,rows);
  console.log(`\nDetailed comparison CSV: ${csvPath}`);

  if(trace) {
    const traceRows=results.flatMap(r=>r.traceRows.map(row=>({config_number:r.configNumber,opening:r.openingPolicy,...row})));
    const tracePath=path.join(outDir,`lipfty8-structure-trace-${strength}-${games}-seed${seed}${configTag}.csv`);
    writeCsv(tracePath,traceRows);
    console.log(`Structural trace CSV: ${tracePath}`);
  }
} catch(err) {
  console.warn(`\nCSV not written: ${err.message}`);
}

const overallFinished=Date.now();
console.log(`Total run time: ${fmtDuration(overallFinished-overallStart)} | finished ${fmtFinish(overallFinished)}`);
