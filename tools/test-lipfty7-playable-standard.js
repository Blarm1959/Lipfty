"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const pdf = path.join(root, "Lipfty-Rules.pdf");
const serviceWorker = fs.readFileSync(path.join(root, "service-worker.js"), "utf8");

function has(text, description) {
  assert.ok(app.includes(text), description || `Missing app contract: ${text}`);
}

// Confirm the new playable baseline is the same E1 rule set as the simulator winner.
for (const text of [
  "allowJump: true",
  "allowMove: true",
  "allowDiagonal: true",
  "allowSquare: true",
  "allowSpacedSquare: true",
  "allowDiamond: false",
  "allowSpacedDiamond: false",
  "rulesBaseline: 7"
]) has(text, `Standard default missing ${text}`);

// One-colour phase must disable both Move and Jump.
has('normalReserveColourCount() === 1', "One-colour placement-only detector missing.");
const moveFn = app.slice(app.indexOf("function moveAllowedNow"), app.indexOf("function jumpAllowedNow"));
const jumpFn = app.slice(app.indexOf("function jumpAllowedNow"), app.indexOf("function firstNormalReserveIndex"));
assert.ok(moveFn.includes("!oneColourPlacementOnly()"), "Move must stop in the one-colour phase.");
assert.ok(jumpFn.includes("!oneColourPlacementOnly()"), "Jump must stop in the one-colour phase.");

// Move consequence: responder places first, chooses second for mover, responder then gets next normal turn.
const beginMove = app.slice(app.indexOf("function beginMoveConsequence"), app.indexOf("function advanceMoveConsequence"));
assert.ok(beginMove.includes("state.currentPlayer = responder"), "Responder must take first compulsory placement.");
assert.ok(beginMove.includes("state.colourChooser = responder"), "Responder must choose their first compulsory reserve piece.");
const advanceMove = app.slice(app.indexOf("function advanceMoveConsequence"), app.indexOf("function finishRedeploy"));
assert.ok(advanceMove.includes("state.currentPlayer = c.mover"), "Original mover must make the second compulsory placement.");
assert.ok(advanceMove.includes("state.colourChooser = c.responder"), "Responder must choose the second reserve piece for the mover.");
assert.ok(advanceMove.includes("startNextNormalTurn(responder, mover, protectedPieceId)"), "Responder must receive the next normal turn after the two placements.");

// Jump must test the direct win before lifting the jumped piece, then redeploy that exact object.
const moveBoard = app.slice(app.indexOf("function moveBoardPiece"), app.indexOf("function handleCell"));
const winPos = moveBoard.indexOf("if (finishWin()) return;");
const liftPos = moveBoard.indexOf("state.board[jump.over] = null");
assert.ok(winPos >= 0 && liftPos > winPos, "Direct Jump win must be checked before the jumped piece is lifted.");
assert.ok(moveBoard.includes("state.redeployPiece = jumpedPiece"), "Jump must retain the exact jumped piece for redeployment.");
const redeploy = app.slice(app.indexOf("function finishRedeploy"), app.indexOf("function placeAt"));
assert.ok(redeploy.includes("state.currentPlayer = responder"), "Responder must keep the next normal turn after redeployment.");
assert.ok(redeploy.includes("state.colourChooser = jumper"), "Original jumper must choose the responder's next reserve colour.");

// Opposite-colour-only and single Jump.
const legalJump = app.slice(app.indexOf("function legalSingleJumps"), app.indexOf("function selectPiece"));
assert.ok(legalJump.includes("over.colour !== piece.colour"), "Jump must be over an opposite-colour piece only.");
assert.ok(!app.includes("jump again with the same piece"), "Multi-jump UI must not be present in Lipfty 7 Standard.");

// Final Four remains player-choice and placement-only.
has("state.colourChooser = state.currentPlayer", "Final Four must be self-chosen by current player.");
assert.ok(html.includes("Final Four is placement-only"), "Help must document placement-only Final Four.");

// Help/UI must describe the frozen Standard rule rather than the old Lipfty 5 consequence.
for (const text of [
  "Lipfty 7 Standard",
  "After a Jump",
  "redeploys that exact piece",
  "One-colour finish",
  "Move and Jump stop",
  "tight 2×2 square",
  "spaced board-aligned square",
  "Printable Lipfty 7 rules (PDF)"
]) assert.ok(html.includes(text), `Updated Help/UI missing: ${text}`);
assert.ok(!html.includes("If you <strong>move or jump</strong>, take any two corner markers"), "Old Move/Jump shared consequence must be removed.");
assert.ok(!html.includes("Lipfty 5</h1>"), "Old Lipfty 5 heading must be removed.");

assert.ok(fs.existsSync(pdf) && fs.statSync(pdf).size > 1000, "Printable Lipfty-Rules.pdf is missing or empty.");
assert.ok(serviceWorker.includes("./Lipfty-Rules.pdf"), "Printable rules PDF must be available in the offline app shell.");

console.log("Lipfty 7 playable Standard baseline tests passed.");
