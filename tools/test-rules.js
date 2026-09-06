global.window = global;
require("../js/rules.js");
const assert = require("node:assert/strict");
const R = global.LipftyRules;
const piece = colour => ({ colour });
const emptyBoard = () => Array(R.SIZE * R.SIZE).fill(null);
const put = (indices, colour="black") => { const b=emptyBoard(); indices.forEach(i=>b[i]=piece(colour)); return b; };

assert.equal(R.SIZE, 6);
assert.equal(R.WIN_LENGTH, 4);

assert.deepEqual(R.checkWin(put([0,1,2,3]), 1), { line:[0,1,2,3], colour:"black" });
assert.deepEqual(R.checkWin(put([2,8,14,20],"white"), 1), { line:[2,8,14,20], colour:"white" });
// Straight diagonals are not Lipfty 5 wins.
assert.equal(R.checkWin(put([2,9,16,23]), 5), null);

// Level 2 adds tight board-aligned squares.
assert.equal(R.checkWin(put([7,8,14,13]), 1), null);
assert.deepEqual(R.checkWin(put([7,8,14,13]), 2), { line:[7,8,14,13], colour:"black" });
// Level 3 adds spaced board-aligned squares.
assert.equal(R.checkWin(put([7,10,28,25]), 2), null);
assert.deepEqual(R.checkWin(put([7,10,28,25]), 3), { line:[7,10,28,25], colour:"black" });
// Level 4 adds tight 45-degree diamonds.
assert.equal(R.checkWin(put([2,9,14,7],"white"), 3), null);
assert.deepEqual(R.checkWin(put([2,9,14,7],"white"), 4), { line:[2,9,14,7], colour:"white" });
// Level 5 adds spaced diamonds.
assert.equal(R.checkWin(put([2,16,26,12],"white"), 4), null);
assert.deepEqual(R.checkWin(put([2,16,26,12],"white"), 5), { line:[2,16,26,12], colour:"white" });

assert.equal(R.checkWin(put([0,1,2]), 5), null);
assert.equal(R.checkWin(put([0,9,14,29]), 5), null);

// A colour with no physical reserve piece cannot be handed to the next player.
assert.deepEqual(R.availableReserveColours({ black: 8, white: 0 }), ["black"]);
assert.deepEqual(R.availableReserveColours({ black: 0, white: 3 }), ["white"]);
assert.deepEqual(R.availableReserveColours({ black: 0, white: 0 }), []);

let board=emptyBoard(); board[0]=piece("white");
assert.deepEqual(R.adjacentDestinations(board,0).sort((a,b)=>a-b),[1,6,7]);
board[1]=piece("black"); assert.equal(R.jumpDestinations(board,0).some(j=>j.to===2&&j.over===1),true);
board[6]=piece("black"); assert.equal(R.jumpDestinations(board,0).some(j=>j.to===12&&j.over===6),true);
board[7]=piece("black"); assert.equal(R.jumpDestinations(board,0).some(j=>j.to===14&&j.over===7),true);

// Undo restores the preceding completed decision even after the current piece has been handed/picked.
// Piece commitment prevents cancelling that selection; it must not suppress completed-turn Undo.
const fs = require("node:fs");
const appSource = fs.readFileSync(require.resolve("../js/app.js"), "utf8");
assert.match(appSource, /undoButton\.disabled = computerBusy \|\| checkpoints\.length === 0;/);
assert.doesNotMatch(appSource, /undoButton\.disabled[^;]*(selectedReserveIndex|selectedPieceIndex)/);

console.log("Lipfty 5 level-based win rules and Undo regression tests passed.");
