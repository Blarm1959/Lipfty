"use strict";
const assert=require("assert");
const {allRuleConfigurations,freshState,chooseColour,chooseAction}=require("./lipfty6-simulator.js");
const {traceGame}=require("./trace-lipfty6-game.js");

// Strategy symmetry: player number itself must not alter colour/action choice.
// Give two otherwise identical states the same RNG state and only swap currentPlayer.
const rules=allRuleConfigurations()[9]; // Diagonal
const a=freshState(12345), b=freshState(12345); b.currentPlayer=1;
const ca=chooseColour(a,rules,"tactical"), cb=chooseColour(b,rules,"tactical");
assert.strictEqual(ca,cb,"Tactical colour choice depends on P1/P2 identity");
const aa=chooseAction(a,ca,rules,"tactical"), ab=chooseAction(b,cb,rules,"tactical");
assert.deepStrictEqual(aa,ab,"Tactical action choice depends on P1/P2 identity");

const trace=traceGame({config:10,seed:1,strength:"tactical"});
assert.match(trace,/Configuration #10: Diagonal/);
assert.match(trace,/Turn 1 - P1/);
assert.match(trace,/Result: P[12] wins|Result: draw/);
assert.match(trace,/Winning cells:|Result: draw/);
console.log("Lipfty 6 diagnostic trace and player-symmetry tests passed.");
