global.window = global;
require("../js/rules.js");
const assert = require("node:assert/strict");
const R = global.LipftyRules;
const piece = colour => ({ colour });
const emptyBoard = () => Array(R.SIZE * R.SIZE).fill(null);

assert.equal(R.SIZE, 8);
assert.equal(R.WIN_LENGTH, 5);

let board = emptyBoard();
[0, 1, 2, 3, 4].forEach(i => board[i] = piece("black"));
assert.deepEqual(R.checkWin(board), { line: [0, 1, 2, 3, 4], colour: "black" });

board = emptyBoard();
[2, 10, 18, 26, 34].forEach(i => board[i] = piece("white"));
assert.deepEqual(R.checkWin(board), { line: [2, 10, 18, 26, 34], colour: "white" });

board = emptyBoard();
[3, 12, 21, 30, 39].forEach(i => board[i] = piece("black"));
assert.deepEqual(R.checkWin(board), { line: [3, 12, 21, 30, 39], colour: "black" });

board = emptyBoard();
[4, 11, 18, 25, 32].forEach(i => board[i] = piece("white"));
assert.deepEqual(R.checkWin(board), { line: [4, 11, 18, 25, 32], colour: "white" });

board = emptyBoard();
[0, 1, 2, 3].forEach(i => board[i] = piece("black"));
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

console.log("Lipfty 8x8 rules tests passed.");
