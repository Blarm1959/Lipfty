"use strict";

const assert=require("node:assert/strict");
const R=require("./run-lipfty7-configurable.js");

(function testDefault(){
  const o=R.parseArgs([]),c=R.resolveConfigurations(o);
  assert.equal(c.length,1);
  assert.equal(c[0].alias,"e1-on-player");
  assert.equal(c[0].rules.allowMove,true);
  assert.equal(c[0].rules.allowSquare,true);
  assert.equal(c[0].rules.allowSpacedSquare,true);
  assert.equal(c[0].finalFourColourPolicy,"tactical");
  assert.equal(c[0].oneColourPolicy,"placement-only");
})();

(function testFresh10000Run(){
  const o=R.parseArgs(["--config","e1-on-player","--games","10000","--seed","5001"]),c=R.resolveConfigurations(o);
  assert.equal(o.games,10000);
  assert.equal(o.seed,5001);
  assert.equal(c.length,1);
  assert.equal(c[0].alias,"e1-on-player");
})();

(function testMultiplePresets(){
  const o=R.parseArgs(["--config","e1-on-player","--config","e4-on-opponent","--games","50"]),c=R.resolveConfigurations(o);
  assert.equal(c.length,2);
  assert.equal(c[0].alias,"e1-on-player");
  assert.equal(c[1].alias,"e4-on-opponent");
})();

(function testDirectOverrides(){
  const o=R.parseArgs(["--squares","tight","--move","off","--jump","on","--final-four","opponent","--one-colour","placement-only"]),c=R.resolveConfigurations(o);
  assert.equal(c.length,1);
  assert.equal(c[0].rules.allowSquare,true);
  assert.equal(c[0].rules.allowSpacedSquare,false);
  assert.equal(c[0].rules.spacedSquareOnly,false);
  assert.equal(c[0].rules.allowMove,false);
  assert.equal(c[0].rules.allowJump,true);
  assert.equal(c[0].finalFourColourPolicy,"opponent");
})();

(function testAllSquareModes(){
  const expected={both:[true,true,false],tight:[true,false,false],none:[false,false,false],spaced:[false,false,true]};
  for(const [name,want] of Object.entries(expected)){
    const c=R.resolveConfigurations(R.parseArgs(["--squares",name]))[0];
    assert.deepEqual([c.rules.allowSquare,c.rules.allowSpacedSquare,c.rules.spacedSquareOnly],want);
  }
})();

(function testPolicyOverrides(){
  const o=R.parseArgs(["--jump-colour","any","--jump-consequence","redeploy-only","--response","committed","--boundary","current","--one-colour","current"]),c=R.resolveConfigurations(o)[0];
  assert.equal(c.jumpPolicy,"any");
  assert.equal(c.jumpConsequence,"redeploy-only");
  assert.equal(c.responsePolicy,"committed");
  assert.equal(c.boundaryPolicy,"current");
  assert.equal(c.oneColourPolicy,"current");
})();

console.log("Lipfty 7 configurable simulation runner tests passed.");
