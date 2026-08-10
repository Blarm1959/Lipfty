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
      selectedPlacementColour: null,
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

  function setStatus(text) { statusElement.textContent = text; }

  function clearSelection() {
    if (state.jumpInProgress) return;
    state.selectedPlacementColour = null;
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
    setStatus(`${playerName(state.currentPlayer)}: place a piece, move one square, or jump.`);
    render();
  }

  function completeTurn(movedPieceId = null) {
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
    state.opponentProtectedPieceId = movedPieceId;
    state.currentPlayer = otherPlayer();
    beginTurn();
  }

  function selectPlacement(colour) {
    if (state.winner !== null || state.jumpInProgress || state.remaining[colour] <= 0) return;
    clearSelection();
    state.selectedPlacementColour = colour;
    setStatus(`${playerName(state.currentPlayer)}: place a ${colour} piece on any empty square.`);
    render();
  }

  function selectBoardPiece(index) {
    if (state.winner !== null) return;
    const piece = state.board[index];
    if (!piece) return;
    if (state.jumpInProgress && index !== state.jumpPieceIndex) return;
    if (!state.jumpInProgress && piece.id === state.opponentProtectedPieceId) {
      setStatus("That piece was moved by your opponent last turn, so it cannot be moved now.");
      return;
    }

    state.selectedPlacementColour = null;
    state.selectedPieceIndex = index;
    state.legalMoves = new Set(state.jumpInProgress ? [] : rules.adjacentDestinations(state.board, index));
    state.legalJumps = new Map(rules.jumpDestinations(state.board, index).map(jump => [jump.to, jump]));
    setStatus(state.jumpInProgress
      ? "Continue jumping with this piece, or finish your turn."
      : "Choose a highlighted square to move or jump to.");
    render();
  }

  function placePiece(index) {
    const colour = state.selectedPlacementColour;
    if (!colour || state.board[index] || state.remaining[colour] <= 0) return;
    state.board[index] = { id: nextPieceId++, colour };
    state.remaining[colour] -= 1;
    clearSelection();
    completeTurn(null);
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
      completeTurn(piece.id);
      return;
    }

    state.jumpInProgress = true;
    state.jumpPieceIndex = to;
    state.legalMoves.clear();
    state.legalJumps = new Map(rules.jumpDestinations(state.board, to).map(jump => [jump.to, jump]));
    jumpControls.hidden = false;
    setStatus(state.legalJumps.size
      ? "Jump again with the same piece, or finish your turn."
      : "No further jump is available. Finish your turn.");
    render();
  }

  function handleCell(index) {
    if (state.winner !== null) return;
    const piece = state.board[index];

    if (state.selectedPlacementColour && !piece) {
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
      if (state.selectedPlacementColour && !state.board[index]) cell.classList.add("board-cell--place");

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
    placeBlackButton.disabled = state.winner !== null || state.jumpInProgress || state.remaining.black === 0;
    placeWhiteButton.disabled = state.winner !== null || state.jumpInProgress || state.remaining.white === 0;
    placeBlackButton.classList.toggle("reserve-button--selected", state.selectedPlacementColour === "black");
    placeWhiteButton.classList.toggle("reserve-button--selected", state.selectedPlacementColour === "white");
    document.getElementById("cancel-action").disabled = state.jumpInProgress || (state.selectedPlacementColour === null && state.selectedPieceIndex === null);
    renderBoard();
  }

  function newGame() {
    nextPieceId = 1;
    state = freshState();
    beginTurn();
  }

  placeBlackButton.addEventListener("click", () => selectPlacement("black"));
  placeWhiteButton.addEventListener("click", () => selectPlacement("white"));
  document.getElementById("cancel-action").addEventListener("click", () => { clearSelection(); beginTurn(); });
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
    completeTurn(pieceId);
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
