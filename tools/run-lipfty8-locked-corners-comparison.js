"use strict";

// Lipfty 8 Config 5 vs Config 6 comparison.
//
// Config 5: current 2.2 automatic inner-board corners, colours diagonal.
// Config 6: same opening, but the four automatic opening pieces are permanent
// anchors. They cannot be the origin of a Move/Jump and cannot be jumped over,
// because Lipfty 7 redeploys a jumped piece and that would move an anchor.
// They otherwise count normally for all winning patterns.
//
// Analysis only. No playable-game rule is changed.

const fs = require("fs");
const path = require("path");
const L8 = require("./lipfty8-simulator.js");
const S = require("./lipfty7-simulator.js");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}

const games = Number(arg("games", "5000"));
const seed = Number(arg("seed", "1"));
const maxActions = Number(arg("max-turns", "500")); // historical CLI name; counts actions
const strength = arg("strength", "tactical");

function defaultOutDir() {
  const drive = fs.existsSync("D:\\") ? "D:" : "C:";
  return path.win32.join(`${drive}\\`, "bxd", "Blarm1959", "Lipfty", "Simulation-Results");
}
const outDir = arg("out", defaultOutDir());

if(!Number.isInteger(games) || games < 1) throw new Error("--games must be a positive integer.");
if(!Number.isInteger(seed)) throw new Error("--seed must be an integer.");
if(!Number.isInteger(maxActions) || maxActions < 1) throw new Error("--max-turns must be a positive integer.");
if(!["tactical", "random"].includes(strength)) throw new Error("--strength must be tactical or random.");

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

const CONFIGS = [
  {number:5, id:"config5", label:"CONFIG 5 — DIAGONAL CORNERS, OPENING PIECES MOBILE", locked:false},
  {number:6, id:"config6", label:"CONFIG 6 — DIAGONAL CORNERS, OPENING PIECES LOCKED", locked:true}
];

const ANCHOR_SQUARES = [0, 5, 30, 35];

function fmtClock(ts = Date.now()) {
  return new Date(ts).toLocaleTimeString("en-GB", {
    hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false
  });
}
function fmtDateTime(ts = Date.now()) {
  return new Date(ts).toLocaleString("en-GB", {
    weekday:"short", day:"2-digit", month:"short",
    hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false
  });
}
function fmtDuration(ms) {
  let s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600); s %= 3600;
  const m = Math.floor(s / 60); s %= 60;
  if(h) return `${h}h ${m}m ${s}s`;
  if(m) return `${m}m ${s}s`;
  return `${s}s`;
}
function pct(n, d) { return d ? 100 * n / d : 0; }
function actorName(v) { return v === 0 ? "P1" : v === 1 ? "P2" : "draw"; }
function normalReserveCount(s) { return s.normalRemaining.black + s.normalRemaining.white; }
function normalColourCount(s) { return ["black", "white"].filter(c => s.normalRemaining[c] > 0).length; }
function actionWins(s, a) { return !!S.fastCheckWin(S.boardAfter(s, a), rules, a.to); }
function actionKey(a) { return [a.type, a.colour, a.from ?? "", a.over ?? "", a.to ?? ""].join(":"); }

function safeArchiveDestination(oldDir, fileName) {
  const direct = path.join(oldDir, fileName);
  if(!fs.existsSync(direct)) return direct;
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  const d = new Date();
  const stamp = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
    "-",
    String(d.getHours()).padStart(2, "0"),
    String(d.getMinutes()).padStart(2, "0"),
    String(d.getSeconds()).padStart(2, "0")
  ].join("");
  let candidate = path.join(oldDir, `${base}-${stamp}${ext}`);
  let n = 2;
  while(fs.existsSync(candidate)) candidate = path.join(oldDir, `${base}-${stamp}-${n++}${ext}`);
  return candidate;
}

