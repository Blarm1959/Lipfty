global.window = global;
require("../js/rules.js");
const assert = require("node:assert/strict");
const R = global.LipftyRules;
const piece = colour => ({ colour });
const emptyBoard = () => Array(R.SIZE * R.SIZE).fill(null);

assert.equal(R.SIZE, 6);
assert.equal(R.WIN_LENGTH, 4);

let board = emptyBoard();
[0, 1, 2, 3].forEach(i => board[i] = piece("black"));
assert.deepEqual(R.checkWin(board), { line: [0, 1, 2, 3], colour: "black" });

board = emptyBoard();
[2, 8, 14, 20].forEach(i => board[i] = piece("white"));
assert.deepEqual(R.checkWin(board), { line: [2, 8, 14, 20], colour: "white" });

board = emptyBoard();
[2, 9, 16, 23].forEach(i => board[i] = piece("black"));
assert.deepEqual(R.checkWin(board), { line: [2, 9, 16, 23], colour: "black" });

board = emptyBoard();
[3, 8, 13, 18].forEach(i => board[i] = piece("white"));
assert.deepEqual(R.checkWin(board), { line: [3, 8, 13, 18], colour: "white" });

// Tight 2x2 board-aligned square wins by default.
board = emptyBoard();
[7, 8, 14, 13].forEach(i => board[i] = piece("black"));
assert.deepEqual(R.checkWin(board), { line: [7, 8, 14, 13], colour: "black" });

// A spaced board-aligned square is disabled by default but can be enabled.
board = emptyBoard();
[7, 10, 28, 25].forEach(i => board[i] = piece("black"));
assert.equal(R.checkWin(board), null);
assert.deepEqual(R.checkWin(board, true), { line: [7, 10, 28, 25], colour: "black" });

// 45-degree diamond corners never count as a square win.
board = emptyBoard();
[2, 16, 26, 12].forEach(i => board[i] = piece("white"));
assert.equal(R.checkWin(board), null);
assert.equal(R.checkWin(board, true), null);

// Three matching pieces are not enough.
board = emptyBoard();
[0, 1, 2].forEach(i => board[i] = piece("black"));
assert.equal(R.checkWin(board), null);

// An arbitrary angled quadrilateral must not count as a square.
board = emptyBoard();
[0, 9, 14, 29].forEach(i => board[i] = piece("black"));
assert.equal(R.checkWin(board), null);

board = emptyBoard();
board[0] = piece("white");
assert.deepEqual(R.adjacentDestinations(board, 0).sort((a,b)=>a-b), [1, 6, 7]);
board[1] = piece("black");
assert.equal(R.jumpDestinations(board, 0).some(j => j.to === 2 && j.over === 1), true);
board[6] = piece("black");
assert.equal(R.jumpDestinations(board, 0).some(j => j.to === 12 && j.over === 6), true);
board[7] = piece("black");
assert.equal(R.jumpDestinations(board, 0).some(j => j.to === 14 && j.over === 7), true);

console.log("Lipfty 6x6 playing-area four-piece win rules tests passed.");
