"use strict";

// Lipfty 7 analysis-only simulator. This starts from the v6.0.13 simulator and
// changes only the consequence of a Move/Jump: the responding player commits
// two reserve pieces together, keeps one to place, and gives the other to the
// mover. Learning/Core are unchanged because they do not allow Move/Jump.
//
// Jump colour is now an analysis parameter. The released Lipfty rule remains
// opposite-colour-only; Lipfty 7 can also simulate an experimental any-colour
// jump without changing the playable app or the Standard rule switches.
global.window = global;
if (!global.LipftyRules) require("../js/rules.js");
const R = global.LipftyRules;

const COLOURS = ["black", "white"];
const OTHER = p => 1 - p;
const WIN_SCORE = 1e9;
const RESPONSE_SEARCH_LIMIT = 6;
const JUMP_POLICIES = ["opposite","any"];
const patternCache = new Map();

function normaliseJumpPolicy(value="opposite") {
  if(!JUMP_POLICIES.includes(value))throw new Error(`jumpPolicy must be one of: ${JUMP_POLICIES.join(", ")}.`);
  return value;
}

function patternKey(rules) {
  const r=normaliseRules(rules);
  return [r.allowDiagonal,r.allowSquare,r.allowSpacedSquare,r.allowDiamond,r.allowSpacedDiamond].map(Number).join("");
}
function patternGroups() {
  const straight=R.WINNING_LINES;
  const orth=straight.filter(p=>{const rs=p.map(i=>Math.floor(i/6)),cs=p.map(i=>i%6);return new Set(rs).size===1||new Set(cs).size===1;});
  const diag=straight.filter(p=>!orth.includes(p));
  const tightSquare=R.WINNING_SQUARES.filter(p=>Math.abs((p[1]%6)-(p[0]%6))===1);
  const tightDiamond=R.WINNING_DIAMONDS.filter(p=>Math.abs(Math.floor(p[1]/6)-Math.floor(p[0]/6))===1);
  return {orth,diag,tightSquare,tightDiamond};
}
const PATTERN_GROUPS=patternGroups();
function compiledPatterns(rules) {
  const key=patternKey(rules);
  if(patternCache.has(key)) return patternCache.get(key);
  const r=normaliseRules(rules),patterns=[...PATTERN_GROUPS.orth];
  if(r.allowDiagonal) patterns.push(...PATTERN_GROUPS.diag);
  if(r.allowSquare) patterns.push(...PATTERN_GROUPS.tightSquare);
  if(r.allowSquare&&r.allowSpacedSquare) patterns.push(...R.WINNING_SQUARES);
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
    allowSquare:!!r.allowSquare,allowSpacedSquare:!!r.allowSquare&&!!r.allowSpacedSquare,
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
function freshState(seed=1,jumpPolicy="opposite") {
  jumpPolicy=normaliseJumpPolicy(jumpPolicy);
  const rng=mulberry32(seed),cornerColours=shuffle(["black","black","white","white"],rng);
  return {
    board:Array(36).fill(null),currentPlayer:0,openingRemaining:4,cornerRemaining:{black:2,white:2},
    normalRemaining:{black:12,white:12},finalPieces:[...cornerColours],forcedPlacements:0,forcedQueue:[],
    awaitingMoveResponse:false,boundaryCornerOwed:false,protectedPieceId:null,nextPieceId:1,
    finalFour:false,winner:null,turns:0,reachedFinalFour:false,jumpPolicy,rng
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
  if(s.awaitingMoveResponse) return [];
  if(s.forcedQueue.length) {
    const q=s.forcedQueue[0];
    if(colour!==q.colour)return[];
    return forcedPlacementActions(s,q.colour,q.source);
  }
  const actions=[],empties=emptySquares(s);
  const placementOnly=s.openingRemaining>0||s.finalFour||s.forcedPlacements>0;
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
    s.forcedPlacements=s.forcedQueue.length+(s.boundaryCornerOwed?1:0);
  } else if(a.type==="move"||a.type==="jump") {
    if(normalReserveCount(s)>0){s.awaitingMoveResponse=true;s.forcedPlacements=2;}
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
function movementResponseScore(s,a,rules) {
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
function chooseColour(s,rules,strength="tactical") {
  if(s.forcedQueue.length)return s.forcedQueue[0].colour;
  const colours=availableColours(s);if(colours.length===1)return colours[0];
  if(strength==="random"||s.openingRemaining>0||s.finalFour)return colours[Math.floor(s.rng()*colours.length)];
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
  if(count===1){
    plan=chooseBoundaryFirstPlan(s,rules,strength);
    s.forcedQueue=[{colour:plan.keep,source:"normal",responseSlot:1,plannedTo:plan.firstTo}];
    s.boundaryCornerOwed=true;
  }else{
    plan=chooseTwoPieceResponse(s,rules,strength);
    s.forcedQueue=[
      {colour:plan.keep,source:"normal",responseSlot:1,plannedTo:plan.firstTo},
      {colour:plan.give,source:"normal",responseSlot:2}
    ];
    s.boundaryCornerOwed=false;
  }
  s.awaitingMoveResponse=false;s.forcedPlacements=2;
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
function emptyResponseStats() {
  return {
    placements:0,moves:0,jumps:0,forcedPlacements:0,twoPieceResponses:0,boundaryResponses:0,
    responsePairs:{"black+black":0,"black+white":0,"white+white":0},
    responseAllocations:{"black->black":0,"black->white":0,"white->black":0,"white->white":0},
    boundaryCornerColours:{black:0,white:0}
  };
}
function playGame({rules={},seed=1,strength="tactical",maxTurns=500,jumpPolicy="opposite"}={}) {
  rules=normaliseRules(rules);jumpPolicy=normaliseJumpPolicy(jumpPolicy);const s=freshState(seed,jumpPolicy),stats=emptyResponseStats();
  while(!s.winner&&s.turns<maxTurns){
    const boundaryColour=commitBoundaryCorner(s,rules,strength);
    if(boundaryColour)stats.boundaryCornerColours[boundaryColour]++;

    const forcedColourInfo=normalForcedColourInfo(s);
    const resultCategory=s.finalFour?"final-four":s.openingRemaining>0?"opening-four":forcedColourInfo?"normal-one-colour":"normal-both-colours";
    const wasForced=s.forcedQueue.length>0,responseSlot=wasForced?s.forcedQueue[0].responseSlot:null;
    const colour=chooseColour(s,rules,strength),action=chooseAction(s,colour,rules,strength);
    if(!action){s.winner="draw";break;}
    if(action.type.includes("place"))stats.placements++;else if(action.type==="move")stats.moves++;else stats.jumps++;
    if(wasForced)stats.forcedPlacements++;
    const result=applyAction(s,action,rules);
    if(result.ended)return{
      ...stats,winner:s.winner,turns:s.turns,reachedFinalFour:s.reachedFinalFour,winType:result.winType||null,
      resultCategory:s.winner==="draw"?"draw":resultCategory,
      winningActionType:s.winner==="draw"?null:(action.type.includes("place")?"placement":action.type),
      winningResponseSlot:s.winner==="draw"?null:responseSlot,
      forcedNormalColourWin:s.winner!=="draw"&&!!forcedColourInfo,forcedNormalColour:forcedColourInfo?.colour||null,
      exhaustedNormalColour:forcedColourInfo?.exhaustedColour||null
    };
    if(action.type==="move"||action.type==="jump"){
      const plan=commitMoveResponse(s,rules,strength);
      if(plan.pair==="boundary-one")stats.boundaryResponses++;
      else{
        stats.twoPieceResponses++;stats.responsePairs[plan.pair]++;
        stats.responseAllocations[`${plan.keep}->${plan.give}`]++;
      }
    }
  }
  return{...stats,winner:s.winner||"draw",turns:s.turns,reachedFinalFour:s.reachedFinalFour,winType:null,resultCategory:"draw",winningActionType:null,winningResponseSlot:null,forcedNormalColourWin:false,forcedNormalColour:null,exhaustedNormalColour:null};
}
function runBatch({rules={},games=1000,seed=1,strength="tactical",jumpPolicy="opposite",onProgress=null,progressEvery=null}={}) {
  jumpPolicy=normaliseJumpPolicy(jumpPolicy);
  const progressStep=typeof onProgress==="function"?(progressEvery===null?Math.max(1,Math.floor(games/20)):Math.max(1,Number(progressEvery))):0;
  if(progressStep&&!Number.isInteger(progressStep))throw new Error("progressEvery must be a positive integer.");
  const results=[];
  for(let i=0;i<games;i++){
    results.push(playGame({rules,seed:seed+i,strength,jumpPolicy}));
    const completed=i+1;
    if(progressStep&&(completed===games||completed%progressStep===0))onProgress({completed,games,jumpPolicy});
  }
  const wins=[0,0],formations={},winTurns=[{},{}],drawTurns={},forcedNormalColourWins=[0,0];
  const forcedNormalExhausted={black:[0,0],white:[0,0]};
  const resultCategories={normalBoth:[0,0],normalOne:[0,0],finalFour:[0,0],openingFour:[0,0]};
  const winningActionTypes={placement:[0,0],move:[0,0],jump:[0,0]};
  const winningResponseSlots={first:[0,0],second:[0,0]};
  const responsePairs={"black+black":0,"black+white":0,"white+white":0};
  const responseAllocations={"black->black":0,"black->white":0,"white->black":0,"white->white":0};
  const boundaryCornerColours={black:0,white:0},responseCountDistribution={};
  let draws=0,total=0,finals=0,min=Infinity,max=0,placements=0,moves=0,jumps=0,forcedPlacements=0,twoPieceResponses=0,boundaryResponses=0,gamesWithMultipleResponses=0,maxResponsesPerGame=0;
  for(const g of results){
    if(g.winner==="draw"){draws++;drawTurns[g.turns]=(drawTurns[g.turns]||0)+1;}
    else{
      wins[g.winner]++;winTurns[g.winner][g.turns]=(winTurns[g.winner][g.turns]||0)+1;
      const key={"normal-both-colours":"normalBoth","normal-one-colour":"normalOne","final-four":"finalFour","opening-four":"openingFour"}[g.resultCategory];
      if(key)resultCategories[key][g.winner]++;
      if(g.winningActionType)winningActionTypes[g.winningActionType][g.winner]++;
      if(g.winningResponseSlot===1)winningResponseSlots.first[g.winner]++;
      if(g.winningResponseSlot===2)winningResponseSlots.second[g.winner]++;
      if(g.forcedNormalColourWin){forcedNormalColourWins[g.winner]++;forcedNormalExhausted[g.exhaustedNormalColour][g.winner]++;}
    }
    total+=g.turns;finals+=g.reachedFinalFour?1:0;min=Math.min(min,g.turns);max=Math.max(max,g.turns);
    placements+=g.placements;moves+=g.moves;jumps+=g.jumps;forcedPlacements+=g.forcedPlacements;
    twoPieceResponses+=g.twoPieceResponses;boundaryResponses+=g.boundaryResponses;
    const responseCount=g.twoPieceResponses+g.boundaryResponses;
    responseCountDistribution[responseCount]=(responseCountDistribution[responseCount]||0)+1;
    if(responseCount>1)gamesWithMultipleResponses++;
    maxResponsesPerGame=Math.max(maxResponsesPerGame,responseCount);
    for(const k of Object.keys(responsePairs))responsePairs[k]+=g.responsePairs[k];
    for(const k of Object.keys(responseAllocations))responseAllocations[k]+=g.responseAllocations[k];
    boundaryCornerColours.black+=g.boundaryCornerColours.black;boundaryCornerColours.white+=g.boundaryCornerColours.white;
    if(g.winType)formations[g.winType]=(formations[g.winType]||0)+1;
  }
  const forcedNormalColourWinTotal=forcedNormalColourWins[0]+forcedNormalColourWins[1];
  return{
    games,wins,draws,firstPlayerWinPct:100*wins[0]/games,secondPlayerWinPct:100*wins[1]/games,drawPct:100*draws/games,
    firstPlayerScorePct:100*(wins[0]+draws/2)/games,averageTurns:total/games,minTurns:min,maxTurns:max,finalFourPct:100*finals/games,
    placements,moves,jumps,forcedPlacements,formations,winTurns,drawTurns,resultCategories,winningActionTypes,winningResponseSlots,
    forcedNormalColourWins,forcedNormalColourWinTotal,forcedNormalColourWinPct:100*forcedNormalColourWinTotal/games,forcedNormalExhausted,
    jumpPolicy,twoPieceResponses,boundaryResponses,responsePairs,responseAllocations,boundaryCornerColours,
    responseCountDistribution,gamesWithMultipleResponses,maxResponsesPerGame,averageResponsesPerGame:(twoPieceResponses+boundaryResponses)/games
  };
}

module.exports={
  normaliseRules,normaliseJumpPolicy,allRuleConfigurations,recommendedRuleConfigurations,freshState,availableColours,enumerateActions,boardAfter,
  chooseColour,chooseAction,applyAction,commitMoveResponse,commitBoundaryCorner,normalForcedColourInfo,playGame,runBatch,classifyWin,
  immediateWinningActions,fastCheckWin,neutralPatternPotential,handoverColourDanger,responseAllocations,bestTwoPieceResponsePlan,
  chooseTwoPieceResponse,evaluateBoundaryFirstPlan,chooseBoundaryCornerColour,actionPositionalScore,baseActionPositionalScore
};
