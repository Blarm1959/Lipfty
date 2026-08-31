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
  const cancelButton = document.getElementById("cancel-action");
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
      language: "en-GB", colour1: "red", colour2: "blue", timer: 30, sound: true, animations: true, undoPreviousJump: false, endgameDrawLimit: 12
    };
    try {
      return { ...defaults, ...JSON.parse(localStorage.getItem("lipfty-settings") || "{}") };
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

  // Once all 28 pieces have first reached the board, the game remains in the
  // end-game phase even while a jumped piece is temporarily back on a stack.
  function openingPiecesRemain() {
    return !state.endgameStarted && piecesRemain();
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

      // During the opening, the opponent chooses a colour for currentPlayer.
      choosingColour: true,
      colourChooser: 1,
      assignedColour: null,

      // A Stage-1 move/jump must be followed by two placement turns:
      // first by the opponent, then by the player who moved/jumped.
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
      endgameStarted: false,
      endgameTurns: 0,
      pendingReplacement: null,
      replacementForbiddenIndex: null,
      jumpRemovalDone: false,
      // After a forced replacement, this player gets one turn in which jumps
      // are legal but cannot remove another piece.
      jumpRemovalBlockedPlayer: null,
      jumpFlashIndex: null,
      returnedPieceColour: null,

      winner: null,
      winningCells: []
    };
  }

  function serialiseState() {
    return {
      ...state,
      board: state.board.map(piece => piece ? { ...piece } : null),
      remaining: { ...state.remaining },
      legalMoves: [],
      legalJumps: [],
      selectedPieceIndex: null,
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
  function applyPieceColours(){document.documentElement.style.setProperty("--piece-black",COLOURS[settings.colour1][1]);document.documentElement.style.setProperty("--piece-white",COLOURS[settings.colour2][1]);}

  function canUseColour(colour) {
    if (!openingPiecesRemain()) return false;

    if (state.forcedPlacement) {
      return state.remaining[colour] > 0 && state.board.some(cell => !cell);
    }

    if (state.remaining[colour] > 0 && state.board.some(cell => !cell)) return true;

    for (let from = 0; from < BOARD_CELLS; from += 1) {
      const piece = state.board[from];
      if (!piece || piece.colour !== colour) continue;
      if (piece.id === state.opponentProtectedPieceId) continue;
      if (rules.adjacentDestinations(state.board, from).length) return true;
      if (rules.jumpDestinations(state.board, from).length) return true;
    }

    return false;
  }

  function colourPrompt() {
    const chooser = participantName(state.colourChooser);
    const receiver = participantName(state.currentPlayer);
    return `${chooser}: choose ${colourTitle("black")} or ${colourTitle("white")} for ${receiver}.`;
  }

  function actionPrompt() {
    const actor = participantName(state.currentPlayer);
    if (!openingPiecesRemain()) return `${actor}: move or jump any piece.`;
    if (state.forcedPlacement) {
      const remaining = state.openingPlacementTurnsRemaining;
      return `${actor}: compulsory placement — place ${colourTitle(state.assignedColour)}. ${remaining} placement turn${remaining === 1 ? "" : "s"} remain${remaining === 1 ? "s" : ""} before moving/jumping is allowed again.`;
    }
    return `${actor}: use ${colourTitle(state.assignedColour)} — place, move or jump.`;
  }

  function processFlow(message = null) {
    clearTimeout(flowTimer);

    if (state.winner !== null) {
      render();
      return;
    }

    // If pieces remain off the board in only one colour, that colour is automatic.
    // This is especially important for the final opening piece: the other colour
    // must not remain selectable merely because one of its pieces can move/jump.
    if (state.choosingColour && openingPiecesRemain()) {
      const stackColours = ["black", "white"].filter(colour => state.remaining[colour] > 0);
      const legalColours = ["black", "white"].filter(canUseColour);
      const automaticColour = stackColours.length === 1 ? stackColours[0] :
        (legalColours.length === 1 ? legalColours[0] : null);
      if (automaticColour) {
        state.assignedColour = automaticColour;
        state.choosingColour = false;
        clearSelection();
        message = `${colourTitle(automaticColour)} is the only colour remaining, so it is selected automatically.`;
      }
    }

    if (message) setStatus(message);
    else if (state.jumpInProgress) setStatus("Jump again with the same piece, or finish your turn.");
    else if (state.pendingReplacement) setStatus(`Replace the ${colourTitle(state.pendingReplacement.colour)} piece on an empty square, but not where it was removed.`);
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
      flowTimer = setTimeout((state.pendingReplacement && !state.jumpInProgress) ? computerReplacePiece : computerPlayTurn, 450);
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
    const win = rules.checkWin(state.board);
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

  function finishTurn(movedPieceId, actionWasMove) {
    if (checkAndFinishWin(movedPieceId)) return;
    const finishingPlayer = state.currentPlayer;

    if (state.endgameStarted) {
      state.endgameTurns += 1;
      const drawLimit = Number(settings.endgameDrawLimit) || 12;
      if (state.endgameTurns >= drawLimit) {
        state.winner = "draw";
        computerBusy = false;
        if (moveTimerInterval) { clearInterval(moveTimerInterval); moveTimerInterval = null; }
        state.winningCells = [];
        clearSelection();
        jumpControls.hidden = true;
        setStatus(`Draw — ${drawLimit} end-game turns completed.`);
        render();
        maybeShowUpdateDialog();
        return;
      }
    } else if (!piecesRemain()) {
      state.endgameStarted = true;
      state.endgameTurns = 0;
    }

    if (state.jumpRemovalBlockedPlayer === finishingPlayer) {
      state.jumpRemovalBlockedPlayer = null;
    }

    state.opponentProtectedPieceId = movedPieceId || null;
    state.currentPlayer = otherPlayer(finishingPlayer);
    state.assignedColour = null;
    clearSelection();
    state.jumpInProgress = false;
    state.jumpPieceIndex = null;
    state.jumpVisited = [];
    state.jumpPreviousIndex = null;
    // The jump turn is now completely closed before replacement can begin.
    // pendingReplacement deliberately survives this cleanup and belongs to
    // the opponent's new forced-placement turn.
    state.jumpRemovalDone = false;
    jumpControls.hidden = true;

    if (state.pendingReplacement) {
      state.forcedPlacement = true;
      state.choosingColour = false;
      state.colourChooser = null;
    } else if (openingPiecesRemain()) {
      if (actionWasMove) {
        state.openingPlacementTurnsRemaining = 2;
      } else if (state.openingPlacementTurnsRemaining > 0) {
        state.openingPlacementTurnsRemaining -= 1;
      }
      state.forcedPlacement = state.openingPlacementTurnsRemaining > 0;
      state.choosingColour = true;
      state.colourChooser = finishingPlayer;
    } else {
      state.openingPlacementTurnsRemaining = 0;
      state.forcedPlacement = false;
      state.choosingColour = false;
      state.colourChooser = null;
    }
    resetMoveTimer();
    processFlow();
  }

  function replaceJumpedPiece(index) {
    if (state.jumpInProgress || !state.pendingReplacement || state.board[index] || index === state.replacementForbiddenIndex) return false;
    const replacement = state.pendingReplacement;
    state.board[index] = replacement;
    state.remaining[replacement.colour] = Math.max(0, state.remaining[replacement.colour] - 1);
    state.pendingReplacement = null;
    state.replacementForbiddenIndex = null;
    state.returnedPieceColour = null;
    state.forcedPlacement = false;
    // The opponent (the player who caused the removal) now gets one normal
    // turn where jumping is allowed but cannot remove another piece.
    state.jumpRemovalBlockedPlayer = otherPlayer(state.currentPlayer);
    clearSelection();
    finishTurn(null, false);
    return true;
  }

  function placePiece(index) {
    if (computerBusy || state.choosingColour || !openingPiecesRemain()) return;
    const colour = state.assignedColour;
    if (!colour || state.remaining[colour] <= 0 || state.board[index]) return;

    state.board[index] = { id: nextPieceId++, colour };
    state.remaining[colour] -= 1;
    clearSelection();
    finishTurn(null, false);
  }

  function selectPiece(index) {
    if (computerBusy || state.winner !== null || state.choosingColour || state.forcedPlacement) return;

    const piece = state.board[index];
    if (!piece) return;

    if (state.jumpInProgress && index !== state.jumpPieceIndex) return;

    if (!state.jumpInProgress && piece.id === state.opponentProtectedPieceId) {
      setStatus("You cannot move the piece your opponent moved on their previous turn.");
      render();
      return;
    }

    if (openingPiecesRemain() && state.assignedColour && piece.colour !== state.assignedColour) {
      setStatus(`You must use ${colourTitle(state.assignedColour)} this turn.`);
      render();
      return;
    }

    state.selectedPieceIndex = index;
    state.legalMoves = new Set(
      state.jumpInProgress ? [] : rules.adjacentDestinations(state.board, index)
    );
    state.legalJumps = new Map(
      legalJumpContinuations(index).map(jump => [jump.to, jump])
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

  function legalJumpContinuations(from) {
    const jumps = rules.jumpDestinations(state.board, from);
    if (!state.jumpInProgress) return jumps;
    const visited = new Set(state.jumpVisited || []);
    return jumps.filter(jump => {
      // Optional immediate reversal only. Any older visited square remains illegal.
      if (settings.undoPreviousJump && jump.to === state.jumpPreviousIndex) return true;
      return !visited.has(jump.to);
    });
  }

  function humanMovePiece(from, to, jump = null, afterFlash = false) {
    const piece = state.board[from];
    if (!piece || state.board[to]) return;

    if (jump && state.endgameStarted && state.jumpRemovalBlockedPlayer !== state.currentPlayer &&
        !state.jumpRemovalDone && !state.pendingReplacement &&
        state.board[jump.over] && !afterFlash) {
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

    if (jump && state.endgameStarted && state.jumpRemovalBlockedPlayer !== state.currentPlayer &&
        !state.jumpRemovalDone && !state.pendingReplacement) {
      if (state.board[jump.over]) {
        state.pendingReplacement = state.board[jump.over];
        state.replacementForbiddenIndex = jump.over;
        state.returnedPieceColour = state.pendingReplacement.colour;
        state.remaining[state.pendingReplacement.colour] += 1;
        state.board[jump.over] = null;
        state.jumpRemovalDone = true;
      }
    }

    if (checkAndFinishWin(piece.id)) return;

    if (!jump) {
      clearSelection();
      finishTurn(piece.id, true);
      return;
    }

    if (!state.jumpInProgress) state.jumpVisited = [from];
    if (!state.jumpVisited.includes(to)) state.jumpVisited.push(to);
    state.jumpPreviousIndex = from;
    state.jumpInProgress = true;
    state.jumpPieceIndex = to;
    state.legalMoves.clear();
    state.legalJumps = new Map(
      legalJumpContinuations(to).map(jump => [jump.to, jump])
    );

    if (state.legalJumps.size === 0) {
      state.jumpInProgress = false;
      state.jumpPieceIndex = null;
      state.jumpVisited = [];
      state.jumpPreviousIndex = null;
      clearSelection();
      jumpControls.hidden = true;
      finishTurn(piece.id, true);
      return;
    }

    jumpControls.hidden = false;
    processFlow();
  }

  function handleCell(index) {
    if (computerBusy || state.jumpFlashIndex !== null || isComputer(state.currentPlayer) || state.winner !== null || state.choosingColour) return;

    const piece = state.board[index];

    if (!piece && state.selectedPieceIndex === null && state.pendingReplacement) {
      if (index === state.replacementForbiddenIndex) {
        setStatus("That piece cannot be replaced on the square it was removed from.");
        render();
        return;
      }
      replaceJumpedPiece(index);
      return;
    }

    // With no piece selected, an empty square means "place" during the opening.
    if (!piece && state.selectedPieceIndex === null && openingPiecesRemain() &&
        state.assignedColour && state.remaining[state.assignedColour] > 0) {
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

    if (openingPiecesRemain() && colour && state.remaining[colour] > 0) {
      for (let to = 0; to < BOARD_CELLS; to += 1) {
        if (!state.board[to]) actions.push({ type: "place", to, colour });
      }
    }

    if (mustPlace) return actions;

    for (let from = 0; from < BOARD_CELLS; from += 1) {
      const piece = state.board[from];
      if (!piece) continue;
      if (colour && piece.colour !== colour) continue;
      if (piece.id === state.opponentProtectedPieceId) continue;

      for (const to of rules.adjacentDestinations(state.board, from)) {
        actions.push({ type: "move", from, to });
      }
      for (const jump of rules.jumpDestinations(state.board, from)) {
        actions.push({ type: "jump", from, to: jump.to, over: jump.over });
      }
    }

    return actions;
  }

  function boardAfterAction(action) {
    const board = cloneBoard(state.board);
    if (action.type === "place") {
      board[action.to] = { id: -1, colour: action.colour };
    } else {
      board[action.to] = board[action.from];
      board[action.from] = null;
      if (action.type === "jump" && state.endgameStarted && action.over !== undefined) {
        board[action.over] = null;
      }
    }
    return board;
  }

  function actionWins(action) {
    return !!rules.checkWin(boardAfterAction(action));
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
      const movedColour = action.type === "place"
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

    const legalColours = ["black", "white"].filter(canUseColour);
    if (!legalColours.length) {
      computerBusy = false;
      setStatus("No colour can be given. Start a new game.");
      render();
      return;
    }

    // Prefer not to give the opponent an immediate winning placement.
    const safeColours = legalColours.filter(colour => {
      if (state.remaining[colour] <= 0) return true;
      for (let to = 0; to < BOARD_CELLS; to += 1) {
        if (state.board[to]) continue;
        const board = cloneBoard(state.board);
        board[to] = { id: -1, colour };
        if (rules.checkWin(board)) return false;
      }
      return true;
    });

    const pool = safeColours.length ? safeColours : legalColours;
    const colour = pool[Math.floor(Math.random() * pool.length)];

    flowTimer = setTimeout(() => {
      computerBusy = false;
      state.assignedColour = colour;
      state.choosingColour = false;
      processFlow(`Computer gives ${participantName(state.currentPlayer)} ${colourTitle(colour)}.`);
    }, 250);
  }

  function computerReplacePiece() {
    if (!state.pendingReplacement || !isComputer(state.currentPlayer)) return;
    computerBusy = true;
    setStatus("Computer is replacing the jumped piece…");
    render();
    const options = [];
    for (let i=0;i<BOARD_CELLS;i+=1) if (!state.board[i] && i !== state.replacementForbiddenIndex) options.push(i);
    if (!options.length) { computerBusy=false; setStatus("No legal replacement square."); render(); return; }
    let best = options[0];
    for (const i of options) {
      const b=cloneBoard(state.board); b[i]=state.pendingReplacement;
      if (rules.checkWin(b)) { best=i; break; }
    }
    flowTimer=setTimeout(()=>{computerBusy=false;replaceJumpedPiece(best);},300);
  }

  function computerPlayTurn() {
    if (state.winner !== null || state.choosingColour || !isComputer(state.currentPlayer)) return;

    computerBusy = true;
    setStatus("Computer is thinking…");
    render();

    const colour = openingPiecesRemain() ? state.assignedColour : null;
    const actions = enumerateActions(colour, state.forcedPlacement);
    const action = pickComputerAction(actions);

    if (!action) {
      computerBusy = false;
      setStatus("Computer has no legal action.");
      render();
      return;
    }

    flowTimer = setTimeout(() => {
      if (action.type === "place") {
        state.board[action.to] = { id: nextPieceId++, colour: action.colour };
        state.remaining[action.colour] -= 1;
        computerBusy = false;
        finishTurn(null, false);
        return;
      }

      const piece = state.board[action.from];
      const firstJumpOver = action.type === "jump" ? action.over : null;
      if (action.type === "jump" && state.endgameStarted &&
          state.jumpRemovalBlockedPlayer !== state.currentPlayer &&
          firstJumpOver !== null && state.board[firstJumpOver] && state.jumpFlashIndex === null) {
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
      if (action.type === "jump" && state.endgameStarted &&
          state.jumpRemovalBlockedPlayer !== state.currentPlayer &&
          firstJumpOver !== null && state.board[firstJumpOver]) {
        state.pendingReplacement = state.board[firstJumpOver];
        state.replacementForbiddenIndex = firstJumpOver;
        state.returnedPieceColour = state.pendingReplacement.colour;
        state.remaining[state.pendingReplacement.colour] += 1;
        state.board[firstJumpOver] = null;
        state.jumpRemovalDone = true;
      }

      if (checkAndFinishWin(piece.id)) {
        computerBusy = false;
        return;
      }

      if (action.type === "jump") {
        // A computer may continue a multi-jump. It always takes an immediate
        // winning continuation; otherwise Standard/Expert may make one extra
        // useful jump, capped to avoid loops.
        let current = action.to;
        const visited = new Set([action.from, action.to]);
        let jumpCount = 1;

        while (jumpCount < 6) {
          const options = rules.jumpDestinations(state.board, current)
            .filter(j => !visited.has(j.to));
          if (!options.length) break;

          let next = null;
          const winningOption = options.find(j => {
            const b = cloneBoard(state.board);
            b[j.to] = b[current];
            b[current] = null;
            return !!rules.checkWin(b);
          });

          if (winningOption) next = winningOption;
          else if (settings.level !== "beginner" && jumpCount === 1) {
            next = options[Math.floor(Math.random() * options.length)];
          }

          if (!next) break;

          state.board[next.to] = state.board[current];
          state.board[current] = null;
          current = next.to;
          visited.add(current);
          jumpCount += 1;

          if (checkAndFinishWin(piece.id)) {
            computerBusy = false;
            return;
          }
        }
      }

      computerBusy = false;
      finishTurn(piece.id, true);
  }

  function renderBoard() {
    boardElement.replaceChildren();
    const winning = new Set(state.winningCells);
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
        const activeTarget = activeColour
          ? (corner ? Math.min(2, state.remaining[activeColour]) : Math.max(0, state.remaining[activeColour] - 2))
          : 0;
        const activeCounter = corner ? reserveShown.corner : reserveShown.other;
        const activeReservePiece = !!activeColour && activeCounter[activeColour] < activeTarget;

        if (corner && lockedColour) {
          cell.classList.add("board-cell--locked-corner");
          const lockedDisc = document.createElement("span");
          lockedDisc.className = `piece piece--${lockedColour} piece--locked-corner`;
          lockedDisc.setAttribute("aria-hidden", "true");
          cell.appendChild(lockedDisc);
        }

        if (activeReservePiece) {
          const disc = document.createElement("span");
          disc.className = `piece piece--${activeColour}${corner ? " piece--corner-top" : ""}`;
          disc.setAttribute("aria-hidden", "true");
          cell.appendChild(disc);
          activeCounter[activeColour] += 1;
        } else if (!corner) {
          cell.classList.add("board-cell--reserve-empty");
        }

        cell.setAttribute("aria-label",
          corner
            ? `${activeReservePiece ? `${colourTitle(activeColour)} playable reserve piece above ` : ""}${colourTitle(lockedColour)} locked boundary piece`
            : `${activeReservePiece ? `${colourTitle(activeColour)} reserve piece` : "Empty reserve square"}`
        );
        cell.disabled = true;
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
      if (state.pendingReplacement && index === state.replacementForbiddenIndex && !state.board[index]) {
        cell.classList.add("board-cell--replacement-forbidden");
      }

      if (!computerBusy && !state.choosingColour && !isComputer(state.currentPlayer) &&
          state.pendingReplacement && !state.board[index] && index !== state.replacementForbiddenIndex) {
        cell.classList.add("board-cell--place");
      } else if (!computerBusy && !state.choosingColour && !isComputer(state.currentPlayer) &&
          openingPiecesRemain() && state.assignedColour && !state.board[index] &&
          state.remaining[state.assignedColour] > 0 && state.selectedPieceIndex === null) {
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
    if (reserveHeading) {
      reserveHeading.textContent = state.choosingColour ? "Choose opponent's colour" : "Colour to use";
    }

    currentPlayerElement.textContent = state.winner === "draw"
      ? "Draw"
      : state.winner !== null ? `${participantName(state.winner)} wins` : participantName(state.currentPlayer);

    blackRemainingElement.textContent = `${state.remaining.black} remaining`;
    document.getElementById("colour1-name").textContent = COLOURS[settings.colour1][0];
    whiteRemainingElement.textContent = `${state.remaining.white} remaining`;
    document.getElementById("colour2-name").textContent = COLOURS[settings.colour2][0];

    const phaseHelp=document.getElementById("phase-help");
    if(phaseHelp) phaseHelp.textContent=state.endgameStarted
      ? `End game · ${state.endgameTurns} / ${Number(settings.endgameDrawLimit) || 12} turns${state.pendingReplacement ? " · jumped piece must be replaced" : ""}${state.jumpRemovalBlockedPlayer === state.currentPlayer ? " · no removal this turn" : ""}`
      : "Stage 1 · use the colour given: place, move or jump.";

    const placementAlert = document.getElementById("placement-alert");
    if (placementAlert) {
      const showPlacementAlert = !state.endgameStarted && state.openingPlacementTurnsRemaining > 0;
      placementAlert.hidden = !showPlacementAlert;
      placementAlert.textContent = showPlacementAlert
        ? `COMPULSORY PLACEMENT · ${state.openingPlacementTurnsRemaining} placement turn${state.openingPlacementTurnsRemaining === 1 ? "" : "s"} remaining`
        : "";
    }

    const reservePanel = document.querySelector(".reserve-panel");
    if (reservePanel) {
      reservePanel.classList.toggle("reserve-panel--choosing", state.winner === null && state.choosingColour);
      reservePanel.classList.toggle("reserve-panel--assigned", state.winner === null && !state.choosingColour && openingPiecesRemain() && !!state.assignedColour);
      reservePanel.classList.toggle("reserve-panel--replacement", state.winner === null && !!state.pendingReplacement);
      reservePanel.classList.toggle("reserve-panel--finished", state.winner !== null || (!openingPiecesRemain() && !state.pendingReplacement));
    }

    const humanChooser =
      state.winner === null &&
      state.choosingColour &&
      !computerBusy &&
      !isComputer(state.colourChooser);

    blackButton.disabled = !humanChooser || !canUseColour("black");
    whiteButton.disabled = !humanChooser || !canUseColour("white");

    const showAssigned =
      state.winner === null &&
      !state.choosingColour &&
      openingPiecesRemain() &&
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
      !!state.pendingReplacement && state.returnedPieceColour === "black"
    );
    whiteButton.classList.toggle(
      "reserve-button--returned",
      !!state.pendingReplacement && state.returnedPieceColour === "white"
    );

    cancelButton.disabled =
      computerBusy ||
      state.jumpInProgress ||
      state.selectedPieceIndex === null;

    undoButton.hidden = !settings.undo;
    undoButton.disabled = computerBusy || checkpoints.length === 0;

    jumpControls.hidden = !state.jumpInProgress;
    renderBoard();
  }

  function hasImmediateStage2Win(board) {
    for (let from = 0; from < BOARD_CELLS; from += 1) {
      const piece = board[from];
      if (!piece) continue;

      for (const to of rules.adjacentDestinations(board, from)) {
        const next = board.slice();
        next[to] = piece;
        next[from] = null;
        if (rules.checkWin(next)) return true;
      }

      for (const jump of rules.jumpDestinations(board, from)) {
        const next = board.slice();
        next[jump.to] = piece;
        next[from] = null;
        next[jump.over] = null;
        if (rules.checkWin(next)) return true;
      }
    }
    return false;
  }

  // g26 temporary Stage-2 testing shortcut.
  // It only creates the starting position; play then uses the normal game engine.
  function startRandomStage2Test() {
    clearTimeout(flowTimer);
    computerBusy = false;
    checkpoints = [];
    nextPieceId = TOTAL_PIECES + 1;

    let candidate = null;
    let fallback = null;
    for (let attempt = 0; attempt < 20000 && !candidate; attempt += 1) {
      const cells = Array.from({ length: BOARD_CELLS }, (_, i) => i);
      for (let i = cells.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [cells[i], cells[j]] = [cells[j], cells[i]];
      }
      const colours = [
        ...Array(PIECES_PER_COLOUR).fill("black"),
        ...Array(PIECES_PER_COLOUR).fill("white")
      ];
      for (let i = colours.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [colours[i], colours[j]] = [colours[j], colours[i]];
      }

      const board = Array(BOARD_CELLS).fill(null);
      for (let i = 0; i < TOTAL_PIECES; i += 1) {
        board[cells[i]] = { id: i + 1, colour: colours[i] };
      }

      if (rules.checkWin(board)) continue;

      const playerToMove = Math.random() < 0.5 ? 0 : 1;
      fallback = fallback || { board, playerToMove };
      if (!hasImmediateStage2Win(board)) {
        candidate = { board, playerToMove };
      }
    }

    // A dense 28-on-36 position can make the strict no-one-move-win filter
    // exceptionally hard to satisfy. The test shortcut must still work:
    // prefer the protected position, otherwise use a valid non-winning board.
    candidate = candidate || fallback;

    if (!candidate) {
      setStatus("Could not create a valid Stage 2 test board.");
      return;
    }

    state = freshState();
    state.board = candidate.board;
    state.remaining = { black: 0, white: 0 };
    state.endgameStarted = true;
    state.endgameTurns = 0;
    state.currentPlayer = candidate.playerToMove;
    state.choosingColour = false;
    state.colourChooser = otherPlayer(state.currentPlayer);
    state.assignedColour = null;
    state.forcedPlacement = false;
    state.pendingReplacement = null;
    state.replacementForbiddenIndex = null;
    state.jumpRemovalDone = false;
    state.jumpRemovalBlockedPlayer = null;
    state.returnedPieceColour = null;
    state.opponentProtectedPieceId = null;
    state.winner = null;
    state.winningCells = [];

    clearSelection();
    applyPieceColours();
    resetMoveTimer();
    processFlow(`${participantName(state.currentPlayer)} starts the random Stage 2 test.`);
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
      state.colourChooser = otherPlayer(state.currentPlayer);
    } else {
      // In two-player mode Player 1 starts; Player 2 gives the first colour.
      state.currentPlayer = 0;
      state.colourChooser = 1;
    }

    processFlow();
  }

  blackButton.addEventListener("click", () => chooseColour("black"));
  whiteButton.addEventListener("click", () => chooseColour("white"));

  cancelButton.addEventListener("click", () => {
    if (computerBusy || state.jumpInProgress) return;
    clearSelection();
    processFlow();
  });

  document.getElementById("new-game").addEventListener("click", startNewGame);
  document.getElementById("stage2-test-button").addEventListener("click", startRandomStage2Test);
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
    finishTurn(movedPieceId, true);
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
  function showStep(n){wizardStep=Math.max(0,Math.min(3,n));wizardSteps.forEach((e,i)=>e.hidden=i!==wizardStep);wizardIndicators.forEach((e,i)=>{e.classList.toggle("wizard-progress-step--active",i===wizardStep);e.classList.toggle("wizard-progress-step--complete",i<wizardStep)});wizardBack.hidden=wizardStep===0;wizardNext.hidden=wizardStep===3;wizardStart.hidden=wizardStep!==3;if(wizardStep===3)summary();}
  function coloursValid(){return fv("colour1")!==fv("colour2")}
  function summary(){const one=fv("gameMode")==="computer",level=["","Beginner","Standard","Expert"][Number(difficultyInput.value)];document.getElementById("setup-summary").textContent=`${one?"Player vs Computer · "+level:"Two players"} · ${COLOURS[fv("colour1")][0]} / ${COLOURS[fv("colour2")][0]} · four-line / square wins · ${fv("timer")==="0"?"Unlimited":fv("timer")+"-second"} turns · draw after ${fv("endgameDrawLimit") || "12"} end-game turns`;}
  function openSettings(){sr("gameMode",settings.mode);difficultyInput.value=settings.level==="beginner"?1:settings.level==="expert"?3:2;sr("allowUndo",settings.undo?"yes":"no");sr("undoPreviousJump",settings.undoPreviousJump?"yes":"no");sr("colour1",settings.colour1);sr("colour2",settings.colour2);player1Input.value=settings.player1;player2Input.value=settings.player2;sr("starter",settings.starter);sr("timer",String(settings.timer));sr("endgameDrawLimit",String(settings.endgameDrawLimit || 12));document.getElementById("setting-sound").checked=settings.sound;document.getElementById("setting-animations").checked=settings.animations;syncMode();syncDifficulty();showStep(0);settingsDialog.showModal();}
  settingsForm.querySelectorAll('[name="gameMode"]').forEach(e=>e.addEventListener("change",syncMode));difficultyInput.addEventListener("input",syncDifficulty);wizardNext.addEventListener("click",()=>{if(wizardStep===1&&!coloursValid()){setStatus("Choose two different piece colours.");return}showStep(wizardStep+1)});wizardBack.addEventListener("click",()=>showStep(wizardStep-1));document.getElementById("settings-button").addEventListener("click",openSettings);document.getElementById("close-settings").addEventListener("click",()=>settingsDialog.close());document.getElementById("cancel-settings").addEventListener("click",()=>settingsDialog.close());
  settingsForm.addEventListener("submit",e=>{e.preventDefault();if(!coloursValid()){showStep(1);return}const n=Number(difficultyInput.value);settings={...settings,mode:fv("gameMode"),player1:player1Input.value.trim()||"Player",player2:player2Input.value.trim()||"Player 2",level:n===1?"beginner":n===3?"expert":"standard",starter:fv("starter"),undo:fv("allowUndo")==="yes",undoPreviousJump:fv("undoPreviousJump")==="yes",colour1:fv("colour1"),colour2:fv("colour2"),timer:Number(fv("timer")),endgameDrawLimit:Number(fv("endgameDrawLimit") || 12),sound:document.getElementById("setting-sound").checked,animations:document.getElementById("setting-animations").checked,language:document.getElementById("setting-language").value};saveSettings();settingsDialog.close();startNewGame();});
  const statisticsDialog=document.getElementById("statistics-dialog");document.getElementById("view-statistics-button").addEventListener("click",()=>statisticsDialog.showModal());document.getElementById("close-statistics").addEventListener("click",()=>statisticsDialog.close());

  // Help
  const helpDialog = document.getElementById("help-dialog");
  document.getElementById("help-button").addEventListener("click", () => helpDialog.showModal());
  document.getElementById("close-help").addEventListener("click", () => helpDialog.close());

  let pendingUpdateRegistration = null;

  function gameIsInProgress() {
    if (!state || state.winner !== null) return false;
    return state.board.some(Boolean) || state.endgameStarted || !!state.pendingReplacement || state.jumpInProgress;
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
