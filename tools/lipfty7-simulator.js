"use strict";

// Lipfty 7 analysis-only simulator. Learning/Core are unchanged because they
// do not allow Move/Jump. Standard can compare two Move/Jump response timings:
//   committed  - responder chooses both reserve pieces before placing either;
//   sequential - responder chooses/places their piece first, then chooses the
//                remaining reserve piece that the mover must place.
// The exactly-one-normal-reserve boundary can also be compared independently:
//   current          - responder places the last normal piece, then chooses the
//                      mover's compulsory Final Four corner;
//   responder-choice - responder chooses whether to place the last normal piece
//                      or a corner first. The mover then places the other type.
//
// Jump colour remains an analysis parameter. The released Lipfty rule remains
// opposite-colour-only; experimental any-colour jump is still available only
// for simulation and does not change the playable app or rule switches.
// Jump consequence can also be compared independently:
//   current  - jumped piece stays put; normal two-placement response applies;
//   redeploy      - after a non-winning Jump, the jumped piece is lifted and the
//                   responder immediately places that exact piece, then chooses
//                   one normal reserve piece that the jumper must place.
//   redeploy-only - the responder immediately places the exact jumped piece and
//                   the consequence ends. No reserve piece is consumed; normal
//                   play resumes with the jumper, with ordinary Move disabled by
//                   the comparison configuration.
//   redeploy-pass - the responder immediately places the exact jumped piece and
//                   then also receives the next normal turn. No reserve piece is
//                   consumed by the Jump; the jumper chooses the normal reserve
//                   colour handed to the responder in the usual way.
global.window = global;
if (!global.LipftyRules) require("../js/rules.js");
const R = global.LipftyRules;

const COLOURS = ["black", "white"];
const OTHER = p => 1 - p;
const WIN_SCORE = 1e9;
const RESPONSE_SEARCH_LIMIT = 6;
const JUMP_POLICIES = ["opposite","any"];
const RESPONSE_POLICIES = ["committed","sequential"];
const BOUNDARY_POLICIES = ["current","responder-choice"];
const JUMP_CONSEQUENCE_POLICIES = ["current","redeploy","redeploy-only","redeploy-pass"];
const FINAL_FOUR_COLOUR_POLICIES = ["random","tactical","opponent"];
const ONE_COLOUR_POLICIES = ["current","placement-only"];
const patternCache = new Map();

function normaliseJumpPolicy(value="opposite") {
  if(!JUMP_POLICIES.includes(value))throw new Error(`jumpPolicy must be one of: ${JUMP_POLICIES.join(", ")}.`);
  return value;
}
function normaliseResponsePolicy(value="committed") {
  if(!RESPONSE_POLICIES.includes(value))throw new Error(`responsePolicy must be one of: ${RESPONSE_POLICIES.join(", ")}.`);
  return value;
}
function normaliseBoundaryPolicy(value="current") {
  if(!BOUNDARY_POLICIES.includes(value))throw new Error(`boundaryPolicy must be one of: ${BOUNDARY_POLICIES.join(", ")}.`);
  return value;
}
function normaliseJumpConsequencePolicy(value="current") {
  if(!JUMP_CONSEQUENCE_POLICIES.includes(value))throw new Error(`jumpConsequence must be one of: ${JUMP_CONSEQUENCE_POLICIES.join(", ")}.`);
  return value;
}
function normaliseFinalFourColourPolicy(value="random") {
  if(!FINAL_FOUR_COLOUR_POLICIES.includes(value))throw new Error(`finalFourColourPolicy must be one of: ${FINAL_FOUR_COLOUR_POLICIES.join(", ")}.`);
  return value;
}
function normaliseOneColourPolicy(value="current") {
  if(!ONE_COLOUR_POLICIES.includes(value))throw new Error(`oneColourPolicy must be one of: ${ONE_COLOUR_POLICIES.join(", ")}.`);
  return value;
}

