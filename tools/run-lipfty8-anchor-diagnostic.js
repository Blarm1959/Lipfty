"use strict";

// Lipfty 8 Config 5 / Config 6 anchor diagnostic.
//
// Purpose:
//   1. Explain why Config 6 records no diagonal wins.
//   2. Explain why locking the four automatic corner pieces sharply reduces jumps.
//
// Config 5: diagonal automatic corner opening; the four opening pieces are mobile.
// Config 6: same opening; the four opening pieces are permanent anchors. They may
//           not Move/Jump and may not be jumped over/redeployed.
//
// This is analysis-only. It does not change the playable game, Lipfty 7 rules,
// the Lipfty 8 simulator, or the existing Config 5-vs-Config 6 comparison runner.

const fs = require("fs");
const path = require("path");
const L8 = require("./lipfty8-simulator.js");
const S = require("./lipfty7-simulator.js");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}

const games = Number(arg("games", "1000"));
const seed = Number(arg("seed", "1"));
const maxActions = Number(arg("max-turns", "500"));
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
const COLOURS = ["black", "white"];

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
function cell(r, c) { return r * 6 + c; }
function rc(i) { return [Math.floor(i / 6), i % 6]; }
function inBounds(r, c) { return r >= 0 && r < 6 && c >= 0 && c < 6; }

function lockedIdsFromState(s) {
  const ids = new Set();
  for(const sq of ANCHOR_SQUARES) {
    const p = s.board[sq];
    if(!p) throw new Error(`Opening anchor square ${sq} is unexpectedly empty at setup.`);
    ids.add(p.id);
  }
  if(ids.size !== 4) throw new Error("Opening did not create four distinct anchor piece IDs.");
  return ids;
}

function checkLockedAnchors(s, anchorIds) {
  for(let i = 0; i < ANCHOR_SQUARES.length; i++) {
    const sq = ANCHOR_SQUARES[i];
    const p = s.board[sq];
    if(!p || p.id !== anchorIds[i]) {
      throw new Error(`Config 6 anchor integrity failure at R${Math.floor(sq / 6) + 1}C${sq % 6 + 1}.`);
    }
  }
}

function actionLockReasons(s, a, lockedIds) {
  const reasons = {blocked:false, moverAnchor:false, jumpedAnchor:false};
  if(a.type !== "move" && a.type !== "jump") return reasons;
  const mover = s.board[a.from];
  if(mover && lockedIds.has(mover.id)) {
    reasons.blocked = true;
    reasons.moverAnchor = true;
  }
  if(a.type === "jump") {
    const jumped = s.board[a.over];
    if(jumped && lockedIds.has(jumped.id)) {
      reasons.blocked = true;
      reasons.jumpedAnchor = true;
    }
  }
  return reasons;
}

function enumerateForConfig(s, colour, config, lockedIds) {
  const raw = S.enumerateActions(s, colour, rules);
  if(!config.locked) return raw;
  return raw.filter(a => !actionLockReasons(s, a, lockedIds).blocked);
}

function actionWins(s, a) {
  return !!S.fastCheckWin(S.boardAfter(s, a), rules, a.to);
}

function handoverDangerLocked(s, colour, lockedIds) {
  const actions = S.enumerateActions(s, colour, rules)
    .filter(a => !actionLockReasons(s, a, lockedIds).blocked);
  if(!actions.length) return -Infinity;
  let best = -Infinity;
  for(const a of actions) best = Math.max(best, S.actionPositionalScore(s, a, rules));
  return best;
}

