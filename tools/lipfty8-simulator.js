"use strict";

// Lipfty 8 analysis-only simulator.
//
// This deliberately delegates all post-opening rules and tactical choices to
// the frozen Lipfty 7 simulator. Lipfty 8 changes only the Opening Four setup.
const S = require("./lipfty7-simulator.js");

const COLOURS = ["black", "white"];
const OPENING_POLICIES = [
  "lipfty7",
  "centre-adjacent",
  "centre-diagonal",
  "corners-adjacent",
  "corners-diagonal"
];

const AUTOMATIC_OPENINGS = {
  "centre-adjacent": [
    {to:14, colour:"black"}, {to:15, colour:"black"},
    {to:20, colour:"white"}, {to:21, colour:"white"}
  ],
  "centre-diagonal": [
    {to:14, colour:"black"}, {to:15, colour:"white"},
    {to:20, colour:"white"}, {to:21, colour:"black"}
  ],
  "corners-adjacent": [
    {to:0, colour:"black"}, {to:5, colour:"black"},
    {to:30, colour:"white"}, {to:35, colour:"white"}
  ],
  "corners-diagonal": [
    {to:0, colour:"black"}, {to:5, colour:"white"},
    {to:30, colour:"white"}, {to:35, colour:"black"}
  ]
};

function normaliseOpeningPolicy(value="lipfty7") {
  if(!OPENING_POLICIES.includes(value)) {
    throw new Error(`openingPolicy must be one of: ${OPENING_POLICIES.join(", ")}.`);
  }
  return value;
}

function normalReserveCount(s) {
  return s.normalRemaining.black + s.normalRemaining.white;
}

function normalColourCount(s) {
  return COLOURS.filter(c => s.normalRemaining[c] > 0).length;
}

function prepareState(seed, jumpPolicy, responsePolicy, boundaryPolicy, jumpConsequence, oneColourPolicy, openingPolicy) {
  const s = S.freshState(seed, jumpPolicy, responsePolicy, boundaryPolicy, jumpConsequence, oneColourPolicy);
  if(openingPolicy === "lipfty7") return s;

  for(const item of AUTOMATIC_OPENINGS[openingPolicy]) {
    if(s.board[item.to]) throw new Error(`Automatic opening collision at square ${item.to}.`);
    s.board[item.to] = {id:s.nextPieceId++, colour:item.colour};
  }

  s.openingRemaining = 0;
  s.cornerRemaining = {black:0, white:0};
  s.currentPlayer = 0;
  s.turns = 0;
  s.protectedPieceId = null;
  return s;
}

function boardKey(s) {
  const board = s.board.map(p => p ? (p.colour === "black" ? "b" : "w") : ".").join("");
  const queue = s.forcedQueue.map(q => `${q.colour[0]}${q.source[0]}${q.responseSlot || 0}`).join("/");
  return [
    board, s.currentPlayer, s.openingRemaining,
    s.normalRemaining.black, s.normalRemaining.white,
    s.finalPieces.slice().sort().join(""), queue,
    Number(s.finalFour), Number(s.awaitingMoveResponse), Number(s.awaitingJumpRedeploy),
    Number(s.sequentialSecondOwed), Number(s.boundaryCornerOwed), Number(s.boundarySelfCornerOwed),
    s.protectedPieceId ?? "-"
  ].join("|");
}

function actionWins(s, action, rules) {
  return !!S.fastCheckWin(S.boardAfter(s, action), rules, action.to);
}

function finalFourImmediateWinInfo(s, rules) {
  const colours = S.availableColours(s), winningColours = [];
  let winningActions = 0;
  for(const colour of colours) {
    const n = S.immediateWinningActions(s, colour, rules).length;
    if(n) {
      winningColours.push(colour);
      winningActions += n;
    }
  }
  return {available:winningActions > 0, winningColours, winningActions};
}

function transitionCause(action, wasForced, responseSlot) {
  if(!action || action.type !== "place") return "other";
  if(!wasForced) return "ordinary-placement";
  return responseSlot === 1 ? "response-placement-1" : responseSlot === 2 ? "response-placement-2" : "forced-placement";
}

