"use strict";

// Lipfty 6 analysis-only simulator. It deliberately lives outside the released
// game code and reuses js/rules.js for the authoritative board geometry.
global.window = global;
if (!global.LipftyRules) require("../js/rules.js");
const R = global.LipftyRules;

const COLOURS = ["black", "white"];
const OTHER = p => 1 - p;
const cloneBoard = board => board.slice();

// Analysis-only win cache. Build the enabled pattern list once per rule set,
// then index it by board cell so hypothetical actions only inspect patterns
// that could have changed. This preserves js/rules.js pattern ordering.
const patternCache = new Map();
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
  const r=normaliseRules(rules), patterns=[...PATTERN_GROUPS.orth];
  if(r.allowDiagonal) patterns.push(...PATTERN_GROUPS.diag);
  if(r.allowSquare) patterns.push(...PATTERN_GROUPS.tightSquare);
  if(r.allowSquare&&r.allowSpacedSquare) patterns.push(...R.WINNING_SQUARES);
  if(r.allowDiamond) patterns.push(...PATTERN_GROUPS.tightDiamond);
  if(r.allowDiamond&&r.allowSpacedDiamond) patterns.push(...R.WINNING_DIAMONDS);
  const byCell=Array.from({length:36},()=>[]);
  for(const pattern of patterns) for(const cell of pattern) byCell[cell].push(pattern);
  const result={patterns,byCell}; patternCache.set(key,result); return result;
}
function fastCheckWin(board,rules,changedCell=null) {
  const compiled=compiledPatterns(rules);
  const patterns=changedCell===null?compiled.patterns:compiled.byCell[changedCell];
  for(const pattern of patterns){
    const first=board[pattern[0]]; if(!first) continue;
    if(pattern.every(i=>board[i]&&board[i].colour===first.colour)) return {line:[...pattern],colour:first.colour};
  }
  return null;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function shuffle(values, rng) {
  const a = [...values];
  for (let i=a.length-1;i>0;i--) { const j=Math.floor(rng()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}
function normaliseRules(r={}) {
  return {
    allowJump: !!r.allowJump, allowMove: !!r.allowMove, allowDiagonal: !!r.allowDiagonal,
    allowSquare: !!r.allowSquare, allowSpacedSquare: !!r.allowSquare && !!r.allowSpacedSquare,
    allowDiamond: !!r.allowDiamond, allowSpacedDiamond: !!r.allowDiamond && !!r.allowSpacedDiamond
  };
}
function allRuleConfigurations() {
  const out=[];
  for (const allowJump of [false,true]) for (const allowMove of [false,true]) for (const allowDiagonal of [false,true])
    for (const square of [0,1,2]) for (const diamond of [0,1,2]) out.push(normaliseRules({
      allowJump, allowMove, allowDiagonal, allowSquare:square>0, allowSpacedSquare:square===2,
      allowDiamond:diamond>0, allowSpacedDiamond:diamond===2
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
function freshState(seed=1) {
  const rng=mulberry32(seed), cornerColours=shuffle(["black","black","white","white"],rng);
  return {
    board:Array(36).fill(null), currentPlayer:0, openingRemaining:4, cornerRemaining:{black:2,white:2},
    normalRemaining:{black:12,white:12}, finalPieces:[...cornerColours], forcedPlacements:0,
    protectedPieceId:null, nextPieceId:1, finalFour:false, winner:null, turns:0, reachedFinalFour:false, rng
  };
}
function emptySquares(s){ const a=[]; for(let i=0;i<36;i++) if(!s.board[i]) a.push(i); return a; }
function availableColours(s) {
  if (s.openingRemaining>0) return COLOURS.filter(c=>s.cornerRemaining[c]>0);
  if (s.finalFour) return COLOURS.filter(c=>s.finalPieces.includes(c));
  return COLOURS.filter(c=>s.normalRemaining[c]>0);
}
function legalJumps(s, from, rules) {
  if (!rules.allowJump) return [];
  const moving=s.board[from]; if(!moving) return [];
  return R.jumpDestinations(s.board,from).filter(j=>s.board[j.over] && s.board[j.over].colour!==moving.colour);
}
function enumerateActions(s, colour, rules) {
  const actions=[], empties=emptySquares(s);
  const placementOnly=s.openingRemaining>0 || s.finalFour || s.forcedPlacements>0;
  const reserveCount=s.openingRemaining>0?s.cornerRemaining[colour]:s.finalFour?s.finalPieces.filter(c=>c===colour).length:s.normalRemaining[colour];
  if (reserveCount>0) for(const to of empties) actions.push({type:s.openingRemaining>0?"opening-place":s.finalFour?"final-place":"place",to,colour});
  if (placementOnly) return actions;
  for(let from=0;from<36;from++) {
    const p=s.board[from]; if(!p || p.colour!==colour || p.id===s.protectedPieceId) continue;
    if(rules.allowMove) for(const to of R.adjacentDestinations(s.board,from)) actions.push({type:"move",from,to,colour});
    if(rules.allowJump) for(const j of legalJumps(s,from,rules)) actions.push({type:"jump",from,to:j.to,over:j.over,colour});
  }
  return actions;
}
function boardAfter(s,a) {
  const b=s.board.slice();
  if(a.type.includes("place")) b[a.to]={id:-1,colour:a.colour}; else { b[a.to]=b[a.from]; b[a.from]=null; }
  return b;
}
function actionWins(s,a,rules){ return !!fastCheckWin(boardAfter(s,a),rules,a.to); }
function immediateWinningActions(s, colour, rules) {
  return enumerateActions(s,colour,rules).filter(a=>actionWins(s,a,rules));
}
function hasImmediateWinningAction(s, colour, rules) {
  for(const a of enumerateActions(s,colour,rules)) if(actionWins(s,a,rules)) return true;
  return false;
}
function immediateWinningPlacements(s, colour, rules) {
  return immediateWinningActions(s,colour,rules).filter(a=>a.type.includes("place")).length;
}
function stateAfterForEvaluation(s,a,rules) {
  const t={...s,board:cloneBoard(s.board),cornerRemaining:{...s.cornerRemaining},normalRemaining:{...s.normalRemaining},finalPieces:[...s.finalPieces]};
  applyAction(t,a,rules);
  return t;
}
function handoverDanger(s,rules) {
  const colours=availableColours(s);
  if(!colours.length) return {safe:true,minImmediateWins:0,totalImmediateWins:0,immediateWins:[]};
  const immediateWins=colours.map(c=>immediateWinningActions(s,c,rules).length);
  return {
    safe:immediateWins.some(n=>n===0),
    minImmediateWins:Math.min(...immediateWins),
    totalImmediateWins:immediateWins.reduce((sum,n)=>sum+n,0),
    immediateWins
  };
}

// Colour-neutral positional potential. Lipfty colours are shared resources,
// not player-owned armies, so Black and White contribute identically here.
// Open patterns with more matching pieces are more tactically significant.
function neutralPatternPotential(board,rules) {
  const weights=[0,1,5,24,100000];
  let score=0;
  for(const pattern of compiledPatterns(rules).patterns) {
    let black=0,white=0;
    for(const i of pattern) {
      const p=board[i]; if(!p) continue;
      if(p.colour==="black") black++; else if(p.colour==="white") white++;
    }
    if(black&&white) continue;
    score+=weights[black||white];
  }
  return score;
}

function actionPositionalScore(s,a,rules) {
  const b=boardAfter(s,a);
  if(fastCheckWin(b,rules,a.to)) return 1e9;
  const rr=Math.floor(a.to/6),cc=a.to%6;
  let score=(2.5-Math.abs(rr-2.5))+(2.5-Math.abs(cc-2.5));
  if(a.type==="jump") score+=0.25;
  score+=neutralPatternPotential(b,rules);
  const next=stateAfterForEvaluation(s,a,rules), danger=handoverDanger(next,rules);
  score+=danger.safe?2000:-2000-250*danger.minImmediateWins;
  // A safe hand-over is not enough: if the other available colour already has
  // one or more winning replies, prefer actions that remove those latent
  // threats before reserve exhaustion can force that colour to be handed over.
  score-=750*danger.totalImmediateWins;
  return score;
}

// Estimate how useful a handed colour is to the receiving player. The receiver
// chooses their best legal action, so the giver should minimise this value.
function handoverColourDanger(s,colour,rules) {
  const actions=enumerateActions(s,colour,rules);
  if(!actions.length) return -Infinity;
  let best=-Infinity;
  for(const a of actions) best=Math.max(best,actionPositionalScore(s,a,rules));
  return best;
}

function chooseColour(s, rules, strength="tactical") {
  const colours=availableColours(s); if(colours.length===1) return colours[0];
  if(strength==="random" || s.openingRemaining>0 || s.finalFour) return colours[Math.floor(s.rng()*colours.length)];
  const safe=colours.filter(c=>!hasImmediateWinningAction(s,c,rules));
  const candidates=safe.length?safe:colours;
  let best=[],bestDanger=Infinity;
  for(const c of candidates) {
    const danger=handoverColourDanger(s,c,rules);
    if(danger<bestDanger-1e-9){bestDanger=danger;best=[c];}
    else if(Math.abs(danger-bestDanger)<1e-9) best.push(c);
  }
  return best[Math.floor(s.rng()*best.length)];
}
function chooseAction(s, colour, rules, strength="tactical") {
  const actions=enumerateActions(s,colour,rules); if(!actions.length) return null;
  if(strength==="random") return actions[Math.floor(s.rng()*actions.length)];
  const wins=actions.filter(a=>actionWins(s,a,rules)); if(wins.length) return wins[Math.floor(s.rng()*wins.length)];
  // Tactical evaluation is deliberately colour-neutral: neither colour belongs
  // to a player. Prefer strong board geometry while preserving a safe hand-over.
  let best=[],bestScore=-Infinity;
  for(const a of actions) {
    const score=actionPositionalScore(s,a,rules)+s.rng()*0.01;
    if(score>bestScore+1e-9){bestScore=score;best=[a];}
    else if(Math.abs(score-bestScore)<1e-9) best.push(a);
  }
  return best[Math.floor(s.rng()*best.length)];
}
function classifyWin(win) {
  const pts=win.line.map(i=>[Math.floor(i/6),i%6]);
  const rs=pts.map(p=>p[0]), cs=pts.map(p=>p[1]);
  if(new Set(rs).size===1) return "horizontal";
  if(new Set(cs).size===1) return "vertical";
  const sr=[...rs].sort((a,b)=>a-b), sc=[...cs].sort((a,b)=>a-b);
  if(new Set(rs.map((r,i)=>r-cs[i])).size===1 || new Set(rs.map((r,i)=>r+cs[i])).size===1) return "diagonal";
  const ur=[...new Set(rs)], uc=[...new Set(cs)];
  if(ur.length===2 && uc.length===2) return (Math.abs(ur[1]-ur[0])===1?"square":"spaced-square");
  const centreR=(Math.min(...rs)+Math.max(...rs))/2, centreC=(Math.min(...cs)+Math.max(...cs))/2;
  const radii=pts.map(([r,c])=>Math.abs(r-centreR)+Math.abs(c-centreC));
  if(radii.every(x=>x===radii[0])) return radii[0]===1?"diamond":"spaced-diamond";
  return "other";
}
function applyAction(s,a,rules) {
  let movedId=null;
  if(a.type.includes("place")) {
    s.board[a.to]={id:s.nextPieceId++,colour:a.colour};
    if(a.type==="opening-place"){s.cornerRemaining[a.colour]--;s.openingRemaining--;}
    else if(a.type==="final-place"){s.finalPieces.splice(s.finalPieces.indexOf(a.colour),1);}
    else s.normalRemaining[a.colour]--;
  } else { const p=s.board[a.from]; movedId=p.id; s.board[a.to]=p; s.board[a.from]=null; }
  s.turns++;
  const win=fastCheckWin(s.board,rules,a.to);
  if(win){s.winner=s.currentPlayer;return {ended:true,winType:classifyWin(win),win};}
  if(a.type==="final-place" && s.finalPieces.length===0){s.winner="draw";return {ended:true};}
  if(a.type==="move" || a.type==="jump") s.forcedPlacements=(s.normalRemaining.black+s.normalRemaining.white)>0?2:0;
  else if(s.forcedPlacements>0) s.forcedPlacements--;
  s.protectedPieceId=movedId;
  s.currentPlayer=OTHER(s.currentPlayer);
  if(s.normalRemaining.black+s.normalRemaining.white===0 && s.openingRemaining===0){s.forcedPlacements=0;s.finalFour=true;s.reachedFinalFour=true;}
  return {ended:false};
}
function normalForcedColourInfo(s) {
  if(s.openingRemaining>0 || s.finalFour) return null;
  const colours=availableColours(s);
  if(colours.length!==1) return null;
  const colour=colours[0];
  return {colour,exhaustedColour:COLOURS.find(c=>c!==colour)};
}
function playGame({rules={},seed=1,strength="tactical",maxTurns=500}={}) {
  rules=normaliseRules(rules); const s=freshState(seed); const stats={placements:0,moves:0,jumps:0,forcedPlacements:0};
  while(!s.winner && s.turns<maxTurns) {
    const forcedColourInfo=normalForcedColourInfo(s);
    const resultCategory=s.finalFour?"final-four":s.openingRemaining>0?"opening-four":forcedColourInfo?"normal-one-colour":"normal-both-colours";
    const colour=chooseColour(s,rules,strength), wasForced=s.forcedPlacements>0;
    const action=chooseAction(s,colour,rules,strength);
    if(!action){s.winner="draw";break;}
    if(action.type.includes("place")) stats.placements++; else if(action.type==="move") stats.moves++; else stats.jumps++;
    if(wasForced) stats.forcedPlacements++;
    const result=applyAction(s,action,rules);
    if(result.ended) return {
      ...stats,winner:s.winner,turns:s.turns,reachedFinalFour:s.reachedFinalFour,winType:result.winType||null,
      resultCategory:s.winner==="draw"?"draw":resultCategory,
      winningActionType:s.winner==="draw"?null:(action.type.includes("place")?"placement":action.type),
      forcedNormalColourWin:s.winner!=="draw"&&!!forcedColourInfo,
      forcedNormalColour:forcedColourInfo?.colour||null,
      exhaustedNormalColour:forcedColourInfo?.exhaustedColour||null
    };
  }
  return {...stats,winner:s.winner||"draw",turns:s.turns,reachedFinalFour:s.reachedFinalFour,winType:null,resultCategory:"draw",winningActionType:null,forcedNormalColourWin:false,forcedNormalColour:null,exhaustedNormalColour:null};
}
function runBatch({rules={},games=1000,seed=1,strength="tactical"}={}) {
  const results=[]; for(let i=0;i<games;i++) results.push(playGame({rules,seed:seed+i,strength}));
  const wins=[0,0], formations={}, winTurns=[{},{}], drawTurns={}, forcedNormalColourWins=[0,0];
  const forcedNormalExhausted={black:[0,0],white:[0,0]};
  const resultCategories={normalBoth:[0,0],normalOne:[0,0],finalFour:[0,0],openingFour:[0,0]};
  const winningActionTypes={placement:[0,0],move:[0,0],jump:[0,0]};
  let draws=0,total=0,finals=0,min=Infinity,max=0,placements=0,moves=0,jumps=0,forcedPlacements=0;
  for(const g of results){
    if(g.winner==="draw"){draws++;drawTurns[g.turns]=(drawTurns[g.turns]||0)+1;}
    else {
      wins[g.winner]++;winTurns[g.winner][g.turns]=(winTurns[g.winner][g.turns]||0)+1;
      const categoryKey={"normal-both-colours":"normalBoth","normal-one-colour":"normalOne","final-four":"finalFour","opening-four":"openingFour"}[g.resultCategory];
      if(categoryKey) resultCategories[categoryKey][g.winner]++;
      if(g.winningActionType) winningActionTypes[g.winningActionType][g.winner]++;
      if(g.forcedNormalColourWin){
        forcedNormalColourWins[g.winner]++;
        forcedNormalExhausted[g.exhaustedNormalColour][g.winner]++;
      }
    }
    total+=g.turns; finals+=g.reachedFinalFour?1:0; min=Math.min(min,g.turns);max=Math.max(max,g.turns);
    placements+=g.placements; moves+=g.moves; jumps+=g.jumps; forcedPlacements+=g.forcedPlacements;
    if(g.winType)formations[g.winType]=(formations[g.winType]||0)+1;
  }
  const forcedNormalColourWinTotal=forcedNormalColourWins[0]+forcedNormalColourWins[1];
  return {
    games,wins,draws,
    firstPlayerWinPct:100*wins[0]/games,secondPlayerWinPct:100*wins[1]/games,drawPct:100*draws/games,
    firstPlayerScorePct:100*(wins[0]+draws/2)/games,
    averageTurns:total/games,minTurns:min,maxTurns:max,finalFourPct:100*finals/games,
    placements,moves,jumps,forcedPlacements,formations,winTurns,drawTurns,resultCategories,winningActionTypes,
    forcedNormalColourWins,forcedNormalColourWinTotal,forcedNormalColourWinPct:100*forcedNormalColourWinTotal/games,forcedNormalExhausted
  };
}
module.exports={normaliseRules,allRuleConfigurations,recommendedRuleConfigurations,freshState,availableColours,enumerateActions,boardAfter,chooseColour,chooseAction,applyAction,normalForcedColourInfo,playGame,runBatch,classifyWin,immediateWinningActions,fastCheckWin,neutralPatternPotential,handoverColourDanger};