function archivePreviousResults() {
  fs.mkdirSync(outDir, {recursive:true});
  const oldDir = path.join(outDir, "old");
  fs.mkdirSync(oldDir, {recursive:true});
  console.log("Archiving previous results...");
  let moved = 0;
  for(const entry of fs.readdirSync(outDir, {withFileTypes:true})) {
    if(!entry.isFile()) continue;
    const src = path.join(outDir, entry.name);
    const dst = safeArchiveDestination(oldDir, entry.name);
    fs.renameSync(src, dst);
    moved++;
  }
  console.log(`  moved ${moved} file${moved === 1 ? "" : "s"} to ${oldDir}`);
  return oldDir;
}

function lockedIdsFromState(s) {
  const ids = new Set();
  for(const sq of ANCHOR_SQUARES) {
    const p = s.board[sq];
    if(!p) throw new Error(`Config 6 anchor square ${sq} is unexpectedly empty at setup.`);
    ids.add(p.id);
  }
  if(ids.size !== 4) throw new Error("Config 6 did not create four distinct opening anchor piece IDs.");
  return ids;
}

function isLockedAction(s, a, lockedIds) {
  if(a.type !== "move" && a.type !== "jump") return false;
  const mover = s.board[a.from];
  if(mover && lockedIds.has(mover.id)) return true;
  if(a.type === "jump") {
    const jumped = s.board[a.over];
    if(jumped && lockedIds.has(jumped.id)) return true;
  }
  return false;
}

function enumerateLocked(s, colour, lockedIds) {
  return S.enumerateActions(s, colour, rules).filter(a => !isLockedAction(s, a, lockedIds));
}

function immediateWinningLocked(s, colour, lockedIds) {
  return enumerateLocked(s, colour, lockedIds).filter(a => actionWins(s, a));
}

function handoverDangerLocked(s, colour, lockedIds) {
  const actions = enumerateLocked(s, colour, lockedIds);
  if(!actions.length) return -Infinity;
  let best = -Infinity;
  for(const a of actions) best = Math.max(best, S.actionPositionalScore(s, a, rules));
  return best;
}

function chooseColourLocked(s, lockedIds) {
  if(s.forcedQueue.length) return s.forcedQueue[0].colour;
  const colours = S.availableColours(s);
  if(!colours.length) return null;
  if(colours.length === 1) return colours[0];

  // Final Four is placement-only, so the standard chooser is identical and
  // can retain the frozen Lipfty 7 tactical colour policy exactly.
  if(s.finalFour) return S.chooseColour(s, rules, strength, fixed.finalFourColourPolicy);
  if(strength === "random" || s.openingRemaining > 0) {
    return colours[Math.floor(s.rng() * colours.length)];
  }

  const safe = colours.filter(c => immediateWinningLocked(s, c, lockedIds).length === 0);
  const candidates = safe.length ? safe : colours;
  let best = [], bestDanger = Infinity;
  for(const c of candidates) {
    const danger = handoverDangerLocked(s, c, lockedIds);
    if(danger < bestDanger - 1e-9) {
      bestDanger = danger;
      best = [c];
    } else if(Math.abs(danger - bestDanger) < 1e-9) {
      best.push(c);
    }
  }
  return best[Math.floor(s.rng() * best.length)];
}

function chooseActionLocked(s, colour, lockedIds) {
  const actions = enumerateLocked(s, colour, lockedIds);
  if(!actions.length) return null;
  const planned = s.forcedQueue[0]?.plannedTo;
  if(planned !== undefined) {
    const action = actions.find(a => a.to === planned);
    if(action) return action;
  }
  if(strength === "random") return actions[Math.floor(s.rng() * actions.length)];
  const wins = actions.filter(a => actionWins(s, a));
  if(wins.length) return wins[Math.floor(s.rng() * wins.length)];

  let best = [], bestScore = -Infinity;
  for(const a of actions) {
    const score = S.actionPositionalScore(s, a, rules) + s.rng() * 0.01;
    if(score > bestScore + 1e-9) {
      bestScore = score;
      best = [a];
    } else if(Math.abs(score - bestScore) < 1e-9) {
      best.push(a);
    }
  }
  return best[Math.floor(s.rng() * best.length)];
}

function checkAnchors(s, anchorIds) {
  for(let i = 0; i < ANCHOR_SQUARES.length; i++) {
    const sq = ANCHOR_SQUARES[i];
    const p = s.board[sq];
    if(!p || p.id !== anchorIds[i]) {
      throw new Error(`Config 6 anchor integrity failure at R${Math.floor(sq / 6) + 1}C${sq % 6 + 1}.`);
    }
  }
}

