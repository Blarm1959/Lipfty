"use strict";

const fs = require("fs");
const path = require("path");
const L8 = require("./lipfty8-simulator.js");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i+1] !== undefined ? process.argv[i+1] : fallback;
}

const games = Number(arg("games", "50"));
const seed = Number(arg("seed", "1"));
const maxTurns = Number(arg("max-turns", "500"));
const strength = arg("strength", "tactical");
const outDir = arg("out", "C:\\bxd\\Lipfty-Simulation-Results");
const configArg = arg("config", null);

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
  if(invalid !== undefined) {
    throw new Error(`--config ${invalid} is invalid; valid configuration numbers are 1-${configs.length}.`);
  }

  const seen = new Set();
  const duplicate = numbers.find(n => {
    if(seen.has(n)) return true;
    seen.add(n);
    return false;
  });
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
  let draws=0,totalTurns=0,totalComparableTurns=0,minTurns=Infinity,maxTurnsSeen=0,finalFour=0,moves=0,jumps=0,redeployments=0,maxTurnDraws=0,repetitionGames=0,repetitionEvents=0;

  const progressMilestones = Array.from({length:10},(_,i)=>Math.max(1,Math.ceil(games*(i+1)/10)));
  const start = Date.now();
  let blockStart = start;
  let progressIndex = 0;

  for(let i=0;i<games;i++) {
    const g = L8.playGame({rules,seed:seed+i,strength,maxTurns,openingPolicy,...fixed});
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
    moves += g.moves;
    jumps += g.jumps;
    redeployments += g.redeployPlacements;
    if(g.maxTurnDraw) maxTurnDraws++;
    if(g.repetitionObserved) repetitionGames++;
    repetitionEvents += g.repetitionEvents || 0;

    const hadJump = g.jumps > 0;
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

    const one = g.phaseDiagnostics?.oneColourEntry;
    if(one) {
      oneColourFirst[one.firstActor]++;
      if(g.winner === "draw") oneColourOutcomes[one.firstActor].draws++;
      else oneColourOutcomes[one.firstActor].wins[g.winner]++;
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

    const done=i+1;
    if(progressIndex < progressMilestones.length && done === progressMilestones[progressIndex]) {
      const now=Date.now();
      const scorePct=100*(wins[0]+draws/2)/done;
      process.stdout.write(
        `  ${done}/${games} | Sim ${fmtClock(start)}`+
        ` | ${fmtClock(blockStart)} | ${fmtDuration(now-blockStart)}`+
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
    structural,
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
  console.log(`  Loops/repetition observed: ${r.repetitionGames} games, ${r.repetitionEvents} repeated states | max-turn draws ${r.maxTurnDraws}`);
  console.log(`  Time: ${fmtDuration(r.runtimeMs)} | finished ${fmtFinish(r.finishedAt)}`);
  if(baseline) {
    console.log(`  Vs Lipfty 7: P1 score ${pp(r.p1ScorePct-baseline.p1ScorePct)} | P1 win ${pp(r.p1WinPct-baseline.p1WinPct)} | P2 win ${pp(r.p2WinPct-baseline.p2WinPct)} | Draw ${pp(r.drawPct-baseline.drawPct)}`);
    console.log(`               avg comparable turns ${(r.averageComparableTurns-baseline.averageComparableTurns)>=0?"+":""}${(r.averageComparableTurns-baseline.averageComparableTurns).toFixed(3)} | Final Four ${pp(r.finalFourPct-baseline.finalFourPct)}`);
  }
}

const overallStart=Date.now();
console.log("Lipfty 8 — automatic Opening Four comparison");
console.log(`${games} games each; tactical strength ${strength}; base seed ${seed}; max turns ${maxTurns}.`);
console.log(`Configurations: ${selectedConfigNumbers.join(",")} of ${configs.length}.`);
console.log(`Run started: ${fmtFinish(overallStart)} | progress output: 10% intervals (10 lines per configuration for normal run sizes).`);
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
  const keys=Object.keys(rows[0]);
  const esc=v=>`"${String(v).replace(/"/g,'""')}"`;
  fs.writeFileSync(csvPath,[keys.join(","),...rows.map(row=>keys.map(k=>esc(row[k])).join(","))].join("\r\n")+"\r\n","utf8");
  console.log(`\nDetailed comparison CSV: ${csvPath}`);
} catch(err) {
  console.warn(`\nCSV not written: ${err.message}`);
}

const overallFinished=Date.now();
console.log(`Total run time: ${fmtDuration(overallFinished-overallStart)} | finished ${fmtFinish(overallFinished)}`);
