"use strict";

const fs=require("node:fs");
const path=require("node:path");
const S=require("./lipfty7-simulator.js");

function positiveInt(value,name){const n=Number(value);if(!Number.isInteger(n)||n<=0)throw new Error(`${name} must be a positive integer.`);return n;}
function parseArgs(argv){
  const o={games:5000,seed:1,strength:"tactical",csv:null,progressEvery:null};
  for(let i=0;i<argv.length;i++){
    const a=argv[i];
    if(a==="--games")o.games=positiveInt(argv[++i],"--games");
    else if(a==="--seed")o.seed=positiveInt(argv[++i],"--seed");
    else if(a==="--strength")o.strength=argv[++i];
    else if(a==="--progress-every")o.progressEvery=positiveInt(argv[++i],"--progress-every");
    else if(a==="--csv")o.csv=argv[++i];
    else if(a==="--no-csv")o.csv=false;
    else if(a==="--help"||a==="-h")o.help=true;
    else throw new Error(`Unknown option: ${a}`);
  }
  if(!["random","tactical"].includes(o.strength))throw new Error("--strength must be random or tactical.");
  if(o.csv===undefined)throw new Error("--csv requires a file name.");
  return o;
}
function standardRules(){return S.recommendedRuleConfigurations().find(x=>x.name==="Standard").rules;}
function duration(ms){const s=ms/1000;if(s<60)return`${s.toFixed(1)}s`;const m=Math.floor(s/60),r=s-m*60;if(m<60)return`${m}m${r.toFixed(1).padStart(4,"0")}s`;return`${Math.floor(m/60)}h${String(m%60).padStart(2,"0")}m${r.toFixed(1).padStart(4,"0")}s`;}
function count(o,k){return o?.[k]||0;}
function pair(a){return`P1 ${a[0]}, P2 ${a[1]}`;}
function defaultCsv(o){return path.join("C:\\bxd\\Lipfty-Simulation-Results",`lipfty7-boundary-choice-comparison-${o.strength}-${o.games}-seed${o.seed}.csv`);}
function responseDistribution(r){return Object.entries(r.responseCountDistribution||{}).sort((a,b)=>Number(a[0])-Number(b[0])).map(([n,g])=>`${n}:${g}`).join(" ");}
function recordedPairs(r){return Object.values(r.responsePairs).reduce((a,b)=>a+b,0);}
function firstSourceCounts(r){
  if(r.boundaryPolicy==="current")return{normal:r.boundaryResponses,corner:0};
  return r.boundaryFirstSources;
}
function flat(label,r,elapsedMs){
  const first=firstSourceCounts(r);
  return{
    boundary_rule:label,boundary_policy:r.boundaryPolicy,response_policy:r.responsePolicy,jump_policy:r.jumpPolicy,games:r.games,
    p1_wins:r.wins[0],p2_wins:r.wins[1],draws:r.draws,p1_win_pct:r.firstPlayerWinPct,p2_win_pct:r.secondPlayerWinPct,draw_pct:r.drawPct,p1_score_pct:r.firstPlayerScorePct,
    average_turns:r.averageTurns,min_turns:r.minTurns,max_turns:r.maxTurns,final_four_pct:r.finalFourPct,
    both_normal_p1:r.resultCategories.normalBoth[0],both_normal_p2:r.resultCategories.normalBoth[1],one_normal_p1:r.resultCategories.normalOne[0],one_normal_p2:r.resultCategories.normalOne[1],final_four_p1:r.resultCategories.finalFour[0],final_four_p2:r.resultCategories.finalFour[1],
    placement_p1:r.winningActionTypes.placement[0],placement_p2:r.winningActionTypes.placement[1],move_p1:r.winningActionTypes.move[0],move_p2:r.winningActionTypes.move[1],jump_p1:r.winningActionTypes.jump[0],jump_p2:r.winningActionTypes.jump[1],
    placements:r.placements,moves:r.moves,jumps:r.jumps,compulsory_placements:r.forcedPlacements,
    forced_single_colour_wins:r.forcedNormalColourWinTotal,forced_single_colour_pct:r.forcedNormalColourWinPct,forced_single_colour_p1:r.forcedNormalColourWins[0],forced_single_colour_p2:r.forcedNormalColourWins[1],
    horizontal:count(r.formations,"horizontal"),vertical:count(r.formations,"vertical"),diagonal:count(r.formations,"diagonal"),square:count(r.formations,"square"),spaced_square:count(r.formations,"spaced-square"),
    two_piece_responses:r.twoPieceResponses,boundary_responses:r.boundaryResponses,total_responses:r.twoPieceResponses+r.boundaryResponses,
    boundary_first_normal:first.normal,boundary_first_corner:first.corner,
    current_responder_chosen_mover_corner_black:r.boundaryCornerColours.black,current_responder_chosen_mover_corner_white:r.boundaryCornerColours.white,
    new_mover_self_corner_black:r.boundarySelfCornerColours.black,new_mover_self_corner_white:r.boundarySelfCornerColours.white,
    new_responder_first_corner_black:r.boundaryResponderCornerColours.black,new_responder_first_corner_white:r.boundaryResponderCornerColours.white,
    sequential_second_choices:r.sequentialSecondChoices,recorded_pair_choices:recordedPairs(r),average_responses_per_game:r.averageResponsesPerGame,games_with_multiple_responses:r.gamesWithMultipleResponses,max_responses_per_game:r.maxResponsesPerGame,response_count_distribution:responseDistribution(r),
    response_first_placement_p1_wins:r.winningResponseSlots.first[0],response_first_placement_p2_wins:r.winningResponseSlots.first[1],response_second_placement_p1_wins:r.winningResponseSlots.second[0],response_second_placement_p2_wins:r.winningResponseSlots.second[1],
    elapsed_seconds:elapsedMs/1000
  };
}
function csvEscape(v){const s=String(v??"");return/[",\r\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;}
function writeCsv(file,rows){const headers=Object.keys(rows[0]);const lines=[headers.join(","),...rows.map(row=>headers.map(h=>csvEscape(typeof row[h]==="number"&&!Number.isInteger(row[h])?row[h].toFixed(6):row[h])).join(","))];fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,lines.join("\n")+"\n","utf8");}
function printResult(label,r,elapsedMs){
  const first=firstSourceCounts(r);
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
  console.log(`  Lipfty 7 responses: two-piece ${r.twoPieceResponses}, one-normal boundary ${r.boundaryResponses}, average/game ${r.averageResponsesPerGame.toFixed(3)}`);
  console.log(`  Response count per game: ${responseDistribution(r)} | games with 2+ ${r.gamesWithMultipleResponses}, max ${r.maxResponsesPerGame}`);
  console.log(`  Boundary first placement: last normal ${first.normal}, corner ${first.corner}`);
  console.log(`  Current responder-chosen corner for mover: Black ${r.boundaryCornerColours.black}, White ${r.boundaryCornerColours.white}`);
  console.log(`  New mover self-chosen corner after normal-first: Black ${r.boundarySelfCornerColours.black}, White ${r.boundarySelfCornerColours.white}`);
  console.log(`  New responder corner used first: Black ${r.boundaryResponderCornerColours.black}, White ${r.boundaryResponderCornerColours.white}`);
  console.log(`  Wins during compulsory response: first placement ${pair(r.winningResponseSlots.first)} | second placement ${pair(r.winningResponseSlots.second)}`);
  console.log(`  Time: ${duration(elapsedMs)}`);
}
function printDelta(current,choice){
  console.log("\nCHANGE: RESPONDER CHOICE minus CURRENT BOUNDARY");
  console.log(`  P1 win: ${(choice.firstPlayerWinPct-current.firstPlayerWinPct).toFixed(2)} percentage points`);
  console.log(`  P2 win: ${(choice.secondPlayerWinPct-current.secondPlayerWinPct).toFixed(2)} percentage points`);
  console.log(`  Draw: ${(choice.drawPct-current.drawPct).toFixed(2)} percentage points`);
  console.log(`  P1 score: ${(choice.firstPlayerScorePct-current.firstPlayerScorePct).toFixed(2)} percentage points`);
  console.log(`  Average turns: ${(choice.averageTurns-current.averageTurns).toFixed(3)}`);
  console.log(`  Final Four frequency: ${(choice.finalFourPct-current.finalFourPct).toFixed(2)} percentage points`);
  console.log(`  Final Four wins P1/P2: ${choice.resultCategories.finalFour[0]-current.resultCategories.finalFour[0]} / ${choice.resultCategories.finalFour[1]-current.resultCategories.finalFour[1]}`);
  console.log(`  One-normal wins P1/P2: ${choice.resultCategories.normalOne[0]-current.resultCategories.normalOne[0]} / ${choice.resultCategories.normalOne[1]-current.resultCategories.normalOne[1]}`);
  console.log(`  Move wins P1/P2: ${choice.winningActionTypes.move[0]-current.winningActionTypes.move[0]} / ${choice.winningActionTypes.move[1]-current.winningActionTypes.move[1]}`);
  console.log(`  Jump wins P1/P2: ${choice.winningActionTypes.jump[0]-current.winningActionTypes.jump[0]} / ${choice.winningActionTypes.jump[1]-current.winningActionTypes.jump[1]}`);
  console.log(`  Boundary responses: ${current.boundaryResponses} -> ${choice.boundaryResponses}`);
  console.log(`  New boundary choice: last normal first ${choice.boundaryFirstSources.normal}, corner first ${choice.boundaryFirstSources.corner}`);
}
function progressStep(o){return o.progressEvery||Math.max(1,Math.floor(o.games/20));}
function progressReporter(label,start,games){return({completed})=>{const elapsedMs=Number(process.hrtime.bigint()-start)/1e6;console.log(`  ${label}: ${completed} / ${games} (${(100*completed/games).toFixed(1)}%) | elapsed ${duration(elapsedMs)}`);};}
function help(){
  console.log("Usage: node .\\tools\\run-lipfty7-boundary-choice-comparison.js [--games N] [--seed N] [--strength tactical|random] [--progress-every N] [--csv FILE|--no-csv]");
  console.log("Defaults: 5,000 games per boundary rule, tactical strength, seed 1, progress every 5%.");
  console.log("Both arms use cleaner sequential 2+-reserve response and opposite-colour Jump. Only the exactly-one-normal-reserve boundary changes.");
}
function runOne(label,boundaryPolicy,o,rules){
  console.log(`\nStarting ${label}...`);
  const start=process.hrtime.bigint();
  const r=S.runBatch({rules,games:o.games,seed:o.seed,strength:o.strength,jumpPolicy:"opposite",responsePolicy:"sequential",boundaryPolicy,progressEvery:progressStep(o),onProgress:progressReporter(label,start,o.games)});
  const ms=Number(process.hrtime.bigint()-start)/1e6;
  printResult(label,r,ms);
  return{r,ms};
}
function main(argv=process.argv.slice(2)){
  const o=parseArgs(argv);if(o.help){help();return;}
  const rules=standardRules(),csvPath=o.csv===false?null:(o.csv||defaultCsv(o));
  console.log("Lipfty 7 Standard one-reserve boundary experiment: CURRENT vs RESPONDER CHOICE");
  console.log(`${o.games} games each; strength ${o.strength}; base seed ${o.seed}; identical Standard rules, opposite-colour Jump and cleaner sequential 2+-reserve response.`);
  console.log("Only the exactly-one-normal-reserve Move/Jump consequence changes.");
  console.log("CURRENT: responder places last normal, then chooses mover's corner. NEW: responder chooses normal-first or corner-first; mover places the other type.");

  const current=runOne("CURRENT BOUNDARY","current",o,rules);
  const choice=runOne("NEW RESPONDER CHOICE","responder-choice",o,rules);
  printDelta(current.r,choice.r);
  if(csvPath){writeCsv(csvPath,[flat("current",current.r,current.ms),flat("responder-choice",choice.r,choice.ms)]);console.log(`\nDetailed comparison CSV: ${csvPath}`);}
}
if(require.main===module){try{main();}catch(err){console.error(`Error: ${err.message}`);process.exitCode=1;}}
module.exports={parseArgs,standardRules,flat,main};