function newPhaseDiagnostics() {
  return {oneColourEntry:null, finalFourEntry:null};
}

function recordPhaseTransition(d, s, beforeColours, beforeReserve, actor, action) {
  const afterColours = normalColourCount(s);
  const afterReserve = normalReserveCount(s);
  if(!d.oneColourEntry && beforeColours >= 2 && afterColours === 1 && !s.finalFour) {
    d.oneColourEntry = {
      firstActor:s.currentPlayer,
      transitionActor:actor,
      turn:s.turns,
      remainingColour:["black", "white"].find(c => s.normalRemaining[c] > 0),
      cause:action.type === "place" ? "placement" : action.type
    };
  }
  if(!d.finalFourEntry && beforeReserve > 0 && afterReserve === 0 && s.finalFour) {
    d.finalFourEntry = {firstActor:s.currentPlayer, transitionActor:actor, turn:s.turns};
  }
}

function finishLocked(s, stats, phaseDiagnostics, winType, resultCategory, winningActionType, maxTurnDraw) {
  checkAnchors(s, stats.anchorIds);
  return {
    winner:s.winner ?? "draw",
    turns:s.turns,
    comparableTurns:s.turns + 4,
    reachedFinalFour:s.reachedFinalFour,
    winType:winType || null,
    resultCategory:s.winner === "draw" ? "draw" : resultCategory,
    winningActionType:s.winner === "draw" ? null : winningActionType,
    moves:stats.moves,
    jumps:stats.jumps,
    redeployPlacements:stats.redeployPlacements,
    placements:stats.placements,
    movesByPlayer:stats.movesByPlayer,
    jumpsByPlayer:stats.jumpsByPlayer,
    placementsByPlayer:stats.placementsByPlayer,
    phaseDiagnostics,
    maxTurnDraw,
    anchorIntegrity:true
  };
}

function playLockedGame(gameSeed) {
  const s = L8.prepareState(
    gameSeed,
    fixed.jumpPolicy,
    fixed.responsePolicy,
    fixed.boundaryPolicy,
    fixed.jumpConsequence,
    fixed.oneColourPolicy,
    fixed.openingPolicy
  );
  const lockedIds = lockedIdsFromState(s);
  const anchorIds = ANCHOR_SQUARES.map(sq => s.board[sq].id);
  const stats = {
    placements:0, moves:0, jumps:0, redeployPlacements:0,
    placementsByPlayer:[0,0], movesByPlayer:[0,0], jumpsByPlayer:[0,0], anchorIds
  };
  const phaseDiagnostics = newPhaseDiagnostics();
  checkAnchors(s, anchorIds);

  while(s.winner === null && s.turns < maxActions) {
    S.commitSequentialSecond(s, rules, strength);
    S.commitBoundarySelfCorner(s, rules, strength);
    S.commitBoundaryCorner(s, rules, strength);

    const forcedColourInfo = S.normalForcedColourInfo(s);
    const resultCategory = s.finalFour ? "final-four" :
      s.openingRemaining > 0 ? "opening-four" :
      forcedColourInfo ? "normal-one-colour" : "normal-both-colours";

    if(!phaseDiagnostics.oneColourEntry && forcedColourInfo) {
      phaseDiagnostics.oneColourEntry = {
        firstActor:s.currentPlayer, transitionActor:null, turn:s.turns,
        remainingColour:forcedColourInfo.colour, cause:"pre-existing"
      };
    }
    if(!phaseDiagnostics.finalFourEntry && s.finalFour) {
      phaseDiagnostics.finalFourEntry = {
        firstActor:s.currentPlayer, transitionActor:null, turn:s.turns
      };
    }

    const colour = chooseColourLocked(s, lockedIds);
    if(!colour) { s.winner = "draw"; break; }
    const action = chooseActionLocked(s, colour, lockedIds);
    if(!action) { s.winner = "draw"; break; }

    const actor = s.currentPlayer;
    if(action.type.includes("place")) {
      stats.placements++;
      stats.placementsByPlayer[actor]++;
    } else if(action.type === "move") {
      stats.moves++;
      stats.movesByPlayer[actor]++;
    } else if(action.type === "jump") {
      stats.jumps++;
      stats.jumpsByPlayer[actor]++;
    }

    const beforeColours = normalColourCount(s);
    const beforeReserve = normalReserveCount(s);
    const result = S.applyAction(s, action, rules);
    checkAnchors(s, anchorIds);

    if(result.ended) {
      return finishLocked(
        s, stats, phaseDiagnostics, result.winType || null, resultCategory,
        action.type.includes("place") ? "placement" : action.type, false
      );
    }

    recordPhaseTransition(phaseDiagnostics, s, beforeColours, beforeReserve, actor, action);

    if(action.type === "jump" && s.jumpConsequence !== "current") {
      const response = S.resolveJumpRedeploy(s, action, rules, strength);
      stats.redeployPlacements++;
      checkAnchors(s, anchorIds);
      if(response.stage === "redeploy") {
        return finishLocked(
          s, stats, phaseDiagnostics, response.firstResult.winType || null,
          resultCategory, "redeploy", false
        );
      }
    } else if(action.type === "move" || action.type === "jump") {
      S.commitMoveResponse(s, rules, strength);
    }

    checkAnchors(s, anchorIds);
  }

  if(s.winner === null) s.winner = "draw";
  return finishLocked(s, stats, phaseDiagnostics, null, "draw", null, s.turns >= maxActions);
}