function chooseColour(s, config, lockedIds) {
  if(!config.locked) return S.chooseColour(s, rules, strength, fixed.finalFourColourPolicy);
  if(s.forcedQueue.length) return s.forcedQueue[0].colour;
  const colours = S.availableColours(s);
  if(!colours.length) return null;
  if(colours.length === 1) return colours[0];
  if(s.finalFour) return S.chooseColour(s, rules, strength, fixed.finalFourColourPolicy);
  if(strength === "random" || s.openingRemaining > 0) {
    return colours[Math.floor(s.rng() * colours.length)];
  }

  const safe = colours.filter(c => enumerateForConfig(s, c, config, lockedIds).filter(a => actionWins(s, a)).length === 0);
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

function chooseAction(s, colour, config, lockedIds) {
  if(!config.locked) return S.chooseAction(s, colour, rules, strength);
  const actions = enumerateForConfig(s, colour, config, lockedIds);
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

function hasLine4(board, colour, dr, dc) {
  for(let r = 0; r < 6; r++) {
    for(let c = 0; c < 6; c++) {
      const er = r + 3 * dr, ec = c + 3 * dc;
      if(!inBounds(er, ec)) continue;
      let ok = true;
      for(let k = 0; k < 4; k++) {
        if(board[cell(r + k * dr, c + k * dc)]?.colour !== colour) {
          ok = false;
          break;
        }
      }
      if(ok) return true;
    }
  }
  return false;
}

function hasTightSquare(board, colour) {
  for(let r = 0; r < 5; r++) {
    for(let c = 0; c < 5; c++) {
      const cells = [cell(r,c), cell(r,c+1), cell(r+1,c), cell(r+1,c+1)];
      if(cells.every(i => board[i]?.colour === colour)) return true;
    }
  }
  return false;
}

function hasSpacedSquare(board, colour) {
  for(let r1 = 0; r1 < 5; r1++) {
    for(let r2 = r1 + 1; r2 < 6; r2++) {
      for(let c1 = 0; c1 < 5; c1++) {
        for(let c2 = c1 + 1; c2 < 6; c2++) {
          // Tight 2x2 is classified separately by the existing rules; this
          // detector counts only genuinely spaced axis-aligned squares.
          if(r2 - r1 === 1 && c2 - c1 === 1) continue;
          const cells = [cell(r1,c1), cell(r1,c2), cell(r2,c1), cell(r2,c2)];
          if(cells.every(i => board[i]?.colour === colour)) return true;
        }
      }
    }
  }
  return false;
}

function patternsOnBoard(board, colour) {
  return {
    horizontal:hasLine4(board, colour, 0, 1),
    vertical:hasLine4(board, colour, 1, 0),
    diagonal:hasLine4(board, colour, 1, 1) || hasLine4(board, colour, 1, -1),
    square:hasTightSquare(board, colour),
    spacedSquare:hasSpacedSquare(board, colour)
  };
}

function diagonalAfter(s, a) {
  const colour = a.colour || s.board[a.from]?.colour;
  if(!colour) return false;
  return patternsOnBoard(S.boardAfter(s, a), colour).diagonal;
}

function newDiag() {
  return {
    decisionStates:0,
    rawMoves:0, allowedMoves:0, blockedMoves:0,
    rawJumps:0, allowedJumps:0, blockedJumps:0,
    blockedJumpMoverAnchor:0,
    blockedJumpedAnchor:0,
    blockedJumpBothAnchor:0,
    statesAnyRawJump:0,
    statesAnyAllowedJump:0,
    statesAllJumpsBlocked:0,
    selectedStatesRawJump:0,
    selectedStatesAllowedJump:0,
    selectedStatesAllJumpsBlocked:0,
    selectedRawJumps:0,
    selectedAllowedJumps:0,
    rawWinningActions:0,
    allowedWinningActions:0,
    blockedWinningActions:0,
    rawDiagonalWinningActions:0,
    allowedDiagonalWinningActions:0,
    blockedDiagonalWinningActions:0,
    actualMoves:0,
    actualJumps:0,
    anchorOriginMoves:0,
    anchorOriginJumps:0,
    jumpsOverAnchor:0,
    gamesWithAnchorInvolvement:0,
    recordedDiagonalWins:0,
    finalBoardsWithDiagonal:0,
    finalBoardsWithDiagonalButRecordedOther:0,
    finalBoardsWithMultiplePatterns:0,
    finalPatternHorizontal:0,
    finalPatternVertical:0,
    finalPatternDiagonal:0,
    finalPatternSquare:0,
    finalPatternSpacedSquare:0
  };
}

function inspectDecision(s, config, lockedIds, d, selectedColour = null) {
  d.decisionStates++;
  let stateRawJumps = 0, stateAllowedJumps = 0;

  for(const colour of S.availableColours(s)) {
    const raw = S.enumerateActions(s, colour, rules);
    for(const a of raw) {
      const lock = actionLockReasons(s, a, lockedIds);
      const allowed = !config.locked || !lock.blocked;
      if(a.type === "move") {
        d.rawMoves++;
        if(allowed) d.allowedMoves++;
        else d.blockedMoves++;
      }
      if(a.type === "jump") {
        d.rawJumps++;
        stateRawJumps++;
        if(allowed) {
          d.allowedJumps++;
          stateAllowedJumps++;
        } else {
          d.blockedJumps++;
          if(lock.moverAnchor) d.blockedJumpMoverAnchor++;
          if(lock.jumpedAnchor) d.blockedJumpedAnchor++;
          if(lock.moverAnchor && lock.jumpedAnchor) d.blockedJumpBothAnchor++;
        }
      }
      if(actionWins(s, a)) {
        d.rawWinningActions++;
        if(allowed) d.allowedWinningActions++;
        else d.blockedWinningActions++;
        if(diagonalAfter(s, a)) {
          d.rawDiagonalWinningActions++;
          if(allowed) d.allowedDiagonalWinningActions++;
          else d.blockedDiagonalWinningActions++;
        }
      }
    }
  }

  if(stateRawJumps > 0) d.statesAnyRawJump++;
  if(stateAllowedJumps > 0) d.statesAnyAllowedJump++;
  if(stateRawJumps > 0 && stateAllowedJumps === 0) d.statesAllJumpsBlocked++;

  if(selectedColour) {
    const raw = S.enumerateActions(s, selectedColour, rules).filter(a => a.type === "jump");
    const allowed = raw.filter(a => !config.locked || !actionLockReasons(s, a, lockedIds).blocked);
    d.selectedRawJumps += raw.length;
    d.selectedAllowedJumps += allowed.length;
    if(raw.length) d.selectedStatesRawJump++;
    if(allowed.length) d.selectedStatesAllowedJump++;
    if(raw.length && !allowed.length) d.selectedStatesAllJumpsBlocked++;
  }
}

function finaliseGamePatterns(s, g, d) {
  if(g.winner !== 0 && g.winner !== 1) return;
  const winnerColour = g.winnerColour;
  if(!winnerColour) return;
  const p = patternsOnBoard(s.board, winnerColour);
  const n = Object.values(p).filter(Boolean).length;
  if(p.horizontal) d.finalPatternHorizontal++;
  if(p.vertical) d.finalPatternVertical++;
  if(p.diagonal) d.finalPatternDiagonal++;
  if(p.square) d.finalPatternSquare++;
  if(p.spacedSquare) d.finalPatternSpacedSquare++;
  if(p.diagonal) d.finalBoardsWithDiagonal++;
  if(p.diagonal && g.winType !== "diagonal") d.finalBoardsWithDiagonalButRecordedOther++;
  if(n > 1) d.finalBoardsWithMultiplePatterns++;
  if(g.winType === "diagonal") d.recordedDiagonalWins++;
}

function playInstrumented(config, gameSeed, aggregateDiag) {
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
  const per = newDiag();
  let winType = null;
  let winningActionType = null;
  let winnerColour = null;
  let anchorInvolved = false;

  if(config.locked) checkLockedAnchors(s, anchorIds);

  while(s.winner === null && s.turns < maxActions) {
    S.commitSequentialSecond(s, rules, strength);
    S.commitBoundarySelfCorner(s, rules, strength);
    S.commitBoundaryCorner(s, rules, strength);

    inspectDecision(s, config, lockedIds, per, null);

    const colour = chooseColour(s, config, lockedIds);
    if(!colour) { s.winner = "draw"; break; }
    inspectDecisionSelectedOnly(s, config, lockedIds, per, colour);

    const action = chooseAction(s, colour, config, lockedIds);
    if(!action) { s.winner = "draw"; break; }

    const moverBefore = (action.type === "move" || action.type === "jump") ? s.board[action.from] : null;
    const jumpedBefore = action.type === "jump" ? s.board[action.over] : null;
    const moverIsAnchor = !!moverBefore && lockedIds.has(moverBefore.id);
    const jumpedIsAnchor = !!jumpedBefore && lockedIds.has(jumpedBefore.id);

    if(action.type === "move") {
      per.actualMoves++;
      if(moverIsAnchor) {
        per.anchorOriginMoves++;
        anchorInvolved = true;
      }
    } else if(action.type === "jump") {
      per.actualJumps++;
      if(moverIsAnchor) {
        per.anchorOriginJumps++;
        anchorInvolved = true;
      }
      if(jumpedIsAnchor) {
        per.jumpsOverAnchor++;
        anchorInvolved = true;
      }
    }

    const result = S.applyAction(s, action, rules);
    if(config.locked) checkLockedAnchors(s, anchorIds);

    if(result.ended) {
      winType = result.winType || null;
      winningActionType = action.type.includes("place") ? "placement" : action.type;
      winnerColour = colour;
      break;
    }

    if(action.type === "jump" && s.jumpConsequence !== "current") {
      const response = S.resolveJumpRedeploy(s, action, rules, strength);
      if(config.locked) checkLockedAnchors(s, anchorIds);
      if(response.stage === "redeploy") {
        winType = response.firstResult.winType || null;
        winningActionType = "redeploy";
        winnerColour = jumpedBefore?.colour || null;
        break;
      }
    } else if(action.type === "move" || action.type === "jump") {
      S.commitMoveResponse(s, rules, strength);
    }

    if(config.locked) checkLockedAnchors(s, anchorIds);
  }

  if(s.winner === null) s.winner = "draw";
  if(anchorInvolved) per.gamesWithAnchorInvolvement = 1;

  const g = {
    seed:gameSeed,
    config:config.number,
    winner:s.winner,
    turns:s.turns,
    winType,
    winningActionType,
    winnerColour,
    maxActionDraw:s.winner === "draw" && s.turns >= maxActions
  };
  finaliseGamePatterns(s, g, per);
  addDiag(aggregateDiag, per);

  return {
    ...g,
    recorded_win_type:winType || "",
    final_diagonal:per.finalBoardsWithDiagonal ? "yes" : "no",
    final_diagonal_recorded_other:per.finalBoardsWithDiagonalButRecordedOther ? "yes" : "no",
    final_multi_pattern:per.finalBoardsWithMultiplePatterns ? "yes" : "no",
    actual_moves:per.actualMoves,
    actual_jumps:per.actualJumps,
    anchor_origin_moves:per.anchorOriginMoves,
    anchor_origin_jumps:per.anchorOriginJumps,
    jumps_over_anchor:per.jumpsOverAnchor,
    selected_raw_jump_opportunities:per.selectedRawJumps,
    selected_allowed_jump_opportunities:per.selectedAllowedJumps,
    blocked_jump_opportunities:per.blockedJumps,
    blocked_diagonal_winning_actions:per.blockedDiagonalWinningActions
  };
}

// Keep the broad all-colour decision scan and the selected-colour scan separate
// so decisionStates is counted once per actual turn.
function inspectDecisionSelectedOnly(s, config, lockedIds, d, selectedColour) {
  const raw = S.enumerateActions(s, selectedColour, rules).filter(a => a.type === "jump");
  const allowed = raw.filter(a => !config.locked || !actionLockReasons(s, a, lockedIds).blocked);
  d.selectedRawJumps += raw.length;
  d.selectedAllowedJumps += allowed.length;
  if(raw.length) d.selectedStatesRawJump++;
  if(allowed.length) d.selectedStatesAllowedJump++;
  if(raw.length && !allowed.length) d.selectedStatesAllJumpsBlocked++;
}

function addDiag(total, x) {
  for(const k of Object.keys(total)) total[k] += x[k] || 0;
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

function summaryRow(config, wins, draws, totalActions, d) {
  const n = games;
  return {
    config:config.number,
    label:config.label,
    games:n,
    p1_wins:wins[0],
    p2_wins:wins[1],
    draws,
    p1_pct:pct(wins[0],n).toFixed(4),
    average_actions:(totalActions/n).toFixed(4),
    actual_moves:d.actualMoves,
    actual_jumps:d.actualJumps,
    recorded_diagonal_wins:d.recordedDiagonalWins,
    final_boards_with_diagonal:d.finalBoardsWithDiagonal,
    final_diagonal_but_recorded_other:d.finalBoardsWithDiagonalButRecordedOther,
    final_multi_pattern_wins:d.finalBoardsWithMultiplePatterns,
    final_pattern_horizontal:d.finalPatternHorizontal,
    final_pattern_vertical:d.finalPatternVertical,
    final_pattern_diagonal:d.finalPatternDiagonal,
    final_pattern_square:d.finalPatternSquare,
    final_pattern_spaced_square:d.finalPatternSpacedSquare,
    anchor_origin_moves:d.anchorOriginMoves,
    anchor_origin_jumps:d.anchorOriginJumps,
    jumps_over_anchor:d.jumpsOverAnchor,
    games_with_anchor_involvement:d.gamesWithAnchorInvolvement,
    raw_jump_opportunities:d.rawJumps,
    allowed_jump_opportunities:d.allowedJumps,
    blocked_jump_opportunities:d.blockedJumps,
    blocked_jump_mover_anchor:d.blockedJumpMoverAnchor,
    blocked_jump_over_anchor:d.blockedJumpedAnchor,
    selected_raw_jump_opportunities:d.selectedRawJumps,
    selected_allowed_jump_opportunities:d.selectedAllowedJumps,
    selected_states_raw_jump:d.selectedStatesRawJump,
    selected_states_allowed_jump:d.selectedStatesAllowedJump,
    selected_states_all_jumps_blocked:d.selectedStatesAllJumpsBlocked,
    raw_winning_actions:d.rawWinningActions,
    allowed_winning_actions:d.allowedWinningActions,
    blocked_winning_actions:d.blockedWinningActions,
    raw_diagonal_winning_actions:d.rawDiagonalWinningActions,
    allowed_diagonal_winning_actions:d.allowedDiagonalWinningActions,
    blocked_diagonal_winning_actions:d.blockedDiagonalWinningActions
  };
}

function reasonLines(s5, s6) {
  const lines = [];
  lines.push("DIAGONAL DIAGNOSTIC");
  if(s6.final_boards_with_diagonal > 0 && s6.recorded_diagonal_wins === 0) {
    lines.push(
      `Config 6 has ${s6.final_boards_with_diagonal} winning final boards containing a diagonal four, ` +
      `but none recorded as diagonal. This means win-type priority/overlap is masking diagonals rather than eliminating them.`
    );
  } else if(s6.final_boards_with_diagonal === 0) {
    lines.push("Config 6 produced no winning final board containing a diagonal four: the disappearance is genuine, not just win-type labelling.");
  } else {
    lines.push(`Config 6 recorded ${s6.recorded_diagonal_wins} diagonal wins and ${s6.final_boards_with_diagonal} final boards containing a diagonal.`);
  }
  lines.push(
    `Config 6 raw immediate diagonal-winning actions ${s6.raw_diagonal_winning_actions}; ` +
    `allowed ${s6.allowed_diagonal_winning_actions}; blocked by anchors ${s6.blocked_diagonal_winning_actions}.`
  );
  lines.push("");
  lines.push("JUMP DIAGNOSTIC");
  lines.push(
    `Config 5 actual jumps ${s5.actual_jumps}; opening-anchor origin jumps ${s5.anchor_origin_jumps}; ` +
    `jumps over an opening anchor ${s5.jumps_over_anchor}.`
  );
  lines.push(
    `Config 6 raw jump opportunities ${s6.raw_jump_opportunities}; allowed ${s6.allowed_jump_opportunities}; ` +
    `blocked ${s6.blocked_jump_opportunities}.`
  );
  lines.push(
    `Of Config 6 blocked jump opportunities: mover was an anchor ${s6.blocked_jump_mover_anchor}; ` +
    `jumped piece was an anchor ${s6.blocked_jump_over_anchor}.`
  );
  lines.push(
    `For the actually handed colour in Config 6, ${s6.selected_states_all_jumps_blocked} decision states had one or more raw jumps but every one was removed by the anchor rule.`
  );
  return lines;
}

const runStarted = Date.now();
fs.mkdirSync(outDir, {recursive:true});
const allRows = [];
const summaries = [];
let completed = 0;
const total = games * CONFIGS.length;
let lastProgress = runStarted;

console.log("Lipfty 8 — Config 5 / Config 6 anchor diagnostic");
console.log(`Run started: ${fmtDateTime(runStarted)}`);
console.log(`Results: ${outDir}`);
console.log(`Games: ${games} per configuration | same seeds ${seed}-${seed + games - 1} | ${strength} strength.`);
console.log("Existing simulation result files are NOT archived or moved by this diagnostic.\n");

for(let ci = 0; ci < CONFIGS.length; ci++) {
  const config = CONFIGS[ci];
  const d = newDiag();
  const wins = [0,0];
  let draws = 0, totalActions = 0;
  const started = Date.now();
  console.log(`Starting ${ci + 1}/${CONFIGS.length} — ${config.label} at ${fmtClock()}...`);

  for(let i = 0; i < games; i++) {
    const gameSeed = seed + i;
    const row = playInstrumented(config, gameSeed, d);
    allRows.push(row);
    if(row.winner === "draw") draws++;
    else wins[row.winner]++;
    totalActions += row.turns;
    completed++;

    const now = Date.now();
    const milestone = i === 0 || i + 1 === games || (i + 1) % Math.max(1, Math.ceil(games / 20)) === 0;
    if(milestone || now - lastProgress >= 15000) {
      lastProgress = now;
      const elapsed = now - runStarted;
      const eta = completed ? elapsed / completed * (total - completed) : 0;
      console.log(
        `  ${fmtClock(now)} | ${i + 1}/${games} | overall ${completed}/${total} ${(100 * completed / total).toFixed(1)}%` +
        ` | P1 ${wins[0]} P2 ${wins[1]} D${draws} | elapsed ${fmtDuration(elapsed)} | ETA ${fmtDuration(eta)}`
      );
    }
  }

  const summary = summaryRow(config, wins, draws, totalActions, d);
  summaries.push(summary);
  console.log(`Config ${config.number} finished: ${fmtClock()} | ${fmtDuration(Date.now() - started)}\n`);
}

const s5 = summaries[0], s6 = summaries[1];
const reportLines = [
  "Lipfty 8 — Config 5 / Config 6 anchor diagnostic",
  `Started: ${fmtDateTime(runStarted)}`,
  `Finished: ${fmtDateTime()}`,
  `Seeds: ${seed}-${seed + games - 1} (${games} games each)`,
  "",
  `Config 5: P1 ${s5.p1_wins} (${s5.p1_pct}%), P2 ${s5.p2_wins}, Draw ${s5.draws}, avg actions ${s5.average_actions}`,
  `Config 6: P1 ${s6.p1_wins} (${s6.p1_pct}%), P2 ${s6.p2_wins}, Draw ${s6.draws}, avg actions ${s6.average_actions}`,
  "",
  ...reasonLines(s5, s6),
  "",
  "FINAL-WIN PATTERNS (independent detectors; more than one may be true on the same final board)",
  `Config 5: H ${s5.final_pattern_horizontal}, V ${s5.final_pattern_vertical}, D ${s5.final_pattern_diagonal}, tight square ${s5.final_pattern_square}, spaced square ${s5.final_pattern_spaced_square}, multi-pattern ${s5.final_multi_pattern_wins}`,
  `Config 6: H ${s6.final_pattern_horizontal}, V ${s6.final_pattern_vertical}, D ${s6.final_pattern_diagonal}, tight square ${s6.final_pattern_square}, spaced square ${s6.final_pattern_spaced_square}, multi-pattern ${s6.final_multi_pattern_wins}`,
  "",
  `Total runtime: ${fmtDuration(Date.now() - runStarted)}`
];

const tag = `seed${seed}-games${games}`;
const summaryPath = path.join(outDir, `lipfty8-anchor-diagnostic-summary-${tag}.csv`);
const gamesPath = path.join(outDir, `lipfty8-anchor-diagnostic-games-${tag}.csv`);
const reportPath = path.join(outDir, `lipfty8-anchor-diagnostic-report-${tag}.txt`);
writeCsv(summaryPath, summaries);
writeCsv(gamesPath, allRows);
fs.writeFileSync(reportPath, reportLines.join("\r\n") + "\r\n", "utf8");

console.log("SUMMARY");
console.log(`  Config 5 actual jumps: ${s5.actual_jumps} | anchor-origin ${s5.anchor_origin_jumps} | over-anchor ${s5.jumps_over_anchor}`);
console.log(`  Config 6 actual jumps: ${s6.actual_jumps} | raw opportunities ${s6.raw_jump_opportunities} | allowed ${s6.allowed_jump_opportunities} | blocked ${s6.blocked_jump_opportunities}`);
console.log(`  Config 6 recorded diagonal wins: ${s6.recorded_diagonal_wins} | final winning boards containing diagonal: ${s6.final_boards_with_diagonal}`);
console.log(`  Config 6 raw/allowed/blocked immediate diagonal wins: ${s6.raw_diagonal_winning_actions}/${s6.allowed_diagonal_winning_actions}/${s6.blocked_diagonal_winning_actions}`);
console.log("");
for(const line of reasonLines(s5, s6)) console.log(line);
console.log("");
console.log(`Report: ${reportPath}`);
console.log(`Summary CSV: ${summaryPath}`);
console.log(`Per-game CSV: ${gamesPath}`);
console.log(`Total time: ${fmtDuration(Date.now() - runStarted)} | finished ${fmtDateTime()}`);
