"use strict";

// Lipfty 6 analysis-only simulator. It deliberately lives outside the released
// game code and reuses js/rules.js for the authoritative board geometry.
global.window = global;
if (!global.LipftyRules) require("../js/rules.js");
const R = global.LipftyRules;

const COLOURS = ["black", "white"];
const OTHER = p => 1 - p;
const cloneBoard = board => board.map(p => p ? { ...p } : null);

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
  const b=cloneBoard(s.board);
  if(a.type.includes("place")) b[a.to]={id:-1,colour:a.colour}; else { b[a.to]=b[a.from]; b[a.from]=null; }
  return b;
}
function actionWins(s,a,rules){ return !!R.checkWin(boardAfter(s,a),rules); }
function immediateWinningPlacements(s, colour, rules) {
  if(s.normalRemaining[colour]<=0 && s.openingRemaining===0 && !s.finalFour) return 0;
  let n=0; for(const to of emptySquares(s)){ const b=cloneBoard(s.board); b[to]={id:-1,colour}; if(R.checkWin(b,rules)) n++; } return n;
}
function chooseColour(s, rules, strength="tactical") {
  const colours=availableColours(s); if(colours.length===1) return colours[0];
  if(strength==="random" || s.openingRemaining>0 || s.finalFour) return colours[Math.floor(s.rng()*colours.length)];
  // During normal play the finishing player hands the next player a reserve colour.
  // Prefer a colour that does not give an immediate winning placement.
  const scored=colours.map(c=>({c,score:immediateWinningPlacements(s,c,rules)}));
  const min=Math.min(...scored.map(x=>x.score)), best=scored.filter(x=>x.score===min);
  return best[Math.floor(s.rng()*best.length)].c;
}
function chooseAction(s, colour, rules, strength="tactical") {
  const actions=enumerateActions(s,colour,rules); if(!actions.length) return null;
  if(strength==="random") return actions[Math.floor(s.rng()*actions.length)];
  const wins=actions.filter(a=>actionWins(s,a,rules)); if(wins.length) return wins[Math.floor(s.rng()*wins.length)];
  // Rule-aware tactical heuristic: favour centre, enabled-pattern potential and
  // actions that reduce the opponent colour's immediate winning placements.
  let best=[],bestScore=-Infinity;
  for(const a of actions) {
    const b=boardAfter(s,a); let score=s.rng()*0.01;
    const rr=Math.floor(a.to/6),cc=a.to%6; score += (2.5-Math.abs(rr-2.5))+(2.5-Math.abs(cc-2.5));
    if(a.type==="jump") score+=0.25;
    const win=R.checkWin(b,rules); if(win) score+=100000;
    // Count enabled threats for the colour used by this action.
    for(const to of b.map((p,i)=>p?null:i).filter(i=>i!==null)) { const bb=cloneBoard(b); bb[to]={id:-1,colour}; if(R.checkWin(bb,rules)) score+=8; }
    const opp=colour==="black"?"white":"black";
    for(const to of b.map((p,i)=>p?null:i).filter(i=>i!==null)) { const bb=cloneBoard(b); bb[to]={id:-1,colour:opp}; if(R.checkWin(bb,rules)) score-=6; }
    if(score>bestScore+1e-9){bestScore=score;best=[a];} else if(Math.abs(score-bestScore)<1e-9) best.push(a);
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
  const win=R.checkWin(s.board,rules);
  if(win){s.winner=s.currentPlayer;return {ended:true,winType:classifyWin(win),win};}
  if(a.type==="final-place" && s.finalPieces.length===0){s.winner="draw";return {ended:true};}
  if(a.type==="move" || a.type==="jump") s.forcedPlacements=(s.normalRemaining.black+s.normalRemaining.white)>0?2:0;
  else if(s.forcedPlacements>0) s.forcedPlacements--;
  s.protectedPieceId=movedId;
  s.currentPlayer=OTHER(s.currentPlayer);
  if(s.normalRemaining.black+s.normalRemaining.white===0 && s.openingRemaining===0){s.forcedPlacements=0;s.finalFour=true;s.reachedFinalFour=true;}
  return {ended:false};
}
function playGame({rules={},seed=1,strength="tactical",maxTurns=500}={}) {
  rules=normaliseRules(rules); const s=freshState(seed); const stats={placements:0,moves:0,jumps:0,forcedPlacements:0};
  while(!s.winner && s.turns<maxTurns) {
    const colour=chooseColour(s,rules,strength), wasForced=s.forcedPlacements>0;
    const action=chooseAction(s,colour,rules,strength);
    if(!action){s.winner="draw";break;}
    if(action.type.includes("place")) stats.placements++; else if(action.type==="move") stats.moves++; else stats.jumps++;
    if(wasForced) stats.forcedPlacements++;
    const result=applyAction(s,action,rules); if(result.ended) return {...stats,winner:s.winner,turns:s.turns,reachedFinalFour:s.reachedFinalFour,winType:result.winType||null};
  }
  return {...stats,winner:s.winner||"draw",turns:s.turns,reachedFinalFour:s.reachedFinalFour,winType:null};
}
function runBatch({rules={},games=1000,seed=1,strength="tactical"}={}) {
  const results=[]; for(let i=0;i<games;i++) results.push(playGame({rules,seed:seed+i,strength}));
  const wins=[0,0], formations={}; let draws=0,total=0,finals=0,min=Infinity,max=0;
  for(const g of results){if(g.winner==="draw")draws++;else wins[g.winner]++; total+=g.turns; finals+=g.reachedFinalFour?1:0; min=Math.min(min,g.turns);max=Math.max(max,g.turns);if(g.winType)formations[g.winType]=(formations[g.winType]||0)+1;}
  return {games,wins,draws,firstPlayerWinPct:100*wins[0]/games,secondPlayerWinPct:100*wins[1]/games,drawPct:100*draws/games,averageTurns:total/games,minTurns:min,maxTurns:max,finalFourPct:100*finals/games,formations};
}
module.exports={normaliseRules,allRuleConfigurations,freshState,availableColours,enumerateActions,boardAfter,chooseColour,chooseAction,applyAction,playGame,runBatch,classifyWin};