function playConfig(config, gameSeed) {
  if(config.locked) return playLockedGame(gameSeed);
  return L8.playGame({
    rules,
    seed:gameSeed,
    strength,
    maxTurns:maxActions,
    ...fixed
  });
}

function newAggregate(config) {
  return {
    config,
    wins:[0,0], draws:0,
    totalActions:0, totalComparableActions:0,
    minActions:Infinity, maxActions:0,
    finalFour:0, moves:0, jumps:0, redeployments:0,
    winTypes:{}, winningActions:{},
    oneColourFirst:[0,0],
    maxActionDraws:0,
    games:[]
  };
}

function addGame(a, gameSeed, g) {
  if(g.winner === "draw") a.draws++;
  else a.wins[g.winner]++;
  a.totalActions += g.turns;
  a.totalComparableActions += g.comparableTurns ?? (g.turns + 4);
  a.minActions = Math.min(a.minActions, g.turns);
  a.maxActions = Math.max(a.maxActions, g.turns);
  if(g.reachedFinalFour) a.finalFour++;
  a.moves += g.moves || 0;
  a.jumps += g.jumps || 0;
  a.redeployments += g.redeployPlacements || 0;
  if(g.winType) a.winTypes[g.winType] = (a.winTypes[g.winType] || 0) + 1;
  if(g.winningActionType) a.winningActions[g.winningActionType] = (a.winningActions[g.winningActionType] || 0) + 1;
  const one = g.phaseDiagnostics?.oneColourEntry;
  if(one && (one.firstActor === 0 || one.firstActor === 1)) a.oneColourFirst[one.firstActor]++;
  if(g.maxTurnDraw) a.maxActionDraws++;

  a.games.push({
    seed:gameSeed,
    config:a.config.number,
    config_id:a.config.id,
    locked_opening:a.config.locked ? "yes" : "no",
    winner:actorName(g.winner),
    actions:g.turns,
    comparable_actions:g.comparableTurns ?? (g.turns + 4),
    win_type:g.winType || "",
    winning_action:g.winningActionType || "",
    reached_final_four:g.reachedFinalFour ? "yes" : "no",
    moves:g.moves || 0,
    jumps:g.jumps || 0,
    redeployments:g.redeployPlacements || 0,
    one_colour_first_actor:one ? actorName(one.firstActor) : "",
    one_colour_action:one?.turn ?? "",
    max_action_draw:g.maxTurnDraw ? "yes" : "no"
  });
}

