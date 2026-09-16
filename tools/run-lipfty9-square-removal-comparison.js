"use strict";

// Lipfty 9 analysis-only square-removal comparison.
//
// A — Lipfty 8 Standard: horizontal, vertical, diagonal, tight square, spaced square.
// B — No Spaced Square: horizontal, vertical, diagonal, tight square.
// C — No Squares: horizontal, vertical, diagonal only.
//
// Everything else remains the Lipfty 8 v8.0.22 pinned-corner Standard game.
// The same seeds are used for A/B/C so each policy can be compared seed-for-seed.
// This file does not change the playable game or shared rules module.

const fs = require("fs");
const path = require("path");
const L8 = require("./lipfty8-simulator.js");
const S = require("./lipfty7-simulator.js");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}
function hasArg(name) { return process.argv.includes(`--${name}`); }

const games = Number(arg("games", "10000"));
const seed = Number(arg("seed", "1"));
const maxActions = Number(arg("max-turns", "500")); // historical CLI name; counts actions
const policyArg = String(arg("policy", "both")).toLowerCase();

function defaultOutDir() {
  const drive = fs.existsSync("D:\\") ? "D:" : "C:";
  return path.win32.join(`${drive}\\`, "bxd", "Blarm1959", "Lipfty", "Simulation-Results");
}
const outDir = arg("out", defaultOutDir());

if(!Number.isInteger(games) || games < 1) throw new Error("--games must be a positive integer.");
if(!Number.isInteger(seed)) throw new Error("--seed must be an integer.");
if(!Number.isInteger(maxActions) || maxActions < 1) throw new Error("--max-turns must be a positive integer.");
if(!["both", "tactical", "random"].includes(policyArg)) throw new Error("--policy must be both, tactical or random.");

const POLICIES = policyArg === "both" ? ["tactical", "random"] : [policyArg];
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

const CONDITIONS = [
  {
    id:"A-standard",
    short:"A",
    label:"A — LIPFTY 8 STANDARD",
    removed:"none",
    rules:S.normaliseRules({
      allowJump:true, allowMove:true, allowDiagonal:true,
      allowSquare:true, allowSpacedSquare:true,
      spacedSquareOnly:false, allowDiamond:false, allowSpacedDiamond:false
    })
  },
  {
    id:"B-no-spaced-square",
    short:"B",
    label:"B — NO SPACED SQUARE",
    removed:"spaced-square",
    rules:S.normaliseRules({
      allowJump:true, allowMove:true, allowDiagonal:true,
      allowSquare:true, allowSpacedSquare:false,
      spacedSquareOnly:false, allowDiamond:false, allowSpacedDiamond:false
    })
  },
  {
    id:"C-no-squares",
    short:"C",
    label:"C — NO SQUARES",
    removed:"square+spaced-square",
    rules:S.normaliseRules({
      allowJump:true, allowMove:true, allowDiagonal:true,
      allowSquare:false, allowSpacedSquare:false,
      spacedSquareOnly:false, allowDiamond:false, allowSpacedDiamond:false
    })
  }
];

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
function scoreForWinner(v) { return v === 0 ? 1 : v === 1 ? 0 : 0.5; }
function cell(r, c) { return r * 6 + c; }
function inBounds(r, c) { return r >= 0 && r < 6 && c >= 0 && c < 6; }

// Independent pattern geometry. Diamonds are deliberately absent.
function buildLinePatterns(dr, dc) {
  const out = [];
  for(let r = 0; r < 6; r++) {
    for(let c = 0; c < 6; c++) {
      if(!inBounds(r + 3 * dr, c + 3 * dc)) continue;
      out.push([0,1,2,3].map(k => cell(r + k * dr, c + k * dc)));
    }
  }
  return out;
}
function buildSquarePatterns(spanFrom, spanTo) {
  const out = [];
  for(let span = spanFrom; span <= spanTo; span++) {
    for(let r = 0; r + span < 6; r++) {
      for(let c = 0; c + span < 6; c++) {
        // Same span is used in both axes: a genuine square, never a rectangle.
        out.push([cell(r,c), cell(r,c+span), cell(r+span,c+span), cell(r+span,c)]);
      }
    }
  }
  return out;
}

const PATTERNS = {
  horizontal:buildLinePatterns(0, 1),
  vertical:buildLinePatterns(1, 0),
  diagonal:[...buildLinePatterns(1, 1), ...buildLinePatterns(1, -1)],
  square:buildSquarePatterns(1, 1),
  spacedSquare:buildSquarePatterns(2, 5)
};
const SPACED_BY_CELL = Array.from({length:36}, () => []);
for(const p of PATTERNS.spacedSquare) for(const i of p) SPACED_BY_CELL[i].push(p);

function patternPresent(board, colour, patterns) {
  return patterns.some(p => p.every(i => board[i]?.colour === colour));
}
function patternsOnBoard(board, colour) {
  if(!colour) return {horizontal:false, vertical:false, diagonal:false, square:false, spacedSquare:false};
  return {
    horizontal:patternPresent(board, colour, PATTERNS.horizontal),
    vertical:patternPresent(board, colour, PATTERNS.vertical),
    diagonal:patternPresent(board, colour, PATTERNS.diagonal),
    square:patternPresent(board, colour, PATTERNS.square),
    spacedSquare:patternPresent(board, colour, PATTERNS.spacedSquare)
  };
}
function completesSpacedSquare(board, colour, changedCell) {
  return SPACED_BY_CELL[changedCell].some(p => p.every(i => board[i]?.colour === colour));
}
function nonSpacedPatternPresent(board, colour) {
  return patternPresent(board, colour, PATTERNS.horizontal) ||
    patternPresent(board, colour, PATTERNS.vertical) ||
    patternPresent(board, colour, PATTERNS.diagonal) ||
    patternPresent(board, colour, PATTERNS.square);
}

