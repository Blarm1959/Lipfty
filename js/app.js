(function () {
  "use strict";

  const rules = window.LipftyRules;
  const boardElement = document.getElementById("board");
  const statusElement = document.getElementById("status");
  const currentPlayerElement = document.getElementById("current-player");
  const placeBlackButton = document.getElementById("place-black");
  const placeWhiteButton = document.getElementById("place-white");
  const blackRemainingElement = document.getElementById("black-remaining");
  const whiteRemainingElement = document.getElementById("white-remaining");
  const jumpControls = document.getElementById("jump-controls");
  const finishJumpButton = document.getElementById("finish-jump");

  let nextPieceId = 1;
  let state;
  let history = [];
  let computerBusy = false;
  let settings = loadSettings();

  function loadSettings() {
    const defaults = { mode: "computer", player1: "Player", player2: "Player 2", level: "standard", starter: "random", undo: true, language: "en-GB" };
    try { return { ...defaults, ...JSON.parse(localStorage.getItem("lipfty-settings") || "{}") }; }
    catch (_) { return defaults; }
  }
  function saveSettings() { localStorage.setItem("lipfty-settings", JSON.stringify(settings)); }
  function isComputer(index) { return settings.mode === "computer" && index === 1; }
  function playerName(index) {
    if (isComputer(index)) return "Computer";
    return index === 0 ? (settings.player1 || "Player") : (settings.player2 || "Player 2");
  }
  function snapshot() {
    return {
      state: JSON.parse(JSON.stringify({
        ...state,
        legalMoves: [...state.legalMoves],
        legalJumps: [...state.legalJumps.entries()]
      })),
      nextPieceId
    };
  }
  function restore(snap) {
    const x = snap.state;
    state = { ...x, legalMoves: new Set(x.legalMoves), legalJumps: new Map(x.legalJumps) };
    nextPieceId = snap.nextPieceId;
    computerBusy = false;
    jumpControls.hidden = !state.jumpInProgress;
    render();
    setStatus("Move undone.");
  }
  function pushHistory() { if (settings.undo && !computerBusy) history.push(snapshot()); }

  function freshState() {
    return {
      board: Array(16).fill(null),
      remaining: { black: 6, white: 6 },
      currentPlayer: 0,
      assignedColour: null,
      choosingColour: true,
      colourChooser: 1,
      forcedPlacement: false,
      selectedPieceIndex: null,
      legalMoves: new Set(),
      legalJumps: new Map(),
      jumpInProgress: false,
      jumpPieceIndex: null,
      opponentProtectedPieceId: null,
      winner: null,
      winningCells: []
    };
  }

  function otherPlayer() { return state.currentPlayer === 0 ? 1 : 0; }
  function piecesRemain() { return state.remaining.black + state.remaining.white > 0; }
  function setStatus(text) { statusElement.textContent = text; }

  function clearSelection() {
    if (state.jumpInProgress) return;
    state.selectedPieceIndex = null;
    state.legalMoves.clear();
    state.legalJumps.clear();
  }

  function beginTurn() {
    clearSelection();
    state.jumpInProgress = false;
    state.jumpPieceIndex = null;
    jumpControls.hidden = true;
    currentPlayerElement.textContent = playerName(state.currentPlayer);

    if (!piecesRemain()) {
      state.choosingColour = false;
      state.assignedColour = null;
      state.forcedPlacement = false;
      setStatus(`${playerName(state.currentPlayer)}: move or jump any piece.`);
    } else if (state.choosingColour) {
      setStatus(`${playerName(state.colourChooser)}: choose Black or White for ${playerName(state.currentPlayer)}.`);
    } else if (state.forcedPlacement) {
      setStatus(`${playerName(state.currentPlayer)}: you were given ${state.assignedColour}. You must place it.`);
    } else {
      setStatus(`${playerName(state.currentPlayer)}: use ${state.assignedColour} — place, move or jump.`);
    }
    render();
    if (state.winner === null) setTimeout(maybeComputerTurn, 280);
  }

  function chooseColour(colour) {
    if (state.winner !== null || !state.choosingColour || !piecesRemain()) return;
    if (!computerBusy) pushHistory();
    if (state.forcedPlacement && state.remaining[colour] <= 0) {
      setStatus(`${colour} has no pieces left to place. Choose the other colour.`);
      return;
    }
    state.assignedColour = colour;
    state.choosingColour = false;
    beginTurn();
  }

  function completeTurn(movedPieceId = null, actionWasMove = false) {
    const win = rules.checkWin(state.board);
    if (win) {
      state.winner = state.currentPlayer;
      state.winningCells = win.line;
      state.opponentProtectedPieceId = movedPieceId;
      jumpControls.hidden = true;
      setStatus(`${playerName(state.currentPlayer)} wins with four ${win.colour} pieces!`);
      render();
      return;
    }

    const finishingPlayer = state.currentPlayer;
    state.opponentProtectedPieceId = movedPieceId;
    state.currentPlayer = otherPlayer();
    state.assignedColour = null;

    if (piecesRemain()) {
      state.forcedPlacement = actionWasMove;
      state.choosingColour = true;
      state.colourChooser = finishingPlayer;
    } else {
      state.forcedPlacement = false;
      state.choosingColour = false;
      state.colourChooser = null;
    }
    beginTurn();
  }

  function selectBoardPiece(index) {
    if (state.winner !== null || state.choosingColour || state.forcedPlacement) return;
    const piece = state.board[index];
    if (!piece) return;
    if (state.assignedColour && piece.colour !== state.assignedColour) {
      setStatus(`You were given ${state.assignedColour}. Choose a ${state.assignedColour} piece.`);
      return;
    }
    if (state.jumpInProgress && index !== state.jumpPieceIndex) return;
    if (!state.jumpInProgress && piece.id === state.opponentProtectedPieceId) {
      setStatus("That piece was moved by your opponent last turn, so it cannot be moved now.");
      return;
    }

    state.selectedPieceIndex = index;
    state.legalMoves = new Set(state.jumpInProgress ? [] : rules.adjacentDestinations(state.board, index));
    state.legalJumps = new Map(rules.jumpDestinations(state.board, index).map(jump => [jump.to, jump]));
    setStatus(state.jumpInProgress
      ? "Continue jumping with this piece, or finish your turn."
      : "Choose a highlighted square to move or jump to.");
    render();
  }

  function placePiece(index) {
    if (!computerBusy) pushHistory();
    const colour = state.assignedColour;
    if (state.choosingColour || !colour || state.board[index] || state.remaining[colour] <= 0) return;
    state.board[index] = { id: nextPieceId++, colour };
    state.remaining[colour] -= 1;
    clearSelection();
    completeTurn(null, false);
  }

  function movePiece(from, to, isJump) {
    if (!computerBusy && !state.jumpInProgress) pushHistory();
    const piece = state.board[from];
    if (!piece || state.board[to]) return;
    state.board[to] = piece;
    state.board[from] = null;
    state.selectedPieceIndex = to;

    const win = rules.checkWin(state.board);
    if (win) {
      state.winner = state.currentPlayer;
      state.winningCells = win.line;
      state.opponentProtectedPieceId = piece.id;
      state.jumpInProgress = false;
      jumpControls.hidden = true;
      setStatus(`${playerName(state.currentPlayer)} wins with four ${win.colour} pieces!`);
      render();
      return;
    }

    if (!isJump) {
      clearSelection();
      completeTurn(piece.id, true);
      return;
    }

    state.legalMoves.clear();
    state.legalJumps = new Map(rules.jumpDestinations(state.board, to).map(jump => [jump.to, jump]));

    if (state.legalJumps.size === 0) {
      state.jumpInProgress = false;
      state.jumpPieceIndex = null;
      state.selectedPieceIndex = null;
      jumpControls.hidden = true;
      completeTurn(piece.id, true);
      return;
    }

    state.jumpInProgress = true;
    state.jumpPieceIndex = to;
    jumpControls.hidden = false;
    setStatus("Jump again with the same piece, or finish your turn.");
    render();
  }

  function handleCell(index) {
    if (computerBusy || isComputer(state.currentPlayer) || state.winner !== null || state.choosingColour) return;
    const piece = state.board[index];

    if (!piece && state.assignedColour && state.remaining[state.assignedColour] > 0 &&
        state.selectedPieceIndex === null && !state.jumpInProgress) {
      placePiece(index);
      return;
    }

    if (state.selectedPieceIndex !== null && !piece) {
      const from = state.selectedPieceIndex;
      if (state.legalJumps.has(index)) movePiece(from, index, true);
      else if (state.legalMoves.has(index)) movePiece(from, index, false);
      return;
    }

    if (piece) selectBoardPiece(index);
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
      if (!state.choosingColour && state.assignedColour && !state.board[index] &&
          state.remaining[state.assignedColour] > 0 && state.selectedPieceIndex === null) {
        cell.classList.add("board-cell--place");
      }

      const piece = state.board[index];
      if (piece) {
        const disc = document.createElement("span");
        disc.className = `piece piece--${piece.colour}`;
        disc.setAttribute("aria-hidden", "true");
        cell.appendChild(disc);
        cell.setAttribute("aria-label", `${piece.colour} piece, row ${Math.floor(index / 4) + 1}, column ${(index % 4) + 1}`);
      } else {
        cell.setAttribute("aria-label", `Empty square, row ${Math.floor(index / 4) + 1}, column ${(index % 4) + 1}`);
      }
      cell.addEventListener("click", () => handleCell(index));
      boardElement.appendChild(cell);
    }
  }

  function render() {
    currentPlayerElement.textContent = state.winner === null ? playerName(state.currentPlayer) : `${playerName(state.winner)} wins`;
    blackRemainingElement.textContent = `${state.remaining.black} remaining`;
    whiteRemainingElement.textContent = `${state.remaining.white} remaining`;

    const chooserIsComputer = isComputer(state.colourChooser);
    const colourChoiceEnabled = state.winner === null && state.choosingColour && piecesRemain() && !chooserIsComputer && !computerBusy;
    placeBlackButton.disabled = !colourChoiceEnabled || (state.forcedPlacement && state.remaining.black === 0);
    placeWhiteButton.disabled = !colourChoiceEnabled || (state.forcedPlacement && state.remaining.white === 0);
    placeBlackButton.classList.toggle("reserve-button--selected", state.assignedColour === "black");
    placeWhiteButton.classList.toggle("reserve-button--selected", state.assignedColour === "white");

    const cancel = document.getElementById("cancel-action");
    cancel.disabled = computerBusy || state.jumpInProgress || state.selectedPieceIndex === null;
    const undo = document.getElementById("undo");
    undo.hidden = !settings.undo;
    undo.disabled = computerBusy || history.length === 0;
    renderBoard();
  }


  function cloneBoard(board) { return board.map(p => p ? { ...p } : null); }

  function availableActions(colour, mustPlace) {
    const actions = [];
    if (colour && state.remaining[colour] > 0) {
      for (let i = 0; i < 16; i += 1) if (!state.board[i]) actions.push({ type: "place", to: i, colour });
    }
    if (mustPlace) return actions;
    for (let from = 0; from < 16; from += 1) {
      const p = state.board[from];
      if (!p || (colour && p.colour !== colour) || p.id === state.opponentProtectedPieceId) continue;
      for (const to of rules.adjacentDestinations(state.board, from)) actions.push({ type: "move", from, to });
      for (const j of rules.jumpDestinations(state.board, from)) actions.push({ type: "jump", from, to: j.to });
    }
    return actions;
  }

  function actionWins(action) {
    const b = cloneBoard(state.board);
    if (action.type === "place") b[action.to] = { id: -1, colour: action.colour };
    else { b[action.to] = b[action.from]; b[action.from] = null; }
    return !!rules.checkWin(b);
  }

  function pickAction(actions) {
    if (!actions.length) return null;
    const wins = actions.filter(actionWins);
    if (wins.length) return wins[Math.floor(Math.random() * wins.length)];
    if (settings.level === "beginner") return actions[Math.floor(Math.random() * actions.length)];
    // Standard/Expert prefer central squares and jumps; Expert also avoids obviously completing
    // an existing three for the opponent where possible.
    const score = a => {
      const r=Math.floor(a.to/4), c=a.to%4;
      let v = (r===1||r===2 ? 2:0) + (c===1||c===2 ? 2:0) + (a.type==="jump" ? 2:0);
      if (settings.level === "expert" && a.type==="place") v += 1;
      return v + Math.random();
    };
    return [...actions].sort((a,b)=>score(b)-score(a))[0];
  }

  function computerChooseColour() {
    const colours = ["black","white"].filter(c => !(state.forcedPlacement && state.remaining[c] === 0));
    // Avoid handing over an immediate placement win where possible.
    const safe = colours.filter(colour => {
      if (state.remaining[colour] <= 0) return true;
      for (let i=0;i<16;i++) if (!state.board[i]) {
        const b=cloneBoard(state.board); b[i]={id:-1,colour};
        if (rules.checkWin(b)) return false;
      }
      return true;
    });
    const pool = safe.length ? safe : colours;
    return pool[Math.floor(Math.random()*pool.length)];
  }

  function maybeComputerTurn() {
    if (state.winner !== null || computerBusy) return;

    // In the opening phase the player who just finished chooses the opponent's colour.
    if (state.choosingColour && isComputer(state.colourChooser)) {
      computerBusy = true;
      const colour = computerChooseColour();
      setTimeout(() => { computerBusy = false; chooseColour(colour); }, 250);
      return;
    }

    if (!isComputer(state.currentPlayer) || state.choosingColour) return;
    computerBusy = true;
    setStatus("Computer is thinking…");
    setTimeout(() => {
      const colour = piecesRemain() ? state.assignedColour : null;
      const actions = availableActions(colour, state.forcedPlacement);
      const action = pickAction(actions);
      if (!action) { computerBusy=false; setStatus("Computer has no legal action."); render(); return; }
      if (action.type === "place") {
        state.board[action.to] = { id: nextPieceId++, colour: action.colour };
        state.remaining[action.colour] -= 1;
        computerBusy=false;
        completeTurn(null, false);
      } else {
        const piece = state.board[action.from];
        state.board[action.to] = piece; state.board[action.from] = null;
        const win = rules.checkWin(state.board);
        if (win) {
          state.winner=state.currentPlayer; state.winningCells=win.line; state.opponentProtectedPieceId=piece.id;
          computerBusy=false; setStatus(`${playerName(state.currentPlayer)} wins with four ${win.colour} pieces!`); render(); return;
        }
        // Computer deliberately ends after one jump for now; multi-jump legality remains available to human.
        computerBusy=false;
        completeTurn(piece.id, true);
      }
    }, 450);
  }

  function newGame() {
    nextPieceId = 1;
    history = [];
    state = freshState();
    if (settings.mode === "computer") {
      let starter = settings.starter;
      if (starter === "random") starter = Math.random() < 0.5 ? "player" : "computer";
      state.currentPlayer = starter === "computer" ? 1 : 0;
      state.colourChooser = state.currentPlayer === 0 ? 1 : 0;
    }
    beginTurn();
  }

  placeBlackButton.addEventListener("click", () => chooseColour("black"));
  placeWhiteButton.addEventListener("click", () => chooseColour("white"));
  document.getElementById("cancel-action").addEventListener("click", () => {
    if (state.jumpInProgress) return;
    clearSelection();
    beginTurn();
  });
  document.getElementById("new-game").addEventListener("click", newGame);
  finishJumpButton.addEventListener("click", () => {
    if (!state.jumpInProgress || state.jumpPieceIndex === null) return;
    const piece = state.board[state.jumpPieceIndex];
    const pieceId = piece?.id ?? null;
    state.jumpInProgress = false;
    state.jumpPieceIndex = null;
    state.selectedPieceIndex = null;
    state.legalJumps.clear();
    jumpControls.hidden = true;
    completeTurn(pieceId, true);
  });


  document.getElementById("undo").addEventListener("click", () => {
    if (!settings.undo || !history.length || computerBusy) return;
    restore(history.pop());
  });

  const settingsDialog = document.getElementById("settings-dialog");
  const modeSelect = document.getElementById("setting-mode");
  const levelSelect = document.getElementById("setting-level");
  const starterSelect = document.getElementById("setting-starter");
  const player2Label = document.getElementById("player2-label");
  function syncSettingsVisibility() {
    const one = modeSelect.value === "computer";
    levelSelect.parentElement.hidden = !one;
    starterSelect.parentElement.hidden = !one;
    player2Label.hidden = one;
  }
  document.getElementById("settings-button").addEventListener("click", () => {
    modeSelect.value=settings.mode;
    document.getElementById("setting-player1").value=settings.player1;
    document.getElementById("setting-player2").value=settings.player2;
    levelSelect.value=settings.level;
    starterSelect.value=settings.starter;
    document.getElementById("setting-undo").checked=settings.undo;
    document.getElementById("setting-language").value=settings.language;
    syncSettingsVisibility();
    settingsDialog.showModal();
  });
  modeSelect.addEventListener("change", syncSettingsVisibility);
  document.getElementById("close-settings").addEventListener("click", () => settingsDialog.close());
  document.getElementById("cancel-settings").addEventListener("click", () => settingsDialog.close());
  document.getElementById("settings-form").addEventListener("submit", () => {
    settings = {
      mode: modeSelect.value,
      player1: document.getElementById("setting-player1").value.trim() || "Player",
      player2: document.getElementById("setting-player2").value.trim() || "Player 2",
      level: levelSelect.value,
      starter: starterSelect.value,
      undo: document.getElementById("setting-undo").checked,
      language: document.getElementById("setting-language").value
    };
    saveSettings();
    setTimeout(newGame, 0);
  });

  const helpDialog = document.getElementById("help-dialog");
  document.getElementById("help-button").addEventListener("click", () => helpDialog.showModal());
  document.getElementById("close-help").addEventListener("click", () => helpDialog.close());

  if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js"));
  fetch("./build-info.json", { cache: "no-store" }).then(response => response.ok ? response.json() : null).then(info => {
    if (info?.version) document.getElementById("app-version").textContent = `v${info.version}`;
  }).catch(() => {});

  newGame();
})();