function summaryRow(a) {
  const n = games;
  return {
    config:a.config.number,
    label:a.config.label,
    locked_opening:a.config.locked ? "yes" : "no",
    games:n,
    p1_wins:a.wins[0],
    p2_wins:a.wins[1],
    draws:a.draws,
    p1_win_pct:pct(a.wins[0], n).toFixed(4),
    p2_win_pct:pct(a.wins[1], n).toFixed(4),
    draw_pct:pct(a.draws, n).toFixed(4),
    p1_score_pct:pct(a.wins[0] + a.draws / 2, n).toFixed(4),
    distance_from_50_pp:Math.abs(pct(a.wins[0] + a.draws / 2, n) - 50).toFixed(4),
    average_actions:(a.totalActions / n).toFixed(4),
    average_comparable_actions:(a.totalComparableActions / n).toFixed(4),
    min_actions:a.minActions,
    max_actions:a.maxActions,
    final_four_pct:pct(a.finalFour, n).toFixed(4),
    moves:a.moves,
    jumps:a.jumps,
    redeployments:a.redeployments,
    moves_per_game:(a.moves / n).toFixed(4),
    jumps_per_game:(a.jumps / n).toFixed(4),
    redeployments_per_game:(a.redeployments / n).toFixed(4),
    one_colour_first_p1:a.oneColourFirst[0],
    one_colour_first_p2:a.oneColourFirst[1],
    win_horizontal:a.winTypes.horizontal || 0,
    win_vertical:a.winTypes.vertical || 0,
    win_diagonal:a.winTypes.diagonal || 0,
    win_square:a.winTypes.square || 0,
    win_spaced_square:a.winTypes["spaced-square"] || 0,
    winning_placement:a.winningActions.placement || 0,
    winning_move:a.winningActions.move || 0,
    winning_jump:a.winningActions.jump || 0,
    winning_redeploy:a.winningActions.redeploy || 0,
    max_action_draws:a.maxActionDraws
  };
}

function writeCsv(filePath, rows) {
  if(!rows.length) return;
  const keys = Object.keys(rows[0]);
  const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  fs.writeFileSync(
    filePath,
    [keys.join(","), ...rows.map(r => keys.map(k => esc(r[k])).join(","))].join("\r\n") + "\r\n",
    "utf8"
  );
}

function formatWinTypes(obj) {
  const order = ["horizontal", "vertical", "diagonal", "square", "spaced-square", "other"];
  return order.filter(k => obj[k]).map(k => `${k} ${obj[k]}`).join(", ") || "none";
}

const runStarted = Date.now();
let completedGames = 0;
let lastProgress = runStarted;
const totalGames = games * CONFIGS.length;

function etaText(now = Date.now()) {
  if(!completedGames) return "ETA --";
  const elapsed = now - runStarted;
  const remaining = totalGames - completedGames;
  return `ETA ${fmtDuration(elapsed / completedGames * remaining)}`;
}

function printProgress(ci, done, a, force = false) {
  const now = Date.now();
  const milestone = done === games || done === 1 || done % Math.max(1, Math.ceil(games / 100)) === 0;
  if(!force && !milestone && now - lastProgress < 15000) return;
  lastProgress = now;
  const overallPct = 100 * completedGames / totalGames;
  console.log(
    `  ${fmtClock(now)} | ${ci + 1}/${CONFIGS.length} ${done}/${games}` +
    ` | ${completedGames}/${totalGames} ${overallPct.toFixed(1)}%` +
    ` | Config ${CONFIGS[ci].number}` +
    ` | P1 ${a.wins[0]} P2 ${a.wins[1]} D${a.draws}` +
    ` | elapsed ${fmtDuration(now - runStarted)} | ${etaText(now)}`
  );
}

console.log("Lipfty 8 — Config 5 vs Config 6 locked-opening comparison");
console.log(`Run started: ${fmtDateTime(runStarted)}`);
console.log(`Results: ${outDir}`);
archivePreviousResults();
console.log("");
console.log(`Games: ${games} per configuration | same seeds ${seed}-${seed + games - 1} | ${strength} strength.`);
console.log("Config 5: diagonal inner-board corners; opening pieces may Move/Jump under existing rules.");
console.log("Config 6: same four opening pieces are permanent anchors: they cannot Move/Jump and cannot be jumped/redeployed.");
console.log("The anchors still count normally in H/V/Diagonal/tight-square/spaced-square wins.");
console.log("All other Lipfty 7 rules remain frozen.");
console.log("Progress columns: configuration/total game/total | overall-game/total-games\n");

