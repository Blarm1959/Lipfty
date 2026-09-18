const mobileVersionElement = document.getElementById("mobile-version");
(function () {
  "use strict";

  const rules = window.LipftyRules;
  const BOARD_CELLS = rules.SIZE * rules.SIZE;
  const CORNERS = [0, 7, 56, 63];
  const ANCHOR_SQUARES = [0, 5, 30, 35];
  const ANCHOR_SETUP = [
    { index: 0, colour: "black" },
    { index: 5, colour: "white" },
    { index: 30, colour: "white" },
    { index: 35, colour: "black" }
  ];
  const STANDARD_RULES = Object.freeze({
    allowJump: true,
    allowMove: true,
    allowDiagonal: true,
    allowSquare: false,
    allowSpacedSquare: false,
    allowDiamond: false,
    allowSpacedDiamond: false
  });

  const boardElement = document.getElementById("board");
  const statusElement = document.getElementById("status");
  const currentPlayerElement = document.getElementById("current-player");
  const blackButton = document.getElementById("place-black");
  const whiteButton = document.getElementById("place-white");
  const blackRemainingElement = document.getElementById("black-remaining");
  const whiteRemainingElement = document.getElementById("white-remaining");
  const jumpControls = document.getElementById("jump-controls");
  const finishJumpButton = document.getElementById("finish-jump");
  const undoButton = document.getElementById("undo");

  const COLOURS = {
    red: ["Red", "#d6423a"], blue: ["Blue", "#2d65ad"], green: ["Green", "#318653"],
    yellow: ["Yellow", "#e2ad34"], purple: ["Purple", "#7955a6"], orange: ["Orange", "#d97832"],
    black: ["Black", "#1d1d1d"], white: ["White", "#f8f8f4"]
  };

  let nextPieceId = 1;
  let state = null;
  let settings = loadSettings();
  let computerBusy = false;
  // App-only aid: retained only while the computer is showing its chosen action.
  // It deliberately does not participate in the rules, saved game state or AI choice.
  let computerMoveVisual = null;
  let flowTimer = null;
  let checkpoints = [];
  let clockInterval = null;
  let clockRemainingMs = [0, 0];
  let clockActivePlayer = null;
  let clockLastTick = null;
  let clockSuppressIncrementOnce = false;

  function loadSettings() {
    const defaults = {
      mode: "computer", player1: "Player", player2: "Player 2", level: "standard",
      gameFormat: "lipfty", starter: "random", undo: true, language: "en-GB", colour1: "red", colour2: "blue",
      clockMinutes: 0, clockIncrement: 0, sound: true, animations: true, undoPreviousJump: false,
      rulesBaseline: 10,
      ...STANDARD_RULES
    };
    try {
      const saved = JSON.parse(localStorage.getItem("lipfty-settings") || "{}");
      if (saved.winLevel && saved.allowJump === undefined) {
        const level = Number(saved.winLevel) || 1;
        Object.assign(saved, {
          allowJump: level >= 2, allowMove: level >= 3, allowDiagonal: level >= 4,
          allowSquare: level >= 5, allowSpacedSquare: level >= 6,
          allowDiamond: level >= 7, allowSpacedDiamond: level >= 8
        });
      }
      delete saved.winLevel;
      // Diamonds were experimental in earlier versions and are no longer part
      // of Lipfty 8. Remove any legacy saved switches and always keep them off.
      const hadLegacyDiamondSettings = Object.prototype.hasOwnProperty.call(saved, "allowDiamond") ||
        Object.prototype.hasOwnProperty.call(saved, "allowSpacedDiamond");
      delete saved.allowDiamond;
      delete saved.allowSpacedDiamond;
      // v8.0.21 replaces the old per-move timer with an optional chess clock.
      // Existing players therefore migrate to Clock Off rather than inheriting
      // an old 30/45/60-second move limit.
      if (saved.clockMinutes === undefined) saved.clockMinutes = 0;
      if (saved.clockIncrement === undefined) saved.clockIncrement = 0;
      delete saved.timer;
      // Lipfty 11 adds Lipfty24 as a second game format. Existing players
      // remain on full Lipfty unless they explicitly choose Lipfty24.
      const needsFormatMigration = !["lipfty", "lipfty24"].includes(saved.gameFormat);
      if (needsFormatMigration) saved.gameFormat = "lipfty";
      // Lipfty 10 introduces the Learning / Standard / Extreme version set.
      // Existing saved settings migrate safely to Standard.
      const needsRulesBaselineMigration = saved.rulesBaseline !== 10;
      if (needsRulesBaselineMigration) {
        Object.assign(saved, STANDARD_RULES, { rulesBaseline: 10 });
      }
      const migrated = { ...defaults, ...saved, allowDiamond: false, allowSpacedDiamond: false };
      if (hadLegacyDiamondSettings || needsRulesBaselineMigration || needsFormatMigration) {
        localStorage.setItem("lipfty-settings", JSON.stringify(migrated));
      }
      return migrated;
    } catch (_) {
      return defaults;
    }
  }

  function saveSettings() { localStorage.setItem("lipfty-settings", JSON.stringify(settings)); }
  function isComputer(playerIndex) { return settings.mode === "computer" && playerIndex === 1; }
  function participantName(playerIndex) {
    if (isComputer(playerIndex)) return "Computer";
    if (settings.mode === "computer") return settings.player1 || "Player";
    return playerIndex === 0 ? (settings.player1 || "Player 1") : (settings.player2 || "Player 2");
  }
  function otherPlayer(playerIndex = state.currentPlayer) { return playerIndex === 0 ? 1 : 0; }
  function colourKey(colour) { return colour === "black" ? settings.colour1 : settings.colour2; }
  function colourTitle(colour) { return COLOURS[colourKey(colour)][0]; }
  function applyPieceColours() {
    document.documentElement.style.setProperty("--piece-black", COLOURS[settings.colour1][1]);
    document.documentElement.style.setProperty("--piece-white", COLOURS[settings.colour2][1]);
  }
  function isLipfty24() { return settings.gameFormat === "lipfty24"; }
  function gameFormatTitle() { return isLipfty24() ? "Lipfty24" : "Lipfty"; }

  function shuffled(values) {
    const result = [...values];
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function makeReserveLayout() {
    const outer = [];
    for (let i = 0; i < 64; i += 1) {
      const r = Math.floor(i / 8), c = i % 8;
      if (r === 0 || r === 7 || c === 0 || c === 7) outer.push(i);
    }
    const nonCorners = outer.filter(i => !CORNERS.includes(i));
    const active = Array(64).fill(null);
    const locked = Array(64).fill(null);

    // The Opening Four are already on the inner board. The 24
    // ordinary reserve pieces therefore occupy only the non-corner ring slots.
    shuffled([...Array(12).fill("black"), ...Array(12).fill("white")])
      .forEach((colour, i) => { active[nonCorners[i]] = colour; });

    // Full Lipfty keeps four special Final Four pieces in the physical board
    // corners. Lipfty24 uses only the 24 ordinary draughts/checkers pieces,
    // so all four physical corners remain empty throughout that game.
    if (!isLipfty24()) {
      shuffled(["black", "black", "white", "white"])
        .forEach((colour, i) => { locked[CORNERS[i]] = colour; });
    }

    return { active, locked };
  }

  function makeAutomaticAnchorBoard() {
    const board = Array(BOARD_CELLS).fill(null);
    if (isLipfty24()) return board;
    for (const anchor of ANCHOR_SETUP) {
      board[anchor.index] = { id: nextPieceId++, colour: anchor.colour, pinned: true, special: true };
    }
    return board;
  }

  function freshState() {
    return {
      board: makeAutomaticAnchorBoard(),
      reserveLayout: makeReserveLayout(),
      currentPlayer: 0,
      finalFourPhase: false,
      finalCornerPieces: [null, null, null, null],
      finalCornersPrepared: false,
      choosingColour: true,
      colourChooser: 1,
      assignedColour: null,
      selectedReserveIndex: null,
      selectedPieceIndex: null,
      legalMoves: new Set(),
      legalJumps: new Map(),
      consequence: null,
      redeployPiece: null,
      protectedPieceId: null,
      compulsoryPlacementsRemaining: 0,
      jumpFlashIndex: null,
      winner: null,
      winReason: null,
      winningCells: []
    };
  }

  function activeReserveIndices(colour = null) {
    const result = [];
    for (let i = 0; i < 64; i += 1) {
      const c = state.reserveLayout.active[i];
      if (!c || CORNERS.includes(i) || (colour && c !== colour)) continue;
      result.push(i);
    }
    return result;
  }
  function normalReserveRemaining(colour) { return activeReserveIndices(colour).length; }
  function normalReserveTotal() { return normalReserveRemaining("black") + normalReserveRemaining("white"); }
  function normalReserveColourCount() {
    return ["black", "white"].filter(colour => normalReserveRemaining(colour) > 0).length;
  }
  function oneColourPlacementOnly() {
    return !state.finalFourPhase && !state.consequence && !state.redeployPiece &&
      normalReserveTotal() > 0 && normalReserveColourCount() === 1;
  }
  function finalCornerPiecesRemain() { return state.finalCornerPieces.some(Boolean); }
  function prepareFinalCorners() {
    if (state.finalCornersPrepared) return;
    state.finalCornerPieces = CORNERS.map(i => state.reserveLayout.locked[i]);
    state.finalCornersPrepared = true;
  }
  function beginFinalFourIfReady() {
    if (state.finalFourPhase || state.consequence || state.redeployPiece || normalReserveTotal() !== 0) return false;
    if (isLipfty24()) {
      state.winner = "draw";
      state.assignedColour = null;
      state.selectedReserveIndex = null;
      state.choosingColour = false;
      state.compulsoryPlacementsRemaining = 0;
      stopChessClockInterval();
      clockActivePlayer = null;
      clockLastTick = null;
      setStatus("Draw - all 24 Lipfty24 pieces have been played without a win.");
      maybeShowUpdateDialog();
      return true;
    }
    prepareFinalCorners();
    state.finalFourPhase = true;
    state.assignedColour = null;
    state.selectedReserveIndex = null;
    state.choosingColour = true;
    state.colourChooser = state.currentPlayer;
    state.compulsoryPlacementsRemaining = 0;
    return true;
  }

  function moveAllowedNow() {
    return !!settings.allowMove && !state.finalFourPhase && !state.consequence &&
      !state.redeployPiece && !oneColourPlacementOnly();
  }
  function jumpAllowedNow() {
    return !!settings.allowJump && !state.finalFourPhase && !state.consequence &&
      !state.redeployPiece && !oneColourPlacementOnly();
  }

  function randomEligibleReserveIndex(colour) {
    const candidates = state.finalFourPhase
      ? CORNERS.filter((index, slot) => state.finalCornerPieces[slot] === colour)
      : activeReserveIndices(colour).filter(i => i !== state.consequence?.heldReserveIndex);
    return candidates.length ? candidates[Math.floor(Math.random() * candidates.length)] : null;
  }
  function firstFinalCornerIndex(colour) {
    const slot = state.finalCornerPieces.findIndex(c => c === colour);
    return slot >= 0 ? CORNERS[slot] : null;
  }

  function clearSelection() {
    state.selectedPieceIndex = null;
    state.legalMoves = new Set();
    state.legalJumps = new Map();
  }
  function clearHeldPiece() {
    state.assignedColour = null;
    state.selectedReserveIndex = null;
    clearSelection();
  }

  function serialiseState() {
    return {
      ...state,
      board: state.board.map(piece => piece ? { ...piece } : null),
      reserveLayout: { active: [...state.reserveLayout.active], locked: [...state.reserveLayout.locked] },
      finalCornerPieces: [...state.finalCornerPieces],
      consequence: state.consequence ? { ...state.consequence } : null,
      redeployPiece: state.redeployPiece ? { ...state.redeployPiece } : null,
      legalMoves: [], legalJumps: [], selectedPieceIndex: null
    };
  }
  function makeSnapshot() {
    settleChessClock();
    return {
      state: serialiseState(),
      nextPieceId,
      clock: { remainingMs: [...clockRemainingMs], activePlayer: clockActivePlayer }
    };
  }
  function snapshotKey(snapshot) { return JSON.stringify(snapshot.state); }
  function isHumanDecisionPoint() {
    if (!state || state.winner !== null || computerBusy) return false;
    if (state.choosingColour) return !isComputer(state.colourChooser);
    return !isComputer(state.currentPlayer);
  }
  function rememberDecisionPoint() {
    if (!settings.undo || !isHumanDecisionPoint()) return;
    const snap = makeSnapshot();
    const key = snapshotKey(snap);
    if (!checkpoints.length || checkpoints[checkpoints.length - 1].key !== key) checkpoints.push({ key, snap });
  }
  function restoreSnapshot(snap) {
    clearTimeout(flowTimer);
    computerBusy = false;
    computerMoveVisual = null;
    nextPieceId = snap.nextPieceId;
    state = {
      ...snap.state,
      board: snap.state.board.map(piece => piece ? { ...piece } : null),
      reserveLayout: { active: [...snap.state.reserveLayout.active], locked: [...snap.state.reserveLayout.locked] },
      finalCornerPieces: [...snap.state.finalCornerPieces],
      consequence: snap.state.consequence ? { ...snap.state.consequence } : null,
      redeployPiece: snap.state.redeployPiece ? { ...snap.state.redeployPiece } : null,
      selectedPieceIndex: null, legalMoves: new Set(), legalJumps: new Map()
    };
    restoreChessClock(snap.clock);
    clockSuppressIncrementOnce = true;
    processFlow("Previous decision restored.");
  }
  function undo() {
    if (!settings.undo || computerBusy || !checkpoints.length) return;
    const currentKey = snapshotKey(makeSnapshot());
    if (checkpoints.length && checkpoints[checkpoints.length - 1].key === currentKey) checkpoints.pop();
    if (!checkpoints.length) { render(); return; }
    restoreSnapshot(checkpoints.pop().snap);
  }

  function setStatus(text) { statusElement.textContent = text; }
  function finishWin() {
    const win = rules.checkWin(state.board, settings);
    if (!win) return false;
    state.winner = state.currentPlayer;
    state.winReason = "board";
    state.winningCells = [...win.line];
    computerBusy = false;
    computerMoveVisual = null;
    stopChessClockInterval();
    clockActivePlayer = null;
    clockLastTick = null;
    clearSelection();
    setStatus(`${participantName(state.currentPlayer)} wins with four ${colourTitle(win.colour)} pieces!`);
    render();
    maybeShowUpdateDialog();
    return true;
  }

  function availableChoiceColours() {
    if (state.finalFourPhase) return ["black", "white"].filter(c => firstFinalCornerIndex(c) !== null);
    const held = state.consequence?.heldReserveIndex;
    return ["black", "white"].filter(c => activeReserveIndices(c).some(i => i !== held));
  }

  function chooserIsChoosingForSelf() {
    if (state.finalFourPhase) return true;
    return false;
  }

  function chooseColour(colour, reserveIndex = null) {
    if (state.winner !== null || !state.choosingColour || computerBusy) return false;
    if (!availableChoiceColours().includes(colour)) return false;
    let index = reserveIndex;
    if (index === null) {
      index = randomEligibleReserveIndex(colour);
    }
    if (index === null) return false;
    if (state.finalFourPhase) {
      const slot = CORNERS.indexOf(index);
      if (slot < 0 || state.finalCornerPieces[slot] !== colour) return false;
    } else {
      // A Move keeps its originally handed piece in the mover's hand.  The
      // first compulsory placement must use another physical reserve piece.
      if (CORNERS.includes(index) || state.reserveLayout.active[index] !== colour ||
          index === state.consequence?.heldReserveIndex) return false;
    }
    state.selectedReserveIndex = index;
    state.assignedColour = colour;
    state.choosingColour = false;
    clearSelection();
    processFlow();
    return true;
  }

  function autoChooseIfNoMeaningfulChoice() {
    if (!state.choosingColour) return false;
    const colours = availableChoiceColours();
    if (colours.length !== 1) return false;
    const colour = colours[0];
    // During a Move consequence the original handed piece is being held for
    // the mover's second placement.  It must never be selected for the
    // opponent's compulsory placement, even if both pieces have the same
    // colour.
    const index = randomEligibleReserveIndex(colour);
    if (index === null) return false;
    state.selectedReserveIndex = index;
    state.assignedColour = colour;
    state.choosingColour = false;
    clearSelection();
    return true;
  }

  function colourPrompt() {
    if (state.finalFourPhase) return `${participantName(state.currentPlayer)}: choose one of the remaining Final Four corner pieces to place.`;
    if (state.consequence?.type === "move" && state.consequence.step === 1) {
      return `${participantName(state.colourChooser)}: choose a reserve piece for ${participantName(state.currentPlayer)} to place.`;
    }
    const chooser = participantName(state.colourChooser);
    const receiver = participantName(state.currentPlayer);
    return `${chooser}: choose a reserve piece/colour for ${receiver}.`;
  }

  function actionPrompt() {
    const actor = participantName(state.currentPlayer);
    if (state.redeployPiece) return `${actor}: redeploy the jumped ${colourTitle(state.redeployPiece.colour)} piece on any empty square.`;
    if (state.finalFourPhase) return `${actor}: place the chosen Final Four ${colourTitle(state.assignedColour)} piece. No Move or Jump.`;
    if (state.consequence?.type === "move") {
      return state.consequence.step === 1 ? `${actor}: place the reserve piece chosen for you.` : `${actor}: place the piece you were originally handed.`;
    }
    if (oneColourPlacementOnly()) return `${actor}: only ${colourTitle(state.assignedColour)} remains in the normal reserve - placement only until the reserve is empty.`;
    const actions = [];
    actions.push("place the handed reserve piece");
    if (moveAllowedNow()) actions.push("Move a board piece of that colour");
    if (jumpAllowedNow()) actions.push("Jump over one opposite-colour piece");
    return `${actor}: ${actions.join(", or ")}.`;
  }

  function processFlow(message = null) {
    clearTimeout(flowTimer);
    if (state.winner !== null) { render(); return; }

    beginFinalFourIfReady();
    if (state.winner !== null) { render(); return; }

    if (state.choosingColour) {
      const colours = availableChoiceColours();
      if (!colours.length) {
        state.winner = "draw";
        stopChessClockInterval();
        clockActivePlayer = null;
        clockLastTick = null;
        setStatus("Draw - no legal piece is available.");
        render();
        maybeShowUpdateDialog();
        return;
      }
      if (autoChooseIfNoMeaningfulChoice()) {
        message = `${colourTitle(state.assignedColour)} is the only available reserve colour, so the piece is selected automatically.`;
      }
    }

    if (message) setStatus(message);
    else if (state.choosingColour) setStatus(colourPrompt());
    else setStatus(actionPrompt());
    syncChessClock({ addIncrement: !clockSuppressIncrementOnce });
    clockSuppressIncrementOnce = false;
    if (state.winner !== null) return;
    render();

    if (isHumanDecisionPoint()) { rememberDecisionPoint(); return; }
    if (state.choosingColour && isComputer(state.colourChooser)) {
      flowTimer = setTimeout(computerChooseColour, 250);
      return;
    }
    if (!state.choosingColour && isComputer(state.currentPlayer)) {
      flowTimer = setTimeout(computerPlayTurn, 350);
    }
  }

  function consumeSelectedActivePiece() {
    const index = state.selectedReserveIndex;
    if (index === null || state.reserveLayout.active[index] !== state.assignedColour) return false;
    state.reserveLayout.active[index] = null;
    return true;
  }

  function startNextNormalTurn(currentPlayer, chooser, protectedPieceId = null) {
    state.currentPlayer = currentPlayer;
    state.colourChooser = chooser;
    state.protectedPieceId = protectedPieceId;
    state.consequence = null;
    state.redeployPiece = null;
    state.compulsoryPlacementsRemaining = 0;
    clearHeldPiece();
    if (!beginFinalFourIfReady()) state.choosingColour = true;
    processFlow();
  }

  function finishOrdinaryPlacement() {
    const finishingPlayer = state.currentPlayer;
    startNextNormalTurn(otherPlayer(finishingPlayer), finishingPlayer, null);
  }

  function beginMoveConsequence(mover, movedPieceId, heldReserveIndex, heldColour) {
    const total = normalReserveTotal();
    if (total < 2) {
      // Standard Lipfty disables Move as soon as one reserve colour remains,
      // so this boundary is not reachable in normal Standard play.
      startNextNormalTurn(otherPlayer(mover), mover, movedPieceId);
      return;
    }
    const responder = otherPlayer(mover);
    state.consequence = { type: "move", step: 1, mover, responder, protectedPieceId: movedPieceId, heldReserveIndex, heldColour };
    state.currentPlayer = responder;
    // The player who made the Move chooses the opponent's compulsory piece.
    // This also lets a computer Move choose automatically for the player.
    state.colourChooser = mover;
    state.protectedPieceId = movedPieceId;
    state.compulsoryPlacementsRemaining = 2;
    state.choosingColour = true;
    processFlow(`Move completed. ${participantName(mover)} chooses a reserve piece for ${participantName(responder)} to place.`);
  }

  function advanceMoveConsequence() {
    const c = state.consequence;
    if (!c || c.type !== "move") return;
    if (c.step === 1) {
      c.step = 2;
      state.currentPlayer = c.mover;
      state.compulsoryPlacementsRemaining = 1;
      state.selectedReserveIndex = c.heldReserveIndex;
      state.assignedColour = c.heldColour;
      state.choosingColour = false;
      processFlow(`${participantName(c.mover)} now places the piece they were originally handed.`);
      return;
    }
    const responder = c.responder;
    const mover = c.mover;
    const protectedPieceId = c.protectedPieceId;
    startNextNormalTurn(responder, mover, protectedPieceId);
  }

  function finishRedeploy() {
    const c = state.consequence;
    const responder = c.responder;
    const jumper = c.jumper;
    const protectedPieceId = c.protectedPieceId;
    state.redeployPiece = null;
    state.currentPlayer = jumper;
    state.consequence = { type: "jump-held", jumper, responder, protectedPieceId, heldReserveIndex: c.heldReserveIndex, heldColour: c.heldColour };
    state.protectedPieceId = protectedPieceId;
    state.selectedReserveIndex = c.heldReserveIndex;
    state.assignedColour = c.heldColour;
    state.choosingColour = false;
    state.compulsoryPlacementsRemaining = 1;
    processFlow(`${participantName(jumper)} now places the piece they were originally handed.`);
  }

  function placeAt(index) {
    if (computerBusy || state.winner !== null || state.choosingColour || state.board[index]) return false;

    if (state.redeployPiece) {
      state.board[index] = state.redeployPiece;
      clearSelection();
      if (finishWin()) return true;
      finishRedeploy();
      return true;
    }

    const colour = state.assignedColour;
    if (!colour || state.selectedReserveIndex === null) return false;

    if (state.finalFourPhase) {
      const slot = CORNERS.indexOf(state.selectedReserveIndex);
      if (slot < 0 || state.finalCornerPieces[slot] !== colour) return false;
      state.board[index] = { id: nextPieceId++, colour, pinned: false, special: true };
      state.finalCornerPieces[slot] = null;
      clearHeldPiece();
      if (finishWin()) return true;
      if (!finalCornerPiecesRemain()) {
        state.winner = "draw";
        stopChessClockInterval();
        clockActivePlayer = null;
        clockLastTick = null;
        setStatus("Draw - all four Final Four pieces have been placed without a win.");
        render(); maybeShowUpdateDialog(); return true;
      }
      const finishing = state.currentPlayer;
      state.currentPlayer = otherPlayer(finishing);
      state.colourChooser = state.currentPlayer;
      state.choosingColour = true;
      processFlow(); return true;
    }

    if (CORNERS.includes(state.selectedReserveIndex)) return false;
    if (!consumeSelectedActivePiece()) return false;
    state.board[index] = { id: nextPieceId++, colour, pinned: false };
    clearHeldPiece();
    if (finishWin()) return true;

    if (state.consequence?.type === "move") {
      advanceMoveConsequence();
      return true;
    }
    if (state.consequence?.type === "jump-held") {
      const c = state.consequence;
      startNextNormalTurn(c.responder, c.jumper, c.protectedPieceId);
      return true;
    }

    finishOrdinaryPlacement();
    return true;
  }

  function legalSingleJumps(from) {
    if (!jumpAllowedNow()) return [];
    const piece = state.board[from];
    if (!piece || piece.pinned) return [];
    return rules.jumpDestinations(state.board, from).filter(j => {
      const over = state.board[j.over];
      return over && !over.pinned && over.colour !== piece.colour;
    });
  }

  function selectPiece(index) {
    if (computerBusy || state.winner !== null || state.choosingColour || state.redeployPiece || state.consequence ||
        state.finalFourPhase || oneColourPlacementOnly()) return;
    const piece = state.board[index];
    if (!piece || piece.colour !== state.assignedColour) return;
    if (piece.pinned) {
      setStatus("That opening corner piece is pinned and cannot Move or Jump.");
      render(); return;
    }
    if (piece.id === state.protectedPieceId) {
      setStatus("You cannot Move or Jump the piece your opponent moved on their previous turn.");
      render(); return;
    }
    if (state.selectedPieceIndex !== null && state.selectedPieceIndex !== index) {
      setStatus("That board piece is already chosen for this turn."); render(); return;
    }
    state.selectedPieceIndex = index;
    state.legalMoves = new Set(moveAllowedNow() ? rules.adjacentDestinations(state.board, index) : []);
    state.legalJumps = new Map(legalSingleJumps(index).map(j => [j.to, j]));
    if (!state.legalMoves.size && !state.legalJumps.size) {
      clearSelection(); setStatus("That piece has no legal Move or Jump.");
    } else setStatus("Choose a highlighted destination.");
    render();
  }

  function moveBoardPiece(from, to, jump = null, afterFlash = false) {
    const piece = state.board[from];
    if (!piece || piece.pinned || state.board[to]) return;
    if (jump && !afterFlash) {
      state.jumpFlashIndex = jump.over;
      render();
      flowTimer = setTimeout(() => {
        state.jumpFlashIndex = null;
        moveBoardPiece(from, to, jump, true);
      }, settings.animations ? 400 : 0);
      return;
    }
    if (jump && state.board[jump.over]?.pinned) return;
    state.board[to] = piece;
    state.board[from] = null;
    clearSelection();
    const heldReserveIndex = state.selectedReserveIndex;
    const heldColour = state.assignedColour;

    if (finishWin()) return;

    if (!jump) {
      beginMoveConsequence(state.currentPlayer, piece.id, heldReserveIndex, heldColour);
      return;
    }

    const jumpedPiece = state.board[jump.over];
    if (!jumpedPiece || jumpedPiece.pinned || jumpedPiece.colour === piece.colour) return;
    state.board[jump.over] = null;
    const jumper = state.currentPlayer;
    const responder = otherPlayer(jumper);
    state.consequence = { type: "jump-redeploy", jumper, responder, protectedPieceId: piece.id, heldReserveIndex, heldColour };
    state.redeployPiece = jumpedPiece;
    state.currentPlayer = responder;
    state.protectedPieceId = piece.id;
    state.assignedColour = jumpedPiece.colour;
    state.selectedReserveIndex = null;
    state.choosingColour = false;
    processFlow(`${participantName(responder)}: redeploy the exact jumped ${colourTitle(jumpedPiece.colour)} piece anywhere empty.`);
  }

  function handleCell(index) {
    if (computerBusy || state.jumpFlashIndex !== null || state.winner !== null || state.choosingColour || isComputer(state.currentPlayer)) return;
    const piece = state.board[index];
    if (!piece && state.selectedPieceIndex !== null) {
      const from = state.selectedPieceIndex;
      if (state.legalJumps.has(index)) moveBoardPiece(from, index, state.legalJumps.get(index));
      else if (state.legalMoves.has(index)) moveBoardPiece(from, index, null);
      return;
    }
    if (!piece && state.selectedPieceIndex === null) { placeAt(index); return; }
    if (piece) selectPiece(index);
  }

  function cloneBoard(board) { return board.map(piece => piece ? { ...piece } : null); }
  function boardAfterAction(action) {
    const board = cloneBoard(state.board);
    if (["place", "final-place", "redeploy"].includes(action.type)) board[action.to] = { id: -1, colour: action.colour, pinned: false };
    else { board[action.to] = board[action.from]; board[action.from] = null; }
    return board;
  }
  function actionWins(action) { return !!rules.checkWin(boardAfterAction(action), settings); }
  function actionScore(action) {
    if (actionWins(action)) return 100000;
    const r = Math.floor(action.to / rules.SIZE), c = action.to % rules.SIZE;
    let score = ((r === 2 || r === 3) ? 2 : 0) + ((c === 2 || c === 3) ? 2 : 0) + Math.random();
    if (action.type === "jump") score += 1.5;
    if (settings.level === "expert") {
      const board = boardAfterAction(action);
      const colour = action.colour || state.board[action.from]?.colour;
      for (const pattern of rules.WINNING_PATTERNS) {
        if (!pattern.includes(action.to)) continue;
        const count = pattern.filter(i => board[i]?.colour === colour).length;
        score += count * count;
      }
    }
    return score;
  }
  function pickComputerAction(actions) {
    if (!actions.length) return null;
    const wins = actions.filter(actionWins);
    if (wins.length) return wins[Math.floor(Math.random() * wins.length)];
    if (settings.level === "beginner") return actions[Math.floor(Math.random() * actions.length)];
    return [...actions].sort((a, b) => actionScore(b) - actionScore(a))[0];
  }

  function enumerateActions(colour, mustPlace = false) {
    const actions = [];
    if (colour && normalReserveRemaining(colour) > 0) {
      for (let to = 0; to < BOARD_CELLS; to += 1) if (!state.board[to]) actions.push({ type: "place", to, colour });
    }
    if (mustPlace || oneColourPlacementOnly()) return actions;
    for (let from = 0; from < BOARD_CELLS; from += 1) {
      const piece = state.board[from];
      if (!piece || piece.pinned || piece.colour !== colour || piece.id === state.protectedPieceId) continue;
      if (moveAllowedNow()) for (const to of rules.adjacentDestinations(state.board, from)) actions.push({ type: "move", from, to, colour });
      if (jumpAllowedNow()) for (const j of legalSingleJumps(from)) actions.push({ type: "jump", from, to: j.to, over: j.over, colour });
    }
    return actions;
  }

  function computerChooseColour() {
    if (state.winner !== null || !state.choosingColour || !isComputer(state.colourChooser)) return;
    computerBusy = true; render();
    const colours = availableChoiceColours();
    if (!colours.length) { computerBusy = false; processFlow(); return; }
    let pool = colours;
    if (chooserIsChoosingForSelf()) {
      const winning = colours.filter(colour => {
        for (let to = 0; to < BOARD_CELLS; to += 1) {
          if (state.board[to]) continue;
          if (rules.checkWin(Object.assign(cloneBoard(state.board), { [to]: { id: -1, colour, pinned: false } }), settings)) return true;
        }
        return false;
      });
      if (winning.length) pool = winning;
    } else {
      const safe = colours.filter(colour => {
        for (let to = 0; to < BOARD_CELLS; to += 1) {
          if (state.board[to]) continue;
          const board = cloneBoard(state.board); board[to] = { id: -1, colour, pinned: false };
          if (rules.checkWin(board, settings)) return false;
        }
        return true;
      });
      if (safe.length) pool = safe;
    }
    const colour = pool[Math.floor(Math.random() * pool.length)];
    // As above, choose a genuinely different reserve piece when a Move has
    // left the original handed piece in the mover's hand.
    const index = randomEligibleReserveIndex(colour);
    flowTimer = setTimeout(() => {
      computerBusy = false;
      state.selectedReserveIndex = index;
      state.assignedColour = colour;
      state.choosingColour = false;
      clearSelection();
      processFlow();
    }, 200);
  }

  function computerPlayTurn() {
    if (state.winner !== null || state.choosingColour || !isComputer(state.currentPlayer)) return;
    computerBusy = true; setStatus("Computer is thinking..."); render();
    let actions = [];
    if (state.redeployPiece) {
      for (let to = 0; to < BOARD_CELLS; to += 1) if (!state.board[to]) actions.push({ type: "redeploy", to, colour: state.redeployPiece.colour });
    } else if (state.finalFourPhase) {
      for (let to = 0; to < BOARD_CELLS; to += 1) if (!state.board[to]) actions.push({ type: "final-place", to, colour: state.assignedColour });
    } else {
      actions = enumerateActions(state.assignedColour, !!state.consequence);
    }
    const action = pickComputerAction(actions);
    if (!action) { computerBusy = false; processFlow("Computer has no legal action."); return; }
    const actionName = action.type === "final-place" ? "place a Final Four piece" :
      action.type === "redeploy" ? "redeploy the jumped piece" :
      action.type === "place" ? "place a piece" : action.type === "jump" ? "Jump" : "Move";
    computerMoveVisual = {
      type: action.type,
      from: action.from ?? null,
      to: action.to,
      over: action.over ?? null
    };
    setStatus(`Computer will ${actionName}.`);
    render();
    flowTimer = setTimeout(() => {
      computerBusy = false;
      computerMoveVisual = null;
      if (["place", "final-place", "redeploy"].includes(action.type)) { placeAt(action.to); return; }
      const jump = action.type === "jump" ? { to: action.to, over: action.over } : null;
      // Retain the established, separate flash of the jumped piece after the
      // arrow has identified the computer's starting square and destination.
      moveBoardPiece(action.from, action.to, jump, false);
    }, settings.animations ? 650 : 0);
  }

  function chooseReservePiece(displayIndex, colour) {
    if (state.winner !== null || computerBusy || !state.choosingColour || isComputer(state.colourChooser)) return;
    if (!availableChoiceColours().includes(colour)) return;
    if (state.finalFourPhase) {
      const slot = CORNERS.indexOf(displayIndex);
      if (slot < 0 || state.finalCornerPieces[slot] !== colour) return;
    } else {
      if (CORNERS.includes(displayIndex) || state.reserveLayout.active[displayIndex] !== colour ||
          displayIndex === state.consequence?.heldReserveIndex) return;
    }
    chooseColour(colour, displayIndex);
  }

  // On a phone the compact colour cards are the clearest way to make the
  // choice. Selecting one chooses uniformly from every eligible physical
  // reserve piece of that colour, so the outer ring empties naturally.
  function chooseReserveColourFromPanel(colour) {
    if (state.winner !== null || computerBusy || !state.choosingColour || isComputer(state.colourChooser)) return;
    if (!availableChoiceColours().includes(colour)) return;
    const index = randomEligibleReserveIndex(colour);
    chooseColour(colour, index);
  }

  function renderBoard() {
    boardElement.replaceChildren();
    const winning = new Set(state.winningCells);
    for (let displayIndex = 0; displayIndex < 64; displayIndex += 1) {
      const dr = Math.floor(displayIndex / 8), dc = displayIndex % 8;
      const inner = dr >= 1 && dr <= 6 && dc >= 1 && dc <= 6;
      const cell = document.createElement("button");
      cell.type = "button"; cell.setAttribute("role", "gridcell");
      if (!inner) {
        cell.className = "board-cell board-cell--reserve";
        const corner = CORNERS.includes(displayIndex);
        const activeColour = state.reserveLayout.active[displayIndex];
        const slot = corner ? CORNERS.indexOf(displayIndex) : -1;
        const finalAvailable = corner && state.finalCornersPrepared ? state.finalCornerPieces[slot] : state.reserveLayout.locked[displayIndex];
        const picked = state.selectedReserveIndex === displayIndex;
        // Final Four pieces remain visibly locked on all four physical
        // corners throughout normal play.  Compulsory placements never use
        // or hide them.
        if (corner && finalAvailable && !(picked && state.finalFourPhase)) {
          const marker = document.createElement("span");
          marker.className = `piece piece--${finalAvailable} piece--locked-corner piece--special-square`; marker.setAttribute("aria-hidden", "true");
          cell.appendChild(marker);
        }
        if (activeColour && !picked) {
          const disc = document.createElement("span");
          disc.className = `piece piece--${activeColour}`; disc.setAttribute("aria-hidden", "true");
          cell.appendChild(disc);
        } else if (!corner) cell.classList.add("board-cell--reserve-empty");

        let selectable = null;
        const humanChooser = state.winner === null && state.choosingColour && !computerBusy && !isComputer(state.colourChooser);
        if (humanChooser) {
          if (state.finalFourPhase && corner && state.finalCornerPieces[slot]) selectable = state.finalCornerPieces[slot];
          else if (!state.finalFourPhase && !corner && activeColour) selectable = activeColour;
        }
        cell.disabled = !selectable;
        if (selectable) {
          cell.classList.add("board-cell--reserve-selectable");
          cell.addEventListener("click", () => chooseReservePiece(displayIndex, selectable));
        }
        boardElement.appendChild(cell); continue;
      }

      const row = dr - 1, col = dc - 1, index = row * rules.SIZE + col;
      cell.className = "board-cell board-cell--playing"; cell.dataset.index = String(index);
      if (winning.has(index)) cell.classList.add("board-cell--winner");
      if (state.selectedPieceIndex === index) cell.classList.add("board-cell--selected");
      if (state.legalMoves.has(index)) cell.classList.add("board-cell--move");
      if (state.legalJumps.has(index)) cell.classList.add("board-cell--jump");
      if (state.jumpFlashIndex === index) cell.classList.add("board-cell--jumped-flash");
      if (computerMoveVisual?.from === index) cell.classList.add("board-cell--computer-source");
      if (computerMoveVisual?.to === index) cell.classList.add("board-cell--computer-target");
      if (computerMoveVisual?.type === "jump" && computerMoveVisual.to === index) cell.classList.add("board-cell--computer-jump-target");
      if (computerMoveVisual?.type === "jump" && computerMoveVisual.over === index) cell.classList.add("board-cell--computer-jumped");
      if (!state.board[index] && !state.choosingColour && !computerBusy && !isComputer(state.currentPlayer) && state.selectedPieceIndex === null) {
        if (state.redeployPiece || state.finalFourPhase || state.selectedReserveIndex !== null) cell.classList.add("board-cell--place");
      }
      const piece = state.board[index];
      if (piece) {
        const disc = document.createElement("span");
        disc.className = `piece piece--${piece.colour}${piece.special ? " piece--special-square" : ""}`;
        disc.setAttribute("aria-hidden", "true");
        cell.appendChild(disc);
        const pieceRole = piece.pinned ? " pinned opening anchor" : piece.special ? " special Final Four piece" : " piece";
        cell.setAttribute("aria-label", `${colourTitle(piece.colour)}${pieceRole}, row ${row + 1}, column ${col + 1}`);
      } else cell.setAttribute("aria-label", `Empty playing square, row ${row + 1}, column ${col + 1}`);
      cell.disabled = computerBusy;
      cell.addEventListener("click", () => handleCell(index));
      boardElement.appendChild(cell);
    }
    renderComputerMoveArrow();
  }

  function renderComputerMoveArrow() {
    if (!computerMoveVisual || computerMoveVisual.from === null || computerMoveVisual.to === null) return;
    const from = boardElement.querySelector(`[data-index="${computerMoveVisual.from}"]`);
    const to = boardElement.querySelector(`[data-index="${computerMoveVisual.to}"]`);
    if (!from || !to) return;
    const boardRect = boardElement.getBoundingClientRect();
    const fromRect = from.getBoundingClientRect();
    const toRect = to.getBoundingClientRect();
    const x1 = fromRect.left + fromRect.width / 2 - boardRect.left;
    const y1 = fromRect.top + fromRect.height / 2 - boardRect.top;
    const x2 = toRect.left + toRect.width / 2 - boardRect.left;
    const y2 = toRect.top + toRect.height / 2 - boardRect.top;
    const dx = x2 - x1, dy = y2 - y1;
    const arrow = document.createElement("span");
    arrow.className = `computer-move-arrow${computerMoveVisual.type === "jump" ? " computer-move-arrow--jump" : ""}`;
    arrow.setAttribute("aria-hidden", "true");
    arrow.style.left = `${x1}px`;
    arrow.style.top = `${y1}px`;
    arrow.style.width = `${Math.hypot(dx, dy)}px`;
    arrow.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
    boardElement.appendChild(arrow);
    if (computerMoveVisual.type === "jump") {
      const label = document.createElement("span");
      label.className = "computer-jump-label";
      label.textContent = "JUMP!";
      label.setAttribute("aria-hidden", "true");
      label.style.left = `${(x1 + x2) / 2}px`;
      label.style.top = `${(y1 + y2) / 2}px`;
      boardElement.appendChild(label);
    }
  }

  function activeColourTotal(colour) {
    return state.reserveLayout.active.filter(c => c === colour).length;
  }
  function render() {
    const decisionActor = decisionActorIndex();
    currentPlayerElement.textContent = state.winner === "draw" ? "Draw" : state.winner !== null ? `${participantName(state.winner)} wins` : participantName(decisionActor ?? state.currentPlayer);
    const decisionLabel = currentPlayerElement.closest(".player-status-card")?.querySelector(".turn-label");
    if (decisionLabel) {
      if (state.winner !== null) decisionLabel.textContent = "Result";
      else decisionLabel.textContent = decisionActor !== state.currentPlayer ? "Decision by" : "Current turn";
    }
    renderChessClocks();
    blackRemainingElement.textContent = state.finalFourPhase ? `${state.finalCornerPieces.filter(c => c === "black").length} final remaining` : `${activeColourTotal("black")} remaining`;
    whiteRemainingElement.textContent = state.finalFourPhase ? `${state.finalCornerPieces.filter(c => c === "white").length} final remaining` : `${activeColourTotal("white")} remaining`;
    blackButton.querySelector(".piece")?.classList.toggle("piece--special-square", state.finalFourPhase && !isLipfty24());
    whiteButton.querySelector(".piece")?.classList.toggle("piece--special-square", state.finalFourPhase && !isLipfty24());
    boardElement.setAttribute("aria-label", `${gameFormatTitle()} eight by eight board with inner six by six playing area`);
    document.getElementById("colour1-name").textContent = COLOURS[settings.colour1][0];
    document.getElementById("colour2-name").textContent = COLOURS[settings.colour2][0];

    const phaseHelp = document.getElementById("phase-help");
    if (phaseHelp) {
      phaseHelp.textContent = state.finalFourPhase ? `Final Four - ${state.finalCornerPieces.filter(Boolean).length} pieces left - placement only`
        : state.redeployPiece ? `Jump consequence - ${participantName(state.currentPlayer)} redeploys the exact jumped piece`
        : state.consequence?.type === "move" ? `Move consequence - opponent placement, then held-piece placement`
        : state.consequence?.type === "jump-held" ? `Jump consequence - place your held piece`
        : oneColourPlacementOnly() ? `One-colour finish - ${normalReserveTotal()} normal reserve pieces left - placement only`
        : isLipfty24() ? `Main play - empty 6×6 start; opponent hands a reserve piece: Place, Move or Jump with that colour.`
        : `Main play - four pinned opening anchors are in place; opponent hands a reserve piece: Place, Move or Jump with that colour.`;
    }
    const boardNote = document.getElementById("board-note");
    if (boardNote) {
      boardNote.textContent = isLipfty24()
        ? "Lipfty24: inner 6×6 starts empty; all 24 draughts/checkers pieces occupy the outer non-corner spaces. There are no special corner pieces."
        : "Lipfty: inner 6×6 playing area with 4 pinned Opening Four pieces, 24 normal reserve pieces and 4 Final Four corner pieces.";
    }
    const quickOpening = document.getElementById("quick-opening-rule");
    if (quickOpening) {
      quickOpening.innerHTML = isLipfty24()
        ? "<strong>Opening:</strong> the inner 6×6 starts empty. All 24 pieces are ordinary shared reserve pieces; there is no Opening Four or Final Four."
        : "<strong>Opening:</strong> four diagonal-colour special pieces start pinned on the corners of the inner 6×6. They count towards wins but never move and cannot be jumped over.";
    }
    const placementAlert = document.getElementById("placement-alert");
    if (placementAlert) {
      placementAlert.hidden = state.compulsoryPlacementsRemaining === 0;
      placementAlert.textContent = state.compulsoryPlacementsRemaining ? `COMPULSORY PLACEMENT - ${state.compulsoryPlacementsRemaining} remaining` : "";
    }
    const reserveHeading = document.getElementById("reserve-heading");
    if (reserveHeading) reserveHeading.textContent = state.redeployPiece ? "Piece to redeploy" : "Colour to use";
    const humanChoosingColour = state.winner === null && state.choosingColour && !computerBusy && !isComputer(state.colourChooser);
    const choices = humanChoosingColour ? availableChoiceColours() : [];
    blackButton.disabled = !choices.includes("black");
    whiteButton.disabled = !choices.includes("white");
    // While choosing a new piece after a Move, the original held piece is not
    // the new choice.  Do not paint its colour as though it were selected.
    const assigned = humanChoosingColour ? null : (state.redeployPiece?.colour || state.assignedColour);
    blackButton.classList.toggle("reserve-button--assigned", !!assigned && assigned === "black");
    whiteButton.classList.toggle("reserve-button--assigned", !!assigned && assigned === "white");
    blackButton.classList.toggle("reserve-button--not-assigned", !!assigned && assigned !== "black");
    whiteButton.classList.toggle("reserve-button--not-assigned", !!assigned && assigned !== "white");
    blackButton.classList.remove("reserve-button--returned"); whiteButton.classList.remove("reserve-button--returned");
    undoButton.hidden = !settings.undo; undoButton.disabled = computerBusy || checkpoints.length === 0;
    jumpControls.hidden = true;
    renderBoard();
  }

  function jumpToFinalFourTest() {
    clearTimeout(flowTimer); computerBusy = false; computerMoveVisual = null; nextPieceId = 1; checkpoints = []; state = freshState();
    const anchorBoard = state.board.map(piece => piece ? { ...piece } : null);
    const availableCells = [...Array(BOARD_CELLS).keys()].filter(i => !anchorBoard[i]);
    let attempts = 0;
    if (isLipfty24()) {
      // Lipfty24 has no Final Four. Leave one ordinary reserve piece so End
      // remains a useful near-end test without inventing a special phase.
      const remainingIndex = activeReserveIndices()[0];
      const remainingColour = state.reserveLayout.active[remainingIndex];
      state.reserveLayout.active.fill(null);
      state.reserveLayout.active[remainingIndex] = remainingColour;
      do {
        state.board = anchorBoard.map(piece => piece ? { ...piece } : null);
        const occupied = shuffled(availableCells).slice(0, 23);
        const colours = shuffled([...Array(12).fill("black"), ...Array(12).fill("white")]);
        const removeAt = colours.indexOf(remainingColour);
        if (removeAt >= 0) colours.splice(removeAt, 1);
        occupied.forEach((index, i) => { state.board[index] = { id: nextPieceId++, colour: colours[i], pinned: false }; });
        attempts += 1;
      } while (rules.checkWin(state.board, settings) && attempts < 10000);
      state.currentPlayer = 0; state.colourChooser = 0; state.choosingColour = true;
    } else {
      state.reserveLayout.active.fill(null);
      do {
        state.board = anchorBoard.map(piece => piece ? { ...piece } : null);
        const occupied = shuffled(availableCells).slice(0, 24);
        const colours = shuffled([...Array(12).fill("black"), ...Array(12).fill("white")]);
        occupied.forEach((index, i) => { state.board[index] = { id: nextPieceId++, colour: colours[i], pinned: false }; });
        attempts += 1;
      } while (rules.checkWin(state.board, settings) && attempts < 10000);
      state.currentPlayer = 0; state.colourChooser = 0; state.choosingColour = true;
      prepareFinalCorners(); state.finalFourPhase = true;
    }
    initialiseChessClock();
    processFlow();
  }

  function resolvedStarterIndex() {
    let starter = settings.starter;
    if (starter === "random") return Math.random() < 0.5 ? 0 : 1;
    if (starter === "alternate") {
      const previous = localStorage.getItem("lipfty-last-starter") || "other";
      const next = previous === "player" ? "other" : "player";
      localStorage.setItem("lipfty-last-starter", next);
      return next === "player" ? 0 : 1;
    }
    if (starter === "computer") return 1;
    return 0;
  }

  function startNewGame() {
    clearTimeout(flowTimer); computerBusy = false; computerMoveVisual = null; nextPieceId = 1; checkpoints = []; state = freshState(); applyPieceColours();
    state.currentPlayer = resolvedStarterIndex();
    // With the automatic opening already complete, P2/opponent makes the first
    // normal handover to the selected starting player.
    state.colourChooser = otherPlayer(state.currentPlayer);
    state.choosingColour = true;
    initialiseChessClock();
    processFlow();
  }

  function clockEnabled() { return Number(settings.clockMinutes) > 0; }
  function clockIncrementMs() { return Math.max(0, Number(settings.clockIncrement) || 0) * 1000; }
  function decisionActorIndex() {
    if (!state || state.winner !== null) return null;
    return state.choosingColour ? state.colourChooser : state.currentPlayer;
  }
  function formatChessClock(milliseconds) {
    const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }
  function stopChessClockInterval() {
    if (clockInterval) clearInterval(clockInterval);
    clockInterval = null;
  }
  function settleChessClock(now = Date.now()) {
    if (!clockEnabled() || clockActivePlayer === null || clockLastTick === null || state?.winner !== null) return null;
    const elapsed = Math.max(0, now - clockLastTick);
    if (elapsed > 0) {
      clockRemainingMs[clockActivePlayer] = Math.max(0, clockRemainingMs[clockActivePlayer] - elapsed);
      clockLastTick = now;
    }
    return clockRemainingMs[clockActivePlayer] <= 0 ? clockActivePlayer : null;
  }
  function initialiseChessClock() {
    stopChessClockInterval();
    const initial = clockEnabled() ? Number(settings.clockMinutes) * 60 * 1000 : 0;
    clockRemainingMs = [initial, initial];
    clockActivePlayer = null;
    clockLastTick = null;
    renderChessClocks();
  }
  function restoreChessClock(snapshot) {
    stopChessClockInterval();
    if (!clockEnabled()) {
      clockRemainingMs = [0, 0];
      clockActivePlayer = null;
      clockLastTick = null;
      return;
    }
    const initial = Number(settings.clockMinutes) * 60 * 1000;
    clockRemainingMs = Array.isArray(snapshot?.remainingMs) ? [...snapshot.remainingMs] : [initial, initial];
    clockActivePlayer = Number.isInteger(snapshot?.activePlayer) ? snapshot.activePlayer : null;
    clockLastTick = clockActivePlayer === null ? null : Date.now();
  }
  function finishTimeLoss(expiredPlayer) {
    if (!state || state.winner !== null) return;
    clearTimeout(flowTimer);
    computerBusy = false;
    computerMoveVisual = null;
    stopChessClockInterval();
    clockRemainingMs[expiredPlayer] = 0;
    clockActivePlayer = null;
    clockLastTick = null;
    state.winner = otherPlayer(expiredPlayer);
    state.winReason = "time";
    clearSelection();
    setStatus(`${participantName(expiredPlayer)} ran out of time. ${participantName(state.winner)} wins on time.`);
    render();
    maybeShowUpdateDialog();
  }
  function startChessClockInterval() {
    if (clockInterval || !clockEnabled() || clockActivePlayer === null || state?.winner !== null) return;
    clockInterval = setInterval(() => {
      const expired = settleChessClock();
      if (expired !== null) { finishTimeLoss(expired); return; }
      renderChessClocks();
    }, 200);
  }
  function syncChessClock({ addIncrement = true } = {}) {
    if (!clockEnabled()) {
      stopChessClockInterval();
      clockActivePlayer = null;
      clockLastTick = null;
      renderChessClocks();
      return;
    }
    const now = Date.now();
    const expired = settleChessClock(now);
    if (expired !== null) { finishTimeLoss(expired); return; }
    if (!state || state.winner !== null) {
      stopChessClockInterval();
      clockActivePlayer = null;
      clockLastTick = null;
      renderChessClocks();
      return;
    }
    const nextPlayer = decisionActorIndex();
    if (nextPlayer !== clockActivePlayer) {
      if (addIncrement && clockActivePlayer !== null) {
        clockRemainingMs[clockActivePlayer] += clockIncrementMs();
      }
      clockActivePlayer = nextPlayer;
    }
    clockLastTick = clockActivePlayer === null ? null : now;
    startChessClockInterval();
    renderChessClocks();
  }
  function renderChessClocks() {
    const panel = document.getElementById("chess-clocks");
    const row = document.querySelector(".turn-status-row");
    if (!panel) return;
    const enabled = clockEnabled();
    panel.hidden = !enabled;
    row?.classList.toggle("chess-clock-enabled", enabled);
    if (!enabled) return;
    const names = [document.getElementById("clock-player-0-name"), document.getElementById("clock-player-1-name")];
    const values = [document.getElementById("clock-player-0"), document.getElementById("clock-player-1")];
    for (let player = 0; player < 2; player += 1) {
      if (names[player]) names[player].textContent = participantName(player);
      if (values[player]) values[player].textContent = formatChessClock(clockRemainingMs[player]);
      const card = panel.querySelector(`[data-clock-player="${player}"]`);
      card?.classList.toggle("chess-clock-card--active", state?.winner === null && clockActivePlayer === player);
      card?.classList.toggle("chess-clock-card--expired", clockRemainingMs[player] <= 0);
    }
  }

  blackButton.addEventListener("click", () => chooseReserveColourFromPanel("black"));
  whiteButton.addEventListener("click", () => chooseReserveColourFromPanel("white"));
  document.getElementById("new-game").addEventListener("click", startNewGame);
  document.getElementById("end-test").addEventListener("click", jumpToFinalFourTest);
  undoButton.addEventListener("click", undo);
  finishJumpButton.addEventListener("click", () => {});

  const settingsDialog = document.getElementById("settings-dialog"), settingsForm = document.getElementById("settings-form");
  const wizardSteps = [...document.querySelectorAll("[data-wizard-step]")], wizardIndicators = [...document.querySelectorAll("[data-step-indicator]")];
  const wizardBack = document.getElementById("wizard-back"), wizardNext = document.getElementById("wizard-next"), wizardStart = document.getElementById("wizard-start");
  const difficultyInput = document.getElementById("difficulty-input"), difficultyField = document.getElementById("difficulty-field");
  const player1Input = document.getElementById("setting-player1"), player2Input = document.getElementById("setting-player2"), player2Label = document.getElementById("player2-label");
  let wizardStep = 0;
  const colourOptions = ["red", "blue", "green", "yellow", "purple", "orange", "black", "white"];
  function buildColours(id, name) {
    const box = document.getElementById(id);
    colourOptions.forEach(k => {
      const l = document.createElement("label"); l.className = "colour-choice";
      l.innerHTML = `<input type="radio" name="${name}" value="${k}"><span><i class="colour-swatch" style="background:${COLOURS[k][1]}"></i>${COLOURS[k][0]}</span>`;
      box.appendChild(l);
    });
  }
  buildColours("colour1-choices", "colour1"); buildColours("colour2-choices", "colour2");
  function fv(n) { return settingsForm.querySelector(`[name="${n}"]:checked`)?.value; }
  function sr(n, v) { const e = settingsForm.querySelector(`[name="${n}"][value="${v}"]`); if (e) e.checked = true; }
  function syncMode() {
    const one = fv("gameMode") === "computer"; difficultyField.hidden = !one; player2Label.hidden = one;
    document.getElementById("player1-label-text").textContent = one ? "Player name" : "Player 1 name";
    document.getElementById("starter-player-label").textContent = one ? "Player" : "Player 1";
    document.getElementById("starter-other-label").textContent = one ? "Computer" : "Player 2";
  }
  function syncDifficulty() { const n = Number(difficultyInput.value), names = ["", "Beginner", "Standard", "Expert"]; document.getElementById("difficulty-name").textContent = `${n} · ${names[n]}`; }
  const ruleOptionIds = ["allowJump", "allowMove", "allowDiagonal", "allowSquare", "allowSpacedSquare"];
  function ruleId(k) { return `setting-${k.replace(/[A-Z]/g, m => "-" + m.toLowerCase())}`; }
  function syncRuleDependencies() {
    const square = document.getElementById("setting-allow-square").checked;
    document.getElementById("setting-allow-spaced-square").disabled = !square;
  }
  document.querySelectorAll("[data-rule-option]").forEach(e => e.addEventListener("change", syncRuleDependencies));
  function showStep(n) {
    wizardStep = Math.max(0, Math.min(5, n));
    wizardSteps.forEach((e, i) => e.hidden = i !== wizardStep);
    wizardIndicators.forEach((e, i) => { e.classList.toggle("wizard-progress-step--active", i === wizardStep); e.classList.toggle("wizard-progress-step--complete", i < wizardStep); });
    wizardBack.hidden = wizardStep === 0; wizardNext.hidden = wizardStep === 5; wizardStart.hidden = wizardStep !== 5;
    if (wizardStep === 5) summary();
  }
  function coloursValid() { return fv("colour1") !== fv("colour2"); }
  function selectedRuleSummary() { const labels = []; document.querySelectorAll("[data-rule-option]:checked").forEach(e => labels.push(e.dataset.ruleLabel)); return labels.length ? labels.join(", ") : "Basic placement only"; }
  function summary() {
    const one = fv("gameMode") === "computer", level = ["", "Beginner", "Standard", "Expert"][Number(difficultyInput.value)];
    const clockMinutes = Number(fv("clockMinutes") || 0), increment = Number(fv("clockIncrement") || 0);
    const clockSummary = clockMinutes ? `${clockMinutes} min each${increment ? ` + ${increment}s` : ""}` : "Clock off";
    const format = fv("gameFormat") === "lipfty24" ? "Lipfty24" : "Lipfty";
    document.getElementById("setup-summary").textContent = `${format} · ${one ? "Player vs Computer · " + level : "Two players"} · ${COLOURS[fv("colour1")][0]} / ${COLOURS[fv("colour2")][0]} · ${selectedRuleSummary()} · ${clockSummary}`;
  }
  function openSettings() {
    sr("gameFormat", settings.gameFormat || "lipfty");
    sr("gameMode", settings.mode); difficultyInput.value = settings.level === "beginner" ? 1 : settings.level === "expert" ? 3 : 2;
    sr("allowUndo", settings.undo ? "yes" : "no"); sr("colour1", settings.colour1); sr("colour2", settings.colour2);
    player1Input.value = settings.player1; player2Input.value = settings.player2; sr("starter", settings.starter);
    sr("clockMinutes", String(settings.clockMinutes || 0)); sr("clockIncrement", String(settings.clockIncrement || 0));
    ruleOptionIds.forEach(k => { const e = document.getElementById(ruleId(k)); if (e) e.checked = !!settings[k]; });
    syncRuleDependencies(); document.getElementById("setting-sound").checked = settings.sound; document.getElementById("setting-animations").checked = settings.animations;
    syncMode(); syncDifficulty(); syncClockOptions(); showStep(0); settingsDialog.showModal();
  }
  settingsForm.querySelectorAll('[name="gameFormat"]').forEach(e => e.addEventListener("change", () => { if (wizardStep === 5) summary(); }));
  settingsForm.querySelectorAll('[name="gameMode"]').forEach(e => e.addEventListener("change", syncMode));
  difficultyInput.addEventListener("input", syncDifficulty);
  function syncClockOptions() {
    const enabled = Number(fv("clockMinutes") || 0) > 0;
    const field = document.getElementById("clock-increment-field");
    if (field) field.disabled = !enabled;
    if (!enabled) sr("clockIncrement", "0");
    if (wizardStep === 5) summary();
  }
  settingsForm.querySelectorAll('[name="clockMinutes"]').forEach(e => e.addEventListener("change", syncClockOptions));
  settingsForm.querySelectorAll('[name="clockIncrement"]').forEach(e => e.addEventListener("change", () => { if (wizardStep === 5) summary(); }));
  wizardNext.addEventListener("click", () => { if (wizardStep === 1 && !coloursValid()) { setStatus("Choose two different piece colours."); return; } showStep(wizardStep + 1); });
  wizardBack.addEventListener("click", () => showStep(wizardStep - 1));
  document.getElementById("settings-button").addEventListener("click", openSettings);
  document.getElementById("close-settings").addEventListener("click", () => settingsDialog.close());
  document.getElementById("cancel-settings").addEventListener("click", () => settingsDialog.close());
  settingsForm.addEventListener("submit", e => {
    e.preventDefault(); if (!coloursValid()) { showStep(1); return; }
    const n = Number(difficultyInput.value), ruleSettings = {};
    ruleOptionIds.forEach(k => { ruleSettings[k] = document.getElementById(ruleId(k)).checked; });
    if (!ruleSettings.allowSquare) ruleSettings.allowSpacedSquare = false;
    ruleSettings.allowDiamond = false;
    ruleSettings.allowSpacedDiamond = false;
    settings = { ...settings, ...ruleSettings, gameFormat: fv("gameFormat") || "lipfty", mode: fv("gameMode"), player1: player1Input.value.trim() || "Player", player2: player2Input.value.trim() || "Player 2", level: n === 1 ? "beginner" : n === 3 ? "expert" : "standard", starter: fv("starter"), undo: fv("allowUndo") === "yes", colour1: fv("colour1"), colour2: fv("colour2"), clockMinutes: Number(fv("clockMinutes") || 0), clockIncrement: Number(fv("clockIncrement") || 0), sound: document.getElementById("setting-sound").checked, animations: document.getElementById("setting-animations").checked, language: document.getElementById("setting-language").value };
    saveSettings(); settingsDialog.close(); startNewGame();
  });

  const statisticsDialog = document.getElementById("statistics-dialog");
  document.getElementById("view-statistics-button").addEventListener("click", () => statisticsDialog.showModal());
  document.getElementById("close-statistics").addEventListener("click", () => statisticsDialog.close());
  const helpDialog = document.getElementById("help-dialog");
  document.getElementById("help-button").addEventListener("click", () => helpDialog.showModal());
  document.getElementById("close-help").addEventListener("click", () => helpDialog.close());

  let pendingUpdateRegistration = null;
  function gameIsInProgress() {
    return !!state && state.winner === null && (
      state.redeployPiece || state.finalFourPhase || normalReserveTotal() < 24 ||
      state.board.some(piece => piece && !piece.pinned)
    );
  }
  function maybeShowUpdateDialog() {
    const registration = pendingUpdateRegistration, dialog = document.getElementById("pwa-update-dialog");
    if (!registration?.waiting || !dialog || dialog.open || gameIsInProgress()) return;
    const laterButton = document.getElementById("pwa-update-later"), updateButton = document.getElementById("pwa-update-button");
    const closeDialog = () => { if (dialog.open) dialog.close(); };
    laterButton.onclick = closeDialog;
    updateButton.onclick = () => { updateButton.disabled = true; updateButton.textContent = "Updating..."; registration.waiting?.postMessage({ type: "SKIP_WAITING" }); };
    dialog.oncancel = event => { event.preventDefault(); closeDialog(); };
    dialog.showModal();
  }
  function queueUpdate(registration) { if (!registration.waiting) return; pendingUpdateRegistration = registration; maybeShowUpdateDialog(); }
  async function registerPwa() {
    if (!("serviceWorker" in navigator)) return;
    try {
      const registration = await navigator.serviceWorker.register("service-worker.js", { scope: "./" });
      if (registration.waiting) queueUpdate(registration);
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => { if (worker.state === "installed" && navigator.serviceWorker.controller) queueUpdate(registration); });
      });
      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => { if (!refreshing) { refreshing = true; location.reload(); } });
    } catch (error) { console.warn("Lipfty service worker registration failed", error); }
  }

  fetch("./build-info.json", { cache: "no-store" })
    .then(response => response.ok ? response.json() : null)
    .then(info => {
      if (!info?.version) return;
      document.getElementById("app-version").textContent = `Version ${info.version}`;
      if (mobileVersionElement) mobileVersionElement.textContent = `v${info.version}`;
      const ref = info.commit || info.gitCommit || info.git || info.hash || info.commitHash || "";
      document.getElementById("build-reference").textContent = ref ? ` · ${String(ref).slice(0, 7)}` : "";
    }).catch(() => {});

  startNewGame();
  registerPwa();
})();
