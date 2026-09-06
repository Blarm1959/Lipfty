global.window = global;
require("../js/rules.js");
const assert = require("node:assert/strict");
const R = global.LipftyRules;
const piece = colour => ({ colour });
const emptyBoard = () => Array(R.SIZE * R.SIZE).fill(null);
const put = (indices, colour="black") => { const b=emptyBoard(); indices.forEach(i=>b[i]=piece(colour)); return b; };

assert.equal(R.SIZE, 6);
assert.equal(R.WIN_LENGTH, 4);

// Basic Lipfty: horizontal / vertical only.
assert.deepEqual(R.checkWin(put([0,1,2,3])), { line:[0,1,2,3], colour:"black" });
assert.deepEqual(R.checkWin(put([2,8,14,20],"white")), { line:[2,8,14,20], colour:"white" });
assert.equal(R.checkWin(put([2,9,16,23])), null);
// Winning options are independently switchable.
assert.deepEqual(R.checkWin(put([2,9,16,23]), {allowDiagonal:true}), { line:[2,9,16,23], colour:"black" });
assert.equal(R.checkWin(put([7,8,14,13])), null);
assert.deepEqual(R.checkWin(put([7,8,14,13]), {allowSquare:true}), { line:[7,8,14,13], colour:"black" });
assert.equal(R.checkWin(put([7,10,28,25]), {allowSquare:true}), null);
assert.deepEqual(R.checkWin(put([7,10,28,25]), {allowSquare:true,allowSpacedSquare:true}), { line:[7,10,28,25], colour:"black" });
assert.equal(R.checkWin(put([2,9,14,7],"white")), null);
assert.deepEqual(R.checkWin(put([2,9,14,7],"white"), {allowDiamond:true}), { line:[2,9,14,7], colour:"white" });
assert.equal(R.checkWin(put([2,16,26,12],"white"), {allowDiamond:true}), null);
assert.deepEqual(R.checkWin(put([2,16,26,12],"white"), {allowDiamond:true,allowSpacedDiamond:true}), { line:[2,16,26,12], colour:"white" });
// Spaced variants do nothing unless their parent formation is enabled.
assert.equal(R.checkWin(put([7,10,28,25]), {allowSpacedSquare:true}), null);
assert.equal(R.checkWin(put([2,16,26,12],"white"), {allowSpacedDiamond:true}), null);

assert.equal(R.checkWin(put([0,1,2]), {}), null);
assert.equal(R.checkWin(put([0,9,14,29]), {allowDiagonal:true,allowSquare:true,allowSpacedSquare:true,allowDiamond:true,allowSpacedDiamond:true}), null);

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
// Jump and move are independent optional rules.
assert.match(appSource, /function jumpAllowed\(\)\{return !!settings\.allowJump;\}/);
assert.match(appSource, /function moveAllowed\(\)\{return !!settings\.allowMove;\}/);
// Exactly one remaining normal reserve piece is automatically picked up.
assert.match(appSource, /normalReserveRemaining\("black"\) \+ normalReserveRemaining\("white"\) === 1/);
// The exact normal reserve-ring piece selected must be the one consumed on placement.
assert.match(appSource, /function consumeSelectedNormalReservePiece\(colour\)/);
assert.match(appSource, /state\.reserveLayout\.active\[pickedIndex\] = null;/);
assert.match(appSource, /if \(!cornerOpeningPlacement\) consumeSelectedNormalReservePiece\(colour\);/);
assert.match(appSource, /if \(!cornerOpeningPlacement\) consumeSelectedNormalReservePiece\(action\.colour\);/);
// Undo snapshots must preserve the physical reserve layout after exact pieces are consumed.
assert.match(appSource, /active: \[\.\.\.state\.reserveLayout\.active\]/);
assert.match(appSource, /active: \[\.\.\.snap\.state\.reserveLayout\.active\]/);

// Undo remains a completed-turn facility despite piece commitment.
assert.match(appSource, /undoButton\.disabled = computerBusy \|\| checkpoints\.length === 0;/);
assert.doesNotMatch(appSource, /undoButton\.disabled[^;]*(selectedReserveIndex|selectedPieceIndex)/);

console.log("Lipfty 5 switchable rules, exact reserve-piece identity, final-reserve auto-pick and Undo regression tests passed.");
