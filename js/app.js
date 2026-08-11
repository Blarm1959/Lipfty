(function () {
  "use strict";

  const rules = window.LipftyRules;

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
      language: "en-GB", colour1: "red", colour2: "blue", allow2x2: false, allowCorners: false, timer: 30, sound: true, animations: true, undoPreviousJump: false
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

  function freshState() {
    return {
      board: Array(16).fill(null),
      remaining: { black: 6, white: 6 },
      currentPlayer: 0,

      // During the opening, the opponent chooses a colour for currentPlayer.
      choosingColour: true,
      colourChooser: 1,
      assignedColour: null,

      // If the previous player moved/jumped instead of placing, currentPlayer
      // must place the colour they are given.
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
    if (!piecesRemain()) return false;

    if (state.forcedPlacement) {
      return state.remaining[colour] > 0 && state.board.some(cell => !cell);
    }

    if (state.remaining[colour] > 0 && state.board.some(cell => !cell)) return true;

    for (let from = 0; from < 16; from += 1) {
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
    if (!piecesRemain()) return `${actor}: move or jump any piece.`;
    if (state.forcedPlacement) {
      return `${actor}: place the ${colourTitle(state.assignedColour)} piece you were given.`;
    }
    return `${actor}: use ${colourTitle(state.assignedColour)} — place, move or jump.`;
  }

  function processFlow(message = null) {
    clearTimeout(flowTimer);

    if (state.winner !== null) {
      render();
      return;
    }

    if (message) setStatus(message);
    else if (state.pendingReplacement) setStatus(`Replace the ${colourTitle(state.pendingReplacement.colour)} piece on an empty square, but not where it was removed.`);
    else if (state.jumpInProgress) setStatus("Jump again with the same piece, or finish your turn.");
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
      flowTimer = setTimeout(state.pendingReplacement ? computerReplacePiece : computerPlayTurn, 450);
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
    const win = rules.checkWin(state.board,{allow2x2:settings.allow2x2,allowCorners:settings.allowCorners});
    if (!win) return false;

    state.winner = state.currentPlayer;
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
    return true;
  }

  function finishTurn(movedPieceId, actionWasMove) {
    if (checkAndFinishWin(movedPieceId)) return;
    const finishingPlayer = state.currentPlayer;

    if (state.endgameStarted) {
      state.endgameTurns += 1;
      if (state.endgameTurns >= 24) {
        state.winner = "draw";
        state.winningCells = [];
        clearSelection();
        jumpControls.hidden = true;
        setStatus("Draw — 24 end-game turns completed.");
        render();
        return;
      }
    } else if (!piecesRemain()) {
      state.endgameStarted = true;
      state.endgameTurns = 0;
    }

    state.opponentProtectedPieceId = movedPieceId || null;
    state.currentPlayer = otherPlayer(finishingPlayer);
    state.assignedColour = null;
    clearSelection();
    state.jumpInProgress = false;
    state.jumpPieceIndex = null;
    state.jumpVisited = [];
    state.jumpPreviousIndex = null;
    state.jumpRemovalDone = false;
    jumpControls.hidden = true;

    if (state.pendingReplacement) {
      state.forcedPlacement = true;
      state.choosingColour = false;
      state.colourChooser = null;
    } else if (piecesRemain()) {
      state.forcedPlacement = !!actionWasMove;
      state.choosingColour = true;
      state.colourChooser = finishingPlayer;
    } else {
      state.forcedPlacement = false;
      state.choosingColour = false;
      state.colourChooser = null;
    }
    resetMoveTimer();
    processFlow();
  }

  function replaceJumpedPiece(index) {
    if (!state.pendingReplacement || state.board[index] || index === state.replacementForbiddenIndex) return false;
    state.board[index] = state.pendingReplacement;
    state.pendingReplacement = null;
    state.replacementForbiddenIndex = null;
    state.forcedPlacement = false;
    clearSelection();
    finishTurn(null, false);
    return true;
  }

  function placePiece(index) {
    if (computerBusy || state.choosingColour || !piecesRemain()) return;
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

    if (piecesRemain() && state.assignedColour && piece.colour !== state.assignedColour) {
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

  function humanMovePiece(from, to, isJump) {
    const piece = state.board[from];
    if (!piece || state.board[to]) return;

    state.board[to] = piece;
    state.board[from] = null;
    state.selectedPieceIndex = to;

    if (isJump && state.endgameStarted && !state.jumpRemovalDone && !state.pendingReplacement) {
      const jump = rules.jumpDestinations(state.board.map((p,i)=>i===from?piece:p), from).find(j => j.to === to);
      if (jump && state.board[jump.over]) {
        state.pendingReplacement = state.board[jump.over];
        state.replacementForbiddenIndex = jump.over;
        state.board[jump.over] = null;
        state.jumpRemovalDone = true;
      }
    }

    if (checkAndFinishWin(piece.id)) return;

    if (!isJump) {
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
    if (computerBusy || isComputer(state.currentPlayer) || state.winner !== null || state.choosingColour) return;

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
    if (!piece && state.selectedPieceIndex === null && piecesRemain() &&
        state.assignedColour && state.remaining[state.assignedColour] > 0) {
      placePiece(index);
      return;
    }

    // When a piece is selected, an empty highlighted square is its destination.
    if (!piece && state.selectedPieceIndex !== null) {
      const from = state.selectedPieceIndex;
      if (state.legalJumps.has(index)) {
        humanMovePiece(from, index, true);
      } else if (state.legalMoves.has(index)) {
        humanMovePiece(from, index, false);
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

    if (piecesRemain() && colour && state.remaining[colour] > 0) {
      for (let to = 0; to < 16; to += 1) {
        if (!state.board[to]) actions.push({ type: "place", to, colour });
      }
    }

    if (mustPlace) return actions;

    for (let from = 0; from < 16; from += 1) {
      const piece = state.board[from];
      if (!piece) continue;
      if (colour && piece.colour !== colour) continue;
      if (piece.id === state.opponentProtectedPieceId) continue;

      for (const to of rules.adjacentDestinations(state.board, from)) {
        actions.push({ type: "move", from, to });
      }
      for (const jump of rules.jumpDestinations(state.board, from)) {
        actions.push({ type: "jump", from, to: jump.to });
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
    }
    return board;
  }

  function actionWins(action) {
    return !!rules.checkWin(boardAfterAction(action));
  }

  function actionScore(action) {
    if (actionWins(action)) return 10000;

    const row = Math.floor(action.to / 4);
    const col = action.to % 4;
    let score = 0;

    if (row === 1 || row === 2) score += 2;
    if (col === 1 || col === 2) score += 2;
    if (action.type === "jump") score += 1.5;

    // Slight randomness keeps repeated games from becoming identical.
    score += Math.random();

    if (settings.level === "expert") {
      const board = boardAfterAction(action);
      // Reward building same-colour occupancy in winning lines.
      const movedColour = action.type === "place"
        ? action.colour
        : state.board[action.from].colour;
      for (const line of rules.WINNING_LINES) {
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
      for (let to = 0; to < 16; to += 1) {
        if (state.board[to]) continue;
        const board = cloneBoard(state.board);
        board[to] = { id: -1, colour };
        if (rules.checkWin(board,{allow2x2:settings.allow2x2,allowCorners:settings.allowCorners})) return false;
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
    for (let i=0;i<16;i+=1) if (!state.board[i] && i !== state.replacementForbiddenIndex) options.push(i);
    if (!options.length) { computerBusy=false; setStatus("No legal replacement square."); render(); return; }
    let best = options[0];
    for (const i of options) {
      const b=cloneBoard(state.board); b[i]=state.pendingReplacement;
      if (rules.checkWin(b,{allow2x2:settings.allow2x2,allowCorners:settings.allowCorners})) { best=i; break; }
    }
    flowTimer=setTimeout(()=>{computerBusy=false;replaceJumpedPiece(best);},300);
  }

  function computerPlayTurn() {
    if (state.winner !== null || state.choosingColour || !isComputer(state.currentPlayer)) return;

    computerBusy = true;
    setStatus("Computer is thinking…");
    render();

    const colour = piecesRemain() ? state.assignedColour : null;
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
      state.board[action.to] = piece;
      state.board[action.from] = null;
      if (action.type === "jump" && state.endgameStarted && firstJumpOver !== null && state.board[firstJumpOver]) {
        state.pendingReplacement = state.board[firstJumpOver];
        state.replacementForbiddenIndex = firstJumpOver;
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
            return !!rules.checkWin(b,{allow2x2:settings.allow2x2,allowCorners:settings.allowCorners});
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
    }, 350);
  }

  function renderBoard() {
    boardElement.replaceChildren();

    const winning = new Set(state.winningCells);

    for (let index = 0; index < 16; index += 1) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "board-cell";
      cell.dataset.index = String(index);
      cell.setAttribute("role", "gridcell");

      if (winning.has(index)) cell.classList.add("board-cell--winner");
      if (state.selectedPieceIndex === index) cell.classList.add("board-cell--selected");
      if (state.legalMoves.has(index)) cell.classList.add("board-cell--move");
      if (state.legalJumps.has(index)) cell.classList.add("board-cell--jump");

      if (!computerBusy && !state.choosingColour && !isComputer(state.currentPlayer) &&
          state.pendingReplacement && !state.board[index] && index !== state.replacementForbiddenIndex) {
        cell.classList.add("board-cell--place");
      } else if (!computerBusy && !state.choosingColour && !isComputer(state.currentPlayer) &&
          piecesRemain() && state.assignedColour && !state.board[index] &&
          state.remaining[state.assignedColour] > 0 && state.selectedPieceIndex === null) {
        cell.classList.add("board-cell--place");
      }

      const piece = state.board[index];
      if (piece) {
        const disc = document.createElement("span");
        disc.className = `piece piece--${piece.colour}`;
        disc.setAttribute("aria-hidden", "true");
        cell.appendChild(disc);
        cell.setAttribute(
          "aria-label",
          `${piece.colour} piece, row ${Math.floor(index / 4) + 1}, column ${(index % 4) + 1}`
        );
      } else {
        cell.setAttribute(
          "aria-label",
          `Empty square, row ${Math.floor(index / 4) + 1}, column ${(index % 4) + 1}`
        );
      }

      cell.disabled = computerBusy;
      cell.addEventListener("click", () => handleCell(index));
      boardElement.appendChild(cell);
    }
  }

  function render() {
    currentPlayerElement.textContent = state.winner === "draw"
      ? "Draw"
      : state.winner !== null ? `${participantName(state.winner)} wins` : participantName(state.currentPlayer);

    blackRemainingElement.textContent = `${state.remaining.black} remaining`;
    document.getElementById("colour1-name").textContent = COLOURS[settings.colour1][0];
    whiteRemainingElement.textContent = `${state.remaining.white} remaining`;
    document.getElementById("colour2-name").textContent = COLOURS[settings.colour2][0];

    const phaseHelp=document.getElementById("phase-help");
    if(phaseHelp) phaseHelp.textContent=state.endgameStarted
      ? `End game · ${state.endgameTurns} / 24 turns${state.pendingReplacement ? " · jumped piece must be replaced" : ""}`
      : "While pieces remain, the player who just finished chooses the colour the opponent must use. The highlighted colour is the one to play.";

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
      piecesRemain() &&
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

    cancelButton.disabled =
      computerBusy ||
      state.jumpInProgress ||
      state.selectedPieceIndex === null;

    undoButton.hidden = !settings.undo;
    undoButton.disabled = computerBusy || checkpoints.length === 0;

    jumpControls.hidden = !state.jumpInProgress;
    renderBoard();
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
  function summary(){const one=fv("gameMode")==="computer",level=["","Beginner","Standard","Expert"][Number(difficultyInput.value)],extras=[];if(document.getElementById("setting-2x2").value==="yes")extras.push("2×2 wins");if(document.getElementById("setting-corners").value==="yes")extras.push("corner wins");document.getElementById("setup-summary").textContent=`${one?"Player vs Computer · "+level:"Two players"} · ${COLOURS[fv("colour1")][0]} / ${COLOURS[fv("colour2")][0]} · ${extras.length?extras.join(" · "):"standard lines"} · ${fv("timer")==="0"?"Unlimited":fv("timer")+"-second"} turns`;}
  function openSettings(){sr("gameMode",settings.mode);difficultyInput.value=settings.level==="beginner"?1:settings.level==="expert"?3:2;sr("allowUndo",settings.undo?"yes":"no");sr("undoPreviousJump",settings.undoPreviousJump?"yes":"no");sr("colour1",settings.colour1);sr("colour2",settings.colour2);document.getElementById("setting-2x2").value=settings.allow2x2?"yes":"no";document.getElementById("setting-corners").value=settings.allowCorners?"yes":"no";player1Input.value=settings.player1;player2Input.value=settings.player2;sr("starter",settings.starter);sr("timer",String(settings.timer));document.getElementById("setting-sound").checked=settings.sound;document.getElementById("setting-animations").checked=settings.animations;syncMode();syncDifficulty();showStep(0);settingsDialog.showModal();}
  settingsForm.querySelectorAll('[name="gameMode"]').forEach(e=>e.addEventListener("change",syncMode));difficultyInput.addEventListener("input",syncDifficulty);wizardNext.addEventListener("click",()=>{if(wizardStep===1&&!coloursValid()){setStatus("Choose two different piece colours.");return}showStep(wizardStep+1)});wizardBack.addEventListener("click",()=>showStep(wizardStep-1));document.getElementById("settings-button").addEventListener("click",openSettings);document.getElementById("close-settings").addEventListener("click",()=>settingsDialog.close());document.getElementById("cancel-settings").addEventListener("click",()=>settingsDialog.close());
  settingsForm.addEventListener("submit",e=>{e.preventDefault();if(!coloursValid()){showStep(1);return}const n=Number(difficultyInput.value);settings={...settings,mode:fv("gameMode"),player1:player1Input.value.trim()||"Player",player2:player2Input.value.trim()||"Player 2",level:n===1?"beginner":n===3?"expert":"standard",starter:fv("starter"),undo:fv("allowUndo")==="yes",undoPreviousJump:fv("undoPreviousJump")==="yes",colour1:fv("colour1"),colour2:fv("colour2"),allow2x2:document.getElementById("setting-2x2").value==="yes",allowCorners:document.getElementById("setting-corners").value==="yes",timer:Number(fv("timer")),sound:document.getElementById("setting-sound").checked,animations:document.getElementById("setting-animations").checked,language:document.getElementById("setting-language").value};saveSettings();settingsDialog.close();startNewGame();});
  const statisticsDialog=document.getElementById("statistics-dialog");document.getElementById("view-statistics-button").addEventListener("click",()=>statisticsDialog.showModal());document.getElementById("close-statistics").addEventListener("click",()=>statisticsDialog.close());

  // Help
  const helpDialog = document.getElementById("help-dialog");
  document.getElementById("help-button").addEventListener("click", () => helpDialog.showModal());
  document.getElementById("close-help").addEventListener("click", () => helpDialog.close());

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js"));
  }

  fetch("./build-info.json", { cache: "no-store" })
    .then(response => response.ok ? response.json() : null)
    .then(info => {
      if (info && info.version) {
        document.getElementById("app-version").textContent = `Version ${info.version}`;
        const ref=info.commit || info.gitCommit || info.git || info.hash || info.commitHash || "";
        document.getElementById("build-reference").textContent = ref ? ` · ${String(ref).slice(0,7)}` : "";
      }
    })
    .catch(() => {});

  startNewGame();
})();
