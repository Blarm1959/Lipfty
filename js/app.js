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

  function playerName(index) { return `Player ${index + 1}`; }
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
  }

  function chooseColour(colour) {
    if (state.winner !== null || !state.choosingColour || !piecesRemain()) return;
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
    const colour = state.assignedColour;
    if (state.choosingColour || !colour || state.board[index] || state.remaining[colour] <= 0) return;
    state.board[index] = { id: nextPieceId++, colour };
    state.remaining[colour] -= 1;
    clearSelection();
    completeTurn(null, false);
  }

  function movePiece(from, to, isJump) {
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
    if (state.winner !== null || state.choosingColour) return;
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

    const colourChoiceEnabled = state.winner === null && state.choosingColour && piecesRemain();
    placeBlackButton.disabled = !colourChoiceEnabled || (state.forcedPlacement && state.remaining.black === 0);
    placeWhiteButton.disabled = !colourChoiceEnabled || (state.forcedPlacement && state.remaining.white === 0);
    placeBlackButton.classList.toggle("reserve-button--selected", state.assignedColour === "black");
    placeWhiteButton.classList.toggle("reserve-button--selected", state.assignedColour === "white");

    const cancel = document.getElementById("cancel-action");
    cancel.disabled = state.jumpInProgress || state.selectedPieceIndex === null;
    renderBoard();
  }

  function newGame() {
    nextPieceId = 1;
    state = freshState();
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

  const helpDialog = document.getElementById("help-dialog");
  document.getElementById("help-button").addEventListener("click", () => helpDialog.showModal());
  document.getElementById("close-help").addEventListener("click", () => helpDialog.close());

  if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js"));
  fetch("./build-info.json", { cache: "no-store" }).then(response => response.ok ? response.json() : null).then(info => {
    if (info?.version) document.getElementById("app-version").textContent = `v${info.version}`;
  }).catch(() => {});

  newGame();
})();
