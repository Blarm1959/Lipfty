"use strict";
const assert=require("assert");
const {allRuleConfigurations,freshState,chooseColour,chooseAction}=require("./lipfty6-simulator.js");
const {traceGame,findSeed,colourChoiceDiagnostics}=require("./trace-lipfty6-game.js");

// Strategy symmetry: player number itself must not alter colour/action choice.
const rules=allRuleConfigurations()[9]; // Diagonal
const a=freshState(12345), b=freshState(12345); b.currentPlayer=1;
const ca=chooseColour(a,rules,"tactical"), cb=chooseColour(b,rules,"tactical");
assert.strictEqual(ca,cb,"Tactical colour choice depends on P1/P2 identity");
const aa=chooseAction(a,ca,rules,"tactical"), ab=chooseAction(b,cb,rules,"tactical");
assert.deepStrictEqual(aa,ab,"Tactical action choice depends on P1/P2 identity");

// Diagnostic evaluation must be observational: it must not consume RNG state.
const d1=freshState(9876), d2=freshState(9876);
d1.openingRemaining=0; d2.openingRemaining=0;
d1.cornerRemaining={black:0,white:0}; d2.cornerRemaining={black:0,white:0};
const diag=colourChoiceDiagnostics(d1,rules,"tactical");
assert.strictEqual(diag.evaluations.length,2);
assert.ok(diag.evaluations.every(e=>typeof e.immediateWins==="number"));
assert.strictEqual(chooseColour(d1,rules,"tactical"),chooseColour(d2,rules,"tactical"),"Diagnostics changed seeded colour choice");

const trace=traceGame({config:10,seed:1,strength:"tactical"});
assert.match(trace,/Configuration #10: Diagonal/);
assert.match(trace,/Turn 1 - P1/);
assert.match(trace,/Hand-over evaluation:/);
assert.match(trace,/receiver best score=/);
assert.match(trace,/Decision:/);
assert.match(trace,/Result: P[12] wins|Result: draw/);
assert.match(trace,/Winning cells:|Result: draw/);

const found=findSeed({config:10,seed:1,strength:"tactical",find:"P2",maxTurns:30,searchLimit:100});
assert.ok(found,"Expected to locate a P2 win in first 100 Learning seeds");
assert.strictEqual(found.game.winner,1);
assert.ok(found.game.turns<=30);

console.log("Lipfty 6 diagnostic trace, hand-over audit and seed-finder tests passed.");
