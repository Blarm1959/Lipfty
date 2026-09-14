"use strict";

// Lipfty 8 counter-reply / one-more-decision probe.
//
// Purpose: deepen the v8.0.14 immediate-reply/refutation result by one more
// decision.  For each of the four representative seeds we test both the
// original baseline root and the promising candidate root (8 branches total),
// force the best handover / strongest opponent reply found by v8.0.14, then
// search the original root player's next meaningful choice.
//
// If the opponent's refutation is a Move, the next meaningful choice is the
// responder's first sequential response placement: every legal response colour
// and square is tested.  If the refutation is an ordinary placement, the state
// is already at the root player's next free normal turn: the opponent controls
// the colour handover, so every available handover colour is tested and the
// root player searches every legal action under that colour.  The branch score
// is minimax over that handover choice.
//
// After the searched counter-response, ordinary frozen Lipfty 7 tactical play
// resumes.  This is analysis-only and is still NOT a full game-tree proof.

const fs = require("fs");
const path = require("path");
const L8 = require("./lipfty8-simulator.js");
const S = require("./lipfty7-simulator.js");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}
function flag(name) { return process.argv.includes(`--${name}`); }

const rollouts = Number(arg("rollouts", "20"));
const maxActions = Number(arg("max-turns", "500")); // compatibility with existing simulator naming
const outDir = arg("out", "C:\\bxd\\Lipfty-Simulation-Results");
const archivePrevious = !flag("no-archive");

if(!Number.isInteger(rollouts) || rollouts < 1) throw new Error("--rollouts must be a positive integer.");
if(!Number.isInteger(maxActions) || maxActions < 1) throw new Error("--max-turns must be a positive integer.");

const PROBES = [
  {
    seed:10001, targetAction:1,
    expectedBaseline:"place:white->R4C3",
    candidate:"place:white->R4C2",
    branches:{
      baseline:{handover:"black", opponentReply:"place:black->R3C4"},
      candidate:{handover:"black", opponentReply:"move:black:R1C1->R2C1"}
    }
  },
  {
    seed:10002, targetAction:1,
    expectedBaseline:"place:black->R4C4",
    candidate:"place:black->R4C5",
    branches:{
      baseline:{handover:"black", opponentReply:"move:black:R6C6->R5C6"},
      candidate:{handover:"black", opponentReply:"move:black:R1C1->R2C1"}
    }
  },
  {
    seed:10003, targetAction:2,
    expectedBaseline:"place:white->R5C2",
    candidate:"place:white->R5C4",
    branches:{
      baseline:{handover:"black", opponentReply:"move:black:R1C1->R2C1"},
      candidate:{handover:"black", opponentReply:"move:black:R1C1->R2C2"}
    }
  },
  {
    seed:10005, targetAction:2,
    expectedBaseline:"place:black->R2C2",
    candidate:"place:black->R3C5",
    branches:{
      baseline:{handover:"black", opponentReply:"move:black:R6C6->R6C5"},
      candidate:{handover:"black", opponentReply:"move:black:R1C1->R2C2"}
    }
  }
];

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

