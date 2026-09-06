  const mobileVersionElement = document.getElementById("mobile-version");
(function () {
  "use strict";

  const rules = window.LipftyRules;
  const BOARD_CELLS = rules.SIZE * rules.SIZE;
  const PIECES_PER_COLOUR = 14;
  const TOTAL_PIECES = PIECES_PER_COLOUR * 2;

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

  let nextPieceId = 1;
  let state = null;
  let settings = loadSettings();
  let computerBusy = false;
  let flowTimer = null;
  let checkpoints = [];

  function loadSettings() {
    const defaults = {
      mode: "computer",
      player1: "Player",
      player2: "Player 2",
      level: "standard",
      starter: "random",
      undo: true,
      language: "en-GB", colour1: "red", colour2: "blue", timer: 30, sound: true, animations: true, undoPreviousJump: false, allowJump: false, allowMove: false, allowDiagonal: false, allowSquare: false, allowSpacedSquare: false, allowDiamond: false, allowSpacedDiamond: false
    };
    try {
      const saved = JSON.parse(localStorage.getItem("lipfty-settings") || "{}");
      if (saved.winLevel && saved.allowJump === undefined) {
        const level = Number(saved.winLevel) || 1;
        Object.assign(saved, { allowJump: level >= 2, allowMove: level >= 3, allowDiagonal: level >= 4, allowSquare: level >= 5, allowSpacedSquare: level >= 6, allowDiamond: level >= 7, allowSpacedDiamond: level >= 8 });
      }
      delete saved.winLevel;
      return { ...defaults, ...saved };
    } catch (_) {
      return defaults;
    }
  }

  function saveSettings() {
    localStorage.setItem("lipfty-settings", JSON.stringify(settings));
  }

  function isComputer(playerIndex) {
    return settings.mode === "computer" && playerIndex === 1;
  }

  function participantName(playerIndex) {
    if (isComputer(playerIndex)) return "Computer";
    if (settings.mode === "computer") return settings.player1 || "Player";
    return playerIndex === 0
      ? (settings.player1 || "Player 1")
      : (settings.player2 || "Player 2");
  }

  function otherPlayer(playerIndex = state.currentPlayer) {
    return playerIndex === 0 ? 1 : 0;
  }

  function piecesRemain() {
    return state.remaining.black + state.remaining.white > 0;
  }

  function openingPiecesRemain() {
    return piecesRemain();
  }

  function initialCornerPhase() {
    return state.openingCornerPlacementsRemaining > 0;
  }

  function jumpCornerPieces() {
    return state.jumpCornerPieces.filter(Boolean);
  }

  function jumpCornerPiecesRemain() {
    return jumpCornerPieces().length > 0;
  }

  function finalCornerPiecesRemain() {
    return state.finalCornerPieces.some(Boolean);
  }

  function reservePieceCount() {
    return state.remaining.black + state.remaining.white;
  }

  function updateJumpUnlock() {
    // Lipfty 4.1: jumping is available throughout normal play.
    state.jumpUnlocked = true;
  }

  function beginFinalFourIfReady() {
    if (state.finalFourPhase || jumpCornerPiecesRemain() || reservePieceCount() !== 0) return false;
    state.finalFourPhase = true;
    state.openingPlacementTurnsRemaining = 0;
    state.forcedPlacement = false;
    state.finalCornerPieces = [0, 7, 56, 63].map(i => state.reserveLayout.locked[i]);
    state.choosingColour = true;
    state.colourChooser = state.currentPlayer;
    return true;
  }

  function cornerTopCount(colour) {
    return state.cornerTopRemaining[colour] + jumpCornerPieces().filter(piece => piece.colour === colour).length;
  }

  function normalReserveRemaining(colour) {
    return Math.max(0, state.remaining[colour] - cornerTopCount(colour));
  }

  function normalReservePiecesRemain() {
    return normalReserveRemaining("black") + normalReserveRemaining("white") > 0;
  }

  function firstFreeJumpCorner() {
    return state.jumpCornerPieces.findIndex(piece => !piece);
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
    const corners = [0, 7, 56, 63];
    const outer = [];
    for (let i = 0; i < 64; i += 1) {
      const r = Math.floor(i / 8), c = i % 8;
      if (r === 0 || r === 7 || c === 0 || c === 7) outer.push(i);
    }
    const nonCorners = outer.filter(i => !corners.includes(i));
    const active = Array(64).fill(null);
    const locked = Array(64).fill(null);

    const cornerColours = shuffled(["black","black","white","white"]);
    cornerColours.forEach((colour,i) => {
      active[corners[i]] = colour;
      locked[corners[i]] = colour;
    });
    shuffled([...Array(12).fill("black"), ...Array(12).fill("white")])
      .forEach((colour,i) => { active[nonCorners[i]] = colour; });

    return { active, locked };
  }

  function freshState() {
    return {
      board: Array(BOARD_CELLS).fill(null),
      remaining: { black: PIECES_PER_COLOUR, white: PIECES_PER_COLOUR },
      reserveLayout: makeReserveLayout(),
      currentPlayer: 0,

      // The first four turns use the four playable top-corner pieces.
      // Each player chooses their own corner-top colour and must place it.
      openingCornerPlacementsRemaining: 4,
      cornerTopRemaining: { black: 2, white: 2 },

      // After those four placements, the opponent chooses a colour for currentPlayer.
      choosingColour: true,
      colourChooser: 0,
      assignedColour: null,
      // The reserve/corner piece picked for this turn. Human picks are committed.
      selectedReserveIndex: null,

      // A Stage-1 move must be followed by two placement turns:
      // first by the opponent, then by the player who moved.
      openingPlacementTurnsRemaining: 0,
      forcedPlacement: false,

      selectedPieceIndex: null,
      legalMoves: new Set(),
      legalJumps: new Map(),
      jumpInProgress: false,
      jumpPieceIndex: null,
      jumpVisited: [],
      jumpPreviousIndex: null,

      // The exact piece moved by the opponent on the preceding turn is protected.
      opponentProtectedPieceId: null,
      // Lipfty 4.1 jumps are non-capturing single jumps. They have the same
      // consequence as an ordinary move: two compulsory placement turns.
      jumpCornerPieces: [null, null, null, null],
      jumpCount: 0,
      jumpFlashIndex: null,
      jumpUnlocked: true,

      // Once all 28 normal playable pieces are on the board, the four marker
      // pieces become the final four placement-only pieces.
      finalFourPhase: false,
      finalCornerPieces: [null, null, null, null],

      winner: null,
      winningCells: []
    };
  }

  function serialiseState() {
    return {
      ...state,
      board: state.board.map(piece => piece ? { ...piece } : null),
      remaining: { ...state.remaining },
      reserveLayout: {
        active: [...state.reserveLayout.active],
        locked: [...state.reserveLayout.locked]
      },
      cornerTopRemaining: { ...state.cornerTopRemaining },
      jumpCornerPieces: state.jumpCornerPieces.map(piece => piece ? { ...piece } : null),
      finalCornerPieces: [...state.finalCornerPieces],
      legalMoves: [],
      legalJumps: [],
      selectedPieceIndex: null,
      selectedReserveIndex: state.selectedReserveIndex,
      jumpInProgress: false,
      jumpPieceIndex: null,
      jumpVisited: [],
      jumpPreviousIndex: null
    };
  }

  function snapshotKey(snapshot) {
    return JSON.stringify(snapshot.state);
  }

  function makeSnapshot() {
    return { state: serialiseState(), nextPieceId };
  }

  function isHumanDecisionPoint() {
    if (state.winner !== null || computerBusy) return false;
    if (state.choosingColour) return !isComputer(state.colourChooser);
    return !isComputer(state.currentPlayer);
  }

  function rememberDecisionPoint() {
    if (!settings.undo || !isHumanDecisionPoint()) return;
    const snap = makeSnapshot();
    const key = snapshotKey(snap);
    if (!checkpoints.length || checkpoints[checkpoints.length - 1].key !== key) {
      checkpoints.push({ key, snap });
    }
  }

  function restoreSnapshot(snap) {
    clearTimeout(flowTimer);
    computerBusy = false;
    nextPieceId = snap.nextPieceId;
    state = {
      ...snap.state,
      board: snap.state.board.map(piece => piece ? { ...piece } : null),
      remaining: { ...snap.state.remaining },
      reserveLayout: {
        active: [...snap.state.reserveLayout.active],
        locked: [...snap.state.reserveLayout.locked]
      },
      cornerTopRemaining: { ...snap.state.cornerTopRemaining },
      jumpCornerPieces: snap.state.jumpCornerPieces.map(piece => piece ? { ...piece } : null),
      finalCornerPieces: [...snap.state.finalCornerPieces],
      selectedPieceIndex: null,
      legalMoves: new Set(),
      legalJumps: new Map(),
      jumpInProgress: false,
      jumpPieceIndex: null
    };
    jumpControls.hidden = true;
    processFlow("Previous decision restored.");
  }

  function undo() {
    if (!settings.undo || computerBusy || !checkpoints.length) return;

    const currentKey = snapshotKey(makeSnapshot());

    // If the current position is itself the last saved decision point,
    // remove it so Undo goes to the preceding playable decision.
    if (checkpoints.length && checkpoints[checkpoints.length - 1].key === currentKey) {
      checkpoints.pop();
    }

    if (!checkpoints.length) {
      render();
      return;
    }

    const entry = checkpoints.pop();
    restoreSnapshot(entry.snap);
  }

  function setStatus(text) {
    statusElement.textContent = text;
  }

  function clearSelection() {
    state.selectedPieceIndex = null;
    state.legalMoves.clear();
    state.legalJumps.clear();
  }

  const COLOURS={red:["Red","#d6423a"],blue:["Blue","#2d65ad"],green:["Green","#318653"],yellow:["Yellow","#e2ad34"],purple:["Purple","#7955a6"],orange:["Orange","#d97832"],black:["Black","#1d1d1d"],white:["White","#f8f8f4"]};
  function colourKey(colour){return colour==="black"?settings.colour1:settings.colour2;}
  function colourTitle(colour){return COLOURS[colourKey(colour)][0];}
  function jumpAllowed(){return !!settings.allowJump;}
  function moveAllowed(){return !!settings.allowMove;}
  function applyPieceColours(){document.documentElement.style.setProperty("--piece-black",COLOURS[settings.colour1][1]);document.documentElement.style.setProperty("--piece-white",COLOURS[settings.colour2][1]);}

  function canUseColour(colour) {
    if (initialCornerPhase()) {
      return state.cornerTopRemaining[colour] > 0 && state.board.some(cell => !cell);
    }

    if (state.finalFourPhase) {
      return state.finalCornerPieces.some(pieceColour => pieceColour === colour) && state.board.some(cell => !cell);
    }

    if (jumpCornerPiecesRemain()) {
      return state.jumpCornerPieces.some(piece => piece?.colour === colour) && state.board.some(cell => !cell);
    }

    if (state.forcedPlacement) {
      return normalReserveRemaining(colour) > 0 && state.board.some(cell => !cell);
    }

    if (normalReserveRemaining(colour) > 0 && state.board.some(cell => !cell)) return true;

    for (let from = 0; from < BOARD_CELLS; from += 1) {
      const piece = state.board[from];
      if (!piece || piece.colour !== colour) continue;
      if (piece.id === state.opponentProtectedPieceId) continue;
      if (moveAllowed() && rules.adjacentDestinations(state.board, from).length) return true;
      if (jumpAllowed() && legalSingleJumps(from).length) return true;
    }

    return false;
  }

  function firstVisibleReserveIndex(colour, mode = "normal") {
    const corners = [0, 7, 56, 63];
    if (mode === "opening") {
      if (state.cornerTopRemaining[colour] <= 0) return null;
      return corners.find(i => state.reserveLayout.active[i] === colour) ?? null;
    }
    if (mode === "final") {
      const slot = state.finalCornerPieces.findIndex(c => c === colour);
      return slot >= 0 ? corners[slot] : null;
    }
    const count = normalReserveRemaining(colour);
    if (count <= 0) return null;
    const candidates = [];
    for (let i = 0; i < 64; i += 1) {
      if (!corners.includes(i) && state.reserveLayout.active[i] === colour) candidates.push(i);
    }
    return candidates[Math.min(count - 1, candidates.length - 1)] ?? null;
  }

  function colourPrompt() {
    if (initialCornerPhase() || jumpCornerPiecesRemain() || state.finalFourPhase) {
      const actor = participantName(state.currentPlayer);
      return `${actor}: choose one of the available top-corner pieces to place.`;
    }
    const chooser = participantName(state.colourChooser);
    const receiver = participantName(state.currentPlayer);
    return `${chooser}: choose ${colourTitle("black")} or ${colourTitle("white")} for ${receiver}.`;
  }

  function actionPrompt() {
    const actor = participantName(state.currentPlayer);
    if (initialCornerPhase()) {
      return `${actor}: place the chosen top-corner ${colourTitle(state.assignedColour)} piece. Moving and jumping are not allowed.`;
    }
    if (state.finalFourPhase) {
      return `${actor}: final four — place the chosen ${colourTitle(state.assignedColour)} corner-marker piece. No moving or jumping.`;
    }
    if (jumpCornerPiecesRemain()) {
      return `${actor}: compulsory corner placement — place the chosen ${colourTitle(state.assignedColour)} top-corner piece.`;
    }
    if (state.forcedPlacement) {
      const remaining = state.openingPlacementTurnsRemaining;
      return `${actor}: compulsory placement — place ${colourTitle(state.assignedColour)}. ${remaining} placement turn${remaining === 1 ? "" : "s"} remain${remaining === 1 ? "s" : ""} before moving or jumping is allowed again.`;
    }
    if (moveAllowed()) return `${actor}: use ${colourTitle(state.assignedColour)} — place, move, or make a single jump over the opposite colour.`;
    if (jumpAllowed()) return `${actor}: use ${colourTitle(state.assignedColour)} — place, or make a single jump over the opposite colour.`;
    return `${actor}: use ${colourTitle(state.assignedColour)} — place the handed reserve piece.`;
  }

  function processFlow(message = null) {
    clearTimeout(flowTimer);

    if (state.winner !== null) {
      render();
      return;
    }

    if (state.forcedPlacement && !jumpCornerPiecesRemain() && !normalReservePiecesRemain()) {
      state.openingPlacementTurnsRemaining = 0;
      state.forcedPlacement = false;
    }

    beginFinalFourIfReady();

    if (state.choosingColour) {
      const normalHandedPiece = !initialCornerPhase() && !state.finalFourPhase && !jumpCornerPiecesRemain();
      const legalColours = normalHandedPiece
        ? rules.availableReserveColours({ black: normalReserveRemaining("black"), white: normalReserveRemaining("white") }).filter(canUseColour)
        : ["black", "white"].filter(canUseColour);
      if (!legalColours.length) {
        state.winner = "draw";
        computerBusy = false;
        if (moveTimerInterval) { clearInterval(moveTimerInterval); moveTimerInterval = null; }
        clearSelection();
        jumpControls.hidden = true;
        setStatus("Draw — stalemate. No legal action is available.");
        render();
        maybeShowUpdateDialog();
        return;
      }

      const reserveColours = initialCornerPhase()
        ? ["black", "white"].filter(colour => state.cornerTopRemaining[colour] > 0)
        : state.finalFourPhase
          ? ["black", "white"].filter(colour => state.finalCornerPieces.some(pieceColour => pieceColour === colour))
        : jumpCornerPiecesRemain()
          ? ["black", "white"].filter(colour => state.jumpCornerPieces.some(piece => piece?.colour === colour))
          : state.forcedPlacement
            ? ["black", "white"].filter(colour => normalReserveRemaining(colour) > 0)
            : [];
      // Opening and Final Four are self-chosen physical corner pieces. If every
      // remaining choice is the same colour, there is no meaningful choice: pick
      // one of those actual corner pieces up automatically and put it "in hand".
      const selfChosenCorner = initialCornerPhase() || state.finalFourPhase;
      const oneCornerColour = selfChosenCorner && reserveColours.length === 1 ? reserveColours[0] : null;
      if (oneCornerColour) {
        const mode = initialCornerPhase() ? "opening" : "final";
        const pickedIndex = firstVisibleReserveIndex(oneCornerColour, mode);
        if (pickedIndex !== null) {
          state.selectedReserveIndex = pickedIndex;
          state.assignedColour = oneCornerColour;
          state.choosingColour = false;
          state.selectedPieceIndex = null;
          state.legalMoves.clear();
          state.legalJumps.clear();
          message = `${colourTitle(oneCornerColour)} is the only corner colour remaining, so a piece is picked up automatically.`;
        }
      }

      // If exactly one normal reserve piece remains, handing it over is inevitable.
      // Pick up that exact physical piece automatically for either player.
      if (state.choosingColour && normalHandedPiece &&
          normalReserveRemaining("black") + normalReserveRemaining("white") === 1) {
        const onlyColour = normalReserveRemaining("black") === 1 ? "black" : "white";
        const pickedIndex = firstVisibleReserveIndex(onlyColour, "normal");
        if (pickedIndex !== null) {
          state.selectedReserveIndex = pickedIndex;
          state.assignedColour = onlyColour;
          state.choosingColour = false;
          clearSelection();
          message = `${colourTitle(onlyColour)} is the only reserve piece remaining, so it is picked up automatically.`;
        }
      }
    }

    if (message) setStatus(message);
    else if (state.jumpInProgress) setStatus(`Jump again with the same piece, or finish your turn. ${2 - state.jumpCount} jump${2 - state.jumpCount === 1 ? "" : "s"} available.`);
    else if (state.choosingColour) setStatus(colourPrompt());
    else setStatus(actionPrompt());

    render();

    if (isHumanDecisionPoint()) {
      rememberDecisionPoint();
      return;
    }

    if (state.choosingColour && isComputer(state.colourChooser)) {
      flowTimer = setTimeout(computerChooseColour, 300);
      return;
    }

    if (!state.choosingColour && isComputer(state.currentPlayer)) {
      flowTimer = setTimeout(computerPlayTurn, 450);
    }
  }

  function chooseColour(colour) {
    if (state.winner !== null || !state.choosingColour || computerBusy) return;
    if (!canUseColour(colour)) {
      setStatus(`${colourTitle(colour)} cannot be used for this turn. Choose the other colour.`);
      render();
      return;
    }

    state.assignedColour = colour;
    state.choosingColour = false;
    clearSelection();
    processFlow();
  }

  function checkAndFinishWin(movedPieceId = null) {
    const win = rules.checkWin(state.board, settings);
    if (!win) return false;

    state.winner = state.currentPlayer;
    // Keep Undo usable after either a human or computer win.
    computerBusy = false;
    if (moveTimerInterval) { clearInterval(moveTimerInterval); moveTimerInterval = null; }
    state.winningCells = win.line;
    state.opponentProtectedPieceId = movedPieceId;
    state.jumpInProgress = false;
    state.jumpPieceIndex = null;
    state.jumpVisited = [];
    state.jumpPreviousIndex = null;
    clearSelection();
    jumpControls.hidden = true;
    setStatus(`${participantName(state.currentPlayer)} wins with four ${colourTitle(win.colour)} pieces!`);
    render();
    maybeShowUpdateDialog();
    return true;
  }

  function finishTurn(movedPieceId, actionWasMove, wasSelfChosenCornerPlacement = false, actionWasJump = false) {
    if (checkAndFinishWin(movedPieceId)) return;
    const finishingPlayer = state.currentPlayer;

    if (actionWasMove || actionWasJump) {
      state.openingPlacementTurnsRemaining = normalReservePiecesRemain() || jumpCornerPiecesRemain() ? 2 : 0;
    } else if (state.openingPlacementTurnsRemaining > 0) {
      state.openingPlacementTurnsRemaining -= 1;
    }

    state.opponentProtectedPieceId = movedPieceId || null;
    state.currentPlayer = otherPlayer(finishingPlayer);
    state.assignedColour = null;
    state.selectedReserveIndex = null;
    clearSelection();
    state.jumpInProgress = false;
    state.jumpPieceIndex = null;
    state.jumpVisited = [];
    state.jumpPreviousIndex = null;
    state.jumpCount = 0;
    jumpControls.hidden = true;

    if (!jumpCornerPiecesRemain() && !normalReservePiecesRemain()) {
      state.openingPlacementTurnsRemaining = 0;
    }
    state.forcedPlacement = state.openingPlacementTurnsRemaining > 0 || jumpCornerPiecesRemain();

    if (beginFinalFourIfReady()) {
      // Final-four colour is chosen by the player who is about to place it.
    } else if (jumpCornerPiecesRemain() || state.finalFourPhase) {
      state.choosingColour = true;
      state.colourChooser = state.currentPlayer;
    } else if (wasSelfChosenCornerPlacement && initialCornerPhase()) {
      state.choosingColour = true;
      state.colourChooser = state.currentPlayer;
    } else {
      state.choosingColour = true;
      state.colourChooser = finishingPlayer;
    }
    resetMoveTimer();
    processFlow();
  }

  function placeJumpCornerPiece(index) {
    if (state.jumpInProgress || !jumpCornerPiecesRemain() || state.board[index]) return false;
    const colour = state.assignedColour;
    const slot = state.jumpCornerPieces.findIndex(piece => piece?.colour === colour);
    if (slot < 0) return false;
    const replacement = state.jumpCornerPieces[slot];
    state.board[index] = replacement;
    state.jumpCornerPieces[slot] = null;
    state.remaining[replacement.colour] = Math.max(0, state.remaining[replacement.colour] - 1);
    clearSelection();
    finishTurn(null, false, true);
    return true;
  }


  function consumeSelectedNormalReservePiece(colour) {
    const pickedIndex = state.selectedReserveIndex;
    if (pickedIndex === null || [0, 7, 56, 63].includes(pickedIndex)) return;
    if (state.reserveLayout.active[pickedIndex] === colour) {
      state.reserveLayout.active[pickedIndex] = null;
    }
  }

  function placePiece(index) {
    if (computerBusy || state.choosingColour || jumpCornerPiecesRemain()) return;
    const colour = state.assignedColour;
    if (!colour || state.board[index]) return;

    if (state.finalFourPhase) {
      const slot = state.finalCornerPieces.findIndex(pieceColour => pieceColour === colour);
      if (slot < 0) return;
      state.board[index] = { id: nextPieceId++, colour };
      state.finalCornerPieces[slot] = null;
      clearSelection();
      if (checkAndFinishWin(null)) return;
      if (!finalCornerPiecesRemain()) {
        state.winner = "draw";
        setStatus("Draw — all four final corner pieces have been placed without a win.");
        render();
        maybeShowUpdateDialog();
        return;
      }
      finishTurn(null, false, true);
      return;
    }

    if (normalReserveRemaining(colour) <= 0) return;

    const cornerOpeningPlacement = initialCornerPhase();
    if (cornerOpeningPlacement && state.cornerTopRemaining[colour] <= 0) return;

    state.board[index] = { id: nextPieceId++, colour };
    if (!cornerOpeningPlacement) consumeSelectedNormalReservePiece(colour);
    state.remaining[colour] -= 1;
    if (cornerOpeningPlacement) {
      state.cornerTopRemaining[colour] -= 1;
      state.openingCornerPlacementsRemaining -= 1;
    }
    updateJumpUnlock();
    clearSelection();
    finishTurn(null, false, cornerOpeningPlacement);
  }

  function selectPiece(index) {
    if (computerBusy || state.winner !== null || state.choosingColour || state.forcedPlacement) return;
    if (initialCornerPhase() || state.finalFourPhase) {
      setStatus(state.finalFourPhase ? "The final four turns are placements only — use a corner-marker piece." : "The first four turns are placements only — use a top-corner piece.");
      render();
      return;
    }

    const piece = state.board[index];
    if (!piece) return;

    // Touch-move principle: once a movable board piece has been picked, it is
    // committed for this turn and another piece cannot be substituted.
    if (state.selectedPieceIndex !== null && index !== state.selectedPieceIndex) {
      setStatus("That piece is already chosen. Choose one of its highlighted destinations.");
      render();
      return;
    }

    if (state.jumpInProgress && index !== state.jumpPieceIndex) return;

    if (!state.jumpInProgress && piece.id === state.opponentProtectedPieceId) {
      setStatus("You cannot move the piece your opponent moved on their previous turn.");
      render();
      return;
    }

    if (state.assignedColour && piece.colour !== state.assignedColour) {
      setStatus(`You must use ${colourTitle(state.assignedColour)} this turn.`);
      render();
      return;
    }

    state.selectedPieceIndex = index;
    state.legalMoves = new Set(
      state.jumpInProgress || !moveAllowed() ? [] : rules.adjacentDestinations(state.board, index)
    );
    state.legalJumps = new Map(
      (jumpAllowed() ? legalJumpContinuations(index) : []).map(jump => [jump.to, jump])
    );

    if (state.legalMoves.size === 0 && state.legalJumps.size === 0) {
      clearSelection();
      setStatus("That piece has no legal move.");
    } else {
      setStatus(state.jumpInProgress
        ? "Choose a highlighted square to continue the jump, or finish your turn."
        : "Choose a highlighted destination square.");
    }
    render();
  }

  function legalSingleJumps(from) {
    if (!jumpAllowed() || state.finalFourPhase || state.forcedPlacement || initialCornerPhase()) return [];
    const movingPiece = state.board[from];
    if (!movingPiece) return [];
    return rules.jumpDestinations(state.board, from).filter(jump => {
      const jumpedPiece = state.board[jump.over];
      return jumpedPiece && jumpedPiece.colour !== movingPiece.colour;
    });
  }

  function legalJumpContinuations(from) {
    return legalSingleJumps(from);
  }

  function humanMovePiece(from, to, jump = null, afterFlash = false) {
    const piece = state.board[from];
    if (!piece || state.board[to]) return;

    if (jump && state.board[jump.over] && !afterFlash) {
      state.jumpFlashIndex = jump.over;
      render();
      flowTimer = setTimeout(() => {
        state.jumpFlashIndex = null;
        humanMovePiece(from, to, jump, true);
      }, 500);
      return;
    }

    state.board[to] = piece;
    state.board[from] = null;
    state.selectedPieceIndex = to;

    // A Lipfty 4.1 jump never removes the piece jumped over. It is a single
    // tactical leap and immediately triggers the same two placements as a move.
    if (checkAndFinishWin(piece.id)) return;

    clearSelection();
    jumpControls.hidden = true;
    finishTurn(piece.id, !jump, false, !!jump);
  }

  function handleCell(index) {
    if (computerBusy || state.jumpFlashIndex !== null || isComputer(state.currentPlayer) || state.winner !== null || state.choosingColour) return;

    const piece = state.board[index];

    if (!piece && state.selectedPieceIndex === null && jumpCornerPiecesRemain()) {
      placeJumpCornerPiece(index);
      return;
    }

    // With no piece selected, an empty square means "place" when a reserve/final piece is available.
    if (!piece && state.selectedPieceIndex === null && state.assignedColour && state.selectedReserveIndex !== null &&
        (state.finalFourPhase || normalReserveRemaining(state.assignedColour) > 0)) {
      placePiece(index);
      return;
    }

    // When a piece is selected, an empty highlighted square is its destination.
    if (!piece && state.selectedPieceIndex !== null) {
      const from = state.selectedPieceIndex;
      if (state.legalJumps.has(index)) {
        humanMovePiece(from, index, state.legalJumps.get(index));
      } else if (state.legalMoves.has(index)) {
        humanMovePiece(from, index, null);
      }
      return;
    }

    if (piece) selectPiece(index);
  }

  function cloneBoard(board) {
    return board.map(piece => piece ? { ...piece } : null);
  }

  function enumerateActions(colour, mustPlace) {
    const actions = [];

    if (colour && normalReserveRemaining(colour) > 0) {
      for (let to = 0; to < BOARD_CELLS; to += 1) {
        if (!state.board[to]) actions.push({ type: "place", to, colour });
      }
    }

    if (mustPlace || initialCornerPhase()) return actions;

    for (let from = 0; from < BOARD_CELLS; from += 1) {
      const piece = state.board[from];
      if (!piece) continue;
      if (colour && piece.colour !== colour) continue;
      if (piece.id === state.opponentProtectedPieceId) continue;

      if (moveAllowed()) {
        for (const to of rules.adjacentDestinations(state.board, from)) {
          actions.push({ type: "move", from, to });
        }
      }
      if (jumpAllowed()) {
        for (const jump of legalSingleJumps(from)) {
          actions.push({ type: "jump", from, to: jump.to, over: jump.over });
        }
      }
    }

    return actions;
  }

  function boardAfterAction(action) {
    const board = cloneBoard(state.board);
    if (action.type === "place" || action.type === "corner-place" || action.type === "final-place") {
      board[action.to] = { id: -1, colour: action.colour };
    } else {
      board[action.to] = board[action.from];
      board[action.from] = null;
      // Single jumps are non-capturing: the jumped piece stays in place.
    }
    return board;
  }

  function actionWins(action) {
    return !!rules.checkWin(boardAfterAction(action), settings);
  }

  function actionScore(action) {
    if (actionWins(action)) return 10000;

    const row = Math.floor(action.to / rules.SIZE);
    const col = action.to % rules.SIZE;
    let score = 0;

    const centreLow = rules.SIZE / 2 - 1;
    const centreHigh = rules.SIZE / 2;
    if (row === centreLow || row === centreHigh) score += 2;
    if (col === centreLow || col === centreHigh) score += 2;
    if (action.type === "jump") score += 1.5;

    // Slight randomness keeps repeated games from becoming identical.
    score += Math.random();

    if (settings.level === "expert") {
      const board = boardAfterAction(action);
      // Reward building same-colour occupancy in winning lines.
      const movedColour = action.type === "place" || action.type === "corner-place" || action.type === "final-place"
        ? action.colour
        : state.board[action.from].colour;
      for (const line of rules.WINNING_PATTERNS) {
        if (!line.includes(action.to)) continue;
        const count = line.filter(i => board[i] && board[i].colour === movedColour).length;
        score += count * count;
      }
    }

    return score;
  }

  function pickComputerAction(actions) {
    if (!actions.length) return null;

    const winning = actions.filter(actionWins);
    if (winning.length) return winning[Math.floor(Math.random() * winning.length)];

    if (settings.level === "beginner") {
      return actions[Math.floor(Math.random() * actions.length)];
    }

    return [...actions].sort((a, b) => actionScore(b) - actionScore(a))[0];
  }

  function computerChooseColour() {
    if (state.winner !== null || !state.choosingColour || !isComputer(state.colourChooser)) return;

    computerBusy = true;
    render();

    const normalHandedPiece = !initialCornerPhase() && !state.finalFourPhase && !jumpCornerPiecesRemain();
    const legalColours = normalHandedPiece
      ? rules.availableReserveColours({ black: normalReserveRemaining("black"), white: normalReserveRemaining("white") }).filter(canUseColour)
      : ["black", "white"].filter(canUseColour);
    if (!legalColours.length) {
      computerBusy = false;
      setStatus("No colour can be given. Start a new game.");
      render();
      return;
    }

    const choosingOwnCorner = initialCornerPhase() || jumpCornerPiecesRemain() || state.finalFourPhase;
    let pool = legalColours;
    if (choosingOwnCorner) {
      const winningColours = legalColours.filter(colour => {
        for (let to = 0; to < BOARD_CELLS; to += 1) {
          if (state.board[to]) continue;
          const board = cloneBoard(state.board);
          board[to] = { id: -1, colour };
          if (rules.checkWin(board, settings)) return true;
        }
        return false;
      });
      if (winningColours.length) pool = winningColours;
    } else {
      // Prefer not to give the opponent a colour with an immediate winning placement.
      const safeColours = legalColours.filter(colour => {
        if (normalReserveRemaining(colour) <= 0) return true;
        for (let to = 0; to < BOARD_CELLS; to += 1) {
          if (state.board[to]) continue;
          const board = cloneBoard(state.board);
          board[to] = { id: -1, colour };
          if (rules.checkWin(board, settings)) return false;
        }
        return true;
      });
      if (safeColours.length) pool = safeColours;
    }
    const colour = pool[Math.floor(Math.random() * pool.length)];

    flowTimer = setTimeout(() => {
      computerBusy = false;
      const mode = initialCornerPhase() ? "opening" : state.finalFourPhase ? "final" : "normal";
      state.selectedReserveIndex = firstVisibleReserveIndex(colour, mode);
      state.assignedColour = colour;
      state.choosingColour = false;
      processFlow(choosingOwnCorner
        ? `Computer picks up a top-corner ${colourTitle(colour)} piece to place.`
        : `Computer picks up a ${colourTitle(colour)} reserve piece and gives it to ${participantName(state.currentPlayer)}.`);
    }, 250);
  }


  function computerPlayTurn() {
    if (state.winner !== null || state.choosingColour || !isComputer(state.currentPlayer)) return;

    computerBusy = true;
    setStatus("Computer is thinking…");
    render();

    const colour = state.assignedColour;
    let actions;
    if (state.finalFourPhase) {
      actions = [];
      if (state.finalCornerPieces.some(pieceColour => pieceColour === colour)) {
        for (let to = 0; to < BOARD_CELLS; to += 1) {
          if (!state.board[to]) actions.push({ type: "final-place", to, colour });
        }
      }
    } else if (jumpCornerPiecesRemain()) {
      actions = [];
      const slot = state.jumpCornerPieces.findIndex(piece => piece?.colour === colour);
      if (slot >= 0) {
        for (let to = 0; to < BOARD_CELLS; to += 1) {
          if (!state.board[to]) actions.push({ type: "corner-place", to, colour, slot });
        }
      }
    } else {
      actions = enumerateActions(colour, state.forcedPlacement);
    }
    const action = pickComputerAction(actions);

    if (!action) {
      computerBusy = false;
      setStatus("Computer has no legal action.");
      render();
      return;
    }

    flowTimer = setTimeout(() => {
      if (action.type === "final-place") {
        const slot = state.finalCornerPieces.findIndex(pieceColour => pieceColour === action.colour);
        state.board[action.to] = { id: nextPieceId++, colour: action.colour };
        state.finalCornerPieces[slot] = null;
        computerBusy = false;
        if (checkAndFinishWin(null)) return;
        if (!finalCornerPiecesRemain()) {
          state.winner = "draw";
          setStatus("Draw — all four final corner pieces have been placed without a win.");
          render();
          maybeShowUpdateDialog();
          return;
        }
        finishTurn(null, false, true);
        return;
      }

      if (action.type === "corner-place") {
        const replacement = state.jumpCornerPieces[action.slot];
        state.board[action.to] = replacement;
        state.jumpCornerPieces[action.slot] = null;
        state.remaining[replacement.colour] = Math.max(0, state.remaining[replacement.colour] - 1);
        computerBusy = false;
        finishTurn(null, false, true);
        return;
      }

      if (action.type === "place") {
        const cornerOpeningPlacement = initialCornerPhase();
        state.board[action.to] = { id: nextPieceId++, colour: action.colour };
        if (!cornerOpeningPlacement) consumeSelectedNormalReservePiece(action.colour);
        state.remaining[action.colour] -= 1;
        if (cornerOpeningPlacement) {
          state.cornerTopRemaining[action.colour] -= 1;
          state.openingCornerPlacementsRemaining -= 1;
        }
        updateJumpUnlock();
        computerBusy = false;
        finishTurn(null, false, cornerOpeningPlacement);
        return;
      }

      const piece = state.board[action.from];
      const firstJumpOver = action.type === "jump" ? action.over : null;
      if (action.type === "jump" && firstJumpOver !== null && state.board[firstJumpOver] && state.jumpFlashIndex === null) {
        state.jumpFlashIndex = firstJumpOver;
        render();
        flowTimer = setTimeout(() => {
          state.jumpFlashIndex = null;
          computerPlayResolvedAction(action, piece, firstJumpOver);
        }, 500);
        return;
      }
      computerPlayResolvedAction(action, piece, firstJumpOver);
    }, 350);
  }

  function computerPlayResolvedAction(action, piece, firstJumpOver) {
      state.board[action.to] = piece;
      state.board[action.from] = null;

      // Lipfty 4.1 single jumps do not remove the jumped-over piece.
      if (checkAndFinishWin(piece.id)) {
        computerBusy = false;
        return;
      }

      computerBusy = false;
      finishTurn(piece.id, action.type === "move", false, action.type === "jump");
  }

  function chooseReservePiece(displayIndex, colour) {
    if (state.winner !== null || computerBusy) return;

    if (state.choosingColour) {
      if (isComputer(state.colourChooser) || !canUseColour(colour)) return;

      // Opening/Final Four: the player picks their own actual corner piece.
      // Normal play: the opponent picks an actual reserve piece and hands it to
      // the player; its colour is the colour to use for PLACE, MOVE or JUMP.
      const cornerChoice = initialCornerPhase() || state.finalFourPhase;
      const forcedOwnPiece = state.forcedPlacement || jumpCornerPiecesRemain();
      if (cornerChoice || forcedOwnPiece || (!initialCornerPhase() && !state.finalFourPhase)) {
        state.selectedReserveIndex = displayIndex;
        chooseColour(colour);
      }
      return;
    }

    // During a compulsory placement the current player chooses the actual piece.
    if (isComputer(state.currentPlayer) || state.selectedReserveIndex !== null || state.selectedPieceIndex !== null) return;
    if (!state.forcedPlacement || state.assignedColour !== colour || normalReserveRemaining(colour) <= 0) return;
    state.selectedReserveIndex = displayIndex;
    setStatus(`${participantName(state.currentPlayer)}: place the chosen ${colourTitle(colour)} reserve piece.`);
    render();
  }

  function renderBoard() {
    boardElement.replaceChildren();
    const winning = new Set(state.winningCells);
    const cornerIndexes = [0, 7, 56, 63];
    // An ordinary move temporarily removes two bottom corner markers to show
    // the two-placement obligation. Jumped pieces sit on top of available markers.
    const markerCandidates = cornerIndexes.filter((_, slot) => !state.jumpCornerPieces[slot]);
    const hiddenMarkerCorners = new Set(
      markerCandidates.slice(0, Math.min(2, state.openingPlacementTurnsRemaining))
    );
    const reserveShown = {
      corner: { black: 0, white: 0 },
      other: { black: 0, white: 0 }
    };

    for (let displayIndex = 0; displayIndex < 64; displayIndex += 1) {
      const displayRow = Math.floor(displayIndex / 8);
      const displayCol = displayIndex % 8;
      const inner = displayRow >= 1 && displayRow <= 6 && displayCol >= 1 && displayCol <= 6;
      const cell = document.createElement("button");
      cell.type = "button";
      cell.setAttribute("role", "gridcell");

      if (!inner) {
        cell.className = "board-cell board-cell--reserve";
        const corner = (displayRow === 0 || displayRow === 7) && (displayCol === 0 || displayCol === 7);
        const activeColour = state.reserveLayout.active[displayIndex];
        const lockedColour = state.reserveLayout.locked[displayIndex];
        const cornerSlot = corner ? cornerIndexes.indexOf(displayIndex) : -1;
        const jumpedCornerPiece = cornerSlot >= 0 ? state.jumpCornerPieces[cornerSlot] : null;
        const finalMarkerPlayed = cornerSlot >= 0 && state.finalFourPhase && !state.finalCornerPieces[cornerSlot];
        const pickedHere = state.selectedReserveIndex === displayIndex;
        const displayedColour = jumpedCornerPiece?.colour || activeColour;
        // The selected reserve index is the exact physical piece being held.
        // Keep the normal visible target unchanged here: when the renderer reaches
        // that exact square, pickedHere hides it and consumes its one reserve slot.
        // This prevents an earlier/later same-colour piece from disappearing instead.
        const activeTarget = activeColour
          ? (corner
            ? Math.min(state.cornerTopRemaining[activeColour], state.remaining[activeColour])
            : normalReserveRemaining(activeColour))
          : 0;
        const activeCounter = corner ? reserveShown.corner : reserveShown.other;
        const initialCornerPiece = corner && !jumpedCornerPiece && !!activeColour && activeCounter[activeColour] < activeTarget;
        let activeReservePiece = !!jumpedCornerPiece || initialCornerPiece ||
          (!corner && !!activeColour && activeCounter[activeColour] < activeTarget);
        if (pickedHere && activeReservePiece && activeColour) {
          // The exact picked piece has left its physical edge square and is now
          // shown in Colour to use. Consume this slot so no other same-colour
          // reserve piece is removed in its place.
          activeCounter[activeColour] += 1;
          activeReservePiece = false;
        }

        const markerIsAway = corner && hiddenMarkerCorners.has(displayIndex);
        if (corner && lockedColour && !markerIsAway && !finalMarkerPlayed && !(pickedHere && state.finalFourPhase)) {
          cell.classList.add("board-cell--locked-corner");
          const lockedDisc = document.createElement("span");
          lockedDisc.className = `piece piece--${lockedColour} piece--locked-corner`;
          lockedDisc.setAttribute("aria-hidden", "true");
          cell.appendChild(lockedDisc);
        } else if (markerIsAway) {
          cell.classList.add("board-cell--reserve-empty");
        }

        if (activeReservePiece) {
          const disc = document.createElement("span");
          disc.className = `piece piece--${displayedColour}${corner ? " piece--corner-top" : ""}`;
          disc.setAttribute("aria-hidden", "true");
          cell.appendChild(disc);
          if (!jumpedCornerPiece && activeColour) activeCounter[activeColour] += 1;
        } else if (!corner) {
          cell.classList.add("board-cell--reserve-empty");
        }

        cell.setAttribute("aria-label",
          corner
            ? `${activeReservePiece ? `${colourTitle(displayedColour)} playable top-corner piece above ` : ""}${markerIsAway ? "Corner marker temporarily removed" : `${colourTitle(lockedColour)} corner marker`}`
            : `${activeReservePiece ? `${colourTitle(activeColour)} reserve piece` : "Empty reserve square"}`
        );
        const humanChooser = state.winner === null && state.choosingColour && !computerBusy && !isComputer(state.colourChooser);
        const humanNormalPlacementChoice = state.winner === null && !state.choosingColour && !computerBusy &&
          !isComputer(state.currentPlayer) && !state.forcedPlacement && !initialCornerPhase() && !state.finalFourPhase &&
          !jumpCornerPiecesRemain() && state.selectedReserveIndex === null && state.selectedPieceIndex === null;
        let selectableColour = null;
        if (humanChooser) {
          if (initialCornerPhase() && corner && initialCornerPiece) selectableColour = activeColour;
          else if (state.finalFourPhase && corner && !finalMarkerPlayed && state.finalCornerPieces[cornerSlot]) selectableColour = state.finalCornerPieces[cornerSlot];
          else if (state.forcedPlacement && !corner && activeReservePiece) selectableColour = activeColour;
          else if (!initialCornerPhase() && !state.finalFourPhase && !state.forcedPlacement &&
                   !jumpCornerPiecesRemain() && !corner && activeReservePiece && canUseColour(activeColour)) {
            selectableColour = activeColour;
          }
        } else if (humanNormalPlacementChoice && state.forcedPlacement && !corner && activeReservePiece && activeColour === state.assignedColour) {
          selectableColour = activeColour;
        }
        cell.disabled = !selectableColour;
        if (selectableColour) {
          cell.classList.add("board-cell--reserve-selectable");
          cell.addEventListener("click", () => chooseReservePiece(displayIndex, selectableColour));
        }
        boardElement.appendChild(cell);
        continue;
      }

      const row = displayRow - 1;
      const col = displayCol - 1;
      const index = row * rules.SIZE + col;
      cell.className = "board-cell board-cell--playing";
      cell.dataset.index = String(index);

      if (winning.has(index)) cell.classList.add("board-cell--winner");
      if (state.selectedPieceIndex === index) cell.classList.add("board-cell--selected");
      if (state.legalMoves.has(index)) cell.classList.add("board-cell--move");
      if (state.legalJumps.has(index)) cell.classList.add("board-cell--jump");
      if (state.jumpFlashIndex === index) cell.classList.add("board-cell--jumped-flash");
      if (!computerBusy && !state.choosingColour && !isComputer(state.currentPlayer) &&
          jumpCornerPiecesRemain() && !state.board[index]) {
        cell.classList.add("board-cell--place");
      } else if (!computerBusy && !state.choosingColour && !isComputer(state.currentPlayer) &&
          state.assignedColour && !state.board[index] &&
          (state.finalFourPhase || normalReserveRemaining(state.assignedColour) > 0) && state.selectedPieceIndex === null) {
        cell.classList.add("board-cell--place");
      }

      const piece = state.board[index];
      if (piece) {
        const disc = document.createElement("span");
        disc.className = `piece piece--${piece.colour}`;
        disc.setAttribute("aria-hidden", "true");
        cell.appendChild(disc);
        cell.setAttribute("aria-label", `${piece.colour} piece, row ${row + 1}, column ${col + 1}`);
      } else {
        cell.setAttribute("aria-label", `Empty playing square, row ${row + 1}, column ${col + 1}`);
      }

      cell.disabled = computerBusy;
      cell.addEventListener("click", () => handleCell(index));
      boardElement.appendChild(cell);
    }
  }

  function render() {
    const reserveHeading = document.getElementById("reserve-heading");
    if (reserveHeading) reserveHeading.textContent = "Colour to use";

    currentPlayerElement.textContent = state.winner === "draw"
      ? "Draw"
      : state.winner !== null ? `${participantName(state.winner)} wins` : participantName(state.currentPlayer);

    blackRemainingElement.textContent = state.finalFourPhase
      ? `${state.finalCornerPieces.filter(c => c === "black").length} final remaining`
      : `${state.remaining.black} remaining`;
    document.getElementById("colour1-name").textContent = COLOURS[settings.colour1][0];
    whiteRemainingElement.textContent = state.finalFourPhase
      ? `${state.finalCornerPieces.filter(c => c === "white").length} final remaining`
      : `${state.remaining.white} remaining`;
    document.getElementById("colour2-name").textContent = COLOURS[settings.colour2][0];

    const phaseHelp=document.getElementById("phase-help");
    if(phaseHelp) phaseHelp.textContent=state.finalFourPhase
      ? `Final four · ${state.finalCornerPieces.filter(Boolean).length} corner-marker piece${state.finalCornerPieces.filter(Boolean).length === 1 ? "" : "s"} left · placement only`
      : initialCornerPhase()
      ? `Opening · top-corner pieces first · ${state.openingCornerPlacementsRemaining} placement${state.openingCornerPlacementsRemaining === 1 ? "" : "s"} remaining`
      : jumpCornerPiecesRemain()
        ? `Corner return · ${jumpCornerPieces().length} jumped piece${jumpCornerPieces().length === 1 ? "" : "s"} must be placed before normal play resumes`
        : `Main play · opponent hands you a reserve piece: place it, or move/jump a board piece of that colour.`;

    const placementAlert = document.getElementById("placement-alert");
    if (placementAlert) {
      const showPlacementAlert = state.openingPlacementTurnsRemaining > 0;
      placementAlert.hidden = !showPlacementAlert;
      placementAlert.replaceChildren();
      if (showPlacementAlert) {
        const label = document.createElement("span");
        label.textContent = `COMPULSORY PLACEMENT · ${state.openingPlacementTurnsRemaining} remaining `;
        placementAlert.appendChild(label);
        const corners = [0, 7, 56, 63];
        corners.slice(0, Math.min(2, state.openingPlacementTurnsRemaining)).forEach(cornerIndex => {
          const marker = document.createElement("span");
          marker.className = `piece piece--${state.reserveLayout.locked[cornerIndex]} placement-alert-piece`;
          marker.setAttribute("aria-hidden", "true");
          placementAlert.appendChild(marker);
        });
      }
    }

    const reservePanel = document.querySelector(".reserve-panel");
    if (reservePanel) {
      reservePanel.classList.toggle("reserve-panel--choosing", state.winner === null && state.choosingColour);
      reservePanel.classList.toggle("reserve-panel--assigned", state.winner === null && !state.choosingColour && !!state.assignedColour);
      reservePanel.classList.toggle("reserve-panel--replacement", state.winner === null && jumpCornerPiecesRemain());
      reservePanel.classList.toggle("reserve-panel--finished", state.winner !== null);
    }

    const humanChooser =
      state.winner === null &&
      state.choosingColour &&
      !computerBusy &&
      !isComputer(state.colourChooser);

    // Colour is always communicated by an actual physical reserve piece: the
    // chooser clicks the edge piece and it appears here as the piece "in hand".
    blackButton.disabled = true;
    whiteButton.disabled = true;

    const showAssigned =
      state.winner === null &&
      !state.choosingColour &&
      !!state.assignedColour;

    blackButton.classList.toggle(
      "reserve-button--assigned",
      showAssigned && state.assignedColour === "black"
    );
    whiteButton.classList.toggle(
      "reserve-button--assigned",
      showAssigned && state.assignedColour === "white"
    );
    blackButton.classList.toggle(
      "reserve-button--not-assigned",
      showAssigned && state.assignedColour !== "black"
    );
    whiteButton.classList.toggle(
      "reserve-button--not-assigned",
      showAssigned && state.assignedColour !== "white"
    );

    blackButton.classList.toggle(
      "reserve-button--returned",
      state.jumpCornerPieces.some(piece => piece?.colour === "black")
    );
    whiteButton.classList.toggle(
      "reserve-button--returned",
      state.jumpCornerPieces.some(piece => piece?.colour === "white")
    );

    undoButton.hidden = !settings.undo;
    undoButton.disabled = computerBusy || checkpoints.length === 0;

    jumpControls.hidden = !state.jumpInProgress;
    renderBoard();
  }


  function jumpToFinalFourTest() {
    clearTimeout(flowTimer);
    computerBusy = false;
    checkpoints = [];
    state = freshState();

    // Development helper: build a random 14/14, 28-piece position with no
    // existing win, then enter the real Final Four placement finish.
    const cells = [...Array(BOARD_CELLS).keys()];
    let attempts = 0;
    do {
      state.board = Array(BOARD_CELLS).fill(null);
      const occupied = shuffled(cells).slice(0, 28);
      const colours = shuffled([...Array(14).fill("black"), ...Array(14).fill("white")]);
      occupied.forEach((index, i) => { state.board[index] = { id: nextPieceId++, colour: colours[i] }; });
      attempts += 1;
    } while (rules.checkWin(state.board, settings) && attempts < 10000);

    if (rules.checkWin(state.board, settings)) {
      setStatus("Could not create a non-winning End test position. Try again.");
      render();
      return;
    }

    state.remaining = { black: 0, white: 0 };
    state.openingCornerPlacementsRemaining = 0;
    state.cornerTopRemaining = { black: 0, white: 0 };
    state.openingPlacementTurnsRemaining = 0;
    state.forcedPlacement = false;
    state.jumpCornerPieces = [null, null, null, null];
    state.assignedColour = null;
    state.choosingColour = true;
    state.colourChooser = state.currentPlayer;
    beginFinalFourIfReady();
    resetMoveTimer();
    processFlow();
  }

  function startNewGame() {
    clearTimeout(flowTimer);
    computerBusy = false;
    nextPieceId = 1;
    checkpoints = [];
    state = freshState();
    applyPieceColours();
    resetMoveTimer();

    if (settings.mode === "computer") {
      let starter = settings.starter;
      if (starter === "random") starter = Math.random() < 0.5 ? "player" : "computer";
      if(starter==="alternate"){const prev=localStorage.getItem("lipfty-last-starter")||"computer";starter=prev==="player"?"computer":"player";localStorage.setItem("lipfty-last-starter",starter);}
      state.currentPlayer = starter === "computer" ? 1 : 0;
      state.colourChooser = state.currentPlayer;
    } else {
      // In two-player mode Player 1 starts; during the four-piece opening
      // the current player chooses their own top-corner colour.
      state.currentPlayer = 0;
      state.colourChooser = state.currentPlayer;
    }

    processFlow();
  }

  blackButton.addEventListener("click", () => chooseColour("black"));
  whiteButton.addEventListener("click", () => chooseColour("white"));

  document.getElementById("new-game").addEventListener("click", startNewGame);
  document.getElementById("end-test").addEventListener("click", jumpToFinalFourTest);
  undoButton.addEventListener("click", undo);

  finishJumpButton.addEventListener("click", () => {
    if (computerBusy || !state.jumpInProgress || state.jumpPieceIndex === null) return;
    const piece = state.board[state.jumpPieceIndex];
    const movedPieceId = piece ? piece.id : null;
    state.jumpInProgress = false;
    state.jumpPieceIndex = null;
    state.jumpVisited = [];
    state.jumpPreviousIndex = null;
    clearSelection();
    jumpControls.hidden = true;
    finishTurn(movedPieceId, false, false, true);
  });

  // g10 move timer — Quarto-style display. Expiry does not force a move.
  let moveTimerInterval=null, moveTimerRemaining=30;
  function timerText(seconds){const m=Math.floor(seconds/60),sec=Math.max(0,seconds%60);return `${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;}
  function renderMoveTimer(){
    const el=document.getElementById("move-timer"); if(!el)return;
    if(!settings.timer){el.textContent="∞";el.classList.remove("move-timer--expired");return;}
    el.textContent=timerText(moveTimerRemaining);el.classList.toggle("move-timer--expired",moveTimerRemaining<=0);
  }
  function resetMoveTimer(){
    if(moveTimerInterval)clearInterval(moveTimerInterval);
    moveTimerRemaining=Number(settings.timer)||0;renderMoveTimer();
    if(!settings.timer)return;
    moveTimerInterval=setInterval(()=>{if(moveTimerRemaining>0){moveTimerRemaining-=1;renderMoveTimer();}else clearInterval(moveTimerInterval);},1000);
  }

  // Quarto-style four-page setup wizard
  const settingsDialog=document.getElementById("settings-dialog"),settingsForm=document.getElementById("settings-form");
  const wizardSteps=[...document.querySelectorAll("[data-wizard-step]")],wizardIndicators=[...document.querySelectorAll("[data-step-indicator]")];
  const wizardBack=document.getElementById("wizard-back"),wizardNext=document.getElementById("wizard-next"),wizardStart=document.getElementById("wizard-start"),difficultyInput=document.getElementById("difficulty-input"),difficultyField=document.getElementById("difficulty-field"),player1Input=document.getElementById("setting-player1"),player2Input=document.getElementById("setting-player2"),player2Label=document.getElementById("player2-label"); let wizardStep=0;
  const colourOptions=["red","blue","green","yellow","purple","orange","black","white"];
  function buildColours(id,name){const box=document.getElementById(id);colourOptions.forEach(k=>{const l=document.createElement("label");l.className="colour-choice";l.innerHTML=`<input type="radio" name="${name}" value="${k}"><span><i class="colour-swatch" style="background:${COLOURS[k][1]}"></i>${COLOURS[k][0]}</span>`;box.appendChild(l);});} buildColours("colour1-choices","colour1");buildColours("colour2-choices","colour2");
  function fv(n){return settingsForm.querySelector(`[name="${n}"]:checked`)?.value} function sr(n,v){const e=settingsForm.querySelector(`[name="${n}"][value="${v}"]`);if(e)e.checked=true}
  function syncMode(){const one=fv("gameMode")==="computer";difficultyField.hidden=!one;player2Label.hidden=one;document.getElementById("player1-label-text").textContent=one?"Player name":"Player 1 name";document.getElementById("starter-player-label").textContent=one?"Player":"Player 1";document.getElementById("starter-other-label").textContent=one?"Computer":"Player 2";}
  function syncDifficulty(){const n=Number(difficultyInput.value),names=["","Beginner","Standard","Expert"];document.getElementById("difficulty-name").textContent=`${n} · ${names[n]}`;}
  const ruleOptionIds=["allowJump","allowMove","allowDiagonal","allowSquare","allowSpacedSquare","allowDiamond","allowSpacedDiamond"];
  function syncRuleDependencies(){
    const square=document.getElementById("setting-allow-square").checked,diamond=document.getElementById("setting-allow-diamond").checked;
    document.getElementById("setting-allow-spaced-square").disabled=!square;
    document.getElementById("setting-allow-spaced-diamond").disabled=!diamond;
  }
  document.querySelectorAll("[data-rule-option]").forEach(e=>e.addEventListener("change",syncRuleDependencies));
  function showStep(n){wizardStep=Math.max(0,Math.min(3,n));wizardSteps.forEach((e,i)=>e.hidden=i!==wizardStep);wizardIndicators.forEach((e,i)=>{e.classList.toggle("wizard-progress-step--active",i===wizardStep);e.classList.toggle("wizard-progress-step--complete",i<wizardStep)});wizardBack.hidden=wizardStep===0;wizardNext.hidden=wizardStep===3;wizardStart.hidden=wizardStep!==3;if(wizardStep===3)summary();}
  function coloursValid(){return fv("colour1")!==fv("colour2")}
  function selectedRuleSummary(){const labels=[];document.querySelectorAll("[data-rule-option]:checked").forEach(e=>labels.push(e.dataset.ruleLabel));return labels.length?labels.join(", "):"Basic placement only";}
  function summary(){const one=fv("gameMode")==="computer",level=["","Beginner","Standard","Expert"][Number(difficultyInput.value)];document.getElementById("setup-summary").textContent=`${one?"Player vs Computer · "+level:"Two players"} · ${COLOURS[fv("colour1")][0]} / ${COLOURS[fv("colour2")][0]} · ${selectedRuleSummary()} · ${fv("timer")==="0"?"Unlimited":fv("timer")+"-second"} turns · stalemate draw`;}
  function openSettings(){sr("gameMode",settings.mode);difficultyInput.value=settings.level==="beginner"?1:settings.level==="expert"?3:2;sr("allowUndo",settings.undo?"yes":"no");sr("undoPreviousJump",settings.undoPreviousJump?"yes":"no");sr("colour1",settings.colour1);sr("colour2",settings.colour2);player1Input.value=settings.player1;player2Input.value=settings.player2;sr("starter",settings.starter);sr("timer",String(settings.timer));ruleOptionIds.forEach(k=>{document.getElementById(`setting-${k.replace(/[A-Z]/g,m=>"-"+m.toLowerCase())}`).checked=!!settings[k];});syncRuleDependencies();document.getElementById("setting-sound").checked=settings.sound;document.getElementById("setting-animations").checked=settings.animations;syncMode();syncDifficulty();showStep(0);settingsDialog.showModal();}
  settingsForm.querySelectorAll('[name="gameMode"]').forEach(e=>e.addEventListener("change",syncMode));difficultyInput.addEventListener("input",syncDifficulty);wizardNext.addEventListener("click",()=>{if(wizardStep===1&&!coloursValid()){setStatus("Choose two different piece colours.");return}showStep(wizardStep+1)});wizardBack.addEventListener("click",()=>showStep(wizardStep-1));document.getElementById("settings-button").addEventListener("click",openSettings);document.getElementById("close-settings").addEventListener("click",()=>settingsDialog.close());document.getElementById("cancel-settings").addEventListener("click",()=>settingsDialog.close());
  settingsForm.addEventListener("submit",e=>{e.preventDefault();if(!coloursValid()){showStep(1);return}const n=Number(difficultyInput.value),ruleSettings={};ruleOptionIds.forEach(k=>{ruleSettings[k]=document.getElementById(`setting-${k.replace(/[A-Z]/g,m=>"-"+m.toLowerCase())}`).checked;});if(!ruleSettings.allowSquare)ruleSettings.allowSpacedSquare=false;if(!ruleSettings.allowDiamond)ruleSettings.allowSpacedDiamond=false;settings={...settings,...ruleSettings,mode:fv("gameMode"),player1:player1Input.value.trim()||"Player",player2:player2Input.value.trim()||"Player 2",level:n===1?"beginner":n===3?"expert":"standard",starter:fv("starter"),undo:fv("allowUndo")==="yes",undoPreviousJump:fv("undoPreviousJump")==="yes",colour1:fv("colour1"),colour2:fv("colour2"),timer:Number(fv("timer")),sound:document.getElementById("setting-sound").checked,animations:document.getElementById("setting-animations").checked,language:document.getElementById("setting-language").value};saveSettings();settingsDialog.close();startNewGame();});
  const statisticsDialog=document.getElementById("statistics-dialog");document.getElementById("view-statistics-button").addEventListener("click",()=>statisticsDialog.showModal());document.getElementById("close-statistics").addEventListener("click",()=>statisticsDialog.close());

  // Help
  const helpDialog = document.getElementById("help-dialog");
  document.getElementById("help-button").addEventListener("click", () => helpDialog.showModal());
  document.getElementById("close-help").addEventListener("click", () => helpDialog.close());

  let pendingUpdateRegistration = null;

  function gameIsInProgress() {
    if (!state || state.winner !== null) return false;
    return state.board.some(Boolean) || jumpCornerPiecesRemain() || state.jumpInProgress;
  }

  function maybeShowUpdateDialog() {
    const registration = pendingUpdateRegistration;
    const dialog = document.getElementById("pwa-update-dialog");
    if (!registration?.waiting || !dialog || dialog.open || gameIsInProgress()) return;

    const laterButton = document.getElementById("pwa-update-later");
    const updateButton = document.getElementById("pwa-update-button");
    const closeDialog = () => { if (dialog.open) dialog.close(); };

    laterButton.onclick = closeDialog;
    updateButton.onclick = () => {
      updateButton.disabled = true;
      updateButton.textContent = "Updating…";
      registration.waiting?.postMessage({ type: "SKIP_WAITING" });
    };
    dialog.oncancel = event => {
      event.preventDefault();
      closeDialog();
    };
    dialog.showModal();
  }

  function queueUpdate(registration) {
    if (!registration.waiting) return;
    pendingUpdateRegistration = registration;
    maybeShowUpdateDialog();
  }

  async function registerPwa() {
    if (!("serviceWorker" in navigator)) return;
    try {
      const registration = await navigator.serviceWorker.register("service-worker.js", { scope: "./" });

      // Pick up an update that finished downloading while Lipfty was closed.
      if (registration.waiting) queueUpdate(registration);

      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            queueUpdate(registration);
          }
        });
      });

      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!refreshing) {
          refreshing = true;
          location.reload();
        }
      });
    } catch (error) {
      console.warn("Lipfty service worker registration failed", error);
    }
  }

  fetch("./build-info.json", { cache: "no-store" })
    .then(response => response.ok ? response.json() : null)
    .then(info => {
      if (info && info.version) {
        document.getElementById("app-version").textContent = `Version ${info.version}`;
        if (mobileVersionElement) mobileVersionElement.textContent = `v${info.version}`;
        const ref=info.commit || info.gitCommit || info.git || info.hash || info.commitHash || "";
        document.getElementById("build-reference").textContent = ref ? ` · ${String(ref).slice(0,7)}` : "";
      }
    })
    .catch(() => {});

  startNewGame();
  registerPwa();
})();