function patternKey(rules) {
  const r=normaliseRules(rules);
  return [r.allowDiagonal,r.allowSquare,r.allowSpacedSquare,r.spacedSquareOnly,r.allowDiamond,r.allowSpacedDiamond].map(Number).join("");
}
function patternGroups() {
  const straight=R.WINNING_LINES;
  const orth=straight.filter(p=>{const rs=p.map(i=>Math.floor(i/6)),cs=p.map(i=>i%6);return new Set(rs).size===1||new Set(cs).size===1;});
  const diag=straight.filter(p=>!orth.includes(p));
  const tightSquare=R.WINNING_SQUARES.filter(p=>Math.abs((p[1]%6)-(p[0]%6))===1);
  const spacedSquare=R.WINNING_SQUARES.filter(p=>Math.abs((p[1]%6)-(p[0]%6))>1);
  const tightDiamond=R.WINNING_DIAMONDS.filter(p=>Math.abs(Math.floor(p[1]/6)-Math.floor(p[0]/6))===1);
  return {orth,diag,tightSquare,spacedSquare,tightDiamond};
}
const PATTERN_GROUPS=patternGroups();
function compiledPatterns(rules) {
  const key=patternKey(rules);
  if(patternCache.has(key)) return patternCache.get(key);
  const r=normaliseRules(rules),patterns=[...PATTERN_GROUPS.orth];
  if(r.allowDiagonal) patterns.push(...PATTERN_GROUPS.diag);
  if(r.spacedSquareOnly) patterns.push(...PATTERN_GROUPS.spacedSquare);
  else {
    if(r.allowSquare) patterns.push(...PATTERN_GROUPS.tightSquare);
    if(r.allowSquare&&r.allowSpacedSquare) patterns.push(...R.WINNING_SQUARES);
  }
  if(r.allowDiamond) patterns.push(...PATTERN_GROUPS.tightDiamond);
  if(r.allowDiamond&&r.allowSpacedDiamond) patterns.push(...R.WINNING_DIAMONDS);
  const byCell=Array.from({length:36},()=>[]);
  for(const pattern of patterns) for(const cell of pattern) byCell[cell].push(pattern);
  const result={patterns,byCell};patternCache.set(key,result);return result;
}
function fastCheckWin(board,rules,changedCell=null) {
  const compiled=compiledPatterns(rules),patterns=changedCell===null?compiled.patterns:compiled.byCell[changedCell];
  for(const pattern of patterns){
    const first=board[pattern[0]];if(!first)continue;
    if(pattern.every(i=>board[i]&&board[i].colour===first.colour)) return {line:[...pattern],colour:first.colour};
  }
  return null;
}
function mulberry32(seed) {
  let a=seed>>>0;
  return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
}
function shuffle(values,rng) {
  const a=[...values];
  for(let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
  return a;
}
function normaliseRules(r={}) {
  return {
    allowJump:!!r.allowJump,allowMove:!!r.allowMove,allowDiagonal:!!r.allowDiagonal,
    allowSquare:!!r.allowSquare,allowSpacedSquare:!!r.allowSquare&&!!r.allowSpacedSquare,spacedSquareOnly:!!r.spacedSquareOnly,
    allowDiamond:!!r.allowDiamond,allowSpacedDiamond:!!r.allowDiamond&&!!r.allowSpacedDiamond
  };
}
function allRuleConfigurations() {
  const out=[];
  for(const allowJump of [false,true]) for(const allowMove of [false,true]) for(const allowDiagonal of [false,true])
    for(const square of [0,1,2]) for(const diamond of [0,1,2]) out.push(normaliseRules({
      allowJump,allowMove,allowDiagonal,allowSquare:square>0,allowSpacedSquare:square===2,
      allowDiamond:diamond>0,allowSpacedDiamond:diamond===2
    }));
  return out;
}
function recommendedRuleConfigurations() {
  return [
    {name:"Learning",rules:normaliseRules({allowDiagonal:true})},
    {name:"Core",rules:normaliseRules({allowDiagonal:true,allowSquare:true,allowSpacedSquare:true})},
    {name:"Standard",rules:normaliseRules({allowJump:true,allowMove:true,allowDiagonal:true,allowSquare:true,allowSpacedSquare:true})}
  ];
}
function freshState(seed=1,jumpPolicy="opposite",responsePolicy="committed",boundaryPolicy="current",jumpConsequence="current",oneColourPolicy="current") {
  jumpPolicy=normaliseJumpPolicy(jumpPolicy);responsePolicy=normaliseResponsePolicy(responsePolicy);boundaryPolicy=normaliseBoundaryPolicy(boundaryPolicy);jumpConsequence=normaliseJumpConsequencePolicy(jumpConsequence);oneColourPolicy=normaliseOneColourPolicy(oneColourPolicy);
  const rng=mulberry32(seed),cornerColours=shuffle(["black","black","white","white"],rng);
  return {
    board:Array(36).fill(null),currentPlayer:0,openingRemaining:4,cornerRemaining:{black:2,white:2},
    normalRemaining:{black:12,white:12},finalPieces:[...cornerColours],forcedPlacements:0,forcedQueue:[],
    awaitingMoveResponse:false,awaitingJumpRedeploy:false,boundaryCornerOwed:false,boundarySelfCornerOwed:false,sequentialSecondOwed:false,sequentialFirstColour:null,
    protectedPieceId:null,nextPieceId:1,finalFour:false,winner:null,turns:0,reachedFinalFour:false,
    jumpPolicy,responsePolicy,boundaryPolicy,jumpConsequence,oneColourPolicy,rng
  };
}
function cloneState(s) {
  return {
    ...s,
    board:s.board.slice(),cornerRemaining:{...s.cornerRemaining},normalRemaining:{...s.normalRemaining},
    finalPieces:[...s.finalPieces],forcedQueue:s.forcedQueue.map(x=>({...x}))
  };
}
function emptySquares(s){const a=[];for(let i=0;i<36;i++)if(!s.board[i])a.push(i);return a;}
function normalReserveCount(s){return s.normalRemaining.black+s.normalRemaining.white;}
function availableColours(s) {
  if(s.forcedQueue.length) return [s.forcedQueue[0].colour];
  if(s.openingRemaining>0) return COLOURS.filter(c=>s.cornerRemaining[c]>0);
  if(s.finalFour) return COLOURS.filter(c=>s.finalPieces.includes(c));
  return COLOURS.filter(c=>s.normalRemaining[c]>0);
}
function legalJumps(s,from,rules) {
  if(!rules.allowJump)return[];
  const moving=s.board[from];if(!moving)return[];
  const jumps=R.jumpDestinations(s.board,from).filter(j=>!!s.board[j.over]);
  if(s.jumpPolicy==="any")return jumps;
  return jumps.filter(j=>s.board[j.over].colour!==moving.colour);
}
function forcedPlacementActions(s,colour,source) {
  const type=source==="final"?"final-place":"place";
  return emptySquares(s).map(to=>({type,to,colour}));
}
function enumerateActions(s,colour,rules) {
  if(s.awaitingMoveResponse||s.awaitingJumpRedeploy||((s.sequentialSecondOwed||s.boundarySelfCornerOwed)&&!s.forcedQueue.length)) return [];
  if(s.forcedQueue.length) {
    const q=s.forcedQueue[0];
    if(colour!==q.colour)return[];
    return forcedPlacementActions(s,q.colour,q.source);
  }
  const actions=[],empties=emptySquares(s);
  const oneColourPlacementOnly=s.oneColourPolicy==="placement-only"&&s.openingRemaining===0&&!s.finalFour&&normalColourCount(s)===1;
  const placementOnly=s.openingRemaining>0||s.finalFour||s.forcedPlacements>0||oneColourPlacementOnly;
  const reserveCount=s.openingRemaining>0?s.cornerRemaining[colour]:s.finalFour?s.finalPieces.filter(c=>c===colour).length:s.normalRemaining[colour];
  if(reserveCount>0) for(const to of empties) actions.push({type:s.openingRemaining>0?"opening-place":s.finalFour?"final-place":"place",to,colour});
  if(placementOnly)return actions;
  for(let from=0;from<36;from++){
    const p=s.board[from];if(!p||p.colour!==colour||p.id===s.protectedPieceId)continue;
    if(rules.allowMove)for(const to of R.adjacentDestinations(s.board,from))actions.push({type:"move",from,to,colour});
    if(rules.allowJump)for(const j of legalJumps(s,from,rules))actions.push({type:"jump",from,to:j.to,over:j.over,colour});
  }
  return actions;
}
function boardAfter(s,a) {
  const b=s.board.slice();
  if(a.type.includes("place"))b[a.to]={id:-1,colour:a.colour};else{b[a.to]=b[a.from];b[a.from]=null;}
  return b;
}
function actionWins(s,a,rules){return!!fastCheckWin(boardAfter(s,a),rules,a.to);}
function immediateWinningActions(s,colour,rules){return enumerateActions(s,colour,rules).filter(a=>actionWins(s,a,rules));}
function hasImmediateWinningAction(s,colour,rules){for(const a of enumerateActions(s,colour,rules))if(actionWins(s,a,rules))return true;return false;}
function handoverDanger(s,rules) {
  const colours=availableColours(s);
  if(!colours.length)return{safe:true,minImmediateWins:0,totalImmediateWins:0,immediateWins:[]};
  const immediateWins=colours.map(c=>immediateWinningActions(s,c,rules).length);
  return{safe:immediateWins.some(n=>n===0),minImmediateWins:Math.min(...immediateWins),totalImmediateWins:immediateWins.reduce((a,b)=>a+b,0),immediateWins};
}
function neutralPatternPotential(board,rules) {
  const weights=[0,1,5,24,100000];let score=0;
  for(const pattern of compiledPatterns(rules).patterns){
    let black=0,white=0;
    for(const i of pattern){const p=board[i];if(!p)continue;if(p.colour==="black")black++;else white++;}
    if(black&&white)continue;score+=weights[black||white];
  }
  return score;
}
function placementStaticScore(s,a,rules) {
  const b=boardAfter(s,a);if(fastCheckWin(b,rules,a.to))return WIN_SCORE;
  const rr=Math.floor(a.to/6),cc=a.to%6;
  return(2.5-Math.abs(rr-2.5))+(2.5-Math.abs(cc-2.5))+neutralPatternPotential(b,rules);
}
function topPlacementCandidates(s,colour,source,rules,limit) {
  const actions=forcedPlacementActions(s,colour,source);
  if(actions.length<=limit)return actions;
  const scored=actions.map(a=>({a,score:placementStaticScore(s,a,rules)})).sort((x,y)=>y.score-x.score||x.a.to-y.a.to);
  const wins=scored.filter(x=>x.score>=WIN_SCORE).map(x=>x.a);
  if(wins.length>=limit)return wins;
  const chosen=[...wins],used=new Set(wins.map(a=>a.to));
  for(const x of scored){if(used.has(x.a.to))continue;chosen.push(x.a);if(chosen.length>=limit)break;}
  return chosen;
}
function applyAction(s,a,rules) {
  const wasForced=s.forcedQueue.length>0;
  let movedId=null;
  if(a.type.includes("place")){
    s.board[a.to]={id:s.nextPieceId++,colour:a.colour};
    if(a.type==="opening-place"){s.cornerRemaining[a.colour]--;s.openingRemaining--;}
    else if(a.type==="final-place"){
      const idx=s.finalPieces.indexOf(a.colour);if(idx<0)throw new Error(`No final ${a.colour} piece available.`);s.finalPieces.splice(idx,1);
    } else {
      if(s.normalRemaining[a.colour]<=0)throw new Error(`No normal ${a.colour} piece available.`);s.normalRemaining[a.colour]--;
    }
  } else {
    const p=s.board[a.from];movedId=p.id;s.board[a.to]=p;s.board[a.from]=null;
  }
  s.turns++;
  const win=fastCheckWin(s.board,rules,a.to);
  if(win){s.winner=s.currentPlayer;return{ended:true,winType:classifyWin(win),win};}
  if(a.type==="final-place"&&s.finalPieces.length===0){s.winner="draw";return{ended:true};}

  if(wasForced){
    s.forcedQueue.shift();
    s.forcedPlacements=s.forcedQueue.length+(s.boundaryCornerOwed?1:0)+(s.boundarySelfCornerOwed?1:0)+(s.sequentialSecondOwed?1:0);
  } else if(a.type==="move"||a.type==="jump") {
    if(normalReserveCount(s)>0){
      if(a.type==="jump"&&s.jumpConsequence!=="current"){
        s.awaitingJumpRedeploy=true;
        s.forcedPlacements=s.jumpConsequence==="redeploy"?2:1;
      }else{s.awaitingMoveResponse=true;s.forcedPlacements=2;}
    }
  } else if(s.forcedPlacements>0) {
    s.forcedPlacements=Math.max(0,s.forcedPlacements-1);
  }

  s.protectedPieceId=movedId;
  s.currentPlayer=OTHER(s.currentPlayer);
  if(normalReserveCount(s)===0&&s.openingRemaining===0){
    s.finalFour=true;s.reachedFinalFour=true;
  }
  return{ended:false};
}
function stateAfterForEvaluation(s,a,rules) {const t=cloneState(s);applyAction(t,a,rules);return t;}
function baseActionPositionalScore(s,a,rules) {
  const b=boardAfter(s,a);if(fastCheckWin(b,rules,a.to))return WIN_SCORE;
  const rr=Math.floor(a.to/6),cc=a.to%6;
  let score=(2.5-Math.abs(rr-2.5))+(2.5-Math.abs(cc-2.5));
  if(a.type==="jump")score+=0.25;
  score+=neutralPatternPotential(b,rules);
  const next=stateAfterForEvaluation(s,a,rules),danger=handoverDanger(next,rules);
  score+=danger.safe?2000:-2000-250*danger.minImmediateWins;
  score-=750*danger.totalImmediateWins;
  return score;
}
function responseAllocations(s) {
  const n=s.normalRemaining,out=[];
  if(n.black>=2)out.push({keep:"black",give:"black",pair:"black+black"});
  if(n.black>=1&&n.white>=1){
    out.push({keep:"black",give:"white",pair:"black+white"});
    out.push({keep:"white",give:"black",pair:"black+white"});
  }
  if(n.white>=2)out.push({keep:"white",give:"white",pair:"white+white"});
  return out;
}
function evaluatePairPlan(s,allocation,rules,limit) {
  const firstActions=topPlacementCandidates(s,allocation.keep,"normal",rules,limit);
  let best=null;
  for(const first of firstActions){
    let moverOutcome;
    if(actionWins(s,first,rules)) {
      moverOutcome=-WIN_SCORE;
    } else {
      const t=cloneState(s);
      t.awaitingMoveResponse=false;
      t.boundaryCornerOwed=false;
      t.forcedQueue=[{colour:allocation.keep,source:"normal",responseSlot:1},{colour:allocation.give,source:"normal",responseSlot:2}];
      t.forcedPlacements=2;
      applyAction(t,first,rules);
      const replies=topPlacementCandidates(t,allocation.give,"normal",rules,limit);
      moverOutcome=-Infinity;
      for(const reply of replies){
        const score=actionWins(t,reply,rules)?WIN_SCORE:baseActionPositionalScore(t,reply,rules);
        if(score>moverOutcome)moverOutcome=score;
      }
    }
    const firstStatic=placementStaticScore(s,first,rules);
    const plan={...allocation,firstTo:first.to,moverOutcome,firstStatic};
    if(!best||plan.moverOutcome<best.moverOutcome-1e-9||
      (Math.abs(plan.moverOutcome-best.moverOutcome)<1e-9&&plan.firstStatic>best.firstStatic+1e-9)) best=plan;
  }
  return best;
}
function bestTwoPieceResponsePlan(s,rules,limit=RESPONSE_SEARCH_LIMIT) {
  const allocations=responseAllocations(s);
  if(!allocations.length)throw new Error("Two-piece response requested with fewer than two normal reserve pieces.");
  let best=null;
  for(const allocation of allocations){
    const plan=evaluatePairPlan(s,allocation,rules,limit);
    if(!best||plan.moverOutcome<best.moverOutcome-1e-9||
      (Math.abs(plan.moverOutcome-best.moverOutcome)<1e-9&&plan.firstStatic>best.firstStatic+1e-9)) best=plan;
  }
  return best;
}
function chooseTwoPieceResponse(s,rules,strength="tactical") {
  const allocations=responseAllocations(s);
  if(strength==="random"){
    const allocation=allocations[Math.floor(s.rng()*allocations.length)];
    const actions=forcedPlacementActions(s,allocation.keep,"normal");
    const first=actions[Math.floor(s.rng()*actions.length)];
    return{...allocation,firstTo:first.to,moverOutcome:null,firstStatic:null};
  }
  const evaluated=allocations.map(a=>evaluatePairPlan(s,a,rules,RESPONSE_SEARCH_LIMIT));
  let min=Math.min(...evaluated.map(x=>x.moverOutcome));
  let candidates=evaluated.filter(x=>Math.abs(x.moverOutcome-min)<1e-9);
  const bestStatic=Math.max(...candidates.map(x=>x.firstStatic));
  candidates=candidates.filter(x=>Math.abs(x.firstStatic-bestStatic)<1e-9);
  return candidates[Math.floor(s.rng()*candidates.length)];
}
function responsePairKey(first,second) {
  return first===second?`${first}+${second}`:"black+white";
}
function evaluateSequentialSecondChoices(s,rules,limit=RESPONSE_SEARCH_LIMIT) {
  const colours=COLOURS.filter(c=>s.normalRemaining[c]>0),results=[];
  for(const colour of colours){
    const t=cloneState(s);
    t.sequentialSecondOwed=false;
    t.forcedQueue=[{colour,source:"normal",responseSlot:2}];
    t.forcedPlacements=1;
    const replies=topPlacementCandidates(t,colour,"normal",rules,limit);
    let moverOutcome=-Infinity;
    for(const reply of replies){
      const score=actionWins(t,reply,rules)?WIN_SCORE:baseActionPositionalScore(t,reply,rules);
      if(score>moverOutcome)moverOutcome=score;
    }
    results.push({colour,moverOutcome});
  }
  return results;
}
function evaluateSequentialFirstPlan(s,rules,limit=RESPONSE_SEARCH_LIMIT) {
  const colours=COLOURS.filter(c=>s.normalRemaining[c]>0);
  if(!colours.length)throw new Error("Sequential response requested with no normal reserve piece remaining.");
  let best=null;
  for(const colour of colours){
    const firstActions=topPlacementCandidates(s,colour,"normal",rules,limit);
    for(const first of firstActions){
      let moverOutcome;
      if(actionWins(s,first,rules)){
        moverOutcome=-WIN_SCORE;
      }else{
        const t=cloneState(s);
        t.awaitingMoveResponse=false;t.boundaryCornerOwed=false;t.sequentialSecondOwed=true;t.sequentialFirstColour=colour;
        t.forcedQueue=[{colour,source:"normal",responseSlot:1}];t.forcedPlacements=2;
        applyAction(t,first,rules);
        const secondChoices=evaluateSequentialSecondChoices(t,rules,limit);
        moverOutcome=Math.min(...secondChoices.map(x=>x.moverOutcome));
      }
      const firstStatic=placementStaticScore(s,first,rules);
      const plan={keep:colour,give:null,pair:"sequential-pending",firstTo:first.to,moverOutcome,firstStatic};
      if(!best||plan.moverOutcome<best.moverOutcome-1e-9||
        (Math.abs(plan.moverOutcome-best.moverOutcome)<1e-9&&plan.firstStatic>best.firstStatic+1e-9))best=plan;
    }
  }
  return best;
}
function chooseSequentialFirstPlan(s,rules,strength="tactical") {
  const colours=COLOURS.filter(c=>s.normalRemaining[c]>0);
  if(strength==="random"){
    const colour=colours[Math.floor(s.rng()*colours.length)];
    const actions=forcedPlacementActions(s,colour,"normal");
    const first=actions[Math.floor(s.rng()*actions.length)];
    return{keep:colour,give:null,pair:"sequential-pending",firstTo:first.to,moverOutcome:null,firstStatic:null};
  }
  return evaluateSequentialFirstPlan(s,rules,RESPONSE_SEARCH_LIMIT);
}
function chooseSequentialSecondColour(s,rules,strength="tactical") {
  const colours=COLOURS.filter(c=>s.normalRemaining[c]>0);
  if(!colours.length)throw new Error("Sequential second piece requested with no normal reserve piece remaining.");
  if(strength==="random")return colours[Math.floor(s.rng()*colours.length)];
  const choices=evaluateSequentialSecondChoices(s,rules,RESPONSE_SEARCH_LIMIT);
  const min=Math.min(...choices.map(x=>x.moverOutcome));
  const candidates=choices.filter(x=>Math.abs(x.moverOutcome-min)<1e-9);
  return candidates[Math.floor(s.rng()*candidates.length)].colour;
}
function evaluateMoverSelfCornerChoices(s,rules,limit=RESPONSE_SEARCH_LIMIT) {
  const colours=[...new Set(s.finalPieces)],results=[];
  for(const colour of colours){
    const actions=topPlacementCandidates(s,colour,"final",rules,limit);
    let moverOutcome=-Infinity,bestTo=null;
    for(const action of actions){
      const score=actionWins(s,action,rules)?WIN_SCORE:baseActionPositionalScore(s,action,rules);
      if(score>moverOutcome){moverOutcome=score;bestTo=action.to;}
    }
    results.push({colour,to:bestTo,moverOutcome});
  }
  return results;
}
function chooseBoundarySelfCornerPlan(s,rules,strength="tactical") {
  const colours=[...new Set(s.finalPieces)];
  if(!colours.length)throw new Error("Boundary self-corner requested with no Final Four corner remaining.");
  if(strength==="random"){
    const colour=colours[Math.floor(s.rng()*colours.length)];
    const actions=forcedPlacementActions(s,colour,"final");
    const action=actions[Math.floor(s.rng()*actions.length)];
    return{colour,to:action.to,moverOutcome:null};
  }
  const choices=evaluateMoverSelfCornerChoices(s,rules,RESPONSE_SEARCH_LIMIT);
  const max=Math.max(...choices.map(x=>x.moverOutcome));
  const candidates=choices.filter(x=>Math.abs(x.moverOutcome-max)<1e-9);
  return candidates[Math.floor(s.rng()*candidates.length)];
}
function evaluateBoundaryResponderChoicePlan(s,rules,limit=RESPONSE_SEARCH_LIMIT) {
  const normalColour=COLOURS.find(c=>s.normalRemaining[c]>0);
  if(!normalColour)throw new Error("Boundary responder-choice requested with no normal reserve piece remaining.");
  const plans=[];

  // Option A: responder places the last normal reserve. The mover then chooses
  // which Final Four corner to place for the second compulsory placement.
  for(const first of topPlacementCandidates(s,normalColour,"normal",rules,limit)){
    let moverOutcome;
    if(actionWins(s,first,rules)){
      moverOutcome=-WIN_SCORE;
    }else{
      const t=cloneState(s);
      t.awaitingMoveResponse=false;t.boundaryCornerOwed=false;t.boundarySelfCornerOwed=true;
      t.forcedQueue=[{colour:normalColour,source:"normal",responseSlot:1}];t.forcedPlacements=2;
      applyAction(t,first,rules);
      const corners=evaluateMoverSelfCornerChoices(t,rules,limit);
      moverOutcome=Math.max(...corners.map(x=>x.moverOutcome));
    }
    plans.push({boundaryFirstSource:"normal",keep:normalColour,give:null,pair:"boundary-choice",firstColour:normalColour,firstTo:first.to,moverOutcome,firstStatic:placementStaticScore(s,first,rules)});
  }

  // Option B: responder chooses and places a Final Four corner first. The mover
  // must then place the last normal reserve piece.
  for(const cornerColour of [...new Set(s.finalPieces)]){
    for(const first of topPlacementCandidates(s,cornerColour,"final",rules,limit)){
      let moverOutcome;
      if(actionWins(s,first,rules)){
        moverOutcome=-WIN_SCORE;
      }else{
        const t=cloneState(s);
        t.awaitingMoveResponse=false;t.boundaryCornerOwed=false;t.boundarySelfCornerOwed=false;
        t.forcedQueue=[{colour:cornerColour,source:"final",responseSlot:1},{colour:normalColour,source:"normal",responseSlot:2}];t.forcedPlacements=2;
        applyAction(t,first,rules);
        const replies=topPlacementCandidates(t,normalColour,"normal",rules,limit);
        moverOutcome=-Infinity;
        for(const reply of replies){
          const score=actionWins(t,reply,rules)?WIN_SCORE:baseActionPositionalScore(t,reply,rules);
          if(score>moverOutcome)moverOutcome=score;
        }
      }
      plans.push({boundaryFirstSource:"corner",keep:cornerColour,give:normalColour,pair:"boundary-choice",firstColour:cornerColour,firstTo:first.to,moverOutcome,firstStatic:placementStaticScore(s,first,rules)});
    }
  }
  return plans;
}
function chooseBoundaryResponderChoicePlan(s,rules,strength="tactical") {
  const normalColour=COLOURS.find(c=>s.normalRemaining[c]>0);
  if(!normalColour)throw new Error("Boundary responder-choice requested with no normal reserve piece remaining.");
  if(strength==="random"){
    if(s.rng()<0.5){
      const actions=forcedPlacementActions(s,normalColour,"normal");
      const first=actions[Math.floor(s.rng()*actions.length)];
      return{boundaryFirstSource:"normal",keep:normalColour,give:null,pair:"boundary-choice",firstColour:normalColour,firstTo:first.to,moverOutcome:null,firstStatic:null};
    }
    const colours=[...new Set(s.finalPieces)],cornerColour=colours[Math.floor(s.rng()*colours.length)];
    const actions=forcedPlacementActions(s,cornerColour,"final"),first=actions[Math.floor(s.rng()*actions.length)];
    return{boundaryFirstSource:"corner",keep:cornerColour,give:normalColour,pair:"boundary-choice",firstColour:cornerColour,firstTo:first.to,moverOutcome:null,firstStatic:null};
  }
  const plans=evaluateBoundaryResponderChoicePlan(s,rules,RESPONSE_SEARCH_LIMIT);
  const min=Math.min(...plans.map(x=>x.moverOutcome));
  let candidates=plans.filter(x=>Math.abs(x.moverOutcome-min)<1e-9);
  const bestStatic=Math.max(...candidates.map(x=>x.firstStatic));
  candidates=candidates.filter(x=>Math.abs(x.firstStatic-bestStatic)<1e-9);
  return candidates[Math.floor(s.rng()*candidates.length)];
}

function evaluateCornerChoiceForMover(s,rules,limit=RESPONSE_SEARCH_LIMIT) {
  const colours=[...new Set(s.finalPieces)],results=[];
  for(const colour of colours){
    const t=cloneState(s);
    t.boundaryCornerOwed=false;
    t.forcedQueue=[{colour,source:"final",responseSlot:2}];
    t.forcedPlacements=1;
    const replies=topPlacementCandidates(t,colour,"final",rules,limit);
    let moverOutcome=-Infinity;
    for(const reply of replies){
      const score=actionWins(t,reply,rules)?WIN_SCORE:baseActionPositionalScore(t,reply,rules);
      if(score>moverOutcome)moverOutcome=score;
    }
    results.push({colour,moverOutcome});
  }
  return results;
}
function chooseBoundaryCornerColour(s,rules,strength="tactical") {
  if(strength==="random")return s.finalPieces[Math.floor(s.rng()*s.finalPieces.length)];
  const choices=evaluateCornerChoiceForMover(s,rules,RESPONSE_SEARCH_LIMIT);
  const min=Math.min(...choices.map(x=>x.moverOutcome));
  const candidates=choices.filter(x=>Math.abs(x.moverOutcome-min)<1e-9);
  return candidates[Math.floor(s.rng()*candidates.length)].colour;
}
function evaluateBoundaryFirstPlan(s,rules,limit=RESPONSE_SEARCH_LIMIT) {
  const colour=COLOURS.find(c=>s.normalRemaining[c]>0);
  const firstActions=topPlacementCandidates(s,colour,"normal",rules,limit);
  let best=null;
  for(const first of firstActions){
    let moverOutcome;
    if(actionWins(s,first,rules)){
      moverOutcome=-WIN_SCORE;
    }else{
      const t=cloneState(s);
      t.awaitingMoveResponse=false;t.boundaryCornerOwed=true;
      t.forcedQueue=[{colour,source:"normal",responseSlot:1}];t.forcedPlacements=2;
      applyAction(t,first,rules);
      const corners=evaluateCornerChoiceForMover(t,rules,limit);
      moverOutcome=Math.min(...corners.map(x=>x.moverOutcome));
    }
    const firstStatic=placementStaticScore(s,first,rules);
    const plan={keep:colour,give:null,pair:"boundary-one",firstTo:first.to,moverOutcome,firstStatic};
    if(!best||plan.moverOutcome<best.moverOutcome-1e-9||
      (Math.abs(plan.moverOutcome-best.moverOutcome)<1e-9&&plan.firstStatic>best.firstStatic+1e-9))best=plan;
  }
  return best;
}
function chooseBoundaryFirstPlan(s,rules,strength="tactical") {
  const colour=COLOURS.find(c=>s.normalRemaining[c]>0),actions=forcedPlacementActions(s,colour,"normal");
  if(strength==="random")return{keep:colour,give:null,pair:"boundary-one",firstTo:actions[Math.floor(s.rng()*actions.length)].to,moverOutcome:null,firstStatic:null};
  return evaluateBoundaryFirstPlan(s,rules,RESPONSE_SEARCH_LIMIT);
}
function immediateWinningPlacementCount(s,colour,source,rules) {
  let count=0;
  for(const action of forcedPlacementActions(s,colour,source)) if(actionWins(s,action,rules)) count++;
  return count;
}
function redeployBoardAfter(s,piece,to) {
  const b=s.board.slice();
  if(b[to])throw new Error("Redeploy target must be empty.");
  b[to]=piece;
  return b;
}
function redeployPlacementWins(s,piece,to,rules) {
  return!!fastCheckWin(redeployBoardAfter(s,piece,to),rules,to);
}
function redeployStaticScore(s,piece,to,rules) {
  const b=redeployBoardAfter(s,piece,to);
  if(fastCheckWin(b,rules,to))return WIN_SCORE;
  const rr=Math.floor(to/6),cc=to%6;
  return(2.5-Math.abs(rr-2.5))+(2.5-Math.abs(cc-2.5))+neutralPatternPotential(b,rules);
}
function topRedeployCandidates(s,piece,rules,limit=RESPONSE_SEARCH_LIMIT) {
  const scored=emptySquares(s).map(to=>({to,score:redeployStaticScore(s,piece,to,rules)})).sort((a,b)=>b.score-a.score||a.to-b.to);
  if(scored.length<=limit)return scored.map(x=>x.to);
  const wins=scored.filter(x=>x.score>=WIN_SCORE).map(x=>x.to);
  if(wins.length>=limit)return wins;
  const chosen=[...wins],used=new Set(wins);
  for(const x of scored){if(used.has(x.to))continue;chosen.push(x.to);if(chosen.length>=limit)break;}
  return chosen;
}
function bestMoverReservePlacementOutcome(s,colour,rules,limit=RESPONSE_SEARCH_LIMIT) {
  const actions=topPlacementCandidates(s,colour,"normal",rules,limit);
  let best=-Infinity;
  for(const action of actions){
    const score=actionWins(s,action,rules)?WIN_SCORE:baseActionPositionalScore(s,action,rules);
    if(score>best)best=score;
  }
  return best;
}
function applyRedeployPlacement(s,piece,to,rules) {
  if(s.board[to])throw new Error("Redeploy target must be empty.");
  s.board[to]=piece;
  s.turns++;
  const win=fastCheckWin(s.board,rules,to);
  if(win){s.winner=s.currentPlayer;return{ended:true,winType:classifyWin(win),win};}
  s.forcedPlacements=Math.max(0,s.forcedPlacements-1);
  s.protectedPieceId=null;
  s.currentPlayer=OTHER(s.currentPlayer);
  return{ended:false};
}
function normalTurnRecipientScore(s,rules) {
  const colours=availableColours(s);
  if(!colours.length)return 0;
  const safe=colours.filter(c=>!hasImmediateWinningAction(s,c,rules)),candidates=safe.length?safe:colours;
  let bestDanger=Infinity;
  for(const colour of candidates){
    const danger=handoverColourDanger(s,colour,rules);
    if(danger<bestDanger)bestDanger=danger;
  }
  return bestDanger;
}
function evaluateRedeployOnlyPlans(s,piece,rules,limit=RESPONSE_SEARCH_LIMIT) {
  const plans=[];
  for(const to of topRedeployCandidates(s,piece,rules,limit)){
    if(redeployPlacementWins(s,piece,to,rules)){
      plans.push({to,moverOutcome:-WIN_SCORE,giveColours:[],firstStatic:WIN_SCORE});
      continue;
    }
    const t=cloneState(s);
    const first=applyRedeployPlacement(t,piece,to,rules);
    if(first.ended)throw new Error("Unexpected redeploy-only evaluation win state.");
    t.forcedPlacements=0;t.forcedQueue=[];
    plans.push({
      to,moverOutcome:normalTurnRecipientScore(t,rules),giveColours:[],
      firstStatic:redeployStaticScore(s,piece,to,rules)
    });
  }
  return plans;
}
function chooseRedeployOnlyPlan(s,piece,rules,strength="tactical") {
  if(strength==="random"){
    const empties=emptySquares(s),to=empties[Math.floor(s.rng()*empties.length)];
    return{to,giveColour:null,moverOutcome:null,firstStatic:null};
  }
  const plans=evaluateRedeployOnlyPlans(s,piece,rules,RESPONSE_SEARCH_LIMIT);
  const min=Math.min(...plans.map(x=>x.moverOutcome));
  let candidates=plans.filter(x=>Math.abs(x.moverOutcome-min)<1e-9);
  const bestStatic=Math.max(...candidates.map(x=>x.firstStatic));
  candidates=candidates.filter(x=>Math.abs(x.firstStatic-bestStatic)<1e-9);
  return candidates[Math.floor(s.rng()*candidates.length)];
}
function redeployPassHandoverScore(s,rules) {
  // In redeploy-pass the jumper controls the colour handed to the responder,
  // exactly as after an ordinary placement. Score that handover from the
  // jumper's point of view using the same immediate-danger weights as the
  // normal positional evaluator, rather than treating the responder's next
  // turn as an unconditional penalty.
  const danger=handoverDanger(s,rules);
  let score=neutralPatternPotential(s.board,rules);
  score+=danger.safe?2000:-2000-250*danger.minImmediateWins;
  score-=750*danger.totalImmediateWins;
  return score;
}
function evaluateRedeployPassPlans(s,piece,rules,limit=RESPONSE_SEARCH_LIMIT) {
  const plans=[];
  for(const to of topRedeployCandidates(s,piece,rules,limit)){
    if(redeployPlacementWins(s,piece,to,rules)){
      plans.push({to,moverOutcome:-WIN_SCORE,giveColours:[],firstStatic:WIN_SCORE});
      continue;
    }
    const t=cloneState(s);
    const first=applyRedeployPlacement(t,piece,to,rules);
    if(first.ended)throw new Error("Unexpected redeploy-pass evaluation win state.");
    t.forcedPlacements=0;t.forcedQueue=[];
    // applyRedeployPlacement hands control back to the jumper. In redeploy-pass
    // the responder receives the next normal turn instead, while the jumper
    // chooses which reserve colour the responder must use.
    t.currentPlayer=OTHER(t.currentPlayer);
    plans.push({
      to,moverOutcome:redeployPassHandoverScore(t,rules),giveColours:[],
      firstStatic:redeployStaticScore(s,piece,to,rules)
    });
  }
  return plans;
}
function chooseRedeployPassPlan(s,piece,rules,strength="tactical") {
  if(strength==="random"){
    const empties=emptySquares(s),to=empties[Math.floor(s.rng()*empties.length)];
    return{to,giveColour:null,moverOutcome:null,firstStatic:null};
  }
  const plans=evaluateRedeployPassPlans(s,piece,rules,RESPONSE_SEARCH_LIMIT);
  const min=Math.min(...plans.map(x=>x.moverOutcome));
  let candidates=plans.filter(x=>Math.abs(x.moverOutcome-min)<1e-9);
  const bestStatic=Math.max(...candidates.map(x=>x.firstStatic));
  candidates=candidates.filter(x=>Math.abs(x.firstStatic-bestStatic)<1e-9);
  return candidates[Math.floor(s.rng()*candidates.length)];
}
function evaluateRedeployPlans(s,piece,rules,limit=RESPONSE_SEARCH_LIMIT) {
  const plans=[];
  for(const to of topRedeployCandidates(s,piece,rules,limit)){
    if(redeployPlacementWins(s,piece,to,rules)){
      plans.push({to,moverOutcome:-WIN_SCORE,giveColours:[],firstStatic:WIN_SCORE});
      continue;
    }
    const t=cloneState(s);
    const first=applyRedeployPlacement(t,piece,to,rules);
    if(first.ended)throw new Error("Unexpected redeploy evaluation win state.");
    const colours=COLOURS.filter(c=>t.normalRemaining[c]>0);
    if(!colours.length){plans.push({to,moverOutcome:0,giveColours:[],firstStatic:redeployStaticScore(s,piece,to,rules)});continue;}
    const outcomes=colours.map(colour=>({colour,outcome:bestMoverReservePlacementOutcome(t,colour,rules,limit)}));
    const min=Math.min(...outcomes.map(x=>x.outcome));
    plans.push({
      to,moverOutcome:min,giveColours:outcomes.filter(x=>Math.abs(x.outcome-min)<1e-9).map(x=>x.colour),
      firstStatic:redeployStaticScore(s,piece,to,rules)
    });
  }
  return plans;
}
function chooseRedeployPlan(s,piece,rules,strength="tactical") {
  if(strength==="random"){
    const empties=emptySquares(s),to=empties[Math.floor(s.rng()*empties.length)];
    if(redeployPlacementWins(s,piece,to,rules))return{to,giveColour:null,moverOutcome:-WIN_SCORE,firstStatic:WIN_SCORE};
    const colours=COLOURS.filter(c=>s.normalRemaining[c]>0);
    return{to,giveColour:colours[Math.floor(s.rng()*colours.length)],moverOutcome:null,firstStatic:null};
  }
  const plans=evaluateRedeployPlans(s,piece,rules,RESPONSE_SEARCH_LIMIT);
  const min=Math.min(...plans.map(x=>x.moverOutcome));
  let candidates=plans.filter(x=>Math.abs(x.moverOutcome-min)<1e-9);
  const bestStatic=Math.max(...candidates.map(x=>x.firstStatic));
  candidates=candidates.filter(x=>Math.abs(x.firstStatic-bestStatic)<1e-9);
  const plan=candidates[Math.floor(s.rng()*candidates.length)];
  const giveColour=plan.giveColours.length?plan.giveColours[Math.floor(s.rng()*plan.giveColours.length)]:null;
  return{...plan,giveColour};
}
function redeployJumpResponseScore(s,a,rules) {
  const t=cloneState(s),result=applyAction(t,a,rules);
  if(result.ended)return WIN_SCORE;
  const piece=t.board[a.over];
  if(!piece)throw new Error("Jumped piece missing during redeploy forecast.");
  t.board[a.over]=null;t.awaitingJumpRedeploy=false;t.awaitingMoveResponse=false;

  // Candidate-Jump forecast only. As with the existing Move/Jump response
  // scorer, avoid the full nested response search for every hypothetical jump.
  // The decisive risk is checked exactly: if the responder can redeploy the
  // jumped piece for an immediate win, the Jump is tactically losing. The full
  // redeploy + reserve-choice search is still used for the Jump actually made.
  for(const to of emptySquares(t))if(redeployPlacementWins(t,piece,to,rules))return-WIN_SCORE;

  const rr=Math.floor(a.to/6),cc=a.to%6;
  let score=(2.5-Math.abs(rr-2.5))+(2.5-Math.abs(cc-2.5))+0.25;
  score+=neutralPatternPotential(t.board,rules);
  if(s.jumpConsequence==="redeploy-only")return score-250;
  if(s.jumpConsequence==="redeploy-pass"){
    // Compare the Jump fairly with an ordinary placement. The responder chooses
    // the redeployment square, but after that the jumper chooses the reserve
    // colour handed to the responder. Evaluate every legal redeployment and
    // take the one that leaves the jumper with the worst handover outlook.
    const plans=evaluateRedeployPassPlans(t,piece,rules,RESPONSE_SEARCH_LIMIT);
    const worst=Math.min(...plans.map(x=>x.moverOutcome));
    if(worst<=-WIN_SCORE)return-WIN_SCORE;
    return worst+(2.5-Math.abs(rr-2.5))+(2.5-Math.abs(cc-2.5))+0.25;
  }
  const colours=COLOURS.filter(c=>t.normalRemaining[c]>0).length;
  score-=850+100*Math.max(0,colours-1);
  return score;
}
function resolveJumpRedeploy(s,jumpAction,rules,strength="tactical") {
  if(!s.awaitingJumpRedeploy)throw new Error("No Jump redeploy response is awaiting resolution.");
  const piece=s.board[jumpAction.over];
  if(!piece)throw new Error("Jumped piece missing when redeploy response begins.");
  s.board[jumpAction.over]=null;
  s.awaitingJumpRedeploy=false;s.awaitingMoveResponse=false;
  s.boundaryCornerOwed=false;s.boundarySelfCornerOwed=false;s.sequentialSecondOwed=false;s.sequentialFirstColour=null;
  const responder=s.currentPlayer;
  const plan=s.jumpConsequence==="redeploy-only"?chooseRedeployOnlyPlan(s,piece,rules,strength):
    s.jumpConsequence==="redeploy-pass"?chooseRedeployPassPlan(s,piece,rules,strength):chooseRedeployPlan(s,piece,rules,strength);
  const first=applyRedeployPlacement(s,piece,plan.to,rules);
  if(first.ended)return{ended:true,stage:"redeploy",plan,firstResult:first,secondAction:null,secondResult:null,piece};
  if(s.jumpConsequence==="redeploy-only"||s.jumpConsequence==="redeploy-pass"){
    s.forcedPlacements=0;s.forcedQueue=[];
    if(s.jumpConsequence==="redeploy-pass")s.currentPlayer=responder;
    return{ended:false,stage:"complete",plan,firstResult:first,secondAction:null,secondResult:null,piece};
  }
  const giveColour=plan.giveColour||COLOURS.find(c=>s.normalRemaining[c]>0);
  if(!giveColour)throw new Error("Redeploy Jump response has no normal reserve piece to give the jumper.");
  s.forcedQueue=[{colour:giveColour,source:"normal",responseSlot:2}];s.forcedPlacements=1;
  const secondAction=chooseAction(s,giveColour,rules,strength);
  if(!secondAction)throw new Error("Jumper has no legal compulsory reserve placement after redeploy.");
  const second=applyAction(s,secondAction,rules);
  return{ended:second.ended,stage:second.ended?"reserve":"complete",plan:{...plan,giveColour},firstResult:first,secondAction,secondResult:second,piece};
}
function movementResponseScore(s,a,rules) {
  if(a.type==="jump"&&s.jumpConsequence!=="current")return redeployJumpResponseScore(s,a,rules);
  const t=cloneState(s),result=applyAction(t,a,rules);
  if(result.ended)return WIN_SCORE;
  const count=normalReserveCount(t);

  // Fast candidate-move forecast.  The actual response is still chosen with
  // the committed two-piece search when the Move/Jump is played.  Here the
  // mover recognises the decisive tactical fact (the responder may keep any
  // selectable winning colour) plus a reserve-control cost, without running
  // the full two-ply response search for every hypothetical movement square.
  for(const colour of COLOURS){
    if(t.normalRemaining[colour]>0&&immediateWinningPlacementCount(t,colour,"normal",rules)>0) return-WIN_SCORE;
  }
  if(count===1&&t.boundaryPolicy==="responder-choice"){
    for(const colour of [...new Set(t.finalPieces)]){
      if(immediateWinningPlacementCount(t,colour,"final",rules)>0)return-WIN_SCORE;
    }
  }

  let score=baseActionPositionalScore(s,a,rules);
  if(count>=2){
    const allocations=responseAllocations(t).length;
    score-=700+150*Math.max(0,allocations-1);
  }else if(count===1){
    score-=900;
  }
  return score;
}
function actionPositionalScore(s,a,rules) {
  if((a.type==="move"||a.type==="jump")&&!s.forcedQueue.length&&!s.awaitingMoveResponse){
    const score=movementResponseScore(s,a,rules);
    const rr=Math.floor(a.to/6),cc=a.to%6;
    return score+0.01*((2.5-Math.abs(rr-2.5))+(2.5-Math.abs(cc-2.5))+(a.type==="jump"?0.25:0));
  }
  return baseActionPositionalScore(s,a,rules);
}
function handoverColourDanger(s,colour,rules) {
  const actions=enumerateActions(s,colour,rules);if(!actions.length)return-Infinity;
  let best=-Infinity;for(const a of actions)best=Math.max(best,actionPositionalScore(s,a,rules));return best;
}
function chooseFinalFourColour(s,rules,strength="tactical",finalFourColourPolicy="random") {
  finalFourColourPolicy=normaliseFinalFourColourPolicy(finalFourColourPolicy);
  const colours=availableColours(s);if(colours.length===1)return colours[0];
  if(strength==="random"||finalFourColourPolicy==="random")return colours[Math.floor(s.rng()*colours.length)];
  if(finalFourColourPolicy==="opponent"){
    let worst=[],worstScore=Infinity;
    for(const colour of colours){
      let colourScore=-Infinity;
      for(const action of enumerateActions(s,colour,rules))colourScore=Math.max(colourScore,actionPositionalScore(s,action,rules));
      if(colourScore<worstScore-1e-9){worstScore=colourScore;worst=[colour];}
      else if(Math.abs(colourScore-worstScore)<1e-9)worst.push(colour);
    }
    return worst[Math.floor(s.rng()*worst.length)];
  }
  const winning=colours.filter(c=>hasImmediateWinningAction(s,c,rules));
  if(winning.length)return winning[Math.floor(s.rng()*winning.length)];
  let best=[],bestScore=-Infinity;
  for(const colour of colours){
    let colourScore=-Infinity;
    for(const action of enumerateActions(s,colour,rules))colourScore=Math.max(colourScore,actionPositionalScore(s,action,rules));
    if(colourScore>bestScore+1e-9){bestScore=colourScore;best=[colour];}
    else if(Math.abs(colourScore-bestScore)<1e-9)best.push(colour);
  }
  return best[Math.floor(s.rng()*best.length)];
}
function chooseColour(s,rules,strength="tactical",finalFourColourPolicy="random") {
  if(s.forcedQueue.length)return s.forcedQueue[0].colour;
  const colours=availableColours(s);if(colours.length===1)return colours[0];
  if(s.finalFour)return chooseFinalFourColour(s,rules,strength,finalFourColourPolicy);
  if(strength==="random"||s.openingRemaining>0)return colours[Math.floor(s.rng()*colours.length)];
  const safe=colours.filter(c=>!hasImmediateWinningAction(s,c,rules)),candidates=safe.length?safe:colours;
  let best=[],bestDanger=Infinity;
  for(const c of candidates){const danger=handoverColourDanger(s,c,rules);if(danger<bestDanger-1e-9){bestDanger=danger;best=[c];}else if(Math.abs(danger-bestDanger)<1e-9)best.push(c);}
  return best[Math.floor(s.rng()*best.length)];
}
function chooseAction(s,colour,rules,strength="tactical") {
  const actions=enumerateActions(s,colour,rules);if(!actions.length)return null;
  const planned=s.forcedQueue[0]?.plannedTo;
  if(planned!==undefined){const action=actions.find(a=>a.to===planned);if(action)return action;}
  if(strength==="random")return actions[Math.floor(s.rng()*actions.length)];
  const wins=actions.filter(a=>actionWins(s,a,rules));if(wins.length)return wins[Math.floor(s.rng()*wins.length)];
  let best=[],bestScore=-Infinity;
  for(const a of actions){const score=actionPositionalScore(s,a,rules)+s.rng()*0.01;if(score>bestScore+1e-9){bestScore=score;best=[a];}else if(Math.abs(score-bestScore)<1e-9)best.push(a);}
  return best[Math.floor(s.rng()*best.length)];
}
function commitMoveResponse(s,rules,strength="tactical") {
  if(!s.awaitingMoveResponse)throw new Error("No Move/Jump response is awaiting commitment.");
  const count=normalReserveCount(s);
  if(count<1)throw new Error("Move/Jump response requested with no normal reserve piece remaining.");
  let plan;
  if(count===1&&s.boundaryPolicy==="responder-choice"){
    plan=chooseBoundaryResponderChoicePlan(s,rules,strength);
    if(plan.boundaryFirstSource==="normal"){
      s.forcedQueue=[{colour:plan.firstColour,source:"normal",responseSlot:1,plannedTo:plan.firstTo}];
      s.boundarySelfCornerOwed=true;
    }else{
      const normalColour=COLOURS.find(c=>s.normalRemaining[c]>0);
      s.forcedQueue=[
        {colour:plan.firstColour,source:"final",responseSlot:1,plannedTo:plan.firstTo},
        {colour:normalColour,source:"normal",responseSlot:2}
      ];
      s.boundarySelfCornerOwed=false;
    }
    s.boundaryCornerOwed=false;s.sequentialSecondOwed=false;s.sequentialFirstColour=null;
  }else if(count===1){
    plan=chooseBoundaryFirstPlan(s,rules,strength);
    s.forcedQueue=[{colour:plan.keep,source:"normal",responseSlot:1,plannedTo:plan.firstTo}];
    s.boundaryCornerOwed=true;s.boundarySelfCornerOwed=false;s.sequentialSecondOwed=false;s.sequentialFirstColour=null;
  }else if(s.responsePolicy==="sequential"){
    plan=chooseSequentialFirstPlan(s,rules,strength);
    s.forcedQueue=[{colour:plan.keep,source:"normal",responseSlot:1,plannedTo:plan.firstTo}];
    s.boundaryCornerOwed=false;s.boundarySelfCornerOwed=false;s.sequentialSecondOwed=true;s.sequentialFirstColour=plan.keep;
  }else{
    plan=chooseTwoPieceResponse(s,rules,strength);
    s.forcedQueue=[
      {colour:plan.keep,source:"normal",responseSlot:1,plannedTo:plan.firstTo},
      {colour:plan.give,source:"normal",responseSlot:2}
    ];
    s.boundaryCornerOwed=false;s.boundarySelfCornerOwed=false;s.sequentialSecondOwed=false;s.sequentialFirstColour=null;
  }
  s.awaitingMoveResponse=false;s.forcedPlacements=2;
  return plan;
}
function commitSequentialSecond(s,rules,strength="tactical") {
  if(!s.sequentialSecondOwed||s.forcedQueue.length)return null;
  const first=s.sequentialFirstColour;
  if(!first)throw new Error("Sequential second piece is owed but the first response colour is missing.");
  const second=chooseSequentialSecondColour(s,rules,strength);
  s.forcedQueue=[{colour:second,source:"normal",responseSlot:2}];
  s.sequentialSecondOwed=false;s.sequentialFirstColour=null;s.forcedPlacements=1;
  return{keep:first,give:second,pair:responsePairKey(first,second)};
}
function commitBoundarySelfCorner(s,rules,strength="tactical") {
  if(!s.boundarySelfCornerOwed||s.forcedQueue.length||!s.finalFour)return null;
  const plan=chooseBoundarySelfCornerPlan(s,rules,strength);
  s.forcedQueue=[{colour:plan.colour,source:"final",responseSlot:2,plannedTo:plan.to}];
  s.boundarySelfCornerOwed=false;s.forcedPlacements=1;
  return plan;
}
function commitBoundaryCorner(s,rules,strength="tactical") {
  if(!s.boundaryCornerOwed||s.forcedQueue.length||!s.finalFour)return null;
  const colour=chooseBoundaryCornerColour(s,rules,strength);
  s.forcedQueue=[{colour,source:"final",responseSlot:2}];
  s.boundaryCornerOwed=false;s.forcedPlacements=1;
  return colour;
}
function classifyWin(win) {
  const pts=win.line.map(i=>[Math.floor(i/6),i%6]),rs=pts.map(p=>p[0]),cs=pts.map(p=>p[1]);
  if(new Set(rs).size===1)return"horizontal";if(new Set(cs).size===1)return"vertical";
  if(new Set(rs.map((r,i)=>r-cs[i])).size===1||new Set(rs.map((r,i)=>r+cs[i])).size===1)return"diagonal";
  const ur=[...new Set(rs)],uc=[...new Set(cs)];
  if(ur.length===2&&uc.length===2)return Math.abs(ur[1]-ur[0])===1?"square":"spaced-square";
  const cr=(Math.min(...rs)+Math.max(...rs))/2,cc=(Math.min(...cs)+Math.max(...cs))/2,radii=pts.map(([r,c])=>Math.abs(r-cr)+Math.abs(c-cc));
  if(radii.every(x=>x===radii[0]))return radii[0]===1?"diamond":"spaced-diamond";return"other";
}
function normalForcedColourInfo(s) {
  if(s.openingRemaining>0||s.finalFour)return null;
  const colours=COLOURS.filter(c=>s.normalRemaining[c]>0);if(colours.length!==1)return null;
  const colour=colours[0];return{colour,exhaustedColour:COLOURS.find(c=>c!==colour)};
}
function normalColourCount(s){return COLOURS.filter(c=>s.normalRemaining[c]>0).length;}
function transitionCause(action,wasForced,responseSlot){
  if(!action||action.type!=="place")return"other";
  if(!wasForced)return"ordinary-placement";
  return responseSlot===1?"response-placement-1":responseSlot===2?"response-placement-2":"forced-placement";
}
function finalFourImmediateWinInfo(s,rules){
  const colours=availableColours(s),winningColours=[];
  let winningActions=0;
  for(const colour of colours){
    const n=immediateWinningActions(s,colour,rules).length;
    if(n){winningColours.push(colour);winningActions+=n;}
  }
  return{available:winningActions>0,winningColours,winningActions};
}
function newPhaseDiagnostics(){
  return{
    oneColourEntry:null,finalFourEntry:null,finalFourPlacements:0,
    finalFourFirstChosenColour:null,finalFourFirstChosenColourImmediateWin:false,
    finalFourFirstActionImmediateWin:false
  };
}
function recordPhaseTransition(d,s,beforeColours,beforeReserve,action,wasForced,responseSlot,actor,rules){
  const afterColours=normalColourCount(s),afterReserve=normalReserveCount(s),cause=transitionCause(action,wasForced,responseSlot);
  if(!d.oneColourEntry&&beforeColours>=2&&afterColours===1&&!s.finalFour){
    d.oneColourEntry={firstActor:s.currentPlayer,transitionActor:actor,cause,turn:s.turns,remainingColour:COLOURS.find(c=>s.normalRemaining[c]>0)};
  }
  if(!d.finalFourEntry&&beforeReserve>0&&afterReserve===0&&s.finalFour){
    const immediate=finalFourImmediateWinInfo(s,rules);
    d.finalFourEntry={firstActor:s.currentPlayer,transitionActor:actor,cause,turn:s.turns,immediateWinAvailable:immediate.available,immediateWinningColours:immediate.winningColours,immediateWinningActions:immediate.winningActions};
  }
}
function withPhaseDiagnostics(result,d){return{...result,phaseDiagnostics:d};}
function emptyResponseStats() {
  return {
    placements:0,moves:0,jumps:0,redeployPlacements:0,forcedPlacements:0,twoPieceResponses:0,boundaryResponses:0,jumpRedeployResponses:0,sequentialSecondChoices:0,
    redeployWins:[0,0],jumpReserveWins:[0,0],maxConsecutiveRedeployOnlyJumps:0,boundaryFirstSources:{normal:0,corner:0},
    responsePairs:{"black+black":0,"black+white":0,"white+white":0},
    responseAllocations:{"black->black":0,"black->white":0,"white->black":0,"white->white":0},
    boundaryCornerColours:{black:0,white:0},boundarySelfCornerColours:{black:0,white:0},boundaryResponderCornerColours:{black:0,white:0}
  };
}
function playGame({rules={},seed=1,strength="tactical",maxTurns=500,jumpPolicy="opposite",responsePolicy="committed",boundaryPolicy="current",jumpConsequence="current",finalFourColourPolicy="random",oneColourPolicy="current"}={}) {
  rules=normaliseRules(rules);jumpPolicy=normaliseJumpPolicy(jumpPolicy);responsePolicy=normaliseResponsePolicy(responsePolicy);boundaryPolicy=normaliseBoundaryPolicy(boundaryPolicy);jumpConsequence=normaliseJumpConsequencePolicy(jumpConsequence);finalFourColourPolicy=normaliseFinalFourColourPolicy(finalFourColourPolicy);oneColourPolicy=normaliseOneColourPolicy(oneColourPolicy);
  const s=freshState(seed,jumpPolicy,responsePolicy,boundaryPolicy,jumpConsequence,oneColourPolicy),stats=emptyResponseStats(),phaseDiagnostics=newPhaseDiagnostics();
  let consecutiveRedeployOnlyJumps=0;
  while(!s.winner&&s.turns<maxTurns){
    const sequentialPlan=commitSequentialSecond(s,rules,strength);
    if(sequentialPlan){
      stats.sequentialSecondChoices++;stats.responsePairs[sequentialPlan.pair]++;
      stats.responseAllocations[`${sequentialPlan.keep}->${sequentialPlan.give}`]++;
    }
    const boundarySelfPlan=commitBoundarySelfCorner(s,rules,strength);
    if(boundarySelfPlan)stats.boundarySelfCornerColours[boundarySelfPlan.colour]++;
    const boundaryColour=commitBoundaryCorner(s,rules,strength);
    if(boundaryColour)stats.boundaryCornerColours[boundaryColour]++;

    const forcedColourInfo=normalForcedColourInfo(s);
    const resultCategory=s.finalFour?"final-four":s.openingRemaining>0?"opening-four":forcedColourInfo?"normal-one-colour":"normal-both-colours";
    const wasForced=s.forcedQueue.length>0,responseSlot=wasForced?s.forcedQueue[0].responseSlot:null;
    if(s.finalFour&&!phaseDiagnostics.finalFourEntry){
      const immediate=finalFourImmediateWinInfo(s,rules);
      phaseDiagnostics.finalFourEntry={firstActor:s.currentPlayer,transitionActor:null,cause:"pre-existing",turn:s.turns,immediateWinAvailable:immediate.available,immediateWinningColours:immediate.winningColours,immediateWinningActions:immediate.winningActions};
    }
    if(forcedColourInfo&&!phaseDiagnostics.oneColourEntry)phaseDiagnostics.oneColourEntry={firstActor:s.currentPlayer,transitionActor:null,cause:"pre-existing",turn:s.turns,remainingColour:forcedColourInfo.colour};
    const colour=chooseColour(s,rules,strength,finalFourColourPolicy),action=chooseAction(s,colour,rules,strength);
    if(!action){s.winner="draw";break;}
    if(!(action.type==="jump"&&(s.jumpConsequence==="redeploy-only"||s.jumpConsequence==="redeploy-pass")))consecutiveRedeployOnlyJumps=0;
    if(action.type.includes("place"))stats.placements++;else if(action.type==="move")stats.moves++;else stats.jumps++;
    if(wasForced)stats.forcedPlacements++;
    const actor=s.currentPlayer,beforeColours=normalColourCount(s),beforeReserve=normalReserveCount(s);
    if(resultCategory==="final-four"&&action.type==="final-place"){
      phaseDiagnostics.finalFourPlacements++;
      if(phaseDiagnostics.finalFourPlacements===1){
        phaseDiagnostics.finalFourFirstChosenColour=colour;
        phaseDiagnostics.finalFourFirstChosenColourImmediateWin=actionWins(s,action,rules);
      }
    }
    const result=applyAction(s,action,rules);
    if(resultCategory==="final-four"&&phaseDiagnostics.finalFourPlacements===1&&result.ended)phaseDiagnostics.finalFourFirstActionImmediateWin=true;
    if(result.ended)return withPhaseDiagnostics({
      ...stats,winner:s.winner,turns:s.turns,reachedFinalFour:s.reachedFinalFour,winType:result.winType||null,
      resultCategory:s.winner==="draw"?"draw":resultCategory,
      winningActionType:s.winner==="draw"?null:(action.type.includes("place")?"placement":action.type),
      winningResponseSlot:s.winner==="draw"?null:responseSlot,
      forcedNormalColourWin:s.winner!=="draw"&&!!forcedColourInfo,forcedNormalColour:forcedColourInfo?.colour||null,
      exhaustedNormalColour:forcedColourInfo?.exhaustedColour||null
    },phaseDiagnostics);
    recordPhaseTransition(phaseDiagnostics,s,beforeColours,beforeReserve,action,wasForced,responseSlot,actor,rules);
    if(action.type==="jump"&&s.jumpConsequence!=="current"){
      stats.jumpRedeployResponses++;
      const response=resolveJumpRedeploy(s,action,rules,strength);
      stats.redeployPlacements++;stats.forcedPlacements++;
      if(response.stage==="redeploy"){
        stats.redeployWins[s.winner]++;
        return withPhaseDiagnostics({
          ...stats,winner:s.winner,turns:s.turns,reachedFinalFour:s.reachedFinalFour,winType:response.firstResult.winType||null,
          resultCategory:resultCategory,winningActionType:"redeploy",winningResponseSlot:1,
          forcedNormalColourWin:!!forcedColourInfo,forcedNormalColour:forcedColourInfo?.colour||null,exhaustedNormalColour:forcedColourInfo?.exhaustedColour||null
        },phaseDiagnostics);
      }
      if(s.jumpConsequence==="redeploy-only"||s.jumpConsequence==="redeploy-pass"){
        consecutiveRedeployOnlyJumps++;
        stats.maxConsecutiveRedeployOnlyJumps=Math.max(stats.maxConsecutiveRedeployOnlyJumps,consecutiveRedeployOnlyJumps);
      }else{
        stats.placements++;stats.forcedPlacements++;
        if(response.stage==="reserve"){
          stats.jumpReserveWins[s.winner]++;
          return withPhaseDiagnostics({
            ...stats,winner:s.winner,turns:s.turns,reachedFinalFour:s.reachedFinalFour,winType:response.secondResult.winType||null,
            resultCategory:resultCategory,winningActionType:"placement",winningResponseSlot:2,
            forcedNormalColourWin:!!forcedColourInfo,forcedNormalColour:forcedColourInfo?.colour||null,exhaustedNormalColour:forcedColourInfo?.exhaustedColour||null
          },phaseDiagnostics);
        }
      }
    }else if(action.type==="move"||action.type==="jump"){
      const plan=commitMoveResponse(s,rules,strength);
      if(plan.pair==="boundary-one"||plan.pair==="boundary-choice"){
        stats.boundaryResponses++;
        if(plan.boundaryFirstSource){
          stats.boundaryFirstSources[plan.boundaryFirstSource]++;
          if(plan.boundaryFirstSource==="corner")stats.boundaryResponderCornerColours[plan.firstColour]++;
        }
      }
      else{
        stats.twoPieceResponses++;
        if(plan.pair!=="sequential-pending"){
          stats.responsePairs[plan.pair]++;stats.responseAllocations[`${plan.keep}->${plan.give}`]++;
        }
      }
    }
  }
  return withPhaseDiagnostics({...stats,winner:s.winner||"draw",turns:s.turns,reachedFinalFour:s.reachedFinalFour,winType:null,resultCategory:"draw",winningActionType:null,winningResponseSlot:null,forcedNormalColourWin:false,forcedNormalColour:null,exhaustedNormalColour:null,maxTurnDraw:!s.winner&&s.turns>=maxTurns},phaseDiagnostics);
}
function runBatch({rules={},games=1000,seed=1,strength="tactical",jumpPolicy="opposite",responsePolicy="committed",boundaryPolicy="current",jumpConsequence="current",finalFourColourPolicy="random",oneColourPolicy="current",onProgress=null,progressEvery=null}={}) {
  jumpPolicy=normaliseJumpPolicy(jumpPolicy);responsePolicy=normaliseResponsePolicy(responsePolicy);boundaryPolicy=normaliseBoundaryPolicy(boundaryPolicy);jumpConsequence=normaliseJumpConsequencePolicy(jumpConsequence);finalFourColourPolicy=normaliseFinalFourColourPolicy(finalFourColourPolicy);oneColourPolicy=normaliseOneColourPolicy(oneColourPolicy);
  const progressStep=typeof onProgress==="function"?(progressEvery===null?Math.max(1,Math.floor(games/20)):Math.max(1,Number(progressEvery))):0;
  if(progressStep&&!Number.isInteger(progressStep))throw new Error("progressEvery must be a positive integer.");
  const results=[];
  for(let i=0;i<games;i++){
    results.push(playGame({rules,seed:seed+i,strength,jumpPolicy,responsePolicy,boundaryPolicy,jumpConsequence,finalFourColourPolicy,oneColourPolicy}));
    const completed=i+1;
    if(progressStep&&(completed===games||completed%progressStep===0))onProgress({completed,games,jumpPolicy,responsePolicy,boundaryPolicy,jumpConsequence});
  }
  const wins=[0,0],formations={},winTurns=[{},{}],drawTurns={},forcedNormalColourWins=[0,0];
  const forcedNormalExhausted={black:[0,0],white:[0,0]};
  const resultCategories={normalBoth:[0,0],normalOne:[0,0],finalFour:[0,0],openingFour:[0,0]};
  const winningActionTypes={placement:[0,0],move:[0,0],jump:[0,0],redeploy:[0,0]};
  const phaseWinningActionTypes={
    normalBoth:{placement:[0,0],move:[0,0],jump:[0,0],redeploy:[0,0]},
    normalOne:{placement:[0,0],move:[0,0],jump:[0,0],redeploy:[0,0]},
    finalFour:{placement:[0,0],move:[0,0],jump:[0,0],redeploy:[0,0]},
    openingFour:{placement:[0,0],move:[0,0],jump:[0,0],redeploy:[0,0]}
  };
  const phaseEntryOutcomes={
    oneColour:[{entries:0,wins:[0,0],draws:0},{entries:0,wins:[0,0],draws:0}],
    finalFour:[{entries:0,wins:[0,0],draws:0},{entries:0,wins:[0,0],draws:0}]
  };
  const phaseTransitionCauses={oneColour:{},finalFour:{}};
  const phaseTransitionActors={oneColour:[0,0],finalFour:[0,0]};
  const finalFourPlacementCountDistribution={},finalFourImmediateWinAvailableByActor=[0,0],finalFourFirstActionImmediateWinsByActor=[0,0],finalFourFirstChosenColourImmediateWinsByActor=[0,0];
  const winningResponseSlots={first:[0,0],second:[0,0]};
  const responsePairs={"black+black":0,"black+white":0,"white+white":0};
  const responseAllocations={"black->black":0,"black->white":0,"white->black":0,"white->white":0};
  const boundaryCornerColours={black:0,white:0},boundarySelfCornerColours={black:0,white:0},boundaryResponderCornerColours={black:0,white:0},boundaryFirstSources={normal:0,corner:0},responseCountDistribution={},redeployOnlyChainMaxDistribution={};
  let draws=0,maxTurnDraws=0,total=0,finals=0,min=Infinity,max=0,placements=0,moves=0,jumps=0,redeployPlacements=0,forcedPlacements=0,twoPieceResponses=0,boundaryResponses=0,jumpRedeployResponses=0,sequentialSecondChoices=0,gamesWithMultipleResponses=0,maxResponsesPerGame=0,gamesWithRedeployOnlyChain2Plus=0,maxConsecutiveRedeployOnlyJumps=0;
  const redeployWins=[0,0],jumpReserveWins=[0,0];
  for(const g of results){
    if(g.winner==="draw"){draws++;drawTurns[g.turns]=(drawTurns[g.turns]||0)+1;if(g.maxTurnDraw)maxTurnDraws++;}
    else{
      wins[g.winner]++;winTurns[g.winner][g.turns]=(winTurns[g.winner][g.turns]||0)+1;
      const key={"normal-both-colours":"normalBoth","normal-one-colour":"normalOne","final-four":"finalFour","opening-four":"openingFour"}[g.resultCategory];
      if(key)resultCategories[key][g.winner]++;
      if(g.winningActionType){
        winningActionTypes[g.winningActionType][g.winner]++;
        if(key&&phaseWinningActionTypes[key]?.[g.winningActionType])phaseWinningActionTypes[key][g.winningActionType][g.winner]++;
      }
      if(g.winningResponseSlot===1)winningResponseSlots.first[g.winner]++;
      if(g.winningResponseSlot===2)winningResponseSlots.second[g.winner]++;
      if(g.forcedNormalColourWin){forcedNormalColourWins[g.winner]++;forcedNormalExhausted[g.exhaustedNormalColour][g.winner]++;}
    }
    const pd=g.phaseDiagnostics||{};
    for(const [phase,entry] of [["oneColour",pd.oneColourEntry],["finalFour",pd.finalFourEntry]]){
      if(!entry)continue;
      const a=entry.firstActor;phaseEntryOutcomes[phase][a].entries++;
      if(g.winner==="draw")phaseEntryOutcomes[phase][a].draws++;else phaseEntryOutcomes[phase][a].wins[g.winner]++;
      const cause=entry.cause||"unknown";phaseTransitionCauses[phase][cause]=(phaseTransitionCauses[phase][cause]||0)+1;
      if(entry.transitionActor===0||entry.transitionActor===1)phaseTransitionActors[phase][entry.transitionActor]++;
      if(phase==="finalFour"&&entry.immediateWinAvailable)finalFourImmediateWinAvailableByActor[a]++;
    }
    if(pd.finalFourEntry){
      const n=pd.finalFourPlacements||0;finalFourPlacementCountDistribution[n]=(finalFourPlacementCountDistribution[n]||0)+1;
      const a=pd.finalFourEntry.firstActor;
      if(pd.finalFourFirstActionImmediateWin)finalFourFirstActionImmediateWinsByActor[a]++;
      if(pd.finalFourFirstChosenColourImmediateWin)finalFourFirstChosenColourImmediateWinsByActor[a]++;
    }
    total+=g.turns;finals+=g.reachedFinalFour?1:0;min=Math.min(min,g.turns);max=Math.max(max,g.turns);
    placements+=g.placements;moves+=g.moves;jumps+=g.jumps;redeployPlacements+=g.redeployPlacements;forcedPlacements+=g.forcedPlacements;
    twoPieceResponses+=g.twoPieceResponses;boundaryResponses+=g.boundaryResponses;jumpRedeployResponses+=g.jumpRedeployResponses;sequentialSecondChoices+=g.sequentialSecondChoices;
    redeployWins[0]+=g.redeployWins[0];redeployWins[1]+=g.redeployWins[1];jumpReserveWins[0]+=g.jumpReserveWins[0];jumpReserveWins[1]+=g.jumpReserveWins[1];
    const responseCount=g.twoPieceResponses+g.boundaryResponses+g.jumpRedeployResponses;
    responseCountDistribution[responseCount]=(responseCountDistribution[responseCount]||0)+1;
    if(responseCount>1)gamesWithMultipleResponses++;
    maxResponsesPerGame=Math.max(maxResponsesPerGame,responseCount);
    const chainMax=g.maxConsecutiveRedeployOnlyJumps||0;
    redeployOnlyChainMaxDistribution[chainMax]=(redeployOnlyChainMaxDistribution[chainMax]||0)+1;
    if(chainMax>=2)gamesWithRedeployOnlyChain2Plus++;
    maxConsecutiveRedeployOnlyJumps=Math.max(maxConsecutiveRedeployOnlyJumps,chainMax);
    for(const k of Object.keys(responsePairs))responsePairs[k]+=g.responsePairs[k];
    for(const k of Object.keys(responseAllocations))responseAllocations[k]+=g.responseAllocations[k];
    boundaryCornerColours.black+=g.boundaryCornerColours.black;boundaryCornerColours.white+=g.boundaryCornerColours.white;
    boundarySelfCornerColours.black+=g.boundarySelfCornerColours.black;boundarySelfCornerColours.white+=g.boundarySelfCornerColours.white;
    boundaryResponderCornerColours.black+=g.boundaryResponderCornerColours.black;boundaryResponderCornerColours.white+=g.boundaryResponderCornerColours.white;
    boundaryFirstSources.normal+=g.boundaryFirstSources.normal;boundaryFirstSources.corner+=g.boundaryFirstSources.corner;
    if(g.winType)formations[g.winType]=(formations[g.winType]||0)+1;
  }
  const forcedNormalColourWinTotal=forcedNormalColourWins[0]+forcedNormalColourWins[1];
  return{
    games,wins,draws,firstPlayerWinPct:100*wins[0]/games,secondPlayerWinPct:100*wins[1]/games,drawPct:100*draws/games,
    firstPlayerScorePct:100*(wins[0]+draws/2)/games,averageTurns:total/games,minTurns:min,maxTurns:max,finalFourPct:100*finals/games,
    placements,moves,jumps,redeployPlacements,forcedPlacements,formations,winTurns,drawTurns,resultCategories,winningActionTypes,phaseWinningActionTypes,winningResponseSlots,
    phaseEntryOutcomes,phaseTransitionCauses,phaseTransitionActors,finalFourPlacementCountDistribution,finalFourImmediateWinAvailableByActor,finalFourFirstActionImmediateWinsByActor,finalFourFirstChosenColourImmediateWinsByActor,finalFourColourPolicy,
    forcedNormalColourWins,forcedNormalColourWinTotal,forcedNormalColourWinPct:100*forcedNormalColourWinTotal/games,forcedNormalExhausted,
    jumpPolicy,responsePolicy,boundaryPolicy,jumpConsequence,oneColourPolicy,twoPieceResponses,boundaryResponses,jumpRedeployResponses,sequentialSecondChoices,redeployWins,jumpReserveWins,responsePairs,responseAllocations,boundaryCornerColours,
    boundarySelfCornerColours,boundaryResponderCornerColours,boundaryFirstSources,
    responseCountDistribution,gamesWithMultipleResponses,maxResponsesPerGame,averageResponsesPerGame:(twoPieceResponses+boundaryResponses+jumpRedeployResponses)/games,
    redeployOnlyChainMaxDistribution,gamesWithRedeployOnlyChain2Plus,maxConsecutiveRedeployOnlyJumps,maxTurnDraws
  };
}

module.exports={
  normaliseRules,normaliseJumpPolicy,normaliseResponsePolicy,normaliseBoundaryPolicy,normaliseJumpConsequencePolicy,normaliseFinalFourColourPolicy,normaliseOneColourPolicy,allRuleConfigurations,recommendedRuleConfigurations,freshState,availableColours,enumerateActions,boardAfter,
  chooseColour,chooseFinalFourColour,chooseAction,applyAction,commitMoveResponse,commitSequentialSecond,commitBoundarySelfCorner,commitBoundaryCorner,normalForcedColourInfo,playGame,runBatch,classifyWin,
  immediateWinningActions,fastCheckWin,neutralPatternPotential,handoverColourDanger,responseAllocations,bestTwoPieceResponsePlan,
  chooseTwoPieceResponse,evaluateSequentialFirstPlan,evaluateSequentialSecondChoices,chooseSequentialFirstPlan,chooseSequentialSecondColour,
  evaluateBoundaryFirstPlan,chooseBoundaryCornerColour,evaluateBoundaryResponderChoicePlan,chooseBoundaryResponderChoicePlan,evaluateMoverSelfCornerChoices,chooseBoundarySelfCornerPlan,
  evaluateRedeployPlans,chooseRedeployPlan,evaluateRedeployOnlyPlans,chooseRedeployOnlyPlan,evaluateRedeployPassPlans,chooseRedeployPassPlan,redeployPassHandoverScore,resolveJumpRedeploy,redeployJumpResponseScore,applyRedeployPlacement,actionPositionalScore,baseActionPositionalScore
};