function other(p) { return 1 - p; }
function actorName(p) { return p === 0 ? "P1" : p === 1 ? "P2" : "draw"; }
function squareName(i) { return i === undefined || i === null ? "" : `R${Math.floor(i / 6) + 1}C${i % 6 + 1}`; }
function actionLabel(a) {
  if(!a) return "none";
  if(a.type.includes("place")) return `${a.type}:${a.colour}->${squareName(a.to)}`;
  if(a.type === "move") return `move:${a.colour}:${squareName(a.from)}->${squareName(a.to)}`;
  if(a.type === "jump") return `jump:${a.colour}:${squareName(a.from)}>${squareName(a.over)}>${squareName(a.to)}`;
  return JSON.stringify(a);
}
function actionKey(a) {
  if(!a) return "none";
  return [a.type, a.colour, a.from ?? "", a.over ?? "", a.to ?? ""].join(":");
}
function pct(v) { return `${(100 * v).toFixed(1)}%`; }
function emptySquares(s) {
  const out = [];
  for(let i = 0; i < s.board.length; i++) if(!s.board[i]) out.push(i);
  return out;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function hash32(text) {
  let h = 2166136261 >>> 0;
  for(let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
function rolloutSeed(gameSeed, actionNumber, decisionKey, index) {
  // Root kind is deliberately omitted where decisionKey is structurally the
  // same, allowing baseline/candidate branches to share downstream RNG stream N.
  return (gameSeed ^ hash32(`${actionNumber}|counter-reply|${decisionKey}|paired|${index}`) ^
    Math.imul(index + 1, 0x9E3779B1)) >>> 0;
}

function cloneState(s, seed = null) {
  return {
    ...s,
    board:s.board.map(p => p ? {...p} : null),
    cornerRemaining:{...s.cornerRemaining},
    normalRemaining:{...s.normalRemaining},
    finalPieces:[...s.finalPieces],
    forcedQueue:s.forcedQueue.map(q => ({...q})),
    rng:seed === null ? s.rng : mulberry32(seed)
  };
}

function commitPending(s) {
  S.commitSequentialSecond(s, rules, "tactical");
  S.commitBoundarySelfCorner(s, rules, "tactical");
  S.commitBoundaryCorner(s, rules, "tactical");
}

function continueTactical(s) {
  while(s.winner === null && s.turns < maxActions) {
    commitPending(s);
    const colour = S.chooseColour(s, rules, "tactical", fixed.finalFourColourPolicy);
    const action = S.chooseAction(s, colour, rules, "tactical");
    if(!action) {
      s.winner = "draw";
      break;
    }

    const result = S.applyAction(s, action, rules);
    if(result.ended) return {winner:s.winner, actions:s.turns, winType:result.winType || null};

    if(action.type === "jump" && s.jumpConsequence !== "current") {
      const response = S.resolveJumpRedeploy(s, action, rules, "tactical");
      if(response.stage === "redeploy") {
        return {winner:s.winner, actions:s.turns, winType:response.firstResult.winType || null};
      }
    } else if(action.type === "move" || action.type === "jump") {
      S.commitMoveResponse(s, rules, "tactical");
    }
  }
  return {winner:s.winner ?? "draw", actions:s.turns, winType:null};
}

function playChosenActionAndContinue(s, action) {
  const result = S.applyAction(s, action, rules);
  if(result.ended) return {winner:s.winner, actions:s.turns, winType:result.winType || null};

  if(action.type === "jump" && s.jumpConsequence !== "current") {
    const response = S.resolveJumpRedeploy(s, action, rules, "tactical");
    if(response.stage === "redeploy") {
      return {winner:s.winner, actions:s.turns, winType:response.firstResult.winType || null};
    }
  } else if(action.type === "move" || action.type === "jump") {
    S.commitMoveResponse(s, rules, "tactical");
  }
  return continueTactical(s);
}

function replayBaselineToTarget(probe) {
  const s = L8.prepareState(
    probe.seed,
    fixed.jumpPolicy,
    fixed.responsePolicy,
    fixed.boundaryPolicy,
    fixed.jumpConsequence,
    fixed.oneColourPolicy,
    fixed.openingPolicy
  );

  while(s.turns < probe.targetAction - 1) {
    commitPending(s);
    const colour = S.chooseColour(s, rules, "tactical", fixed.finalFourColourPolicy);
    const action = S.chooseAction(s, colour, rules, "tactical");
    if(!action) throw new Error(`Seed ${probe.seed}: baseline ended before action ${probe.targetAction}.`);
    const result = S.applyAction(s, action, rules);
    if(result.ended) throw new Error(`Seed ${probe.seed}: baseline won before action ${probe.targetAction}.`);
    if(action.type === "jump" && s.jumpConsequence !== "current") {
      const response = S.resolveJumpRedeploy(s, action, rules, "tactical");
      if(response.stage === "redeploy") throw new Error(`Seed ${probe.seed}: redeploy won before target action.`);
    } else if(action.type === "move" || action.type === "jump") {
      S.commitMoveResponse(s, rules, "tactical");
    }
  }

  commitPending(s);
  if(s.turns !== probe.targetAction - 1) {
    throw new Error(`Seed ${probe.seed}: expected action ${probe.targetAction}, state is at ${s.turns + 1}.`);
  }

  const actor = s.currentPlayer;
  const colour = S.chooseColour(s, rules, "tactical", fixed.finalFourColourPolicy);
  const baselineAction = S.chooseAction(s, colour, rules, "tactical");
  if(!baselineAction) throw new Error(`Seed ${probe.seed}: no baseline action at target.`);
  if(actionLabel(baselineAction) !== probe.expectedBaseline) {
    throw new Error(
      `Seed ${probe.seed}: baseline mismatch at action ${probe.targetAction}: ` +
      `expected ${probe.expectedBaseline}, got ${actionLabel(baselineAction)}.`
    );
  }

  const legal = S.enumerateActions(s, colour, rules);
  const candidateAction = legal.find(a => actionLabel(a) === probe.candidate);
  if(!candidateAction) throw new Error(`Seed ${probe.seed}: candidate is not legal: ${probe.candidate}.`);
  return {state:s, actor, colour, baselineAction, candidateAction};
}

function applyRootAndOpponentReply(probe, replay, rootKind) {
  const branch = probe.branches[rootKind];
  const rootAction = rootKind === "baseline" ? replay.baselineAction : replay.candidateAction;
  const s = cloneState(replay.state);

  const rootResult = S.applyAction(s, rootAction, rules);
  if(rootResult.ended) {
    return {state:s, ended:true, rootAction, branch, opponentReply:null, rootWin:true};
  }

  const pendingAfterRoot = s.forcedQueue.length || s.awaitingMoveResponse || s.awaitingJumpRedeploy ||
    s.sequentialSecondOwed || s.boundaryCornerOwed || s.boundarySelfCornerOwed;
  if(pendingAfterRoot) {
    throw new Error(`Seed ${probe.seed} ${rootKind}: root ${actionLabel(rootAction)} leaves compulsory work; expected ordinary placement root.`);
  }
  if(s.currentPlayer !== other(replay.actor)) {
    throw new Error(`Seed ${probe.seed} ${rootKind}: expected opponent after root action.`);
  }

  const replies = S.enumerateActions(s, branch.handover, rules);
  const opponentReply = replies.find(a => actionLabel(a) === branch.opponentReply);
  if(!opponentReply) {
    throw new Error(
      `Seed ${probe.seed} ${rootKind}: v8.0.14 reply is no longer legal: ${branch.opponentReply} ` +
      `(handover ${branch.handover}).`
    );
  }

  const replyResult = S.applyAction(s, opponentReply, rules);
  if(replyResult.ended) {
    return {state:s, ended:true, rootAction, branch, opponentReply, rootWin:s.winner === replay.actor};
  }

  return {state:s, ended:false, rootAction, branch, opponentReply, rootWin:false};
}

function buildCounterDecisions(probe, replay, rootKind) {
  const applied = applyRootAndOpponentReply(probe, replay, rootKind);
  const rootActor = replay.actor;
  const base = {
    rootKind,
    rootActor,
    rootAction:applied.rootAction,
    handoverToOpponent:applied.branch.handover,
    opponentReply:applied.opponentReply,
    state:applied.state,
    ended:applied.ended,
    rootWin:applied.rootWin,
    decisions:[]
  };
  if(applied.ended) return base;

  const s = applied.state;

  // Seven of the eight current branches land here: the v8.0.14 refutation was
  // a Move.  The root player is the responder and controls the first sequential
  // compulsory placement, including both its colour and its square.
  if(s.awaitingMoveResponse) {
    if(fixed.responsePolicy !== "sequential") throw new Error("Counter probe expects sequential Move response policy.");
    if(s.currentPlayer !== rootActor) {
      throw new Error(`Seed ${probe.seed} ${rootKind}: Move response actor is not the original root player.`);
    }
    const colours = ["black", "white"].filter(c => s.normalRemaining[c] > 0);
    const squares = emptySquares(s);
    const options = [];
    for(const colour of colours) {
      for(const to of squares) {
        options.push({kind:"sequential-first", colour, action:{type:"place", colour, to}});
      }
    }
    base.decisions.push({
      type:"sequential-first-response",
      controller:"root",
      handoverColour:"",
      decisionKey:"sequential-first-response",
      options
    });
    return base;
  }

  if(s.awaitingJumpRedeploy) {
    throw new Error(`Seed ${probe.seed} ${rootKind}: Jump refutation is not supported by this one-more-decision probe.`);
  }

  const pending = s.forcedQueue.length || s.sequentialSecondOwed || s.boundaryCornerOwed || s.boundarySelfCornerOwed;
  if(pending) {
    throw new Error(`Seed ${probe.seed} ${rootKind}: unexpected pending compulsory state after refutation.`);
  }
  if(s.currentPlayer !== rootActor) {
    throw new Error(`Seed ${probe.seed} ${rootKind}: expected original root player to act after opponent placement reply.`);
  }

  // Ordinary free turn: the opponent chooses the colour handed to the root
  // player.  The root player then chooses the best legal action for that colour.
  // We therefore create one decision per possible opponent handover and later
  // take the minimum of the root player's best scores across handovers.
  const colours = S.availableColours(s);
  for(const colour of colours) {
    const actions = S.enumerateActions(s, colour, rules);
    base.decisions.push({
      type:"free-action-after-placement-reply",
      controller:"root-after-opponent-handover",
      handoverColour:colour,
      decisionKey:`free-${colour}`,
      options:actions.map(action => ({kind:"free-action", colour, action}))
    });
  }
  return base;
}

function applyCounterOptionAndContinue(baseState, option) {
  const s = baseState;

  if(option.kind === "sequential-first") {
    if(!s.awaitingMoveResponse) throw new Error("Sequential counter option applied without awaiting Move response.");
    s.awaitingMoveResponse = false;
    s.boundaryCornerOwed = false;
    s.boundarySelfCornerOwed = false;
    s.sequentialSecondOwed = true;
    s.sequentialFirstColour = option.colour;
    s.forcedQueue = [{colour:option.colour, source:"normal", responseSlot:1}];
    s.forcedPlacements = 2;
    const result = S.applyAction(s, option.action, rules);
    if(result.ended) return {winner:s.winner, actions:s.turns, winType:result.winType || null};
    return continueTactical(s);
  }

  if(option.kind === "free-action") {
    return playChosenActionAndContinue(s, option.action);
  }

  throw new Error(`Unknown counter option kind: ${option.kind}`);
}

function scoreWinner(winner, rootActor) {
  if(winner === "draw" || winner === null || winner === undefined) return 0.5;
  return winner === rootActor ? 1 : 0;
}

function fmtClock(ts = Date.now()) {
  return new Date(ts).toLocaleTimeString("en-GB", {hour12:false, hour:"2-digit", minute:"2-digit", second:"2-digit"});
}
function fmtStart(ts = Date.now()) {
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
function archiveStamp(ts = Date.now()) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function archivePreviousResults() {
  fs.mkdirSync(outDir, {recursive:true});
  if(!archivePrevious) {
    console.log("Archiving previous results: OFF (--no-archive)");
    return;
  }

  const oldDir = path.join(outDir, "old");
  fs.mkdirSync(oldDir, {recursive:true});
  const entries = fs.readdirSync(outDir, {withFileTypes:true});
  const files = entries.filter(e => e.isFile() && /^lipfty/i.test(e.name));
  console.log(`Archiving previous results to ${oldDir} ...`);

  if(!files.length) {
    console.log("  no previous Lipfty result files found");
    return;
  }

  const stamp = archiveStamp();
  let moved = 0;
  for(const entry of files) {
    const src = path.join(outDir, entry.name);
    let dest = path.join(oldDir, entry.name);
    if(fs.existsSync(dest)) {
      const ext = path.extname(entry.name);
      const stem = path.basename(entry.name, ext);
      let n = 0;
      do {
        n++;
        dest = path.join(oldDir, `${stem}-${stamp}${n === 1 ? "" : `-${n}`}${ext}`);
      } while(fs.existsSync(dest));
    }
    fs.renameSync(src, dest);
    moved++;
    console.log(`  moved ${entry.name} -> old\\${path.basename(dest)}`);
  }
  console.log(`Archived ${moved} previous result file${moved === 1 ? "" : "s"}.`);
}

function writeCsv(filePath, rows) {
  if(!rows.length) return;
  const keys = Object.keys(rows[0]);
  const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  fs.writeFileSync(
    filePath,
    [keys.join(","), ...rows.map(row => keys.map(k => esc(row[k])).join(","))].join("\r\n") + "\r\n",
    "utf8"
  );
}

const runStarted = Date.now();
let analysisStarted = null;
let lastProgressPrint = runStarted;
let completedRollouts = 0;
let currentOverallOption = 0;

function etaText(totalRollouts) {
  if(completedRollouts < 1 || !analysisStarted) return "ETA --";
  const elapsed = Date.now() - analysisStarted;
  const remaining = Math.max(0, totalRollouts - completedRollouts);
  return `ETA ${fmtDuration(elapsed / completedRollouts * remaining)}`;
}

function printProgress(ctx, totalOptions, totalRollouts, rolloutNo, force = false) {
  const now = Date.now();
  if(!force && now - lastProgressPrint < 15000) return;
  lastProgressPrint = now;
  const structural = `${ctx.seedIndex}/${ctx.seedTotal} ${ctx.decisionIndex}/${ctx.decisionTotal} ${ctx.optionIndex}/${ctx.optionTotal}`;
  const optionOverall = `${ctx.overallOption}/${totalOptions}`;
  const overallPct = totalRollouts ? 100 * completedRollouts / totalRollouts : 100;
  console.log(
    `  ${fmtClock(now)} | ${structural} | ${optionOverall}` +
    ` | seed ${ctx.seed} | ${ctx.rootKind} | ${ctx.decisionType}` +
    (ctx.handoverColour ? ` | handover ${ctx.handoverColour}` : "") +
    ` | ${ctx.optionLabel}` +
    ` | rollout ${rolloutNo}/${rollouts}` +
    ` | rollouts ${completedRollouts}/${totalRollouts} ${overallPct.toFixed(1)}%` +
    ` | elapsed ${fmtDuration(now - runStarted)} | ${etaText(totalRollouts)}`
  );
}

function buildPlan() {
  const seedPlans = [];
  let totalOptions = 0;
  let totalDecisions = 0;

  for(const probe of PROBES) {
    const replay = replayBaselineToTarget(probe);
    const branches = ["baseline", "candidate"].map(kind => buildCounterDecisions(probe, replay, kind));
    const decisionTotal = branches.reduce((n, b) => n + b.decisions.length, 0);
    totalDecisions += decisionTotal;
    for(const branch of branches) {
      for(const decision of branch.decisions) totalOptions += decision.options.length;
    }
    seedPlans.push({probe, replay, branches, decisionTotal});
  }

  return {seedPlans, totalDecisions, totalOptions, totalRollouts:totalOptions * rollouts};
}

console.log("Lipfty 8 — Config 5 counter-reply / one-more-decision probe");
console.log(`Branches: ${PROBES.length * 2} (candidate + baseline controls) | ${rollouts} paired tactical rollout(s) per counter-response option.`);
console.log("Counter search: ALL legal next meaningful choices for the original root player.");
console.log("Opening: 2.2 inner-board corners, colours diagonal. All Lipfty 7 rules remain frozen.");
console.log("This deepens the v8.0.14 refutations by one decision; it is not a full mathematical game-tree proof.");
console.log(`Run started: ${fmtStart(runStarted)}`);
console.log("Progress columns: seed/total-seeds decision/seed-decisions option/decision-options | overall-option/total-options");

try {
  archivePreviousResults();
} catch(err) {
  throw new Error(`Could not archive previous result files: ${err.message}`);
}

const preScanStarted = Date.now();
console.log(`\nPre-scan started: ${fmtClock(preScanStarted)} ...`);
const plan = buildPlan();
console.log(`Pre-scan finished: ${fmtClock()} | ${fmtDuration(Date.now() - preScanStarted)}`);
console.log(
  `Run plan: ${PROBES.length} seeds | ${PROBES.length * 2} branches | ${plan.totalDecisions} counter decisions` +
  ` | ${plan.totalOptions} options | ${plan.totalRollouts} rollout evaluations.\n`
);
analysisStarted = Date.now();

const branchRows = [];
const decisionRows = [];
const optionRows = [];

for(let si = 0; si < plan.seedPlans.length; si++) {
  const sp = plan.seedPlans[si];
  const seedStart = Date.now();
  console.log(`Starting seed ${si + 1}/${plan.seedPlans.length} (${sp.probe.seed}) at ${fmtClock(seedStart)} | ${sp.decisionTotal} counter decisions...`);
  let decisionIndex = 0;

  for(const branch of sp.branches) {
    if(branch.ended) {
      const score = branch.rootWin ? 1 : 0;
      branchRows.push({
        seed:sp.probe.seed,
        target_action:sp.probe.targetAction,
        root_kind:branch.rootKind,
        root_actor:actorName(branch.rootActor),
        root_action:actionLabel(branch.rootAction),
        handover_to_opponent:branch.handoverToOpponent,
        opponent_reply:actionLabel(branch.opponentReply),
        counter_stage:"ended-before-counter",
        counter_score:score.toFixed(4),
        limiting_handover:"",
        best_counter_response:"",
        decisions:0,
        counter_options:0
      });
      continue;
    }

    const summaries = [];
    for(const decision of branch.decisions) {
      decisionIndex++;
      const optionTotal = decision.options.length;
      const optionResults = [];
      console.log(
        `  ${fmtClock()} | seed ${sp.probe.seed} | ${branch.rootKind} | decision ${decisionIndex}/${sp.decisionTotal}` +
        ` | ${decision.type}` +
        (decision.handoverColour ? ` | handover ${decision.handoverColour}` : "") +
        ` | ${optionTotal} options x ${rollouts}`
      );

      for(let oi = 0; oi < decision.options.length; oi++) {
        const option = decision.options[oi];
        currentOverallOption++;
        const ctx = {
          seedIndex:si + 1,
          seedTotal:plan.seedPlans.length,
          decisionIndex,
          decisionTotal:sp.decisionTotal,
          optionIndex:oi + 1,
          optionTotal,
          overallOption:currentOverallOption,
          seed:sp.probe.seed,
          rootKind:branch.rootKind,
          decisionType:decision.type,
          handoverColour:decision.handoverColour,
          optionLabel:actionLabel(option.action)
        };
        printProgress(ctx, plan.totalOptions, plan.totalRollouts, 0, true);

        let wins = 0, draws = 0, losses = 0, total = 0;
        for(let r = 0; r < rollouts; r++) {
          const rs = rolloutSeed(sp.probe.seed, sp.probe.targetAction, decision.decisionKey, r);
          const t = cloneState(branch.state, rs);
          const result = applyCounterOptionAndContinue(t, option);
          const sc = scoreWinner(result.winner, branch.rootActor);
          total += sc;
          if(sc === 1) wins++; else if(sc === 0.5) draws++; else losses++;
          completedRollouts++;
          printProgress(ctx, plan.totalOptions, plan.totalRollouts, r + 1, false);
        }

        const score = total / rollouts;
        optionResults.push({option, score, wins, draws, losses});
        optionRows.push({
          seed:sp.probe.seed,
          target_action:sp.probe.targetAction,
          root_kind:branch.rootKind,
          root_actor:actorName(branch.rootActor),
          root_action:actionLabel(branch.rootAction),
          handover_to_opponent:branch.handoverToOpponent,
          opponent_reply:actionLabel(branch.opponentReply),
          decision_type:decision.type,
          response_handover_colour:decision.handoverColour,
          response_option:actionLabel(option.action),
          root_score:score.toFixed(4),
          root_wins:wins,
          draws,
          root_losses:losses
        });
      }

      // At this searched node the original root player chooses the response,
      // therefore select the option with the highest root-player score.
      optionResults.sort((a, b) => b.score - a.score || actionKey(a.option.action).localeCompare(actionKey(b.option.action)));
      const best = optionResults[0];
      const avg = optionResults.reduce((n, x) => n + x.score, 0) / Math.max(1, optionResults.length);
      const summary = {
        decision,
        bestScore:best.score,
        bestOption:best.option,
        averageScore:avg,
        optionCount:optionResults.length
      };
      summaries.push(summary);
      decisionRows.push({
        seed:sp.probe.seed,
        target_action:sp.probe.targetAction,
        root_kind:branch.rootKind,
        root_actor:actorName(branch.rootActor),
        root_action:actionLabel(branch.rootAction),
        handover_to_opponent:branch.handoverToOpponent,
        opponent_reply:actionLabel(branch.opponentReply),
        decision_type:decision.type,
        response_handover_colour:decision.handoverColour,
        response_options:optionResults.length,
        best_response:actionLabel(best.option.action),
        best_response_root_score:best.score.toFixed(4),
        average_response_root_score:avg.toFixed(4)
      });
    }

    let counterScore;
    let limitingHandover = "";
    let bestCounterResponse = "";
    let counterStage;

    if(summaries.length === 1 && summaries[0].decision.type === "sequential-first-response") {
      // Root player controls this compulsory responder choice directly.
      counterScore = summaries[0].bestScore;
      bestCounterResponse = actionLabel(summaries[0].bestOption.action);
      counterStage = "sequential-first-response";
    } else {
      // Free normal turn: opponent controls the handover colour, root controls
      // the action.  Use the handover under which the root's best action scores
      // worst (min over opponent colour, max over root action).
      summaries.sort((a, b) => a.bestScore - b.bestScore || a.decision.handoverColour.localeCompare(b.decision.handoverColour));
      const limiting = summaries[0];
      counterScore = limiting.bestScore;
      limitingHandover = limiting.decision.handoverColour;
      bestCounterResponse = actionLabel(limiting.bestOption.action);
      counterStage = "free-action-minimax";
    }

    branchRows.push({
      seed:sp.probe.seed,
      target_action:sp.probe.targetAction,
      root_kind:branch.rootKind,
      root_actor:actorName(branch.rootActor),
      root_action:actionLabel(branch.rootAction),
      handover_to_opponent:branch.handoverToOpponent,
      opponent_reply:actionLabel(branch.opponentReply),
      counter_stage:counterStage,
      counter_score:counterScore.toFixed(4),
      limiting_handover:limitingHandover,
      best_counter_response:bestCounterResponse,
      decisions:branch.decisions.length,
      counter_options:branch.decisions.reduce((n, d) => n + d.options.length, 0)
    });
  }

  console.log(`Seed ${sp.probe.seed} finished: ${fmtClock()} | ${fmtDuration(Date.now() - seedStart)} | total ${fmtDuration(Date.now() - runStarted)}\n`);
}

console.log("SUMMARY — can the original player answer the v8.0.14 strongest reply?");
for(const probe of PROBES) {
  const baseline = branchRows.find(r => r.seed === probe.seed && r.root_kind === "baseline");
  const candidate = branchRows.find(r => r.seed === probe.seed && r.root_kind === "candidate");
  if(!baseline || !candidate) continue;
  const b = Number(baseline.counter_score);
  const c = Number(candidate.counter_score);
  const delta = c - b;
  const status = c >= 0.70 ? "candidate refutation is strongly answerable" :
    c >= 0.50 ? "candidate refutation is provisionally answerable" :
      "candidate still looks refuted at this depth";
  console.log(
    `  Seed ${probe.seed} action ${probe.targetAction}: candidate ${candidate.root_action}` +
    ` | counter ${pct(c)} vs baseline ${pct(b)} (${delta >= 0 ? "+" : ""}${(100 * delta).toFixed(1)}pp)` +
    ` | ${status}`
  );
  console.log(
    `    v8.0.14 reply: ${candidate.opponent_reply}` +
    (candidate.limiting_handover ? ` | limiting handover ${candidate.limiting_handover}` : "") +
    ` | best counter: ${candidate.best_counter_response}`
  );
}

try {
  fs.mkdirSync(outDir, {recursive:true});
  const seedTag = PROBES.map(p => p.seed).join("-");
  const tag = `seeds${seedTag}-r${rollouts}-all-withbaseline`;
  const branchPath = path.join(outDir, `lipfty8-counter-reply-branches-${tag}.csv`);
  const decisionPath = path.join(outDir, `lipfty8-counter-reply-decisions-${tag}.csv`);
  const optionPath = path.join(outDir, `lipfty8-counter-reply-options-${tag}.csv`);
  writeCsv(branchPath, branchRows);
  writeCsv(decisionPath, decisionRows);
  writeCsv(optionPath, optionRows);
  console.log(`\nBranch summary CSV: ${branchPath}`);
  console.log(`Decision summary CSV: ${decisionPath}`);
  console.log(`Option detail CSV: ${optionPath}`);
} catch(err) {
  console.warn(`\nCSV not written: ${err.message}`);
}

console.log(`Total counter-reply probe time: ${fmtDuration(Date.now() - runStarted)} | finished ${fmtStart()}`);
