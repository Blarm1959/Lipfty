"use strict";

// Lipfty 8 reply / refutation probe.
//
// Purpose: take the four earliest promising one-deviation moves found by the
// v8.0.12/v8.0.13 strategy probe and test them against the opponent's full set
// of immediate legal replies.  For each root move we also test the original
// baseline move as a control.  The root player chooses the colour handed to the
// opponent; the opponent then chooses the reply.  Each reply is followed by
// ordinary frozen Lipfty 7 tactical play using paired/common random numbers.
//
// This is analysis-only.  It does NOT alter the playable game, Lipfty 7 rules,
// or the tactical chooser.  It is a one-reply minimax probe, not a complete
// game-tree proof.

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
const topReplies = Number(arg("top-replies", "0")); // 0 = every legal immediate reply
const includeBaseline = !flag("candidate-only");
const outDir = arg("out", "C:\\bxd\\Lipfty-Simulation-Results");

if(!Number.isInteger(rollouts) || rollouts < 1) throw new Error("--rollouts must be a positive integer.");
if(!Number.isInteger(maxActions) || maxActions < 1) throw new Error("--max-turns must be a positive integer.");
if(!Number.isInteger(topReplies) || topReplies < 0) throw new Error("--top-replies must be 0 or a positive integer.");

const PROBES = [
  {
    seed:10001, targetAction:1, baselineWinner:"P2",
    expectedBaseline:"place:white->R4C3",
    candidate:"place:white->R4C2",
    priorBaselineScore:0.60, priorCandidateScore:0.85
  },
  {
    seed:10002, targetAction:1, baselineWinner:"P2",
    expectedBaseline:"place:black->R4C4",
    candidate:"place:black->R4C5",
    priorBaselineScore:0.30, priorCandidateScore:0.80
  },
  {
    seed:10003, targetAction:2, baselineWinner:"P1",
    expectedBaseline:"place:white->R5C2",
    candidate:"place:white->R5C4",
    priorBaselineScore:0.45, priorCandidateScore:1.00
  },
  {
    seed:10005, targetAction:2, baselineWinner:"P1",
    expectedBaseline:"place:black->R2C2",
    candidate:"place:black->R3C5",
    priorBaselineScore:0.45, priorCandidateScore:1.00
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
function rolloutSeed(gameSeed, actionNumber, handoverColour, index) {
  // Excludes root kind and reply option deliberately: baseline/candidate and
  // every reply option use the same downstream RNG stream for rollout N.
  return (gameSeed ^ hash32(`${actionNumber}|reply|${handoverColour}|paired|${index}`) ^
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
    throw new Error(`Seed ${probe.seed}: expected to reach action ${probe.targetAction}, but state is at ${s.turns + 1}.`);
  }

  const actor = s.currentPlayer;
  const colour = S.chooseColour(s, rules, "tactical", fixed.finalFourColourPolicy);
  const baselineAction = S.chooseAction(s, colour, rules, "tactical");
  if(!baselineAction) throw new Error(`Seed ${probe.seed}: no baseline action at target.`);
  const baselineLabel = actionLabel(baselineAction);
  if(baselineLabel !== probe.expectedBaseline) {
    throw new Error(`Seed ${probe.seed}: baseline mismatch at action ${probe.targetAction}: expected ${probe.expectedBaseline}, got ${baselineLabel}.`);
  }

  const legal = S.enumerateActions(s, colour, rules);
  const candidateAction = legal.find(a => actionLabel(a) === probe.candidate);
  if(!candidateAction) {
    throw new Error(`Seed ${probe.seed}: candidate is not legal at action ${probe.targetAction}: ${probe.candidate}.`);
  }

  return {state:s, actor, colour, baselineAction, candidateAction};
}

function applyRootAction(before, action) {
  const s = cloneState(before);
  const result = S.applyAction(s, action, rules);
  if(result.ended) return {state:s, ended:true};

  // The four configured roots are ordinary placements.  Keep support for a
  // future movement root, but require its compulsory consequence to finish
  // before the reply search begins.
  if(action.type === "jump" && s.jumpConsequence !== "current") {
    const response = S.resolveJumpRedeploy(s, action, rules, "tactical");
    if(response.stage === "redeploy") return {state:s, ended:true};
  } else if(action.type === "move" || action.type === "jump") {
    S.commitMoveResponse(s, rules, "tactical");
  }

  // Reply probe starts at the next free normal decision.  A future movement
  // root with forced placements is intentionally rejected rather than silently
  // analysing a different decision point.
  const pending = s.forcedQueue.length || s.awaitingMoveResponse || s.awaitingJumpRedeploy ||
    s.sequentialSecondOwed || s.boundaryCornerOwed || s.boundarySelfCornerOwed;
  if(pending) {
    throw new Error(`Root action ${actionLabel(action)} leaves compulsory response work; this probe currently expects a free reply state.`);
  }
  return {state:s, ended:false};
}

function chooseReplies(state, colour) {
  const actions = S.enumerateActions(state, colour, rules);
  if(topReplies === 0 || actions.length <= topReplies) return actions;
  const scored = actions.map(a => ({a, score:S.actionPositionalScore(state, a, rules)}));
  scored.sort((x, y) => y.score - x.score || actionKey(x.a).localeCompare(actionKey(y.a)));
  return scored.slice(0, topReplies).map(x => x.a);
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

const runStarted = Date.now();
let lastProgressPrint = runStarted;
let completedRollouts = 0;
let currentOverallOption = 0;

function etaText(totalRollouts) {
  if(completedRollouts < 1) return "ETA --";
  const elapsed = Date.now() - runStarted;
  const remaining = Math.max(0, totalRollouts - completedRollouts);
  const estimate = elapsed / completedRollouts * remaining;
  return `ETA ${fmtDuration(estimate)}`;
}

function printProgress(ctx, totalOptions, totalRollouts, rolloutNo, force = false) {
  const now = Date.now();
  if(!force && now - lastProgressPrint < 15000) return;
  lastProgressPrint = now;
  const structural = `${ctx.seedIndex}/${ctx.seedTotal}/${ctx.decisionIndex}/${ctx.decisionTotal}/${ctx.optionIndex}/${ctx.optionTotal}`;
  const optionOverall = `${ctx.overallOption}/${totalOptions}`;
  const overallPct = totalRollouts ? 100 * completedRollouts / totalRollouts : 100;
  console.log(
    `  ${fmtClock(now)} | ${structural} | ${optionOverall}` +
    ` | seed ${ctx.seed} | ${ctx.rootKind} | give ${ctx.handoverColour}` +
    ` | ${ctx.replyLabel}` +
    ` | rollout ${rolloutNo}/${rollouts}` +
    ` | rollouts ${completedRollouts}/${totalRollouts} ${overallPct.toFixed(1)}%` +
    ` | elapsed ${fmtDuration(now - runStarted)} | ${etaText(totalRollouts)}`
  );
}

function buildPlan() {
  const seedPlans = [];
  let totalOptions = 0;
  for(let si = 0; si < PROBES.length; si++) {
    const probe = PROBES[si];
    const replay = replayBaselineToTarget(probe);
    const roots = [];
    const rootSpecs = includeBaseline ? [
      {kind:"baseline", action:replay.baselineAction},
      {kind:"candidate", action:replay.candidateAction}
    ] : [{kind:"candidate", action:replay.candidateAction}];

    for(const spec of rootSpecs) {
      const applied = applyRootAction(replay.state, spec.action);
      if(applied.ended) {
        roots.push({
          kind:spec.kind,
          action:spec.action,
          actionLabel:actionLabel(spec.action),
          rootActor:replay.actor,
          rootState:applied.state,
          ended:true,
          decisions:[]
        });
        continue;
      }
      const rootState = applied.state;
      const rootActor = replay.actor;
      const opponent = rootState.currentPlayer;
      if(opponent !== other(rootActor)) {
        throw new Error(`Seed ${probe.seed}: expected opponent ${actorName(other(rootActor))} after root action, got ${actorName(opponent)}.`);
      }
      const colours = S.availableColours(rootState);
      const decisions = colours.map(colour => {
        const replies = chooseReplies(rootState, colour);
        totalOptions += replies.length;
        return {handoverColour:colour, replies};
      });
      roots.push({
        kind:spec.kind,
        action:spec.action,
        actionLabel:actionLabel(spec.action),
        rootActor,
        rootState,
        ended:false,
        decisions
      });
    }

    const decisions = roots.reduce((n, r) => n + r.decisions.length, 0);
    seedPlans.push({probe, replay, roots, decisionTotal:decisions});
  }
  return {seedPlans, totalOptions, totalRollouts:totalOptions * rollouts};
}

function scoreWinner(winner, rootActor) {
  if(winner === "draw" || winner === null || winner === undefined) return 0.5;
  return winner === rootActor ? 1 : 0;
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

console.log("Lipfty 8 — Config 5 immediate reply / refutation probe");
console.log(`Roots: ${PROBES.length} representative seeds | ${rollouts} paired tactical rollout(s) per reply option.`);
console.log(`Reply search: ${topReplies === 0 ? "ALL legal immediate replies" : `top ${topReplies} tactical reply candidates`}.`);
console.log(`Baseline controls: ${includeBaseline ? "ON" : "OFF (--candidate-only)"}.`);
console.log("Common random numbers: ON — reply options at the same handover use the same rollout seed.");
console.log("Opening: 2.2 inner-board corners, colours diagonal. All Lipfty 7 rules remain frozen.");
console.log("This is a one-reply minimax probe, not a full mathematical game-tree proof.");
console.log(`Run started: ${fmtStart(runStarted)}`);
console.log("Progress columns: seed/total-seeds/decision/seed-decisions/option/decision-options | overall-option/total-options\n");

const preScanStarted = Date.now();
console.log(`Pre-scan started: ${fmtClock(preScanStarted)} ...`);
const plan = buildPlan();
console.log(`Pre-scan finished: ${fmtClock()} | ${fmtDuration(Date.now() - preScanStarted)}`);
console.log(`Run plan: ${PROBES.length} seeds | ${plan.seedPlans.reduce((n, s) => n + s.decisionTotal, 0)} reply decisions | ${plan.totalOptions} reply options | ${plan.totalRollouts} rollout evaluations.\n`);

const rootRows = [];
const decisionRows = [];
const optionRows = [];

for(let si = 0; si < plan.seedPlans.length; si++) {
  const sp = plan.seedPlans[si];
  const seedStart = Date.now();
  console.log(`Starting seed ${si + 1}/${plan.seedPlans.length} (${sp.probe.seed}) at ${fmtClock(seedStart)} | ${sp.decisionTotal} reply decisions...`);
  let decisionIndex = 0;

  for(const root of sp.roots) {
    if(root.ended) {
      rootRows.push({
        seed:sp.probe.seed,
        target_action:sp.probe.targetAction,
        root_kind:root.kind,
        root_actor:actorName(root.rootActor),
        root_action:root.actionLabel,
        prior_one_deviation_score:root.kind === "candidate" ? sp.probe.priorCandidateScore.toFixed(4) : sp.probe.priorBaselineScore.toFixed(4),
        best_handover:"",
        maximin_score:"1.0000",
        opponent_best_reply:"root action already wins",
        opponent_best_reply_score:"1.0000",
        decisions:0,
        reply_options:0
      });
      continue;
    }

    const rootDecisionSummaries = [];
    for(const decision of root.decisions) {
      decisionIndex++;
      const optionTotal = decision.replies.length;
      const optionResults = [];
      console.log(
        `  ${fmtClock()} | seed ${sp.probe.seed} | ${root.kind} | decision ${decisionIndex}/${sp.decisionTotal}` +
        ` | give ${decision.handoverColour} | ${optionTotal} reply options x ${rollouts}`
      );

      for(let oi = 0; oi < decision.replies.length; oi++) {
        const reply = decision.replies[oi];
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
          rootKind:root.kind,
          handoverColour:decision.handoverColour,
          replyLabel:actionLabel(reply)
        };
        printProgress(ctx, plan.totalOptions, plan.totalRollouts, 0, true);

        let wins = 0, draws = 0, losses = 0, total = 0;
        const outcomes = [];
        for(let r = 0; r < rollouts; r++) {
          const rs = rolloutSeed(sp.probe.seed, sp.probe.targetAction, decision.handoverColour, r);
          const t = cloneState(root.rootState, rs);
          const result = playChosenActionAndContinue(t, reply);
          const sc = scoreWinner(result.winner, root.rootActor);
          outcomes.push(sc);
          total += sc;
          if(sc === 1) wins++; else if(sc === 0.5) draws++; else losses++;
          completedRollouts++;
          printProgress(ctx, plan.totalOptions, plan.totalRollouts, r + 1, false);
        }
        const score = total / rollouts;
        optionResults.push({reply, score, wins, draws, losses, outcomes});
        optionRows.push({
          seed:sp.probe.seed,
          target_action:sp.probe.targetAction,
          root_kind:root.kind,
          root_actor:actorName(root.rootActor),
          root_action:root.actionLabel,
          handover_colour:decision.handoverColour,
          reply_option:actionLabel(reply),
          root_score:score.toFixed(4),
          root_wins:wins,
          draws,
          root_losses:losses
        });
      }

      // Opponent chooses the reply that minimises the root player's score.
      optionResults.sort((a, b) => a.score - b.score || actionKey(a.reply).localeCompare(actionKey(b.reply)));
      const worst = optionResults[0];
      const avg = optionResults.reduce((n, x) => n + x.score, 0) / Math.max(1, optionResults.length);
      const ds = {
        handoverColour:decision.handoverColour,
        worstScore:worst.score,
        worstReply:worst.reply,
        averageReplyScore:avg,
        optionCount:optionResults.length
      };
      rootDecisionSummaries.push(ds);
      decisionRows.push({
        seed:sp.probe.seed,
        target_action:sp.probe.targetAction,
        root_kind:root.kind,
        root_actor:actorName(root.rootActor),
        root_action:root.actionLabel,
        handover_colour:decision.handoverColour,
        opponent:actorName(other(root.rootActor)),
        reply_options:optionResults.length,
        worst_reply:actionLabel(worst.reply),
        worst_reply_root_score:worst.score.toFixed(4),
        average_reply_root_score:avg.toFixed(4)
      });
    }

    // Root player controls the colour handover, so choose the handover whose
    // worst opponent reply leaves the highest root-player score (maximin).
    rootDecisionSummaries.sort((a, b) => b.worstScore - a.worstScore || a.handoverColour.localeCompare(b.handoverColour));
    const bestHandover = rootDecisionSummaries[0];
    rootRows.push({
      seed:sp.probe.seed,
      target_action:sp.probe.targetAction,
      root_kind:root.kind,
      root_actor:actorName(root.rootActor),
      root_action:root.actionLabel,
      prior_one_deviation_score:(root.kind === "candidate" ? sp.probe.priorCandidateScore : sp.probe.priorBaselineScore).toFixed(4),
      best_handover:bestHandover.handoverColour,
      maximin_score:bestHandover.worstScore.toFixed(4),
      opponent_best_reply:actionLabel(bestHandover.worstReply),
      opponent_best_reply_score:bestHandover.worstScore.toFixed(4),
      decisions:root.decisions.length,
      reply_options:root.decisions.reduce((n, d) => n + d.replies.length, 0)
    });
  }

  console.log(`Seed ${sp.probe.seed} finished: ${fmtClock()} | ${fmtDuration(Date.now() - seedStart)} | total ${fmtDuration(Date.now() - runStarted)}\n`);
}

console.log("SUMMARY — candidate vs baseline immediate-reply maximin");
for(const probe of PROBES) {
  const candidate = rootRows.find(r => r.seed === probe.seed && r.root_kind === "candidate");
  const baseline = rootRows.find(r => r.seed === probe.seed && r.root_kind === "baseline");
  if(!candidate) continue;
  const c = Number(candidate.maximin_score);
  const b = baseline ? Number(baseline.maximin_score) : null;
  const delta = b === null ? null : c - b;
  const status = c >= 0.70 ? "survives strongly" : c >= 0.50 ? "survives provisionally" : "opponent has a reply lead";
  console.log(
    `  Seed ${probe.seed} action ${probe.targetAction}: candidate ${candidate.root_action}` +
    ` | maximin ${pct(c)}` +
    (b === null ? "" : ` vs baseline ${pct(b)} (${delta >= 0 ? "+" : ""}${(100 * delta).toFixed(1)}pp)`) +
    ` | ${status}`
  );
  console.log(`    Best handover: ${candidate.best_handover} | strongest opponent reply: ${candidate.opponent_best_reply}`);
}

try {
  fs.mkdirSync(outDir, {recursive:true});
  const seedTag = PROBES.map(p => p.seed).join("-");
  const replyTag = topReplies === 0 ? "all" : `top${topReplies}`;
  const baseTag = includeBaseline ? "withbaseline" : "candidateonly";
  const tag = `seeds${seedTag}-r${rollouts}-${replyTag}-${baseTag}`;
  const rootPath = path.join(outDir, `lipfty8-reply-probe-roots-${tag}.csv`);
  const decisionPath = path.join(outDir, `lipfty8-reply-probe-decisions-${tag}.csv`);
  const optionPath = path.join(outDir, `lipfty8-reply-probe-options-${tag}.csv`);
  writeCsv(rootPath, rootRows);
  writeCsv(decisionPath, decisionRows);
  writeCsv(optionPath, optionRows);
  console.log(`\nRoot summary CSV: ${rootPath}`);
  console.log(`Decision summary CSV: ${decisionPath}`);
  console.log(`Option detail CSV: ${optionPath}`);
} catch(err) {
  console.warn(`\nCSV not written: ${err.message}`);
}

console.log(`Total reply-probe time: ${fmtDuration(Date.now() - runStarted)} | finished ${fmtStart()}`);
