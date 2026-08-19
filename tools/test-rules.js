global.window = global;
require("../js/rules.js");
const assert = require("node:assert/strict");
const R = global.LipftyRules;
const piece = colour => ({ colour });
const emptyBoard = () => Array(R.SIZE * R.SIZE).fill(null);

assert.equal(R.SIZE, 8);
assert.equal(R.WIN_LENGTH, 4);

let board = emptyBoard();
[0, 1, 2, 3].forEach(i => board[i] = piece("black"));
assert.deepEqual(R.checkWin(board), { line: [0, 1, 2, 3], colour: "black" });

board = emptyBoard();
[2, 10, 18, 26].forEach(i => board[i] = piece("white"));
assert.deepEqual(R.checkWin(board), { line: [2, 10, 18, 26], colour: "white" });

board = emptyBoard();
[3, 12, 21, 30].forEach(i => board[i] = piece("black"));
assert.deepEqual(R.checkWin(board), { line: [3, 12, 21, 30], colour: "black" });

board = emptyBoard();
[3, 10, 17, 24].forEach(i => board[i] = piece("white"));
assert.deepEqual(R.checkWin(board), { line: [3, 10, 17, 24], colour: "white" });

// Board-aligned 3x3 square: corners (1,1), (1,4), (4,4), (4,1).
board = emptyBoard();
[9, 12, 36, 33].forEach(i => board[i] = piece("black"));
assert.deepEqual(R.checkWin(board), { line: [9, 12, 36, 33], colour: "black" });

// 45-degree diamond centred on (3,3), radius 2.
board = emptyBoard();
[11, 29, 43, 25].forEach(i => board[i] = piece("white"));
assert.deepEqual(R.checkWin(board), { line: [11, 29, 43, 25], colour: "white" });

// Three matching pieces are not enough.
board = emptyBoard();
[0, 1, 2].forEach(i => board[i] = piece("black"));
assert.equal(R.checkWin(board), null);

// An arbitrary angled quadrilateral must not count as a square.
board = emptyBoard();
[0, 11, 17, 30].forEach(i => board[i] = piece("black"));
assert.equal(R.checkWin(board), null);

board = emptyBoard();
board[0] = piece("white");
assert.deepEqual(R.adjacentDestinations(board, 0).sort((a,b)=>a-b), [1, 8, 9]);
board[1] = piece("black");
assert.equal(R.jumpDestinations(board, 0).some(j => j.to === 2 && j.over === 1), true);
board[8] = piece("black");
assert.equal(R.jumpDestinations(board, 0).some(j => j.to === 16 && j.over === 8), true);
board[9] = piece("black");
assert.equal(R.jumpDestinations(board, 0).some(j => j.to === 18 && j.over === 9), true);

console.log("Lipfty 8x8 four-piece win rules tests passed.");