function selfTest() {
  const piece = colour => ({id:1, colour});
  const board = () => Array(36).fill(null);

  let b = board();
  [cell(0,0),cell(0,2),cell(2,0),cell(2,2)].forEach(i => b[i] = piece("black"));
  if(!patternsOnBoard(b,"black").spacedSquare) throw new Error("Self-test failed: valid spaced square not detected.");

  b = board();
  [cell(0,0),cell(0,2),cell(3,0),cell(3,2)].forEach(i => b[i] = piece("black"));
  if(patternsOnBoard(b,"black").spacedSquare) throw new Error("Self-test failed: rectangle incorrectly detected as spaced square.");

  b = board();
  [cell(0,0),cell(0,1),cell(1,0),cell(1,1)].forEach(i => b[i] = piece("white"));
  const p = patternsOnBoard(b,"white");
  if(!p.square || p.spacedSquare) throw new Error("Self-test failed: tight square classification is wrong.");

  if(PATTERNS.spacedSquare.length !== 30) throw new Error(`Self-test failed: expected 30 spaced-square geometries, got ${PATTERNS.spacedSquare.length}.`);
  if(CONDITIONS[0].rules.allowSpacedSquare !== true || CONDITIONS[1].rules.allowSpacedSquare !== false || CONDITIONS[2].rules.allowSquare !== false) {
    throw new Error("Self-test failed: A/B/C rules are not configured as intended.");
  }
  if(CONDITIONS.some(c => c.rules.allowDiamond || c.rules.allowSpacedDiamond)) {
    throw new Error("Self-test failed: Diamond rules must not be present in Lipfty 9 analysis.");
  }

  const opening = L8.prepareState(1, fixed.jumpPolicy, fixed.responsePolicy, fixed.boundaryPolicy, fixed.jumpConsequence, fixed.oneColourPolicy, fixed.openingPolicy);
  const expected = ["black","white","white","black"];
  const actual = ANCHOR_SQUARES.map(i => opening.board[i]?.colour);
  if(actual.some((c,i) => c !== expected[i])) throw new Error(`Self-test failed: pinned opening colours are ${actual.join(",")}, expected ${expected.join(",")}.`);
  if(opening.normalRemaining.black !== 12 || opening.normalRemaining.white !== 12 || opening.openingRemaining !== 0) {
    throw new Error("Self-test failed: automatic opening did not leave the expected 24-piece normal reserve.");
  }
}

function safeArchiveDestination(oldDir, fileName) {
  const direct = path.join(oldDir, fileName);
  if(!fs.existsSync(direct)) return direct;
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  const d = new Date();
  const stamp = [
    d.getFullYear(), String(d.getMonth()+1).padStart(2,"0"), String(d.getDate()).padStart(2,"0"), "-",
    String(d.getHours()).padStart(2,"0"), String(d.getMinutes()).padStart(2,"0"), String(d.getSeconds()).padStart(2,"0")
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
    fs.renameSync(path.join(outDir, entry.name), safeArchiveDestination(oldDir, entry.name));
    moved++;
  }
  console.log(`  moved ${moved} file${moved === 1 ? "" : "s"} to ${oldDir}`);
}

