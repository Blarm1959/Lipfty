"use strict";

const fs=require("node:fs");
const path=require("node:path");
const Old=require("./lipfty6-simulator.js");
const New=require("./lipfty7-simulator.js");

function positiveInt(value,name){const n=Number(value);if(!Number.isInteger(n)||n<=0)throw new Error(`${name} must be a positive integer.`);return n;}
function parseArgs(argv){
  const o={games:5000,seed:1,strength:"tactical",csv:null};
  for(let i=0;i<argv.length;i++){
    const a=argv[i];
    if(a==="--games")o.games=positiveInt(argv[++i],"--games");
    else if(a==="--seed")o.seed=positiveInt(argv[++i],"--seed");
    else if(a==="--strength")o.strength=argv[++i];
    else if(a==="--csv")o.csv=argv[++i];
    else if(a==="--no-csv")o.csv=false;
    else if(a==="--help"||a==="-h")o.help=true;
    else throw new Error(`Unknown option: ${a}`);
  }
  if(!["random","tactical"].includes(o.strength))throw new Error("--strength must be random or tactical.");
  if(o.csv===undefined)throw new Error("--csv requires a file name.");
  return o;
}
function standardRules(sim){return sim.recommendedRuleConfigurations().find(x=>x.name==="Standard").rules;}
function duration(ms){const s=ms/1000;if(s<60)return`${s.toFixed(1)}s`;const m=Math.floor(s/60),r=s-m*60;if(m<60)return`${m}m${r.toFixed(1).padStart(4,"0")}s`;return`${Math.floor(m/60)}h${String(m%60).padStart(2,"0")}m${r.toFixed(1).padStart(4,"0")}s`;}
function pct(n,d){return d?100*n/d:0;}
function count(o,k){return o?.[k]||0;}
function defaultCsv(o){return path.join("C:\\bxd\\Lipfty-Simulation-Results",`lipfty7-standard-comparison-${o.strength}-${o.games}-seed${o.seed}.csv`);}
function flat(label,r,elapsedMs){
  return{
    mechanism:label,games:r.games,p1_wins:r.wins[0],p2_wins:r.wins[1],draws:r.draws,
    p1_win_pct:r.firstPlayerWinPct,p2_win_pct:r.secondPlayerWinPct,draw_pct:r.drawPct,p1_score_pct:r.firstPlayerScorePct,
    average_turns:r.averageTurns,min_turns:r.minTurns,max_turns:r.maxTurns,final_four_pct:r.finalFourPct,
    both_normal_p1:r.resultCategories.normalBoth[0],both_normal_p2:r.resultCategories.normalBoth[1],
    one_normal_p1:r.resultCategories.normalOne[0],one_normal_p2:r.resultCategories.normalOne[1],
    final_four_p1:r.resultCategories.finalFour[0],final_four_p2:r.resultCategories.finalFour[1],
    placement_p1:r.winningActionTypes.placement[0],placement_p2:r.winningActionTypes.placement[1],
    move_p1:r.winningActionTypes.move[0],move_p2:r.winningActionTypes.move[1],jump_p1:r.winningActionTypes.jump[0],jump_p2:r.winningActionTypes.jump[1],
    placements:r.placements,moves:r.moves,jumps:r.jumps,compulsory_placements:r.forcedPlacements,
    forced_single_colour_wins:r.forcedNormalColourWinTotal,forced_single_colour_pct:r.forcedNormalColourWinPct,
    forced_single_colour_p1:r.forcedNormalColourWins[0],forced_single_colour_p2:r.forcedNormalColourWins[1],
    horizontal:count(r.formations,"horizontal"),vertical:count(r.formations,"vertical"),diagonal:count(r.formations,"diagonal"),
    square:count(r.formations,"square"),spaced_square:count(r.formations,"spaced-square"),diamond:count(r.formations,"diamond"),spaced_diamond:count(r.formations,"spaced-diamond"),other:count(r.formations,"other"),
    two_piece_responses:r.twoPieceResponses||0,boundary_responses:r.boundaryResponses||0,
    pair_black_black:r.responsePairs?.["black+black"]||0,pair_black_white:r.responsePairs?.["black+white"]||0,pair_white_white:r.responsePairs?.["white+white"]||0,
    allocation_black_black:r.responseAllocations?.["black->black"]||0,allocation_black_white:r.responseAllocations?.["black->white"]||0,
    allocation_white_black:r.responseAllocations?.["white->black"]||0,allocation_white_white:r.responseAllocations?.["white->white"]||0,
    boundary_corner_black:r.boundaryCornerColours?.black||0,boundary_corner_white:r.boundaryCornerColours?.white||0,
    response_first_placement_p1_wins:r.winningResponseSlots?.first?.[0]||0,response_first_placement_p2_wins:r.winningResponseSlots?.first?.[1]||0,
    response_second_placement_p1_wins:r.winningResponseSlots?.second?.[0]||0,response_second_placement_p2_wins:r.winningResponseSlots?.second?.[1]||0,
    elapsed_seconds:elapsedMs/1000
  };
}
function csvEscape(v){const s=String(v??"");return/[",\r\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;}
function writeCsv(file,rows){const headers=Object.keys(rows[0]);const lines=[headers.join(","),...rows.map(row=>headers.map(h=>csvEscape(typeof row[h]==="number"&&!Number.isInteger(row[h])?row[h].toFixed(6):row[h])).join(","))];fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,lines.join("\n")+"\n","utf8");}
function pair(a){return`P1 ${a[0]}, P2 ${a[1]}`;}
function printResult(label,r,elapsedMs){
  console.log(`\n${label}`);
  console.log(`  Result: P1 ${r.wins[0]} (${r.firstPlayerWinPct.toFixed(2)}%), P2 ${r.wins[1]} (${r.secondPlayerWinPct.toFixed(2)}%), Draw ${r.draws} (${r.drawPct.toFixed(2)}%)`);
  console.log(`  P1 chess-style score: ${r.firstPlayerScorePct.toFixed(2)}%`);
  console.log(`  Turns: average ${r.averageTurns.toFixed(3)}, min ${r.minTurns}, max ${r.maxTurns}`);
  console.log(`  Final Four reached: ${r.finalFourPct.toFixed(2)}%`);
  console.log(`  Result phase: both normal colours ${pair(r.resultCategories.normalBoth)} | one normal colour ${pair(r.resultCategories.normalOne)} | Final Four ${pair(r.resultCategories.finalFour)} | Draw ${r.draws}`);
  console.log(`  Winning action: Placement ${pair(r.winningActionTypes.placement)} | Move ${pair(r.winningActionTypes.move)} | Jump ${pair(r.winningActionTypes.jump)}`);
  console.log(`  Actions: placements ${r.placements}, moves ${r.moves}, jumps ${r.jumps}, compulsory placements ${r.forcedPlacements}`);
  console.log(`  Forced single-colour wins: ${r.forcedNormalColourWinTotal} (${r.forcedNormalColourWinPct.toFixed(2)}%) | ${pair(r.forcedNormalColourWins)}`);
  console.log(`  Formations: H ${count(r.formations,"horizontal")}, V ${count(r.formations,"vertical")}, D ${count(r.formations,"diagonal")}, Square ${count(r.formations,"square")}, Spaced Square ${count(r.formations,"spaced-square")}`);
  if(r.twoPieceResponses!==undefined){
    console.log(`  Lipfty 7 responses: two-piece ${r.twoPieceResponses}, one-normal boundary ${r.boundaryResponses}`);
    console.log(`  Pair choices: BB ${r.responsePairs["black+black"]}, BW ${r.responsePairs["black+white"]}, WW ${r.responsePairs["white+white"]}`);
    console.log(`  Allocation (responder->mover): B->B ${r.responseAllocations["black->black"]}, B->W ${r.responseAllocations["black->white"]}, W->B ${r.responseAllocations["white->black"]}, W->W ${r.responseAllocations["white->white"]}`);
    console.log(`  Wins during compulsory response: first placement ${pair(r.winningResponseSlots.first)} | second placement ${pair(r.winningResponseSlots.second)}`);
    console.log(`  Boundary corner chosen for mover: Black ${r.boundaryCornerColours.black}, White ${r.boundaryCornerColours.white}`);
  }
  console.log(`  Time: ${duration(elapsedMs)}`);
}
function printDelta(oldR,newR){
  console.log("\nCHANGE: NEW minus OLD");
  console.log(`  P1 win: ${(newR.firstPlayerWinPct-oldR.firstPlayerWinPct).toFixed(2)} percentage points`);
  console.log(`  P2 win: ${(newR.secondPlayerWinPct-oldR.secondPlayerWinPct).toFixed(2)} percentage points`);
  console.log(`  Draw: ${(newR.drawPct-oldR.drawPct).toFixed(2)} percentage points`);
  console.log(`  P1 score: ${(newR.firstPlayerScorePct-oldR.firstPlayerScorePct).toFixed(2)} percentage points`);
  console.log(`  Average turns: ${(newR.averageTurns-oldR.averageTurns).toFixed(3)}`);
  console.log(`  Final Four frequency: ${(newR.finalFourPct-oldR.finalFourPct).toFixed(2)} percentage points`);
  console.log(`  Move wins P1/P2: ${newR.winningActionTypes.move[0]-oldR.winningActionTypes.move[0]} / ${newR.winningActionTypes.move[1]-oldR.winningActionTypes.move[1]}`);
  console.log(`  Move frequency: ${newR.moves-oldR.moves}; Jump frequency: ${newR.jumps-oldR.jumps}; compulsory placements: ${newR.forcedPlacements-oldR.forcedPlacements}`);
}
function help(){console.log("Usage: node .\\tools\\run-lipfty7-standard-comparison.js [--games N] [--seed N] [--strength tactical|random] [--csv FILE|--no-csv]");console.log("Defaults: 5,000 games per mechanism, tactical strength, seed 1.");}
function main(argv=process.argv.slice(2)){
  const o=parseArgs(argv);if(o.help){help();return;}
  const oldRules=standardRules(Old),newRules=standardRules(New);
  if(JSON.stringify(oldRules)!==JSON.stringify(newRules))throw new Error("Old/New Standard rule switches differ; comparison aborted.");
  const csvPath=o.csv===false?null:(o.csv||defaultCsv(o));
  console.log(`Lipfty 7 Standard experiment: OLD v6.0.13 vs NEW committed two-piece Move/Jump response`);
  console.log(`${o.games} games each; strength ${o.strength}; base seed ${o.seed}; identical Standard rule switches.`);
  console.log("Isolation: the pre-existing v6.0.13 opposite-colour-only jump filter is retained in BOTH mechanisms for this comparison.");

  let start=process.hrtime.bigint();
  const oldR=Old.runBatch({rules:oldRules,games:o.games,seed:o.seed,strength:o.strength});
  const oldMs=Number(process.hrtime.bigint()-start)/1e6;
  printResult("OLD STANDARD — Lipfty 6 v6.0.13 mechanism",oldR,oldMs);

  start=process.hrtime.bigint();
  const newR=New.runBatch({rules:newRules,games:o.games,seed:o.seed,strength:o.strength});
  const newMs=Number(process.hrtime.bigint()-start)/1e6;
  printResult("NEW STANDARD — Lipfty 7 committed two-piece response",newR,newMs);
  printDelta(oldR,newR);

  if(csvPath){writeCsv(csvPath,[flat("OLD-v6.0.13",oldR,oldMs),flat("NEW-v7-two-piece",newR,newMs)]);console.log(`\nDetailed comparison CSV: ${csvPath}`);}
}
if(require.main===module){try{main();}catch(err){console.error(`Error: ${err.message}`);process.exitCode=1;}}
module.exports={parseArgs,standardRules,flat,main};