function newPhaseDiagnostics() {
  return {
    oneColourEntry:null,
    finalFourEntry:null,
    finalFourPlacements:0,
    finalFourFirstChosenColour:null,
    finalFourFirstChosenColourImmediateWin:false,
    finalFourFirstActionImmediateWin:false
  };
}

function recordPhaseTransition(d, s, beforeColours, beforeReserve, action, wasForced, responseSlot, actor, rules) {
  const afterColours = normalColourCount(s), afterReserve = normalReserveCount(s);
  const cause = transitionCause(action, wasForced, responseSlot);
  if(!d.oneColourEntry && beforeColours >= 2 && afterColours === 1 && !s.finalFour) {
    d.oneColourEntry = {
      firstActor:s.currentPlayer,
      transitionActor:actor,
      cause,
      turn:s.turns,
      remainingColour:COLOURS.find(c => s.normalRemaining[c] > 0),
      remainingBlack:s.normalRemaining.black,
      remainingWhite:s.normalRemaining.white
    };
  }
  if(!d.finalFourEntry && beforeReserve > 0 && afterReserve === 0 && s.finalFour) {
    const immediate = finalFourImmediateWinInfo(s, rules);
    d.finalFourEntry = {
      firstActor:s.currentPlayer,
      transitionActor:actor,
      cause,
      turn:s.turns,
      immediateWinAvailable:immediate.available,
      immediateWinningColours:immediate.winningColours,
      immediateWinningActions:immediate.winningActions
    };
  }
}

function emptyResponseStats() {
  return {
    placements:0, moves:0, jumps:0, redeployPlacements:0, forcedPlacements:0,
    placementsByPlayer:[0,0], movesByPlayer:[0,0], jumpsByPlayer:[0,0], jumpEvents:[],
    twoPieceResponses:0, boundaryResponses:0, jumpRedeployResponses:0, sequentialSecondChoices:0,
    redeployWins:[0,0], jumpReserveWins:[0,0], maxConsecutiveRedeployOnlyJumps:0,
    boundaryFirstSources:{normal:0,corner:0},
    responsePairs:{"black+black":0,"black+white":0,"white+white":0},
    responseAllocations:{"black->black":0,"black->white":0,"white->black":0,"white->white":0},
    boundaryCornerColours:{black:0,white:0},
    boundarySelfCornerColours:{black:0,white:0},
    boundaryResponderCornerColours:{black:0,white:0}
  };
}

function finish(result, phaseDiagnostics, openingPolicy, repetitionObserved, repetitionEvents, automaticOpening) {
  return {
    ...result,
    phaseDiagnostics,
    openingPolicy,
    automaticOpening,
    repetitionObserved,
    repetitionEvents,
    comparableTurns:result.turns + (automaticOpening ? 4 : 0)
  };
}

