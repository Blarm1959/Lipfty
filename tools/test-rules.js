global.window = global;
require("../js/rules.js");
const assert = require("node:assert/strict");
const R = global.LipftyRules;
const piece = colour => ({ colour });
const emptyBoard = () => Array(R.SIZE * R.SIZE).fill(null);
const put = (indices, colour="black") => { const b=emptyBoard(); indices.forEach(i=>b[i]=piece(colour)); return b; };

assert.equal(R.SIZE, 6);
assert.equal(R.WIN_LENGTH, 4);

// Level 1: horizontal / vertical only.
assert.deepEqual(R.checkWin(put([0,1,2,3]), 1), { line:[0,1,2,3], colour:"black" });
assert.deepEqual(R.checkWin(put([2,8,14,20],"white"), 1), { line:[2,8,14,20], colour:"white" });
assert.equal(R.checkWin(put([2,9,16,23]), 1), null);
// Levels 2 and 3 add jump/move mechanics, not winning patterns.
assert.equal(R.checkWin(put([2,9,16,23]), 3), null);
// Level 4 adds diagonal four-in-a-row.
assert.deepEqual(R.checkWin(put([2,9,16,23]), 4), { line:[2,9,16,23], colour:"black" });
// Level 5 adds tight board-aligned squares.
assert.equal(R.checkWin(put([7,8,14,13]), 4), null);
assert.deepEqual(R.checkWin(put([7,8,14,13]), 5), { line:[7,8,14,13], colour:"black" });
// Level 6 adds spaced board-aligned squares.
assert.equal(R.checkWin(put([7,10,28,25]), 5), null);
assert.deepEqual(R.checkWin(put([7,10,28,25]), 6), { line:[7,10,28,25], colour:"black" });
// Level 7 adds tight 45-degree diamonds.
assert.equal(R.checkWin(put([2,9,14,7],"white"), 6), null);
assert.deepEqual(R.checkWin(put([2,9,14,7],"white"), 7), { line:[2,9,14,7], colour:"white" });
// Level 8 adds spaced diamonds.
assert.equal(R.checkWin(put([2,16,26,12],"white"), 7), null);
assert.deepEqual(R.checkWin(put([2,16,26,12],"white"), 8), { line:[2,16,26,12], colour:"white" });

assert.equal(R.checkWin(put([0,1,2]), 8), null);
assert.equal(R.checkWin(put([0,9,14,29]), 8), null);

// A colour with no physical reserve piece cannot be handed to the next player.
assert.deepEqual(R.availableReserveColours({ black: 8, white: 0 }), ["black"]);
assert.deepEqual(R.availableReserveColours({ black: 0, white: 3 }), ["white"]);
assert.deepEqual(R.availableReserveColours({ black: 0, white: 0 }), []);

let board=emptyBoard(); board[0]=piece("white");
assert.deepEqual(R.adjacentDestinations(board,0).sort((a,b)=>a-b),[1,6,7]);
board[1]=piece("black"); assert.equal(R.jumpDestinations(board,0).some(j=>j.to===2&&j.over===1),true);
board[6]=piece("black"); assert.equal(R.jumpDestinations(board,0).some(j=>j.to===12&&j.over===6),true);
board[7]=piece("black"); assert.equal(R.jumpDestinations(board,0).some(j=>j.to===14&&j.over===7),true);

const fs = require("node:fs");
const appSource = fs.readFileSync(require.resolve("../js/app.js"), "utf8");
// Level progression gates jump before move.
assert.match(appSource, /function jumpAllowed\(\)\{return Number\(settings\.winLevel \|\| 1\) >= 2;\}/);
assert.match(appSource, /function moveAllowed\(\)\{return Number\(settings\.winLevel \|\| 1\) >= 3;\}/);
// Exactly one remaining normal reserve piece is automatically picked up.
assert.match(appSource, /normalReserveRemaining\("black"\) \+ normalReserveRemaining\("white"\) === 1/);
// Undo remains a completed-turn facility despite piece commitment.
assert.match(appSource, /undoButton\.disabled = computerBusy \|\| checkpoints\.length === 0;/);
assert.doesNotMatch(appSource, /undoButton\.disabled[^;]*(selectedReserveIndex|selectedPieceIndex)/);

console.log("Lipfty 5 eight-level rules, final-reserve auto-pick and Undo regression tests passed.");
