const mobileVersionElement = document.getElementById("mobile-version");
(function () {
  "use strict";

  const rules = window.LipftyRules;
  const BOARD_CELLS = rules.SIZE * rules.SIZE;
  const CORNERS = [0, 7, 56, 63];
  const STANDARD_RULES = Object.freeze({
    allowJump: true,
    allowMove: true,
    allowDiagonal: true,
    allowSquare: true,
    allowSpacedSquare: true,
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
  let flowTimer = null;
  let checkpoints = [];
  let moveTimerInterval = null;
  let moveTimerRemaining = 30;

  function loadSettings() {
    const defaults = {
      mode: "computer", player1: "Player", player2: "Player 2", level: "standard",
      starter: "random", undo: true, language: "en-GB", colour1: "red", colour2: "blue",
      timer: 30, sound: true, animations: true, undoPreviousJump: false,
      rulesBaseline: 7,
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
      // v7.0.16 establishes the confirmed Lipfty 7 Standard rules as the new
      // playable baseline. Migrate older saved rule switches once; afterwards
      // any variants the player deliberately saves are preserved.
      if (saved.rulesBaseline !== 7) {
        Object.assign(saved, STANDARD_RULES, { rulesBaseline: 7 });
        localStorage.setItem("lipfty-settings", JSON.stringify(saved));
      }
      return { ...defaults, ...saved };
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
    const cornerColours = shuffled(["black", "black", "white", "white"]);
    cornerColours.forEach((colour, i) => {
      active[CORNERS[i]] = colour;
      locked[CORNERS[i]] = colour;
    });
    shuffled([...Array(12).fill("black"), ...Array(12).fill("white")])
      .forEach((colour, i) => { active[nonCorners[i]] = colour; });
    return { active, locked };
  }

  function freshState() {
    return {
      board: Array(BOARD_CELLS).fill(null),
      reserveLayout: makeReserveLayout(),
      currentPlayer: 0,
      openingCornerPlacementsRemaining: 4,
      finalFourPhase: false,
      finalCornerPieces: [null, null, null, null],
      finalCornersPrepared: false,
      choosingColour: true,
      colourChooser: 0,
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
      winningCells: []
    };
  }

  function initialCornerPhase() { return state.openingCornerPlacementsRemaining > 0; }
  function activeReserveIndices(mode = "normal", colour = null) {
    const wantedCorner = mode === "opening";
    const result = [];
    for (let i = 0; i < 64; i += 1) {
      const c = state.reserveLayout.active[i];
      if (!c || (colour && c !== colour)) continue;
      const isCorner = CORNERS.includes(i);
      if ((wantedCorner && isCorner) || (!wantedCorner && !isCorner)) result.push(i);
    }
    return result;
  }
  function normalReserveRemaining(colour) { return activeReserveIndices("normal", colour).length; }
  function normalReserveTotal() { return normalReserveRemaining("black") + normalReserveRemaining("white"); }
  function normalReserveColourCount() {
    return ["black", "white"].filter(colour => normalReserveRemaining(colour) > 0).length;
  }
  function oneColourPlacementOnly() {
    return !initialCornerPhase() && !state.finalFourPhase && !state.consequence && !state.redeployPiece &&
      normalReserveTotal() > 0 && normalReserveColourCount() === 1;
  }
  function finalCornerPiecesRemain() { return state.finalCornerPieces.some(Boolean); }
  function prepareFinalCorners() {
    if (state.finalCornersPrepared) return;
    state.finalCornerPieces = CORNERS.map(i => state.reserveLayout.locked[i]);
    state.finalCornersPrepared = true;
  }
  function beginFinalFourIfReady() {
    if (state.finalFourPhase || initialCornerPhase() || state.consequence || state.redeployPiece || normalReserveTotal() !== 0) return false;
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
    return !!settings.allowMove && !initialCornerPhase() && !state.finalFourPhase && !state.consequence &&
      !state.redeployPiece && !oneColourPlacementOnly();
  }
  function jumpAllowedNow() {
    return !!settings.allowJump && !initialCornerPhase() && !state.finalFourPhase && !state.consequence &&
      !state.redeployPiece && !oneColourPlacementOnly();
  }

  function firstNormalReserveIndex(colour) { return activeReserveIndices("normal", colour)[0] ?? null; }
  function firstOpeningReserveIndex(colour) { return activeReserveIndices("opening", colour)[0] ?? null; }
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
  function makeSnapshot() { return { state: serialiseState(), nextPieceId }; }
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
    resetMoveTimer();
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
    state.winningCells = [...win.line];
    computerBusy = false;
    if (moveTimerInterval) { clearInterval(moveTimerInterval); moveTimerInterval = null; }
    clearSelection();
    setStatus(`${participantName(state.currentPlayer)} wins with four ${colourTitle(win.colour)} pieces!`);
    render();
    maybeShowUpdateDialog();
    return true;
  }

  function availableChoiceColours() {
    if (initialCornerPhase()) return ["black", "white"].filter(c => firstOpeningReserveIndex(c) !== null);
    if (state.finalFourPhase) return ["black", "white"].filter(c => firstFinalCornerIndex(c) !== null);
    return ["black", "white"].filter(c => normalReserveRemaining(c) > 0);
  }

  function chooserIsChoosingForSelf() {
    if (initialCornerPhase() || state.finalFourPhase) return true;
    return state.consequence?.type === "move" && state.consequence.step === 1;
  }

  function chooseColour(colour, reserveIndex = null) {
    if (state.winner !== null || !state.choosingColour || computerBusy) return false;
    if (!availableChoiceColours().includes(colour)) return false;
    let index = reserveIndex;
    if (index === null) {
      index = initialCornerPhase() ? firstOpeningReserveIndex(colour)
        : state.finalFourPhase ? firstFinalCornerIndex(colour)
        : firstNormalReserveIndex(colour);
    }
    if (index === null) return false;
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
    const index = initialCornerPhase() ? firstOpeningReserveIndex(colour)
      : state.finalFourPhase ? firstFinalCornerIndex(colour)
      : firstNormalReserveIndex(colour);
    if (index === null) return false;
    state.selectedReserveIndex = index;
    state.assignedColour = colour;
    state.choosingColour = false;
    clearSelection();
    return true;
  }

  function colourPrompt() {
    if (initialCornerPhase()) return `${participantName(state.currentPlayer)}: choose one of the remaining top-corner pieces to place.`;
    if (state.finalFourPhase) return `${participantName(state.currentPlayer)}: choose one of the remaining Final Four corner pieces to place.`;
    if (state.consequence?.type === "move" && state.consequence.step === 1) {
      return `${participantName(state.currentPlayer)}: choose a reserve piece for your first compulsory placement.`;
    }
    const chooser = participantName(state.colourChooser);
    const receiver = participantName(state.currentPlayer);
    return `${chooser}: choose a reserve piece/colour for ${receiver}.`;
  }

  function actionPrompt() {
    const actor = participantName(state.currentPlayer);
    if (state.redeployPiece) return `${actor}: redeploy the jumped ${colourTitle(state.redeployPiece.colour)} piece on any empty square.`;
    if (initialCornerPhase()) return `${actor}: place the chosen top-corner ${colourTitle(state.assignedColour)} piece. Opening turns are placement only.`;
    if (state.finalFourPhase) return `${actor}: place the chosen Final Four ${colourTitle(state.assignedColour)} piece. No Move or Jump.`;
    if (state.consequence?.type === "move") {
      return `${actor}: compulsory placement ${state.consequence.step} of 2 - place ${colourTitle(state.assignedColour)}.`;
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

    if (state.choosingColour) {
      const colours = availableChoiceColours();
      if (!colours.length) {
        state.winner = "draw";
        if (moveTimerInterval) { clearInterval(moveTimerInterval); moveTimerInterval = null; }
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
    resetMoveTimer();
    processFlow();
  }

  function finishOrdinaryPlacement() {
    const finishingPlayer = state.currentPlayer;
    startNextNormalTurn(otherPlayer(finishingPlayer), finishingPlayer, null);
  }

  function beginMoveConsequence(mover, movedPieceId) {
    const total = normalReserveTotal();
    if (total < 2) {
      // Standard Lipfty disables Move as soon as one reserve colour remains,
      // so this boundary is not reachable in normal Standard play.
      startNextNormalTurn(otherPlayer(mover), mover, movedPieceId);
      return;
    }
    const responder = otherPlayer(mover);
    state.consequence = { type: "move", step: 1, mover, responder, protectedPieceId: movedPieceId };
    state.currentPlayer = responder;
    state.colourChooser = responder;
    state.protectedPieceId = movedPieceId;
    state.compulsoryPlacementsRemaining = 2;
    clearHeldPiece();
    state.choosingColour = true;
    resetMoveTimer();
    processFlow("Move completed. The responder now chooses and makes the first compulsory reserve placement.");
  }

  function advanceMoveConsequence() {
    const c = state.consequence;
    if (!c || c.type !== "move") return;
    if (c.step === 1) {
      c.step = 2;
      state.currentPlayer = c.mover;
      state.colourChooser = c.responder;
      state.compulsoryPlacementsRemaining = 1;
      clearHeldPiece();
      state.choosingColour = true;
      resetMoveTimer();
      processFlow(`${participantName(c.responder)} now chooses the second compulsory reserve piece for ${participantName(c.mover)}.`);
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
    state.consequence = null;
    state.currentPlayer = responder;
    state.colourChooser = jumper;
    state.protectedPieceId = protectedPieceId;
    clearHeldPiece();
    state.choosingColour = true;
    resetMoveTimer();
    processFlow(`${participantName(jumper)} now chooses the reserve piece/colour for ${participantName(responder)}'s normal turn.`);
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
      state.board[index] = { id: nextPieceId++, colour };
      state.finalCornerPieces[slot] = null;
      clearHeldPiece();
      if (finishWin()) return true;
      if (!finalCornerPiecesRemain()) {
        state.winner = "draw";
        if (moveTimerInterval) { clearInterval(moveTimerInterval); moveTimerInterval = null; }
        setStatus("Draw - all four Final Four pieces have been placed without a win.");
        render(); maybeShowUpdateDialog(); return true;
      }
      const finishing = state.currentPlayer;
      state.currentPlayer = otherPlayer(finishing);
      state.colourChooser = state.currentPlayer;
      state.choosingColour = true;
      resetMoveTimer(); processFlow(); return true;
    }

    const opening = initialCornerPhase();
    const isCorner = CORNERS.includes(state.selectedReserveIndex);
    if (opening !== isCorner) return false;
    if (!consumeSelectedActivePiece()) return false;
    state.board[index] = { id: nextPieceId++, colour };
    if (opening) state.openingCornerPlacementsRemaining -= 1;
    clearHeldPiece();
    if (finishWin()) return true;

    if (opening) {
      const finishing = state.currentPlayer;
      state.currentPlayer = otherPlayer(finishing);
      state.colourChooser = state.currentPlayer;
      state.choosingColour = true;
      resetMoveTimer(); processFlow(); return true;
    }

    if (state.consequence?.type === "move") {
      advanceMoveConsequence();
      return true;
    }

    finishOrdinaryPlacement();
    return true;
  }

  function legalSingleJumps(from) {
    if (!jumpAllowedNow()) return [];
    const piece = state.board[from];
    if (!piece) return [];
    return rules.jumpDestinations(state.board, from).filter(j => {
      const over = state.board[j.over];
      return over && over.colour !== piece.colour;
    });
  }

  function selectPiece(index) {
    if (computerBusy || state.winner !== null || state.choosingColour || state.redeployPiece || state.consequence ||
        initialCornerPhase() || state.finalFourPhase || oneColourPlacementOnly()) return;
    const piece = state.board[index];
    if (!piece || piece.colour !== state.assignedColour) return;
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
    if (!piece || state.board[to]) return;
    if (jump && !afterFlash) {
      state.jumpFlashIndex = jump.over;
      render();
      flowTimer = setTimeout(() => {
        state.jumpFlashIndex = null;
        moveBoardPiece(from, to, jump, true);
      }, settings.animations ? 400 : 0);
      return;
    }
    state.board[to] = piece;
    state.board[from] = null;
    clearSelection();
    // The reserve piece handed for a Move/Jump was not placed, so it returns to the ring.
    state.selectedReserveIndex = null;
    state.assignedColour = null;

    if (finishWin()) return;

    if (!jump) {
      beginMoveConsequence(state.currentPlayer, piece.id);
      return;
    }

    const jumpedPiece = state.board[jump.over];
    if (!jumpedPiece || jumpedPiece.colour === piece.colour) return;
    state.board[jump.over] = null;
    const jumper = state.currentPlayer;
    const responder = otherPlayer(jumper);
    state.consequence = { type: "jump-redeploy", jumper, responder, protectedPieceId: piece.id };
    state.redeployPiece = jumpedPiece;
    state.currentPlayer = responder;
    state.protectedPieceId = piece.id;
    state.assignedColour = jumpedPiece.colour;
    state.selectedReserveIndex = null;
    state.choosingColour = false;
    resetMoveTimer();
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
    if (["place", "final-place", "redeploy"].includes(action.type)) board[action.to] = { id: -1, colour: action.colour };
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
      if (!piece || piece.colour !== colour || piece.id === state.protectedPieceId) continue;
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
          if (rules.checkWin(Object.assign(cloneBoard(state.board), { [to]: { id: -1, colour } }), settings)) return true;
        }
        return false;
      });
      if (winning.length) pool = winning;
    } else {
      const safe = colours.filter(colour => {
        for (let to = 0; to < BOARD_CELLS; to += 1) {
          if (state.board[to]) continue;
          const board = cloneBoard(state.board); board[to] = { id: -1, colour };
          if (rules.checkWin(board, settings)) return false;
        }
        return true;
      });
      if (safe.length) pool = safe;
    }
    const colour = pool[Math.floor(Math.random() * pool.length)];
    const index = initialCornerPhase() ? firstOpeningReserveIndex(colour)
      : state.finalFourPhase ? firstFinalCornerIndex(colour)
      : firstNormalReserveIndex(colour);
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
    } else if (initialCornerPhase()) {
      for (let to = 0; to < BOARD_CELLS; to += 1) if (!state.board[to]) actions.push({ type: "place", to, colour: state.assignedColour });
    } else {
      actions = enumerateActions(state.assignedColour, !!state.consequence);
    }
    const action = pickComputerAction(actions);
    if (!action) { computerBusy = false; processFlow("Computer has no legal action."); return; }
    flowTimer = setTimeout(() => {
      computerBusy = false;
      if (["place", "final-place", "redeploy"].includes(action.type)) { placeAt(action.to); return; }
      const jump = action.type === "jump" ? { to: action.to, over: action.over } : null;
      moveBoardPiece(action.from, action.to, jump, true);
    }, 250);
  }

  function chooseReservePiece(displayIndex, colour) {
    if (state.winner !== null || computerBusy || !state.choosingColour || isComputer(state.colourChooser)) return;
    if (!availableChoiceColours().includes(colour)) return;
    if (initialCornerPhase()) {
      if (!CORNERS.includes(displayIndex) || state.reserveLayout.active[displayIndex] !== colour) return;
    } else if (state.finalFourPhase) {
      const slot = CORNERS.indexOf(displayIndex);
      if (slot < 0 || state.finalCornerPieces[slot] !== colour) return;
    } else {
      if (CORNERS.includes(displayIndex) || state.reserveLayout.active[displayIndex] !== colour) return;
    }
    chooseColour(colour, displayIndex);
  }

  function renderBoard() {
    boardElement.replaceChildren();
    const winning = new Set(state.winningCells);
    const hiddenMarkers = new Set(CORNERS.slice(0, Math.min(2, state.compulsoryPlacementsRemaining)));
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
        const markerAway = corner && hiddenMarkers.has(displayIndex) && !state.finalFourPhase;
        if (corner && finalAvailable && !markerAway && !(picked && state.finalFourPhase)) {
          const marker = document.createElement("span");
          marker.className = `piece piece--${finalAvailable} piece--locked-corner`; marker.setAttribute("aria-hidden", "true");
          cell.appendChild(marker);
        }
        if (activeColour && !picked) {
          const disc = document.createElement("span");
          disc.className = `piece piece--${activeColour}${corner ? " piece--corner-top" : ""}`; disc.setAttribute("aria-hidden", "true");
          cell.appendChild(disc);
        } else if (!corner || markerAway) cell.classList.add("board-cell--reserve-empty");

        let selectable = null;
        const humanChooser = state.winner === null && state.choosingColour && !computerBusy && !isComputer(state.colourChooser);
        if (humanChooser) {
          if (initialCornerPhase() && corner && activeColour) selectable = activeColour;
          else if (state.finalFourPhase && corner && state.finalCornerPieces[slot]) selectable = state.finalCornerPieces[slot];
          else if (!initialCornerPhase() && !state.finalFourPhase && !corner && activeColour) selectable = activeColour;
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
      if (!state.board[index] && !state.choosingColour && !computerBusy && !isComputer(state.currentPlayer) && state.selectedPieceIndex === null) {
        if (state.redeployPiece || state.finalFourPhase || state.selectedReserveIndex !== null) cell.classList.add("board-cell--place");
      }
      const piece = state.board[index];
      if (piece) {
        const disc = document.createElement("span"); disc.className = `piece piece--${piece.colour}`; disc.setAttribute("aria-hidden", "true"); cell.appendChild(disc);
        cell.setAttribute("aria-label", `${colourTitle(piece.colour)} piece, row ${row + 1}, column ${col + 1}`);
      } else cell.setAttribute("aria-label", `Empty playing square, row ${row + 1}, column ${col + 1}`);
      cell.disabled = computerBusy;
      cell.addEventListener("click", () => handleCell(index));
      boardElement.appendChild(cell);
    }
  }

  function activeColourTotal(colour) {
    return state.reserveLayout.active.filter(c => c === colour).length;
  }
  function render() {
    currentPlayerElement.textContent = state.winner === "draw" ? "Draw" : state.winner !== null ? `${participantName(state.winner)} wins` : participantName(state.currentPlayer);
    blackRemainingElement.textContent = state.finalFourPhase ? `${state.finalCornerPieces.filter(c => c === "black").length} final remaining` : `${activeColourTotal("black")} remaining`;
    whiteRemainingElement.textContent = state.finalFourPhase ? `${state.finalCornerPieces.filter(c => c === "white").length} final remaining` : `${activeColourTotal("white")} remaining`;
    document.getElementById("colour1-name").textContent = COLOURS[settings.colour1][0];
    document.getElementById("colour2-name").textContent = COLOURS[settings.colour2][0];

    const phaseHelp = document.getElementById("phase-help");
    if (phaseHelp) {
      phaseHelp.textContent = state.finalFourPhase ? `Final Four - ${state.finalCornerPieces.filter(Boolean).length} pieces left - placement only`
        : initialCornerPhase() ? `Opening - ${state.openingCornerPlacementsRemaining} top-corner placements remaining`
        : state.redeployPiece ? `Jump consequence - ${participantName(state.currentPlayer)} redeploys the exact jumped piece`
        : state.consequence?.type === "move" ? `Move consequence - compulsory placement ${state.consequence.step} of 2`
        : oneColourPlacementOnly() ? `One-colour finish - ${normalReserveTotal()} normal reserve pieces left - placement only`
        : `Main play - opponent hands a reserve piece: Place, Move or Jump with that colour.`;
    }
    const placementAlert = document.getElementById("placement-alert");
    if (placementAlert) {
      placementAlert.hidden = state.compulsoryPlacementsRemaining === 0;
      placementAlert.textContent = state.compulsoryPlacementsRemaining ? `COMPULSORY PLACEMENT - ${state.compulsoryPlacementsRemaining} remaining` : "";
    }
    const reserveHeading = document.getElementById("reserve-heading");
    if (reserveHeading) reserveHeading.textContent = state.redeployPiece ? "Piece to redeploy" : "Colour to use";
    blackButton.disabled = true; whiteButton.disabled = true;
    const assigned = state.redeployPiece?.colour || state.assignedColour;
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
    clearTimeout(flowTimer); computerBusy = false; checkpoints = []; state = freshState();
    state.openingCornerPlacementsRemaining = 0;
    state.reserveLayout.active.fill(null);
    const cells = [...Array(BOARD_CELLS).keys()];
    let attempts = 0;
    do {
      state.board = Array(BOARD_CELLS).fill(null);
      const occupied = shuffled(cells).slice(0, 28);
      const colours = shuffled([...Array(14).fill("black"), ...Array(14).fill("white")]);
      occupied.forEach((index, i) => { state.board[index] = { id: nextPieceId++, colour: colours[i] }; });
      attempts += 1;
    } while (rules.checkWin(state.board, settings) && attempts < 10000);
    state.currentPlayer = 0; state.colourChooser = 0; state.choosingColour = true;
    prepareFinalCorners(); state.finalFourPhase = true;
    resetMoveTimer(); processFlow();
  }

  function startNewGame() {
    clearTimeout(flowTimer); computerBusy = false; nextPieceId = 1; checkpoints = []; state = freshState(); applyPieceColours();
    if (settings.mode === "computer") {
      let starter = settings.starter;
      if (starter === "random") starter = Math.random() < 0.5 ? "player" : "computer";
      if (starter === "alternate") {
        const prev = localStorage.getItem("lipfty-last-starter") || "computer";
        starter = prev === "player" ? "computer" : "player";
        localStorage.setItem("lipfty-last-starter", starter);
      }
      state.currentPlayer = starter === "computer" ? 1 : 0;
    } else state.currentPlayer = 0;
    state.colourChooser = state.currentPlayer;
    resetMoveTimer(); processFlow();
  }

  function timerText(seconds) { const m = Math.floor(seconds / 60), s = Math.max(0, seconds % 60); return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`; }
  function renderMoveTimer() {
    const el = document.getElementById("move-timer"); if (!el) return;
    if (!settings.timer) { el.textContent = "∞"; el.classList.remove("move-timer--expired"); return; }
    el.textContent = timerText(moveTimerRemaining); el.classList.toggle("move-timer--expired", moveTimerRemaining <= 0);
  }
  function resetMoveTimer() {
    if (moveTimerInterval) clearInterval(moveTimerInterval);
    moveTimerRemaining = Number(settings.timer) || 0; renderMoveTimer();
    if (!settings.timer) return;
    moveTimerInterval = setInterval(() => {
      if (moveTimerRemaining > 0) { moveTimerRemaining -= 1; renderMoveTimer(); }
      else clearInterval(moveTimerInterval);
    }, 1000);
  }

  blackButton.addEventListener("click", () => {});
  whiteButton.addEventListener("click", () => {});
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
  const ruleOptionIds = ["allowJump", "allowMove", "allowDiagonal", "allowSquare", "allowSpacedSquare", "allowDiamond", "allowSpacedDiamond"];
  function ruleId(k) { return `setting-${k.replace(/[A-Z]/g, m => "-" + m.toLowerCase())}`; }
  function syncRuleDependencies() {
    const square = document.getElementById("setting-allow-square").checked, diamond = document.getElementById("setting-allow-diamond").checked;
    document.getElementById("setting-allow-spaced-square").disabled = !square;
    document.getElementById("setting-allow-spaced-diamond").disabled = !diamond;
  }
  document.querySelectorAll("[data-rule-option]").forEach(e => e.addEventListener("change", syncRuleDependencies));
  function showStep(n) {
    wizardStep = Math.max(0, Math.min(4, n));
    wizardSteps.forEach((e, i) => e.hidden = i !== wizardStep);
    wizardIndicators.forEach((e, i) => { e.classList.toggle("wizard-progress-step--active", i === wizardStep); e.classList.toggle("wizard-progress-step--complete", i < wizardStep); });
    wizardBack.hidden = wizardStep === 0; wizardNext.hidden = wizardStep === 4; wizardStart.hidden = wizardStep !== 4;
    if (wizardStep === 4) summary();
  }
  function coloursValid() { return fv("colour1") !== fv("colour2"); }
  function selectedRuleSummary() { const labels = []; document.querySelectorAll("[data-rule-option]:checked").forEach(e => labels.push(e.dataset.ruleLabel)); return labels.length ? labels.join(", ") : "Basic placement only"; }
  function summary() {
    const one = fv("gameMode") === "computer", level = ["", "Beginner", "Standard", "Expert"][Number(difficultyInput.value)];
    document.getElementById("setup-summary").textContent = `${one ? "Player vs Computer · " + level : "Two players"} · ${COLOURS[fv("colour1")][0]} / ${COLOURS[fv("colour2")][0]} · ${selectedRuleSummary()} · ${fv("timer") === "0" ? "Unlimited" : fv("timer") + "-second"} turns`;
  }
  function openSettings() {
    sr("gameMode", settings.mode); difficultyInput.value = settings.level === "beginner" ? 1 : settings.level === "expert" ? 3 : 2;
    sr("allowUndo", settings.undo ? "yes" : "no"); sr("colour1", settings.colour1); sr("colour2", settings.colour2);
    player1Input.value = settings.player1; player2Input.value = settings.player2; sr("starter", settings.starter); sr("timer", String(settings.timer));
    ruleOptionIds.forEach(k => { const e = document.getElementById(ruleId(k)); if (e) e.checked = !!settings[k]; });
    syncRuleDependencies(); document.getElementById("setting-sound").checked = settings.sound; document.getElementById("setting-animations").checked = settings.animations;
    syncMode(); syncDifficulty(); showStep(0); settingsDialog.showModal();
  }
  settingsForm.querySelectorAll('[name="gameMode"]').forEach(e => e.addEventListener("change", syncMode));
  difficultyInput.addEventListener("input", syncDifficulty);
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
    if (!ruleSettings.allowDiamond) ruleSettings.allowSpacedDiamond = false;
    settings = { ...settings, ...ruleSettings, mode: fv("gameMode"), player1: player1Input.value.trim() || "Player", player2: player2Input.value.trim() || "Player 2", level: n === 1 ? "beginner" : n === 3 ? "expert" : "standard", starter: fv("starter"), undo: fv("allowUndo") === "yes", colour1: fv("colour1"), colour2: fv("colour2"), timer: Number(fv("timer")), sound: document.getElementById("setting-sound").checked, animations: document.getElementById("setting-animations").checked, language: document.getElementById("setting-language").value };
    saveSettings(); settingsDialog.close(); startNewGame();
  });

  const statisticsDialog = document.getElementById("statistics-dialog");
  document.getElementById("view-statistics-button").addEventListener("click", () => statisticsDialog.showModal());
  document.getElementById("close-statistics").addEventListener("click", () => statisticsDialog.close());
  const helpDialog = document.getElementById("help-dialog");
  document.getElementById("help-button").addEventListener("click", () => helpDialog.showModal());
  document.getElementById("close-help").addEventListener("click", () => helpDialog.close());

  let pendingUpdateRegistration = null;
  function gameIsInProgress() { return !!state && state.winner === null && (state.board.some(Boolean) || state.redeployPiece); }
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
