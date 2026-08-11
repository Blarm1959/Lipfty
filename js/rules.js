(function () {
  "use strict";

  const SIZE = 4;
  const WINNING_LINES = [
    [0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11], [12, 13, 14, 15],
    [0, 4, 8, 12], [1, 5, 9, 13], [2, 6, 10, 14], [3, 7, 11, 15],
    [0, 5, 10, 15], [3, 6, 9, 12]
  ];

  function row(index) { return Math.floor(index / SIZE); }
  function col(index) { return index % SIZE; }
  function indexOf(r, c) { return r * SIZE + c; }
  function inBounds(r, c) { return r >= 0 && r < SIZE && c >= 0 && c < SIZE; }

  function checkWin(board, options = {}) {
    for (const line of WINNING_LINES) {
      const pieces = line.map(index => board[index]);
      if (pieces.some(piece => !piece)) continue;
      const colour = pieces[0].colour;
      if (pieces.every(piece => piece.colour === colour)) return { line: [...line], colour };
    }
    if (options.allow2x2) {
      for (let rr = 0; rr < 3; rr += 1) for (let cc = 0; cc < 3; cc += 1) {
        const a = rr * 4 + cc, line = [a, a + 1, a + 4, a + 5];
        const pieces = line.map(index => board[index]);
        if (pieces.every(Boolean) && pieces.every(piece => piece.colour === pieces[0].colour)) return { line, colour: pieces[0].colour, pattern: "2x2" };
      }
    }
    if (options.allowCorners) {
      const line = [0, 3, 12, 15], pieces = line.map(index => board[index]);
      if (pieces.every(Boolean) && pieces.every(piece => piece.colour === pieces[0].colour)) return { line, colour: pieces[0].colour, pattern: "corners" };
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

  window.LipftyRules = { SIZE, WINNING_LINES, checkWin, adjacentDestinations, jumpDestinations };
})();
