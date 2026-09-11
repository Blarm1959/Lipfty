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
function defaultCsv(o){return path.join("C:\\bxd\\Lipfty-Simulation-Results",`lipfty7-jump-redeploy-comparison-${o.strength}-${o.games}-seed${o.seed}.csv`);}
function responseDistribution(r){return Object.entries(r.responseCountDistribution||{}).sort((a,b)=>Number(a[0])-Number(b[0])).map(([n,g])=>`${n}:${g}`).join(" ");}
function flat(label,r,elapsedMs,rules){
  return{
    configuration:label,allow_move:rules.allowMove,jump_consequence:r.jumpConsequence,boundary_rule:r.boundaryPolicy,response_rule:r.responsePolicy,jump_colour:r.jumpPolicy,
    games:r.games,p1_wins:r.wins[0],p2_wins:r.wins[1],draws:r.draws,p1_win_pct:r.firstPlayerWinPct,p2_win_pct:r.secondPlayerWinPct,draw_pct:r.drawPct,p1_score_pct:r.firstPlayerScorePct,
    average_turns:r.averageTurns,min_turns:r.minTurns,max_turns:r.maxTurns,final_four_pct:r.finalFourPct,
    both_normal_p1:r.resultCategories.normalBoth[0],both_normal_p2:r.resultCategories.normalBoth[1],one_normal_p1:r.resultCategories.normalOne[0],one_normal_p2:r.resultCategories.normalOne[1],
    final_four_p1:r.resultCategories.finalFour[0],final_four_p2:r.resultCategories.finalFour[1],
    placement_wins_p1:r.winningActionTypes.placement[0],placement_wins_p2:r.winningActionTypes.placement[1],
    move_wins_p1:r.winningActionTypes.move[0],move_wins_p2:r.winningActionTypes.move[1],jump_direct_wins_p1:r.winningActionTypes.jump[0],jump_direct_wins_p2:r.winningActionTypes.jump[1],
    redeploy_wins_p1:r.winningActionTypes.redeploy[0],redeploy_wins_p2:r.winningActionTypes.redeploy[1],
    placements:r.placements,moves:r.moves,jumps:r.jumps,redeploy_placements:r.redeployPlacements,compulsory_placements:r.forcedPlacements,
    two_piece_responses:r.twoPieceResponses,boundary_responses:r.boundaryResponses,jump_redeploy_responses:r.jumpRedeployResponses,average_responses_per_game:r.averageResponsesPerGame,
    redeploy_immediate_wins_p1:r.redeployWins[0],redeploy_immediate_wins_p2:r.redeployWins[1],jump_reserve_wins_p1:r.jumpReserveWins[0],jump_reserve_wins_p2:r.jumpReserveWins[1],
    boundary_last_reserve_first:r.boundaryFirstSources.normal,boundary_corner_first:r.boundaryFirstSources.corner,
    horizontal:count(r.formations,"horizontal"),vertical:count(r.formations,"vertical"),diagonal:count(r.formations,"diagonal"),square:count(r.formations,"square"),spaced_square:count(r.formations,"spaced-square"),
    response_count_distribution:responseDistribution(r),games_with_multiple_responses:r.gamesWithMultipleResponses,max_responses_per_game:r.maxResponsesPerGame,elapsed_seconds:elapsedMs/1000
  };
}
function csvEscape(v){const s=String(v??"");return/[",\r\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;}
function writeCsv(file,rows){const headers=Object.keys(rows[0]);const lines=[headers.join(","),...rows.map(row=>headers.map(h=>csvEscape(typeof row[h]==="number"&&!Number.isInteger(row[h])?row[h].toFixed(6):row[h])).join(","))];fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,lines.join("\n")+"\n","utf8");}
function progressStep(o){return o.progressEvery||Math.max(1,Math.floor(o.games/20));}
function progressReporter(label,start,games){return({completed})=>{const elapsed=Number(process.hrtime.bigint()-start)/1e6;console.log(`  ${label}: ${completed} / ${games} (${(100*completed/games).toFixed(1)}%) | elapsed ${duration(elapsed)}`);};}
function printResult(label,r,rules,elapsedMs){
  console.log(`\n${label}`);
  console.log(`  Move: ${rules.allowMove?"ON":"OFF"} | Jump consequence: ${r.jumpConsequence} | Jump colour: opposite only`);
  console.log(`  Result: P1 ${r.wins[0]} (${r.firstPlayerWinPct.toFixed(2)}%), P2 ${r.wins[1]} (${r.secondPlayerWinPct.toFixed(2)}%), Draw ${r.draws} (${r.drawPct.toFixed(2)}%)`);
  console.log(`  P1 chess-style score: ${r.firstPlayerScorePct.toFixed(2)}%`);
  console.log(`  Turns: average ${r.averageTurns.toFixed(3)}, min ${r.minTurns}, max ${r.maxTurns}`);
  console.log(`  Final Four reached: ${r.finalFourPct.toFixed(2)}%`);
  console.log(`  Result phase: both normal colours ${pair(r.resultCategories.normalBoth)} | one normal colour ${pair(r.resultCategories.normalOne)} | Final Four ${pair(r.resultCategories.finalFour)} | Draw ${r.draws}`);
  console.log(`  Winning action: Placement ${pair(r.winningActionTypes.placement)} | Move ${pair(r.winningActionTypes.move)} | direct Jump ${pair(r.winningActionTypes.jump)} | jumped-piece redeploy ${pair(r.winningActionTypes.redeploy)}`);
  console.log(`  Actions: placements ${r.placements}, moves ${r.moves}, jumps ${r.jumps}, jumped-piece redeployments ${r.redeployPlacements}, compulsory actions ${r.forcedPlacements}`);
  console.log(`  Responses: normal two-piece ${r.twoPieceResponses}, 7.1 boundary ${r.boundaryResponses}, redeploy-Jump ${r.jumpRedeployResponses}, average/game ${r.averageResponsesPerGame.toFixed(3)}`);
  console.log(`  Redeploy consequence wins: replayed jumped piece ${pair(r.redeployWins)} | jumper's forced reserve placement ${pair(r.jumpReserveWins)}`);
  console.log(`  7.1 CURRENT choices: last reserve first ${r.boundaryFirstSources.normal}, corner first ${r.boundaryFirstSources.corner}`);
  console.log(`  Response count per game: ${responseDistribution(r)} | games with 2+ ${r.gamesWithMultipleResponses}, max ${r.maxResponsesPerGame}`);
  console.log(`  Formations: H ${count(r.formations,"horizontal")}, V ${count(r.formations,"vertical")}, D ${count(r.formations,"diagonal")}, Square ${count(r.formations,"square")}, Spaced Square ${count(r.formations,"spaced-square")}`);
  console.log(`  Time: ${duration(elapsedMs)}`);
}
function printDelta(label,base,test){
  console.log(`\nCHANGE: ${label} minus A — CURRENT`);
  console.log(`  P1 score: ${(test.firstPlayerScorePct-base.firstPlayerScorePct).toFixed(2)} percentage points`);
  console.log(`  P1 win: ${(test.firstPlayerWinPct-base.firstPlayerWinPct).toFixed(2)} pp | P2 win: ${(test.secondPlayerWinPct-base.secondPlayerWinPct).toFixed(2)} pp | Draw: ${(test.drawPct-base.drawPct).toFixed(2)} pp`);
  console.log(`  Average turns: ${(test.averageTurns-base.averageTurns).toFixed(3)} | Final Four: ${(test.finalFourPct-base.finalFourPct).toFixed(2)} pp`);
  console.log(`  Move frequency: ${test.moves-base.moves} | Jump frequency: ${test.jumps-base.jumps}`);
  console.log(`  Direct Jump wins P1/P2: ${test.winningActionTypes.jump[0]-base.winningActionTypes.jump[0]} / ${test.winningActionTypes.jump[1]-base.winningActionTypes.jump[1]}`);
  console.log(`  Replayed-piece wins P1/P2: ${test.winningActionTypes.redeploy[0]-base.winningActionTypes.redeploy[0]} / ${test.winningActionTypes.redeploy[1]-base.winningActionTypes.redeploy[1]}`);
}
function help(){
  console.log("Usage: node .\\tools\\run-lipfty7-jump-redeploy-comparison.js [--games N] [--seed N] [--strength tactical|random] [--progress-every N] [--csv FILE|--no-csv]");
  console.log("Defaults: 5,000 games per configuration, tactical strength, seed 1, progress every 5%.");
  console.log("Fixed baseline: opposite-colour Jump, cleaner sequential Move response, and 7.1 responder-choice boundary.");
  console.log("A = current Jump consequence + Move; B = redeploy Jump + Move; C = redeploy Jump with Move disabled.");
}
function runOne(label,rules,jumpConsequence,o){
  console.log(`\nStarting ${label}...`);
  const start=process.hrtime.bigint();
  const r=S.runBatch({rules,games:o.games,seed:o.seed,strength:o.strength,jumpPolicy:"opposite",responsePolicy:"sequential",boundaryPolicy:"responder-choice",jumpConsequence,progressEvery:progressStep(o),onProgress:progressReporter(label,start,o.games)});
  const ms=Number(process.hrtime.bigint()-start)/1e6;
  printResult(label,r,rules,ms);
  return{r,rules,ms};
}
function main(argv=process.argv.slice(2)){
  const o=parseArgs(argv);if(o.help){help();return;}
  const standard=standardRules(),noMove=S.normaliseRules({...standard,allowMove:false});
  const csvPath=o.csv===false?null:(o.csv||defaultCsv(o));
  console.log("Lipfty 7 Standard Jump-consequence experiment");
  console.log(`${o.games} games each; strength ${o.strength}; base seed ${o.seed}.`);
  console.log("Fixed in all three: opposite-colour Jump, cleaner sequential response, and 7.1 CURRENT responder-choice boundary.");
  console.log("A CURRENT: Move ON + current Jump consequence.");
  console.log("B REDEPLOY + MOVE: Move ON + opponent immediately replays jumped piece, then gives one reserve to jumper.");
  console.log("C REDEPLOY, NO MOVE: same redeploy Jump, ordinary Move disabled.");

  const a=runOne("A — CURRENT",standard,"current",o);
  const b=runOne("B — REDEPLOY + MOVE",standard,"redeploy",o);
  const c=runOne("C — REDEPLOY, NO MOVE",noMove,"redeploy",o);
  printDelta("B — REDEPLOY + MOVE",a.r,b.r);
  printDelta("C — REDEPLOY, NO MOVE",a.r,c.r);

  if(csvPath){
    writeCsv(csvPath,[flat("A-current",a.r,a.ms,a.rules),flat("B-redeploy-move",b.r,b.ms,b.rules),flat("C-redeploy-no-move",c.r,c.ms,c.rules)]);
    console.log(`\nDetailed comparison CSV: ${csvPath}`);
  }
}
if(require.main===module){try{main();}catch(err){console.error(`Error: ${err.stack||err.message}`);process.exitCode=1;}}
module.exports={parseArgs,standardRules,flat,main};
