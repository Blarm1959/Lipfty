(function () {
  "use strict";

  const SIZE = 8;
  const WIN_LENGTH = 5;

  function indexOf(r, c) { return r * SIZE + c; }
  function inBounds(r, c) { return r >= 0 && r < SIZE && c >= 0 && c < SIZE; }

  function buildWinningLines() {
    const lines = [];
    const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];

    for (let r = 0; r < SIZE; r += 1) {
      for (let c = 0; c < SIZE; c += 1) {
        for (const [dr, dc] of directions) {
          const endR = r + dr * (WIN_LENGTH - 1);
          const endC = c + dc * (WIN_LENGTH - 1);
          if (!inBounds(endR, endC)) continue;

          const line = [];
          for (let step = 0; step < WIN_LENGTH; step += 1) {
            line.push(indexOf(r + dr * step, c + dc * step));
          }
          lines.push(line);
        }
      }
    }

    return lines;
  }

  const WINNING_LINES = buildWinningLines();

  function row(index) { return Math.floor(index / SIZE); }
  function col(index) { return index % SIZE; }

  function checkWin(board) {
    for (const line of WINNING_LINES) {
      const pieces = line.map(index => board[index]);
      if (pieces.some(piece => !piece)) continue;
      const colour = pieces[0].colour;
      if (pieces.every(piece => piece.colour === colour)) return { line: [...line], colour };
    }
    return null;
  }

  function adjacentDestinations(board, from) {
    const result = [];
    const r = row(from), c = col(from);
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr, nc = c + dc;
        if (inBounds(nr, nc)) {
          const to = indexOf(nr, nc);
          if (!board[to]) result.push(to);
        }
      }
    }
    return result;
  }

  function jumpDestinations(board, from) {
    const result = [];
    const r = row(from), c = col(from);
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        if (dr === 0 && dc === 0) continue;
        const overR = r + dr, overC = c + dc;
        const landR = r + dr * 2, landC = c + dc * 2;
        if (!inBounds(overR, overC) || !inBounds(landR, landC)) continue;
        const over = indexOf(overR, overC), to = indexOf(landR, landC);
        if (board[over] && !board[to]) result.push({ to, over });
      }
    }
    return result;
  }

  window.LipftyRules = { SIZE, WIN_LENGTH, WINNING_LINES, checkWin, adjacentDestinations, jumpDestinations };
})();
