"use strict";

// Lipfty 8 pinned-corner diversity test.
//
// Baseline under test:
//   - four automatic opening pieces on the corners of the inner 6x6
//   - same colours diagonally opposite
//   - those four opening pieces are permanent anchors
//
// Purpose:
//   Compare the same pinned game under tactical and random play so we can see
//   whether the low jump rate and absence of diagonal wins are properties of
//   the rules or mainly properties of the tactical policy.
//
// This is analysis-only. It does not change the playable game or frozen rules.

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
const maxActions = Number(arg("max-turns", "500"));
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
const ANCHOR_SQUARES = [0, 5, 30, 35];

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
function inBounds(r, c) { return r >= 0 && r < 6 && c >= 0 && c < 6; }

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

function checkAnchors(s, anchorIds) {
  for(let i = 0; i < ANCHOR_SQUARES.length; i++) {
    const sq = ANCHOR_SQUARES[i];
    const p = s.board[sq];
    if(!p || p.id !== anchorIds[i]) {
      throw new Error(`Pinned-corner integrity failure at R${Math.floor(sq / 6) + 1}C${sq % 6 + 1}.`);
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

function enumerateLocked(s, colour, lockedIds) {
  return S.enumerateActions(s, colour, rules).filter(a => !isLockedAction(s, a, lockedIds));
}

function actionWins(s, a) {
  return !!S.fastCheckWin(S.boardAfter(s, a), rules, a.to);
}

function handoverDangerLocked(s, colour, lockedIds) {
  const actions = enumerateLocked(s, colour, lockedIds);
  if(!actions.length) return -Infinity;
  let best = -Infinity;
  for(const a of actions) best = Math.max(best, S.actionPositionalScore(s, a, rules));
  return best;
}

function chooseColourLocked(s, lockedIds, policy) {
  if(s.forcedQueue.length) return s.forcedQueue[0].colour;
  const colours = S.availableColours(s);
  if(!colours.length) return null;
  if(colours.length === 1) return colours[0];
  if(s.finalFour) return S.chooseColour(s, rules, policy, fixed.finalFourColourPolicy);
  if(policy === "random" || s.openingRemaining > 0) {
    return colours[Math.floor(s.rng() * colours.length)];
  }

  const safe = colours.filter(c => enumerateLocked(s, c, lockedIds).filter(a => actionWins(s, a)).length === 0);
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

function chooseActionLocked(s, colour, lockedIds, policy) {
  const actions = enumerateLocked(s, colour, lockedIds);
  if(!actions.length) return null;
  const planned = s.forcedQueue[0]?.plannedTo;
  if(planned !== undefined) {
    const action = actions.find(a => a.to === planned);
    if(action) return action;
  }
  if(policy === "random") return actions[Math.floor(s.rng() * actions.length)];

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
  for(let span = 2; span < 6; span++) {
    for(let r = 0; r + span < 6; r++) {
      for(let c = 0; c + span < 6; c++) {
        const cells = [cell(r,c), cell(r,c+span), cell(r+span,c), cell(r+span,c+span)];
        if(cells.every(i => board[i]?.colour === colour)) return true;
      }
    }
  }
  return false;
}

function finalPatterns(board, colour) {
  if(!colour) return {horizontal:false, vertical:false, diagonal:false, square:false, spacedSquare:false};
  return {
    horizontal:hasLine4(board, colour, 0, 1),
    vertical:hasLine4(board, colour, 1, 0),
    diagonal:hasLine4(board, colour, 1, 1) || hasLine4(board, colour, 1, -1),
    square:hasTightSquare(board, colour),
    spacedSquare:hasSpacedSquare(board, colour)
  };
}

function playPinnedGame(gameSeed, policy) {
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
  checkAnchors(s, anchorIds);

  const stats = {
    placements:0,
    moves:0,
    jumps:0,
    redeployments:0,
    jumpImmediateWins:0,
    redeployWins:0
  };
  let winType = null;
  let winningAction = null;
  let winnerColour = null;

  while(s.winner === null && s.turns < maxActions) {
    S.commitSequentialSecond(s, rules, policy);
    S.commitBoundarySelfCorner(s, rules, policy);
    S.commitBoundaryCorner(s, rules, policy);

    const colour = chooseColourLocked(s, lockedIds, policy);
    if(!colour) { s.winner = "draw"; break; }
    const action = chooseActionLocked(s, colour, lockedIds, policy);
    if(!action) { s.winner = "draw"; break; }

    if(action.type.includes("place")) stats.placements++;
    else if(action.type === "move") stats.moves++;
    else if(action.type === "jump") stats.jumps++;

    const jumpedBefore = action.type === "jump" ? s.board[action.over] : null;
    const result = S.applyAction(s, action, rules);
    checkAnchors(s, anchorIds);

    if(result.ended) {
      winType = result.winType || null;
      winningAction = action.type.includes("place") ? "placement" : action.type;
      winnerColour = colour;
      if(action.type === "jump") stats.jumpImmediateWins++;
      break;
    }

    if(action.type === "jump" && s.jumpConsequence !== "current") {
      const response = S.resolveJumpRedeploy(s, action, rules, policy);
      stats.redeployments++;
      checkAnchors(s, anchorIds);
      if(response.stage === "redeploy") {
        winType = response.firstResult.winType || null;
        winningAction = "redeploy";
        winnerColour = jumpedBefore?.colour || null;
        stats.redeployWins++;
        break;
      }
    } else if(action.type === "move" || action.type === "jump") {
      S.commitMoveResponse(s, rules, policy);
    }

    checkAnchors(s, anchorIds);
  }

  if(s.winner === null) s.winner = "draw";
  const patterns = (s.winner === 0 || s.winner === 1) ? finalPatterns(s.board, winnerColour) : finalPatterns([], null);
  const patternCount = Object.values(patterns).filter(Boolean).length;
  const template = [
    actorName(s.winner),
    s.turns,
    winType || "none",
    winningAction || "none",
    stats.moves,
    stats.jumps,
    stats.redeployments
  ].join("|");

  return {
    seed:gameSeed,
    policy,
    winner:actorName(s.winner),
    actions:s.turns,
    win_type:winType || "",
    winning_action:winningAction || "",
    winner_colour:winnerColour || "",
    placements:stats.placements,
    moves:stats.moves,
    jumps:stats.jumps,
    redeployments:stats.redeployments,
    jump_immediate_wins:stats.jumpImmediateWins,
    redeploy_wins:stats.redeployWins,
    reached_final_four:s.reachedFinalFour ? "yes" : "no",
    final_horizontal:patterns.horizontal ? "yes" : "no",
    final_vertical:patterns.vertical ? "yes" : "no",
    final_diagonal:patterns.diagonal ? "yes" : "no",
    final_square:patterns.square ? "yes" : "no",
    final_spaced_square:patterns.spacedSquare ? "yes" : "no",
    final_multi_pattern:patternCount > 1 ? "yes" : "no",
    template
  };
}

function newAggregate(policy) {
  return {
    policy,
    wins:{P1:0,P2:0,draw:0},
    totalActions:0,
    minActions:Infinity,
    maxActions:0,
    placements:0,
    moves:0,
    jumps:0,
    redeployments:0,
    jumpImmediateWins:0,
    redeployWins:0,
    finalFour:0,
    winTypes:{},
    winningActions:{},
    finalPatterns:{horizontal:0,vertical:0,diagonal:0,square:0,spacedSquare:0,multi:0},
    templates:new Map(),
    rows:[]
  };
}

function addGame(a, g) {
  a.rows.push(g);
  a.wins[g.winner]++;
  a.totalActions += g.actions;
  a.minActions = Math.min(a.minActions, g.actions);
  a.maxActions = Math.max(a.maxActions, g.actions);
  a.placements += g.placements;
  a.moves += g.moves;
  a.jumps += g.jumps;
  a.redeployments += g.redeployments;
  a.jumpImmediateWins += g.jump_immediate_wins;
  a.redeployWins += g.redeploy_wins;
  if(g.reached_final_four === "yes") a.finalFour++;
  if(g.win_type) a.winTypes[g.win_type] = (a.winTypes[g.win_type] || 0) + 1;
  if(g.winning_action) a.winningActions[g.winning_action] = (a.winningActions[g.winning_action] || 0) + 1;
  if(g.final_horizontal === "yes") a.finalPatterns.horizontal++;
  if(g.final_vertical === "yes") a.finalPatterns.vertical++;
  if(g.final_diagonal === "yes") a.finalPatterns.diagonal++;
  if(g.final_square === "yes") a.finalPatterns.square++;
  if(g.final_spaced_square === "yes") a.finalPatterns.spacedSquare++;
  if(g.final_multi_pattern === "yes") a.finalPatterns.multi++;
  a.templates.set(g.template, (a.templates.get(g.template) || 0) + 1);
}

function summaryRow(a) {
  const dominant = [...a.templates.entries()].sort((x,y) => y[1] - x[1])[0] || ["",0];
  return {
    policy:a.policy,
    games,
    p1_wins:a.wins.P1,
    p2_wins:a.wins.P2,
    draws:a.wins.draw,
    p1_score_pct:pct(a.wins.P1 + a.wins.draw / 2, games).toFixed(4),
    distance_from_50_pp:Math.abs(pct(a.wins.P1 + a.wins.draw / 2, games) - 50).toFixed(4),
    average_actions:(a.totalActions / games).toFixed(4),
    min_actions:a.minActions,
    max_actions:a.maxActions,
    placements:a.placements,
    moves:a.moves,
    jumps:a.jumps,
    redeployments:a.redeployments,
    jump_immediate_wins:a.jumpImmediateWins,
    redeploy_wins:a.redeployWins,
    final_four_pct:pct(a.finalFour, games).toFixed(4),
    recorded_horizontal:a.winTypes.horizontal || 0,
    recorded_vertical:a.winTypes.vertical || 0,
    recorded_diagonal:a.winTypes.diagonal || 0,
    recorded_square:a.winTypes.square || 0,
    recorded_spaced_square:a.winTypes["spaced-square"] || 0,
    winning_placement:a.winningActions.placement || 0,
    winning_move:a.winningActions.move || 0,
    winning_jump:a.winningActions.jump || 0,
    winning_redeploy:a.winningActions.redeploy || 0,
    final_pattern_horizontal:a.finalPatterns.horizontal,
    final_pattern_vertical:a.finalPatterns.vertical,
    final_pattern_diagonal:a.finalPatterns.diagonal,
    final_pattern_square:a.finalPatterns.square,
    final_pattern_spaced_square:a.finalPatterns.spacedSquare,
    final_multi_pattern:a.finalPatterns.multi,
    unique_templates:a.templates.size,
    dominant_template_games:dominant[1],
    dominant_template_pct:pct(dominant[1], games).toFixed(4),
    dominant_template:dominant[0]
  };
}

function templateRows(a) {
  return [...a.templates.entries()]
    .sort((x,y) => y[1] - x[1] || x[0].localeCompare(y[0]))
    .map(([template,count], i) => ({
      policy:a.policy,
      rank:i + 1,
      games:count,
      pct:pct(count, games).toFixed(4),
      template
    }));
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

function formatCounts(obj, keys) {
  return keys.map(k => `${k} ${obj[k] || 0}`).join(", ");
}

const runStarted = Date.now();
archivePreviousResults();
console.log("");
console.log("Lipfty 8 — pinned diagonal-corner diversity test");
console.log(`Run started: ${fmtDateTime(runStarted)}`);
console.log(`Results: ${outDir}`);
console.log(`Pinned setup only; policies: ${POLICIES.join(" + ")}`);
console.log(`Games: ${games} per policy | seeds ${seed}-${seed + games - 1}.`);
console.log("The four automatic diagonal-colour inner-board corner pieces remain pinned throughout.\n");

const aggregates = [];
let completed = 0;
const total = games * POLICIES.length;
let lastProgress = runStarted;

for(let pi = 0; pi < POLICIES.length; pi++) {
  const policy = POLICIES[pi];
  const a = newAggregate(policy);
  aggregates.push(a);
  const started = Date.now();
  console.log(`Starting ${pi + 1}/${POLICIES.length} — ${policy.toUpperCase()} at ${fmtClock()}...`);

  for(let i = 0; i < games; i++) {
    const g = playPinnedGame(seed + i, policy);
    addGame(a, g);
    completed++;

    const now = Date.now();
    const milestone = i === 0 || i + 1 === games || (i + 1) % Math.max(1, Math.ceil(games / 20)) === 0;
    if(milestone || now - lastProgress >= 15000) {
      lastProgress = now;
      const elapsed = now - runStarted;
      const eta = completed ? elapsed / completed * (total - completed) : 0;
      console.log(
        `  ${fmtClock(now)} | ${i + 1}/${games} | overall ${completed}/${total} ${(100 * completed / total).toFixed(1)}%` +
        ` | P1 ${a.wins.P1} P2 ${a.wins.P2} D${a.wins.draw}` +
        ` | elapsed ${fmtDuration(elapsed)} | ETA ${fmtDuration(eta)}`
      );
    }
  }
  console.log(`${policy} finished: ${fmtClock()} | ${fmtDuration(Date.now() - started)}\n`);
}

const summaries = aggregates.map(summaryRow);
const templateData = aggregates.flatMap(templateRows);
const report = [
  "Lipfty 8 — pinned diagonal-corner diversity test",
  `Started: ${fmtDateTime(runStarted)}`,
  `Finished: ${fmtDateTime()}`,
  `Seeds: ${seed}-${seed + games - 1} (${games} games per policy)`,
  "",
  "BASELINE",
  "Four automatic pieces on the corners of the inner 6x6, same colours diagonally opposite, permanently pinned.",
  "",
  ...aggregates.flatMap((a, i) => {
    const s = summaries[i];
    const top = templateRows(a).slice(0, 5);
    return [
      `${a.policy.toUpperCase()}: P1 ${s.p1_wins}, P2 ${s.p2_wins}, Draw ${s.draws}; P1 score ${s.p1_score_pct}%`,
      `Actions avg ${s.average_actions} (min ${s.min_actions}, max ${s.max_actions}); moves ${s.moves}; jumps ${s.jumps}; redeployments ${s.redeployments}`,
      `Jump immediate wins ${s.jump_immediate_wins}; redeploy wins ${s.redeploy_wins}; Final Four ${s.final_four_pct}%`,
      `Recorded wins: ${formatCounts(a.winTypes, ["horizontal","vertical","diagonal","square","spaced-square"])}`,
      `Independent final patterns: H ${s.final_pattern_horizontal}, V ${s.final_pattern_vertical}, D ${s.final_pattern_diagonal}, tight square ${s.final_pattern_square}, spaced square ${s.final_pattern_spaced_square}, multi ${s.final_multi_pattern}`,
      `Distinct outcome/action templates ${s.unique_templates}; dominant template ${s.dominant_template_games}/${games} (${s.dominant_template_pct}%)`,
      `Top templates: ${top.map(t => `${t.games} x ${t.template}`).join("; ") || "none"}`,
      ""
    ];
  }),
  "INTERPRETATION GUIDE",
  "If random play restores diagonal wins and materially increases jumps, the tactical zero-diagonal/low-jump result is mainly policy-driven rather than a structural consequence of pinning.",
  "If both policies show the same suppression, that is stronger evidence that the pinned opening itself changes those parts of play.",
  "A much larger random-policy template count would also confirm that the small tactical template set is a simulator-policy effect.",
  "",
  `Total runtime: ${fmtDuration(Date.now() - runStarted)}`
];

const tag = `seed${seed}-games${games}`;
const summaryPath = path.join(outDir, `lipfty8-pinned-diversity-summary-${tag}.csv`);
const gamesPath = path.join(outDir, `lipfty8-pinned-diversity-games-${tag}.csv`);
const templatesPath = path.join(outDir, `lipfty8-pinned-diversity-templates-${tag}.csv`);
const reportPath = path.join(outDir, `lipfty8-pinned-diversity-report-${tag}.txt`);

writeCsv(summaryPath, summaries);
writeCsv(gamesPath, aggregates.flatMap(a => a.rows));
writeCsv(templatesPath, templateData);
fs.writeFileSync(reportPath, report.join("\r\n") + "\r\n", "utf8");

console.log("SUMMARY");
for(const s of summaries) {
  console.log(
    `  ${s.policy}: P1 score ${s.p1_score_pct}% | avg actions ${s.average_actions}` +
    ` | jumps ${s.jumps} | recorded diagonals ${s.recorded_diagonal}` +
    ` | final diagonals ${s.final_pattern_diagonal} | templates ${s.unique_templates}`
  );
}
console.log("");
console.log(`Report: ${reportPath}`);
console.log(`Summary CSV: ${summaryPath}`);
console.log(`Per-game CSV: ${gamesPath}`);
console.log(`Template CSV: ${templatesPath}`);
console.log(`Total time: ${fmtDuration(Date.now() - runStarted)} | finished ${fmtDateTime()}`);