const aggregates = [];
for(let ci = 0; ci < CONFIGS.length; ci++) {
  const config = CONFIGS[ci];
  const a = newAggregate(config);
  aggregates.push(a);
  console.log(`Starting ${ci + 1}/${CONFIGS.length} — ${config.label} at ${fmtClock()}...`);
  const configStart = Date.now();
  for(let i = 0; i < games; i++) {
    const gameSeed = seed + i;
    const g = playConfig(config, gameSeed);
    addGame(a, gameSeed, g);
    completedGames++;
    printProgress(ci, i + 1, a, false);
  }
  console.log(`Config ${config.number} finished: ${fmtClock()} | ${fmtDuration(Date.now() - configStart)}\n`);
}

const summaries = aggregates.map(summaryRow);
const c5 = aggregates[0], c6 = aggregates[1];
const pairedRows = [];
const transitionCounts = {};
let sameWinner = 0;
let p1ToP2 = 0, p2ToP1 = 0, p1ToDraw = 0, p2ToDraw = 0, drawToP1 = 0, drawToP2 = 0;
let actionDeltaTotal = 0;
for(let i = 0; i < games; i++) {
  const g5 = c5.games[i], g6 = c6.games[i];
  const transition = `${g5.winner}->${g6.winner}`;
  transitionCounts[transition] = (transitionCounts[transition] || 0) + 1;
  if(g5.winner === g6.winner) sameWinner++;
  if(transition === "P1->P2") p1ToP2++;
  if(transition === "P2->P1") p2ToP1++;
  if(transition === "P1->draw") p1ToDraw++;
  if(transition === "P2->draw") p2ToDraw++;
  if(transition === "draw->P1") drawToP1++;
  if(transition === "draw->P2") drawToP2++;
  const delta = Number(g6.actions) - Number(g5.actions);
  actionDeltaTotal += delta;
  pairedRows.push({
    seed:g5.seed,
    config5_winner:g5.winner,
    config6_winner:g6.winner,
    winner_transition:transition,
    same_winner:g5.winner === g6.winner ? "yes" : "no",
    config5_actions:g5.actions,
    config6_actions:g6.actions,
    action_delta_config6_minus_config5:delta,
    config5_moves:g5.moves,
    config6_moves:g6.moves,
    config5_jumps:g5.jumps,
    config6_jumps:g6.jumps,
    config5_final_four:g5.reached_final_four,
    config6_final_four:g6.reached_final_four,
    config5_win_type:g5.win_type,
    config6_win_type:g6.win_type
  });
}