function lockedIdsFromState(s) {
  const ids = new Set();
  for(const sq of ANCHOR_SQUARES) {
    const p = s.board[sq];
    if(!p) throw new Error(`Pinned corner square ${sq} is unexpectedly empty at setup.`);
    ids.add(p.id);
  }
  if(ids.size !== 4) throw new Error("Opening did not create four distinct pinned pieces.");
  return ids;
}
function anchorIdsFromState(s) { return ANCHOR_SQUARES.map(sq => s.board[sq]?.id); }
function checkAnchors(s, anchorIds) {
  for(let i = 0; i < ANCHOR_SQUARES.length; i++) {
    const sq = ANCHOR_SQUARES[i], p = s.board[sq];
    if(!p || p.id !== anchorIds[i]) {
      throw new Error(`Pinned-corner integrity failure at R${Math.floor(sq/6)+1}C${sq%6+1}.`);
    }
  }
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
function enumerateLocked(s, colour, lockedIds, rules) {
  return S.enumerateActions(s, colour, rules).filter(a => !isLockedAction(s, a, lockedIds));
}
function actionWins(s, a, rules) { return !!S.fastCheckWin(S.boardAfter(s, a), rules, a.to); }

function handoverDangerLocked(s, colour, lockedIds, rules) {
  const actions = enumerateLocked(s, colour, lockedIds, rules);
  if(!actions.length) return -Infinity;
  let best = -Infinity;
  for(const a of actions) best = Math.max(best, S.actionPositionalScore(s, a, rules));
  return best;
}
function chooseColourLocked(s, lockedIds, rules, policy) {
  if(s.forcedQueue.length) return s.forcedQueue[0].colour;
  const colours = S.availableColours(s);
  if(!colours.length) return null;
  if(colours.length === 1) return colours[0];
  if(s.finalFour) return S.chooseColour(s, rules, policy, fixed.finalFourColourPolicy);
  if(policy === "random" || s.openingRemaining > 0) return colours[Math.floor(s.rng() * colours.length)];

  const safe = colours.filter(c => enumerateLocked(s, c, lockedIds, rules).filter(a => actionWins(s, a, rules)).length === 0);
  const candidates = safe.length ? safe : colours;
  let best = [], bestDanger = Infinity;
  for(const c of candidates) {
    const danger = handoverDangerLocked(s, c, lockedIds, rules);
    if(danger < bestDanger - 1e-9) { bestDanger = danger; best = [c]; }
    else if(Math.abs(danger - bestDanger) < 1e-9) best.push(c);
  }
  return best[Math.floor(s.rng() * best.length)];
}
function chooseActionFromLockedActions(s, actions, rules, policy) {
  if(!actions.length) return null;
  const planned = s.forcedQueue[0]?.plannedTo;
  if(planned !== undefined) {
    const action = actions.find(a => a.to === planned);
    if(action) return action;
  }
  if(policy === "random") return actions[Math.floor(s.rng() * actions.length)];
  const wins = actions.filter(a => actionWins(s, a, rules));
  if(wins.length) return wins[Math.floor(s.rng() * wins.length)];

  let best = [], bestScore = -Infinity;
  for(const a of actions) {
    const score = S.actionPositionalScore(s, a, rules) + s.rng() * 0.01;
    if(score > bestScore + 1e-9) { bestScore = score; best = [a]; }
    else if(Math.abs(score - bestScore) < 1e-9) best.push(a);
  }
  return best[Math.floor(s.rng() * best.length)];
}

function inspectSpacedOpportunities(s, actions) {
  let count = 0, only = 0, plusOther = 0;
  for(const a of actions) {
    const colour = a.colour || s.board[a.from]?.colour;
    if(!colour) continue;
    const after = S.boardAfter(s, a);
    if(!completesSpacedSquare(after, colour, a.to)) continue;
    count++;
    if(nonSpacedPatternPresent(after, colour)) plusOther++;
    else only++;
  }
  return {count, only, plusOther};
}
function inspectRedeploySpacedOpportunities(s, jumpAction, piece) {
  const base = s.board.slice();
  base[jumpAction.over] = null; // lifted before redeployment
  let count = 0, only = 0, plusOther = 0;
  for(let to = 0; to < 36; to++) {
    if(base[to]) continue;
    const after = base.slice();
    after[to] = piece;
    if(!completesSpacedSquare(after, piece.colour, to)) continue;
    count++;
    if(nonSpacedPatternPresent(after, piece.colour)) plusOther++;
    else only++;
  }
  return {count, only, plusOther};
}

function newGameStats() {
  return {
    placements:0, moves:0, jumps:0, redeployments:0,
    jumpImmediateWins:0, redeployWins:0,
    spacedOpportunityStates:0, spacedOpportunityActions:0,
    spacedOpportunityOnlyActions:0, spacedOpportunityPlusOtherActions:0,
    redeploySpacedOpportunityStates:0, redeploySpacedOpportunityActions:0,
    redeploySpacedOpportunityOnlyActions:0, redeploySpacedOpportunityPlusOtherActions:0,
    winningSpacedOptions:0
  };
}

function finalPatternInfo(board, finalActionColour, recordedWinType) {
  const black = patternsOnBoard(board, "black");
  const white = patternsOnBoard(board, "white");
  const action = patternsOnBoard(board, finalActionColour);
  const actionCount = Object.values(action).filter(Boolean).length;
  const anySpaced = black.spacedSquare || white.spacedSquare;
  return {
    black, white, action,
    actionCount,
    anySpaced,
    actionSpacedRecordedOther:!!finalActionColour && action.spacedSquare && recordedWinType !== "spaced-square"
  };
}

function playPinnedGame(gameSeed, condition, policy) {
  const rules = condition.rules;
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
  const anchorIds = anchorIdsFromState(s);
  checkAnchors(s, anchorIds);

  const stats = newGameStats();
  let winType = null, winningAction = null, resultCategory = null;
  let finalActionColour = null, lastActionColour = null;
  let lastDecisionSpacedOptions = 0;

  while(s.winner === null && s.turns < maxActions) {
    S.commitSequentialSecond(s, rules, policy);
    S.commitBoundarySelfCorner(s, rules, policy);
    S.commitBoundaryCorner(s, rules, policy);

    const forcedColourInfo = S.normalForcedColourInfo(s);
    const category = s.finalFour ? "final-four" :
      s.openingRemaining > 0 ? "opening-four" :
      forcedColourInfo ? "normal-one-colour" : "normal-both-colours";

    const colour = chooseColourLocked(s, lockedIds, rules, policy);
    if(!colour) { s.winner = "draw"; break; }
    const actions = enumerateLocked(s, colour, lockedIds, rules);
    if(!actions.length) { s.winner = "draw"; break; }

    const opportunities = inspectSpacedOpportunities(s, actions);
    lastDecisionSpacedOptions = opportunities.count;
    if(opportunities.count) stats.spacedOpportunityStates++;
    stats.spacedOpportunityActions += opportunities.count;
    stats.spacedOpportunityOnlyActions += opportunities.only;
    stats.spacedOpportunityPlusOtherActions += opportunities.plusOther;

    const action = chooseActionFromLockedActions(s, actions, rules, policy);
    if(!action) { s.winner = "draw"; break; }

    if(action.type.includes("place")) stats.placements++;
    else if(action.type === "move") stats.moves++;
    else if(action.type === "jump") stats.jumps++;

    const jumpedBefore = action.type === "jump" ? s.board[action.over] : null;
    lastActionColour = colour;
    const result = S.applyAction(s, action, rules);
    checkAnchors(s, anchorIds);

    if(result.ended) {
      winType = result.winType || null;
      winningAction = s.winner === "draw" ? null : (action.type.includes("place") ? "placement" : action.type);
      resultCategory = s.winner === "draw" ? "draw" : category;
      finalActionColour = colour;
      if(s.winner !== "draw" && action.type === "jump") stats.jumpImmediateWins++;
      if(s.winner !== "draw" && resultCategory === "final-four") { /* counted in aggregate */ }
      if(s.winner !== "draw" && patternsOnBoard(s.board, colour).spacedSquare) stats.winningSpacedOptions = lastDecisionSpacedOptions;
      break;
    }

    if(action.type === "jump" && s.jumpConsequence !== "current") {
      const redeployOpportunities = inspectRedeploySpacedOpportunities(s, action, jumpedBefore);
      if(redeployOpportunities.count) stats.redeploySpacedOpportunityStates++;
      stats.redeploySpacedOpportunityActions += redeployOpportunities.count;
      stats.redeploySpacedOpportunityOnlyActions += redeployOpportunities.only;
      stats.redeploySpacedOpportunityPlusOtherActions += redeployOpportunities.plusOther;

      const response = S.resolveJumpRedeploy(s, action, rules, policy);
      stats.redeployments++;
      lastActionColour = jumpedBefore?.colour || null;
      checkAnchors(s, anchorIds);
      if(response.stage === "redeploy") {
        winType = response.firstResult.winType || null;
        winningAction = "redeploy";
        resultCategory = category;
        finalActionColour = jumpedBefore?.colour || null;
        stats.redeployWins++;
        if(finalActionColour && patternsOnBoard(s.board, finalActionColour).spacedSquare) {
          stats.winningSpacedOptions = redeployOpportunities.count;
        }
        break;
      }
    } else if(action.type === "move" || action.type === "jump") {
      S.commitMoveResponse(s, rules, policy);
    }

    checkAnchors(s, anchorIds);
  }

  if(s.winner === null) s.winner = "draw";
  if(finalActionColour === null) finalActionColour = lastActionColour;
  if(resultCategory === null) resultCategory = s.winner === "draw" ? "draw" : "unknown";

  const finalPatterns = finalPatternInfo(s.board, finalActionColour, winType);
  const template = [
    actorName(s.winner), s.turns, winType || "none", winningAction || "none",
    stats.moves, stats.jumps, stats.redeployments
  ].join("|");

  return {
    seed:gameSeed,
    policy,
    condition:condition.id,
    condition_short:condition.short,
    winner:s.winner,
    winner_name:actorName(s.winner),
    p1_score:scoreForWinner(s.winner),
    actions:s.turns,
    placements:stats.placements,
    moves:stats.moves,
    jumps:stats.jumps,
    redeployments:stats.redeployments,
    jump_immediate_wins:stats.jumpImmediateWins,
    redeploy_wins:stats.redeployWins,
    reached_final_four:s.reachedFinalFour,
    recorded_win_type:winType || "",
    winning_action:winningAction || "",
    result_category:resultCategory,
    final_action_colour:finalActionColour || "",
    final_action_horizontal:finalPatterns.action.horizontal,
    final_action_vertical:finalPatterns.action.vertical,
    final_action_diagonal:finalPatterns.action.diagonal,
    final_action_square:finalPatterns.action.square,
    final_action_spaced_square:finalPatterns.action.spacedSquare,
    final_action_multi_pattern:finalPatterns.actionCount > 1,
    final_spaced_square_recorded_other:finalPatterns.actionSpacedRecordedOther,
    final_board_black_spaced_square:finalPatterns.black.spacedSquare,
    final_board_white_spaced_square:finalPatterns.white.spacedSquare,
    final_board_any_spaced_square:finalPatterns.anySpaced,
    spaced_opportunity_states:stats.spacedOpportunityStates,
    spaced_opportunity_actions:stats.spacedOpportunityActions,
    spaced_opportunity_only_actions:stats.spacedOpportunityOnlyActions,
    spaced_opportunity_plus_other_actions:stats.spacedOpportunityPlusOtherActions,
    redeploy_spaced_opportunity_states:stats.redeploySpacedOpportunityStates,
    redeploy_spaced_opportunity_actions:stats.redeploySpacedOpportunityActions,
    redeploy_spaced_opportunity_only_actions:stats.redeploySpacedOpportunityOnlyActions,
    redeploy_spaced_opportunity_plus_other_actions:stats.redeploySpacedOpportunityPlusOtherActions,
    winning_spaced_options:stats.winningSpacedOptions,
    max_action_draw:s.winner === "draw" && s.turns >= maxActions,
    template
  };
}

function newAggregate(policy, condition) {
  return {
    policy, condition, completed:0,
    wins:[0,0], draws:0,
    scoreSum:0, scoreSqSum:0,
    totalActions:0, minActions:Infinity, maxActions:0,
    placements:0, moves:0, jumps:0, redeployments:0,
    jumpImmediateWins:0, redeployWins:0, finalFour:0, finalFourWins:0, maxActionDraws:0,
    winTypes:{}, winningActions:{}, winTypeByAction:{},
    finalActionPatterns:{horizontal:0,vertical:0,diagonal:0,square:0,spacedSquare:0,multi:0},
    finalBoardsWithSpacedSquare:0, finalSpacedRecordedOther:0,
    spacedOpportunityGames:0, spacedOpportunityStates:0, spacedOpportunityActions:0,
    spacedOpportunityOnlyActions:0, spacedOpportunityPlusOtherActions:0,
    redeploySpacedOpportunityGames:0, redeploySpacedOpportunityStates:0, redeploySpacedOpportunityActions:0,
    redeploySpacedOpportunityOnlyActions:0, redeploySpacedOpportunityPlusOtherActions:0,
    spacedWinsWithOneOption:0, spacedWinsWithMultipleOptions:0, winningSpacedOptionsTotal:0,
    templates:new Map()
  };
}
function addGame(a, g) {
  a.completed++;
  if(g.winner === "draw") a.draws++; else a.wins[g.winner]++;
  a.scoreSum += g.p1_score; a.scoreSqSum += g.p1_score * g.p1_score;
  a.totalActions += g.actions; a.minActions = Math.min(a.minActions, g.actions); a.maxActions = Math.max(a.maxActions, g.actions);
  a.placements += g.placements; a.moves += g.moves; a.jumps += g.jumps; a.redeployments += g.redeployments;
  a.jumpImmediateWins += g.jump_immediate_wins; a.redeployWins += g.redeploy_wins;
  if(g.reached_final_four) a.finalFour++;
  if(g.result_category === "final-four" && g.winner !== "draw") a.finalFourWins++;
  if(g.max_action_draw) a.maxActionDraws++;
  if(g.recorded_win_type) a.winTypes[g.recorded_win_type] = (a.winTypes[g.recorded_win_type] || 0) + 1;
  if(g.winning_action) a.winningActions[g.winning_action] = (a.winningActions[g.winning_action] || 0) + 1;
  if(g.recorded_win_type && g.winning_action) {
    const key = `${g.recorded_win_type}|${g.winning_action}`;
    a.winTypeByAction[key] = (a.winTypeByAction[key] || 0) + 1;
  }
  for(const k of ["horizontal","vertical","diagonal","square","spaced_square"]) {
    if(g[`final_action_${k}`]) a.finalActionPatterns[k === "spaced_square" ? "spacedSquare" : k]++;
  }
  if(g.final_action_multi_pattern) a.finalActionPatterns.multi++;
  if(g.final_board_any_spaced_square) a.finalBoardsWithSpacedSquare++;
  if(g.final_spaced_square_recorded_other) a.finalSpacedRecordedOther++;
  if(g.spaced_opportunity_states) a.spacedOpportunityGames++;
  a.spacedOpportunityStates += g.spaced_opportunity_states;
  a.spacedOpportunityActions += g.spaced_opportunity_actions;
  a.spacedOpportunityOnlyActions += g.spaced_opportunity_only_actions;
  a.spacedOpportunityPlusOtherActions += g.spaced_opportunity_plus_other_actions;
  if(g.redeploy_spaced_opportunity_states) a.redeploySpacedOpportunityGames++;
  a.redeploySpacedOpportunityStates += g.redeploy_spaced_opportunity_states;
  a.redeploySpacedOpportunityActions += g.redeploy_spaced_opportunity_actions;
  a.redeploySpacedOpportunityOnlyActions += g.redeploy_spaced_opportunity_only_actions;
  a.redeploySpacedOpportunityPlusOtherActions += g.redeploy_spaced_opportunity_plus_other_actions;
  if(g.recorded_win_type === "spaced-square") {
    a.winningSpacedOptionsTotal += g.winning_spaced_options;
    if(g.winning_spaced_options === 1) a.spacedWinsWithOneOption++;
    else if(g.winning_spaced_options > 1) a.spacedWinsWithMultipleOptions++;
  }
  a.templates.set(g.template, (a.templates.get(g.template) || 0) + 1);
}

function ciHalfPct(sum, sumSq, n) {
  if(n < 2) return 0;
  const mean = sum / n;
  const variance = Math.max(0, (sumSq - n * mean * mean) / (n - 1));
  return 100 * 1.96 * Math.sqrt(variance / n);
}
function summaryRow(a) {
  const n = a.completed || 1, p1ScorePct = 100 * a.scoreSum / n;
  const dominant = [...a.templates.entries()].sort((x,y) => y[1]-x[1])[0] || ["",0];
  const spacedWins = a.winTypes["spaced-square"] || 0;
  return {
    policy:a.policy,
    condition:a.condition.short,
    condition_id:a.condition.id,
    games:n,
    p1_wins:a.wins[0], p2_wins:a.wins[1], draws:a.draws,
    p1_score_pct:p1ScorePct.toFixed(4),
    p1_score_95ci_low:(p1ScorePct - ciHalfPct(a.scoreSum,a.scoreSqSum,n)).toFixed(4),
    p1_score_95ci_high:(p1ScorePct + ciHalfPct(a.scoreSum,a.scoreSqSum,n)).toFixed(4),
    distance_from_50_pp:Math.abs(p1ScorePct - 50).toFixed(4),
    average_actions:(a.totalActions/n).toFixed(4), min_actions:a.minActions, max_actions:a.maxActions,
    placements:a.placements, moves:a.moves, jumps:a.jumps, redeployments:a.redeployments,
    jump_immediate_wins:a.jumpImmediateWins, redeploy_wins:a.redeployWins,
    final_four_games:a.finalFour, final_four_wins:a.finalFourWins,
    max_action_draws:a.maxActionDraws,
    recorded_horizontal:a.winTypes.horizontal || 0,
    recorded_vertical:a.winTypes.vertical || 0,
    recorded_diagonal:a.winTypes.diagonal || 0,
    recorded_square:a.winTypes.square || 0,
    recorded_spaced_square:spacedWins,
    spaced_square_placement_wins:a.winTypeByAction["spaced-square|placement"] || 0,
    spaced_square_move_wins:a.winTypeByAction["spaced-square|move"] || 0,
    spaced_square_jump_wins:a.winTypeByAction["spaced-square|jump"] || 0,
    spaced_square_redeploy_wins:a.winTypeByAction["spaced-square|redeploy"] || 0,
    winning_placement:a.winningActions.placement || 0,
    winning_move:a.winningActions.move || 0,
    winning_jump:a.winningActions.jump || 0,
    winning_redeploy:a.winningActions.redeploy || 0,
    final_action_horizontal:a.finalActionPatterns.horizontal,
    final_action_vertical:a.finalActionPatterns.vertical,
    final_action_diagonal:a.finalActionPatterns.diagonal,
    final_action_square:a.finalActionPatterns.square,
    final_action_spaced_square:a.finalActionPatterns.spacedSquare,
    final_action_multi_pattern:a.finalActionPatterns.multi,
    final_boards_with_spaced_square:a.finalBoardsWithSpacedSquare,
    final_spaced_square_but_recorded_other:a.finalSpacedRecordedOther,
    games_with_spaced_opportunity:a.spacedOpportunityGames,
    spaced_opportunity_states:a.spacedOpportunityStates,
    spaced_opportunity_actions:a.spacedOpportunityActions,
    spaced_opportunity_only_actions:a.spacedOpportunityOnlyActions,
    spaced_opportunity_plus_other_actions:a.spacedOpportunityPlusOtherActions,
    games_with_redeploy_spaced_opportunity:a.redeploySpacedOpportunityGames,
    redeploy_spaced_opportunity_states:a.redeploySpacedOpportunityStates,
    redeploy_spaced_opportunity_actions:a.redeploySpacedOpportunityActions,
    redeploy_spaced_opportunity_only_actions:a.redeploySpacedOpportunityOnlyActions,
    redeploy_spaced_opportunity_plus_other_actions:a.redeploySpacedOpportunityPlusOtherActions,
    spaced_wins_with_one_option:a.spacedWinsWithOneOption,
    spaced_wins_with_multiple_options:a.spacedWinsWithMultipleOptions,
    average_spaced_options_when_recorded_win:spacedWins ? (a.winningSpacedOptionsTotal/spacedWins).toFixed(4) : "0.0000",
    unique_templates:a.templates.size,
    dominant_template_games:dominant[1],
    dominant_template_pct:pct(dominant[1],n).toFixed(4),
    dominant_template:dominant[0]
  };
}

function newPairAggregate(policy, base, test) {
  return {
    policy, base, test, n:0,
    deltaScoreSum:0, deltaScoreSqSum:0,
    actionDeltaSum:0, actionDeltaSqSum:0,
    sameWinner:0, changedWinner:0,
    testLonger:0, testShorter:0, sameLength:0,
    removedRuleBaseWins:0,
    removedRuleTestOutcomes:{P1:0,P2:0,draw:0}
  };
}
function baseWinUsesRemovedRule(base, test, g) {
  if(base.short === "A" && test.short === "B") return g.recorded_win_type === "spaced-square";
  if(base.short === "B" && test.short === "C") return g.recorded_win_type === "square";
  if(base.short === "A" && test.short === "C") return g.recorded_win_type === "square" || g.recorded_win_type === "spaced-square";
  return false;
}
function addPair(p, baseGame, testGame) {
  p.n++;
  const ds = testGame.p1_score - baseGame.p1_score;
  p.deltaScoreSum += ds; p.deltaScoreSqSum += ds * ds;
  const da = testGame.actions - baseGame.actions;
  p.actionDeltaSum += da; p.actionDeltaSqSum += da * da;
  if(baseGame.winner_name === testGame.winner_name) p.sameWinner++; else p.changedWinner++;
  if(da > 0) p.testLonger++; else if(da < 0) p.testShorter++; else p.sameLength++;
  if(baseWinUsesRemovedRule(p.base, p.test, baseGame)) {
    p.removedRuleBaseWins++;
    p.removedRuleTestOutcomes[testGame.winner_name]++;
  }
}
function pairRow(p) {
  const meanDelta = p.deltaScoreSum / p.n;
  const ci = ciHalfPct(p.deltaScoreSum, p.deltaScoreSqSum, p.n);
  const actionMean = p.actionDeltaSum / p.n;
  return {
    policy:p.policy,
    comparison:`${p.base.short}->${p.test.short}`,
    base_condition:p.base.id,
    test_condition:p.test.id,
    seeds:p.n,
    test_minus_base_p1_score_pp:(100*meanDelta).toFixed(4),
    paired_delta_95ci_low:(100*meanDelta-ci).toFixed(4),
    paired_delta_95ci_high:(100*meanDelta+ci).toFixed(4),
    average_action_delta:actionMean.toFixed(4),
    same_winner:p.sameWinner,
    changed_winner:p.changedWinner,
    test_longer:p.testLonger,
    test_shorter:p.testShorter,
    same_length:p.sameLength,
    base_wins_by_removed_rule:p.removedRuleBaseWins,
    removed_rule_seeds_test_p1:p.removedRuleTestOutcomes.P1,
    removed_rule_seeds_test_p2:p.removedRuleTestOutcomes.P2,
    removed_rule_seeds_test_draw:p.removedRuleTestOutcomes.draw
  };
}

function csvLine(keys, row) {
  const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return keys.map(k => esc(row[k])).join(",") + "\r\n";
}
class CsvBatchWriter {
  constructor(filePath, keys, batchSize=1000) {
    this.filePath=filePath; this.keys=keys; this.batchSize=batchSize; this.buffer=[];
    fs.writeFileSync(filePath, keys.join(",") + "\r\n", "utf8");
  }
  add(row) {
    this.buffer.push(csvLine(this.keys,row));
    if(this.buffer.length >= this.batchSize) this.flush();
  }
  flush() {
    if(!this.buffer.length) return;
    fs.appendFileSync(this.filePath, this.buffer.join(""), "utf8");
    this.buffer=[];
  }
}
function writeCsv(filePath, rows) {
  if(!rows.length) { fs.writeFileSync(filePath, "", "utf8"); return; }
  const keys = Object.keys(rows[0]);
  fs.writeFileSync(filePath, keys.join(",") + "\r\n" + rows.map(r => csvLine(keys,r)).join(""), "utf8");
}

function gameCsvRow(g) {
  const out = {...g};
  delete out.winner;
  for(const k of Object.keys(out)) if(typeof out[k] === "boolean") out[k] = out[k] ? "yes" : "no";
  return out;
}
function matchedRow(policy, gameSeed, byShort) {
  const A=byShort.A, B=byShort.B, C=byShort.C;
  return {
    policy, seed:gameSeed,
    A_winner:A.winner_name, A_p1_score:A.p1_score, A_actions:A.actions, A_win_type:A.recorded_win_type, A_final_any_spaced:A.final_board_any_spaced_square ? "yes":"no",
    B_winner:B.winner_name, B_p1_score:B.p1_score, B_actions:B.actions, B_win_type:B.recorded_win_type, B_final_any_spaced:B.final_board_any_spaced_square ? "yes":"no",
    C_winner:C.winner_name, C_p1_score:C.p1_score, C_actions:C.actions, C_win_type:C.recorded_win_type, C_final_any_spaced:C.final_board_any_spaced_square ? "yes":"no",
    B_minus_A_score:B.p1_score-A.p1_score, C_minus_A_score:C.p1_score-A.p1_score, C_minus_B_score:C.p1_score-B.p1_score,
    B_minus_A_actions:B.actions-A.actions, C_minus_A_actions:C.actions-A.actions, C_minus_B_actions:C.actions-B.actions
  };
}
function templateRows(aggregates) {
  const rows=[];
  for(const a of aggregates) {
    const sorted=[...a.templates.entries()].sort((x,y)=>y[1]-x[1]||x[0].localeCompare(y[0]));
    for(let i=0;i<sorted.length;i++) rows.push({
      policy:a.policy, condition:a.condition.short, condition_id:a.condition.id,
      rank:i+1, games:sorted[i][1], pct:pct(sorted[i][1],games).toFixed(4), template:sorted[i][0]
    });
  }
  return rows;
}

selfTest();
if(hasArg("self-test")) {
  console.log("Lipfty 9 square-removal self-test passed.");
  process.exit(0);
}

const runStarted = Date.now();
archivePreviousResults();
console.log("");
console.log("Lipfty 9 — square-removal comparison");
console.log(`Run started: ${fmtDateTime(runStarted)}`);
console.log(`Results: ${outDir}`);
console.log(`Policies: ${POLICIES.join(" + ")} | ${games} matched seeds per policy | seeds ${seed}-${seed+games-1}`);
console.log("A = Standard; B = no Spaced Square; C = no tight or Spaced Squares.");
console.log("Pinned diagonal corner anchors and all other Lipfty 8 v8.0.22 Standard rules are unchanged.\n");

const tag = `seed${seed}-games${games}`;
const gamesPath = path.join(outDir, `lipfty9-square-removal-games-${tag}.csv`);
const matchedPath = path.join(outDir, `lipfty9-square-removal-matched-${tag}.csv`);
const summaryPath = path.join(outDir, `lipfty9-square-removal-summary-${tag}.csv`);
const pairedPath = path.join(outDir, `lipfty9-square-removal-paired-${tag}.csv`);
const templatesPath = path.join(outDir, `lipfty9-square-removal-templates-${tag}.csv`);
const reportPath = path.join(outDir, `lipfty9-square-removal-report-${tag}.txt`);

const GAME_KEYS = [
  "seed","policy","condition","condition_short","winner_name","p1_score","actions","placements","moves","jumps","redeployments",
  "jump_immediate_wins","redeploy_wins","reached_final_four","recorded_win_type","winning_action","result_category","final_action_colour",
  "final_action_horizontal","final_action_vertical","final_action_diagonal","final_action_square","final_action_spaced_square","final_action_multi_pattern",
  "final_spaced_square_recorded_other","final_board_black_spaced_square","final_board_white_spaced_square","final_board_any_spaced_square",
  "spaced_opportunity_states","spaced_opportunity_actions","spaced_opportunity_only_actions","spaced_opportunity_plus_other_actions",
  "redeploy_spaced_opportunity_states","redeploy_spaced_opportunity_actions","redeploy_spaced_opportunity_only_actions","redeploy_spaced_opportunity_plus_other_actions",
  "winning_spaced_options","max_action_draw","template"
];
const MATCHED_KEYS = [
  "policy","seed",
  "A_winner","A_p1_score","A_actions","A_win_type","A_final_any_spaced",
  "B_winner","B_p1_score","B_actions","B_win_type","B_final_any_spaced",
  "C_winner","C_p1_score","C_actions","C_win_type","C_final_any_spaced",
  "B_minus_A_score","C_minus_A_score","C_minus_B_score",
  "B_minus_A_actions","C_minus_A_actions","C_minus_B_actions"
];
const gameWriter = new CsvBatchWriter(gamesPath, GAME_KEYS);
const matchedWriter = new CsvBatchWriter(matchedPath, MATCHED_KEYS);
const aggregates=[];
const aggregateMap=new Map();
const pairAggregates=[];
const pairMap=new Map();
for(const policy of POLICIES) {
  for(const condition of CONDITIONS) {
    const a=newAggregate(policy,condition); aggregates.push(a); aggregateMap.set(`${policy}|${condition.short}`,a);
  }
  for(const [baseShort,testShort] of [["A","B"],["B","C"],["A","C"]]) {
    const base=CONDITIONS.find(c=>c.short===baseShort), test=CONDITIONS.find(c=>c.short===testShort);
    const p=newPairAggregate(policy,base,test); pairAggregates.push(p); pairMap.set(`${policy}|${baseShort}|${testShort}`,p);
  }
}

let completedGames=0;
const totalGames=games*CONDITIONS.length*POLICIES.length;
let lastProgress=runStarted;

for(const policy of POLICIES) {
  const policyStart=Date.now();
  console.log(`Starting ${policy.toUpperCase()} at ${fmtClock()}...`);
  for(let i=0;i<games;i++) {
    const gameSeed=seed+i;
    const byShort={};
    for(const condition of CONDITIONS) {
      const g=playPinnedGame(gameSeed,condition,policy);
      byShort[condition.short]=g;
      addGame(aggregateMap.get(`${policy}|${condition.short}`),g);
      gameWriter.add(gameCsvRow(g));
      completedGames++;
    }
    addPair(pairMap.get(`${policy}|A|B`),byShort.A,byShort.B);
    addPair(pairMap.get(`${policy}|B|C`),byShort.B,byShort.C);
    addPair(pairMap.get(`${policy}|A|C`),byShort.A,byShort.C);
    matchedWriter.add(matchedRow(policy,gameSeed,byShort));

    const now=Date.now();
    const milestone=i===0 || i+1===games || (i+1)%Math.max(1,Math.ceil(games/20))===0;
    if(milestone || now-lastProgress>=15000) {
      lastProgress=now;
      const elapsed=now-runStarted;
      const eta=completedGames ? elapsed/completedGames*(totalGames-completedGames) : 0;
      const sa=summaryRow(aggregateMap.get(`${policy}|A`));
      const sb=summaryRow(aggregateMap.get(`${policy}|B`));
      const sc=summaryRow(aggregateMap.get(`${policy}|C`));
      console.log(
        `  ${fmtClock(now)} | seeds ${i+1}/${games} | overall ${completedGames}/${totalGames} ${(100*completedGames/totalGames).toFixed(1)}%` +
        ` | P1 score A ${sa.p1_score_pct}% B ${sb.p1_score_pct}% C ${sc.p1_score_pct}%` +
        ` | elapsed ${fmtDuration(elapsed)} | ETA ${fmtDuration(eta)}`
      );
    }
  }
  console.log(`${policy} finished: ${fmtClock()} | ${fmtDuration(Date.now()-policyStart)}\n`);
}

gameWriter.flush(); matchedWriter.flush();

const summaries=aggregates.map(summaryRow);
const pairedRows=pairAggregates.map(pairRow);
writeCsv(summaryPath,summaries);
writeCsv(pairedPath,pairedRows);
writeCsv(templatesPath,templateRows(aggregates));

function summaryFor(policy,short) { return summaries.find(x=>x.policy===policy&&x.condition===short); }
function pairFor(policy,comparison) { return pairedRows.find(x=>x.policy===policy&&x.comparison===comparison); }

const report=[
  "Lipfty 9 — Square-removal comparison",
  `Started: ${fmtDateTime(runStarted)}`,
  `Finished: ${fmtDateTime()}`,
  `Seeds: ${seed}-${seed+games-1} (${games} matched seeds per policy)`,
  `Policies: ${POLICIES.join(", ")}`,
  "",
  "CONDITIONS",
  "A — Lipfty 8 Standard: horizontal, vertical, diagonal, tight square, Spaced Square.",
  "B — No Spaced Square: horizontal, vertical, diagonal, tight square.",
  "C — No Squares: horizontal, vertical, diagonal only.",
  "All other Lipfty 8 v8.0.22 Standard rules are identical, including the four permanently pinned diagonal-colour corner anchors.",
  "",
  "BALANCE AND GAME LENGTH"
];
for(const policy of POLICIES) {
  report.push(`\n${policy.toUpperCase()}`);
  for(const short of ["A","B","C"]) {
    const s=summaryFor(policy,short);
    report.push(
      `${short}: P1 ${s.p1_wins}, P2 ${s.p2_wins}, draws ${s.draws}; P1 score ${s.p1_score_pct}%` +
      ` (95% CI ${s.p1_score_95ci_low}% to ${s.p1_score_95ci_high}%); avg actions ${s.average_actions}` +
      ` (min ${s.min_actions}, max ${s.max_actions}).`
    );
    report.push(
      `   Moves ${s.moves}; Jumps ${s.jumps}; redeployments ${s.redeployments}; Final Four games ${s.final_four_games}; max-action draws ${s.max_action_draws}.`
    );
    report.push(
      `   Recorded wins: H ${s.recorded_horizontal}, V ${s.recorded_vertical}, D ${s.recorded_diagonal}, tight square ${s.recorded_square}, spaced square ${s.recorded_spaced_square}.`
    );
    report.push(
      `   Final boards with valid Spaced Square ${s.final_boards_with_spaced_square}; final-action Spaced Square recorded as another win ${s.final_spaced_square_but_recorded_other}.`
    );
    report.push(
      `   Spaced-square opportunities: ${s.spaced_opportunity_states} decision states / ${s.spaced_opportunity_actions} legal actions` +
      ` (${s.spaced_opportunity_only_actions} spaced-only, ${s.spaced_opportunity_plus_other_actions} also another standard pattern).`
    );
    report.push(`   Distinct outcome/action templates ${s.unique_templates}.`);
  }
  report.push("\nMATCHED-SEED EFFECTS");
  for(const cmp of ["A->B","B->C","A->C"]) {
    const p=pairFor(policy,cmp);
    report.push(
      `${cmp}: test-minus-base P1 score ${p.test_minus_base_p1_score_pp} percentage points` +
      ` (paired 95% CI ${p.paired_delta_95ci_low} to ${p.paired_delta_95ci_high});` +
      ` avg action change ${p.average_action_delta}; changed winner ${p.changed_winner}/${p.seeds}.`
    );
    report.push(
      `   Base wins using removed rule ${p.base_wins_by_removed_rule}; same seeds under test ended P1 ${p.removed_rule_seeds_test_p1}, P2 ${p.removed_rule_seeds_test_p2}, draw ${p.removed_rule_seeds_test_draw}.`
    );
  }
}
report.push(
  "",
  "DIAGNOSTIC NOTES",
  "Recorded win type is kept separate from independent final-board pattern detection, so checkWin() ordering cannot hide a Spaced Square that is also present after the final action.",
  "Spaced Square geometry requires equal row and column spans. Rectangles are explicitly rejected by construction and startup self-test.",
  "Opportunity counts use only actions legal under the pinned-anchor rules. A counted action completes a valid Spaced Square through its destination square.",
  "The A/B/C runs use identical seed ranges within each policy. Paired confidence intervals therefore measure the seed-for-seed effect of removing the relevant square rule.",
  "",
  `Total runtime: ${fmtDuration(Date.now()-runStarted)}`
);
fs.writeFileSync(reportPath,report.join("\r\n")+"\r\n","utf8");

console.log("SUMMARY");
for(const policy of POLICIES) {
  console.log(`  ${policy.toUpperCase()}`);
  for(const short of ["A","B","C"]) {
    const s=summaryFor(policy,short);
    console.log(`    ${short}: P1 score ${s.p1_score_pct}% | avg actions ${s.average_actions} | draws ${s.draws} | H/V/D/Sq/SS ${s.recorded_horizontal}/${s.recorded_vertical}/${s.recorded_diagonal}/${s.recorded_square}/${s.recorded_spaced_square}`);
  }
  for(const cmp of ["A->B","B->C","A->C"]) {
    const p=pairFor(policy,cmp);
    console.log(`    ${cmp}: P1 score delta ${p.test_minus_base_p1_score_pp} pp | avg action delta ${p.average_action_delta} | changed winner ${p.changed_winner}/${p.seeds}`);
  }
}
console.log("");
console.log(`Report: ${reportPath}`);
console.log(`Summary CSV: ${summaryPath}`);
console.log(`Paired CSV: ${pairedPath}`);
console.log(`Per-game CSV: ${gamesPath}`);
console.log(`Matched-seed CSV: ${matchedPath}`);
console.log(`Template CSV: ${templatesPath}`);
console.log(`Total time: ${fmtDuration(Date.now()-runStarted)} | finished ${fmtDateTime()}`);