function playGame({
  rules={}, seed=1, strength="tactical", maxTurns=500,
  jumpPolicy="opposite", responsePolicy="sequential", boundaryPolicy="responder-choice",
  jumpConsequence="redeploy-pass", finalFourColourPolicy="tactical",
  oneColourPolicy="placement-only", openingPolicy="lipfty7"
}={}) {
  rules = S.normaliseRules(rules);
  jumpPolicy = S.normaliseJumpPolicy(jumpPolicy);
  responsePolicy = S.normaliseResponsePolicy(responsePolicy);
  boundaryPolicy = S.normaliseBoundaryPolicy(boundaryPolicy);
  jumpConsequence = S.normaliseJumpConsequencePolicy(jumpConsequence);
  finalFourColourPolicy = S.normaliseFinalFourColourPolicy(finalFourColourPolicy);
  oneColourPolicy = S.normaliseOneColourPolicy(oneColourPolicy);
  openingPolicy = normaliseOpeningPolicy(openingPolicy);

  const automaticOpening = openingPolicy !== "lipfty7";
  const s = prepareState(seed, jumpPolicy, responsePolicy, boundaryPolicy, jumpConsequence, oneColourPolicy, openingPolicy);
  const stats = emptyResponseStats(), phaseDiagnostics = newPhaseDiagnostics();
  let consecutiveRedeployOnlyJumps = 0, repetitionObserved = false, repetitionEvents = 0;
  const seen = new Set([boardKey(s)]);

  while(!s.winner && s.turns < maxTurns) {
    const sequentialPlan = S.commitSequentialSecond(s, rules, strength);
    if(sequentialPlan) {
      stats.sequentialSecondChoices++;
      stats.responsePairs[sequentialPlan.pair]++;
      stats.responseAllocations[`${sequentialPlan.keep}->${sequentialPlan.give}`]++;
    }
    const boundarySelfPlan = S.commitBoundarySelfCorner(s, rules, strength);
    if(boundarySelfPlan) stats.boundarySelfCornerColours[boundarySelfPlan.colour]++;
    const boundaryColour = S.commitBoundaryCorner(s, rules, strength);
    if(boundaryColour) stats.boundaryCornerColours[boundaryColour]++;

    const forcedColourInfo = S.normalForcedColourInfo(s);
    const resultCategory = s.finalFour ? "final-four" : s.openingRemaining > 0 ? "opening-four" : forcedColourInfo ? "normal-one-colour" : "normal-both-colours";
    const wasForced = s.forcedQueue.length > 0;
    const responseSlot = wasForced ? s.forcedQueue[0].responseSlot : null;

    if(s.finalFour && !phaseDiagnostics.finalFourEntry) {
      const immediate = finalFourImmediateWinInfo(s, rules);
      phaseDiagnostics.finalFourEntry = {
        firstActor:s.currentPlayer, transitionActor:null, cause:"pre-existing", turn:s.turns,
        immediateWinAvailable:immediate.available,
        immediateWinningColours:immediate.winningColours,
        immediateWinningActions:immediate.winningActions
      };
    }
    if(forcedColourInfo && !phaseDiagnostics.oneColourEntry) {
      phaseDiagnostics.oneColourEntry = {
        firstActor:s.currentPlayer, transitionActor:null, cause:"pre-existing", turn:s.turns,
        remainingColour:forcedColourInfo.colour,
        remainingBlack:s.normalRemaining.black,
        remainingWhite:s.normalRemaining.white
      };
    }

    const colour = S.chooseColour(s, rules, strength, finalFourColourPolicy);
    const action = S.chooseAction(s, colour, rules, strength);
    if(!action) { s.winner = "draw"; break; }

    if(!(action.type === "jump" && (s.jumpConsequence === "redeploy-only" || s.jumpConsequence === "redeploy-pass"))) {
      consecutiveRedeployOnlyJumps = 0;
    }

    const actor = s.currentPlayer;
    const actionTurn = s.turns + 1;
    if(action.type.includes("place")) {
      stats.placements++;
      stats.placementsByPlayer[actor]++;
    } else if(action.type === "move") {
      stats.moves++;
      stats.movesByPlayer[actor]++;
    } else {
      stats.jumps++;
      stats.jumpsByPlayer[actor]++;
      stats.jumpEvents.push({
        turn:actionTurn,
        actor,
        colour,
        from:action.from,
        to:action.to,
        over:action.over
      });
    }
    if(wasForced) stats.forcedPlacements++;

    const beforeColours = normalColourCount(s), beforeReserve = normalReserveCount(s);
    if(resultCategory === "final-four" && action.type === "final-place") {
      phaseDiagnostics.finalFourPlacements++;
      if(phaseDiagnostics.finalFourPlacements === 1) {
        phaseDiagnostics.finalFourFirstChosenColour = colour;
        phaseDiagnostics.finalFourFirstChosenColourImmediateWin = actionWins(s, action, rules);
      }
    }

    const result = S.applyAction(s, action, rules);
    if(resultCategory === "final-four" && phaseDiagnostics.finalFourPlacements === 1 && result.ended) {
      phaseDiagnostics.finalFourFirstActionImmediateWin = true;
    }
    if(result.ended) {
      return finish({
        ...stats, winner:s.winner, turns:s.turns, reachedFinalFour:s.reachedFinalFour,
        winType:result.winType || null,
        resultCategory:s.winner === "draw" ? "draw" : resultCategory,
        winningActionType:s.winner === "draw" ? null : (action.type.includes("place") ? "placement" : action.type),
        winningResponseSlot:s.winner === "draw" ? null : responseSlot,
        forcedNormalColourWin:s.winner !== "draw" && !!forcedColourInfo,
        forcedNormalColour:forcedColourInfo?.colour || null,
        exhaustedNormalColour:forcedColourInfo?.exhaustedColour || null,
        maxTurnDraw:false
      }, phaseDiagnostics, openingPolicy, repetitionObserved, repetitionEvents, automaticOpening);
    }

    recordPhaseTransition(phaseDiagnostics, s, beforeColours, beforeReserve, action, wasForced, responseSlot, actor, rules);

    if(action.type === "jump" && s.jumpConsequence !== "current") {
      stats.jumpRedeployResponses++;
      const response = S.resolveJumpRedeploy(s, action, rules, strength);
      stats.redeployPlacements++;
      stats.forcedPlacements++;
      if(response.stage === "redeploy") {
        stats.redeployWins[s.winner]++;
        return finish({
          ...stats, winner:s.winner, turns:s.turns, reachedFinalFour:s.reachedFinalFour,
          winType:response.firstResult.winType || null, resultCategory,
          winningActionType:"redeploy", winningResponseSlot:1,
          forcedNormalColourWin:!!forcedColourInfo,
          forcedNormalColour:forcedColourInfo?.colour || null,
          exhaustedNormalColour:forcedColourInfo?.exhaustedColour || null,
          maxTurnDraw:false
        }, phaseDiagnostics, openingPolicy, repetitionObserved, repetitionEvents, automaticOpening);
      }
      if(s.jumpConsequence === "redeploy-only" || s.jumpConsequence === "redeploy-pass") {
        consecutiveRedeployOnlyJumps++;
        stats.maxConsecutiveRedeployOnlyJumps = Math.max(stats.maxConsecutiveRedeployOnlyJumps, consecutiveRedeployOnlyJumps);
      } else {
        stats.placements++;
        stats.forcedPlacements++;
        if(response.stage === "reserve") {
          stats.jumpReserveWins[s.winner]++;
          return finish({
            ...stats, winner:s.winner, turns:s.turns, reachedFinalFour:s.reachedFinalFour,
            winType:response.secondResult.winType || null, resultCategory,
            winningActionType:"placement", winningResponseSlot:2,
            forcedNormalColourWin:!!forcedColourInfo,
            forcedNormalColour:forcedColourInfo?.colour || null,
            exhaustedNormalColour:forcedColourInfo?.exhaustedColour || null,
            maxTurnDraw:false
          }, phaseDiagnostics, openingPolicy, repetitionObserved, repetitionEvents, automaticOpening);
        }
      }
    } else if(action.type === "move" || action.type === "jump") {
      const plan = S.commitMoveResponse(s, rules, strength);
      if(plan.pair === "boundary-one" || plan.pair === "boundary-choice") {
        stats.boundaryResponses++;
        if(plan.boundaryFirstSource) {
          stats.boundaryFirstSources[plan.boundaryFirstSource]++;
          if(plan.boundaryFirstSource === "corner") stats.boundaryResponderCornerColours[plan.firstColour]++;
        }
      } else {
        stats.twoPieceResponses++;
        if(plan.pair !== "sequential-pending") {
          stats.responsePairs[plan.pair]++;
          stats.responseAllocations[`${plan.keep}->${plan.give}`]++;
        }
      }
    }

    const key = boardKey(s);
    if(seen.has(key)) {
      repetitionObserved = true;
      repetitionEvents++;
    } else {
      seen.add(key);
    }
  }

  return finish({
    ...stats, winner:s.winner || "draw", turns:s.turns, reachedFinalFour:s.reachedFinalFour,
    winType:null, resultCategory:"draw", winningActionType:null, winningResponseSlot:null,
    forcedNormalColourWin:false, forcedNormalColour:null, exhaustedNormalColour:null,
    maxTurnDraw:!s.winner && s.turns >= maxTurns
  }, phaseDiagnostics, openingPolicy, repetitionObserved, repetitionEvents, automaticOpening);
}

module.exports = {
  OPENING_POLICIES,
  AUTOMATIC_OPENINGS,
  normaliseOpeningPolicy,
  prepareState,
  playGame
};