const s5 = summaries[0], s6 = summaries[1];
const p1Score5 = Number(s5.p1_score_pct), p1Score6 = Number(s6.p1_score_pct);
const reportLines = [
  "Lipfty 8 — Config 5 vs Config 6 locked-opening comparison",
  `Started: ${fmtDateTime(runStarted)}`,
  `Finished: ${fmtDateTime()}`,
  `Seeds: ${seed}-${seed + games - 1} (${games} games each)`,
  "",
  `Config 5: P1 ${s5.p1_wins} (${s5.p1_win_pct}%), P2 ${s5.p2_wins} (${s5.p2_win_pct}%), Draw ${s5.draws}; P1 score ${s5.p1_score_pct}%`,
  `Config 6: P1 ${s6.p1_wins} (${s6.p1_win_pct}%), P2 ${s6.p2_wins} (${s6.p2_win_pct}%), Draw ${s6.draws}; P1 score ${s6.p1_score_pct}%`,
  `Config 6 minus Config 5 P1 score: ${(p1Score6 - p1Score5 >= 0 ? "+" : "")}${(p1Score6 - p1Score5).toFixed(4)} pp`,
  `Config 5 distance from 50%: ${s5.distance_from_50_pp} pp`,
  `Config 6 distance from 50%: ${s6.distance_from_50_pp} pp`,
  "",
  `Average actions: Config 5 ${s5.average_actions}, Config 6 ${s6.average_actions}`,
  `Moves: Config 5 ${s5.moves}, Config 6 ${s6.moves}`,
  `Jumps: Config 5 ${s5.jumps}, Config 6 ${s6.jumps}`,
  `Redeployments: Config 5 ${s5.redeployments}, Config 6 ${s6.redeployments}`,
  `Final Four reached: Config 5 ${s5.final_four_pct}%, Config 6 ${s6.final_four_pct}%`,
  `Win formations Config 5: ${formatWinTypes(c5.winTypes)}`,
  `Win formations Config 6: ${formatWinTypes(c6.winTypes)}`,
  "",
  `Same winner on paired seed: ${sameWinner}/${games} (${pct(sameWinner, games).toFixed(2)}%)`,
  `P1->P2: ${p1ToP2}; P2->P1: ${p2ToP1}; P1->draw: ${p1ToDraw}; P2->draw: ${p2ToDraw}; draw->P1: ${drawToP1}; draw->P2: ${drawToP2}`,
  `Average action delta Config 6 - Config 5: ${(actionDeltaTotal / games).toFixed(4)}`,
  `Transitions: ${Object.entries(transitionCounts).map(([k,v]) => `${k} ${v}`).join(", ")}`,
  "",
  `Total runtime: ${fmtDuration(Date.now() - runStarted)}`
];

const tag = `seed${seed}-games${games}`;
const summaryPath = path.join(outDir, `lipfty8-config5-vs-config6-summary-${tag}.csv`);
const gamesPath = path.join(outDir, `lipfty8-config5-vs-config6-games-${tag}.csv`);
const pairedPath = path.join(outDir, `lipfty8-config5-vs-config6-paired-${tag}.csv`);
const reportPath = path.join(outDir, `lipfty8-config5-vs-config6-report-${tag}.txt`);
writeCsv(summaryPath, summaries);
writeCsv(gamesPath, aggregates.flatMap(a => a.games));
writeCsv(pairedPath, pairedRows);
fs.writeFileSync(reportPath, reportLines.join("\r\n") + "\r\n", "utf8");

console.log("SUMMARY");
console.log(`  Config 5: P1 ${s5.p1_wins} (${s5.p1_win_pct}%) | P2 ${s5.p2_wins} (${s5.p2_win_pct}%) | D ${s5.draws} | P1 score ${s5.p1_score_pct}%`);
console.log(`  Config 6: P1 ${s6.p1_wins} (${s6.p1_win_pct}%) | P2 ${s6.p2_wins} (${s6.p2_win_pct}%) | D ${s6.draws} | P1 score ${s6.p1_score_pct}%`);
console.log(`  P1 score change Config 6 - Config 5: ${(p1Score6 - p1Score5 >= 0 ? "+" : "")}${(p1Score6 - p1Score5).toFixed(4)} pp`);
console.log(`  Distance from 50%: Config 5 ${s5.distance_from_50_pp} pp | Config 6 ${s6.distance_from_50_pp} pp`);
console.log(`  Same paired-seed winner: ${sameWinner}/${games} (${pct(sameWinner, games).toFixed(2)}%)`);
console.log(`  Winner flips P1->P2 ${p1ToP2} | P2->P1 ${p2ToP1}`);
console.log(`  Actions avg: Config 5 ${s5.average_actions} | Config 6 ${s6.average_actions}`);
console.log(`  Move/Jump: Config 5 ${s5.moves}/${s5.jumps} | Config 6 ${s6.moves}/${s6.jumps}`);
console.log(`  Final Four: Config 5 ${s5.final_four_pct}% | Config 6 ${s6.final_four_pct}%`);
console.log("");
console.log(`Report: ${reportPath}`);
console.log(`Summary CSV: ${summaryPath}`);
console.log(`Per-game CSV: ${gamesPath}`);
console.log(`Paired CSV: ${pairedPath}`);
console.log(`Total time: ${fmtDuration(Date.now() - runStarted)} | finished ${fmtDateTime()}`);
