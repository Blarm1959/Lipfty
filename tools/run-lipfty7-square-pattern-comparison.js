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
function comparisonRules(){
  const standard=standardRules();
  return [
    {key:"E1-current-squares",label:"E1 — CURRENT SQUARES",rules:S.normaliseRules({...standard,allowMove:false,allowSquare:true,allowSpacedSquare:true})},
    {key:"E2-tight-square-only",label:"E2 — TIGHT SQUARE ONLY",rules:S.normaliseRules({...standard,allowMove:false,allowSquare:true,allowSpacedSquare:false})},
    {key:"E3-no-squares",label:"E3 — NO SQUARES",rules:S.normaliseRules({...standard,allowMove:false,allowSquare:false,allowSpacedSquare:false})}
  ];
}
function duration(ms){const s=ms/1000;if(s<60)return`${s.toFixed(1)}s`;const m=Math.floor(s/60),r=s-m*60;if(m<60)return`${m}m${r.toFixed(1).padStart(4,"0")}s`;return`${Math.floor(m/60)}h${String(m%60).padStart(2,"0")}m${r.toFixed(1).padStart(4,"0")}s`;}
function count(o,k){return o?.[k]||0;}
function pair(a){return`P1 ${a[0]}, P2 ${a[1]}`;}
function defaultCsv(o){return path.join("C:\\bxd\\Lipfty-Simulation-Results",`lipfty7-square-pattern-comparison-${o.strength}-${o.games}-seed${o.seed}.csv`);}
function distribution(o){return Object.entries(o||{}).sort((a,b)=>Number(a[0])-Number(b[0])).map(([n,g])=>`${n}:${g}`).join(" ");}
function flat(config,r,elapsedMs){
  const rules=config.rules;
  return{
    configuration:config.key,allow_move:rules.allowMove,allow_square:rules.allowSquare,allow_spaced_square:rules.allowSpacedSquare,
    jump_consequence:r.jumpConsequence,boundary_rule:r.boundaryPolicy,response_rule:r.responsePolicy,jump_colour:r.jumpPolicy,
    games:r.games,p1_wins:r.wins[0],p2_wins:r.wins[1],draws:r.draws,p1_win_pct:r.firstPlayerWinPct,p2_win_pct:r.secondPlayerWinPct,draw_pct:r.drawPct,p1_score_pct:r.firstPlayerScorePct,
    average_turns:r.averageTurns,min_turns:r.minTurns,max_turns:r.maxTurns,final_four_pct:r.finalFourPct,max_turn_draws:r.maxTurnDraws,
    both_normal_p1:r.resultCategories.normalBoth[0],both_normal_p2:r.resultCategories.normalBoth[1],one_normal_p1:r.resultCategories.normalOne[0],one_normal_p2:r.resultCategories.normalOne[1],final_four_p1:r.resultCategories.finalFour[0],final_four_p2:r.resultCategories.finalFour[1],
    placement_wins_p1:r.winningActionTypes.placement[0],placement_wins_p2:r.winningActionTypes.placement[1],jump_direct_wins_p1:r.winningActionTypes.jump[0],jump_direct_wins_p2:r.winningActionTypes.jump[1],redeploy_wins_p1:r.winningActionTypes.redeploy[0],redeploy_wins_p2:r.winningActionTypes.redeploy[1],
    placements:r.placements,jumps:r.jumps,redeploy_placements:r.redeployPlacements,nonwinning_jumps_redeployed:r.redeployPlacements,
    jump_redeploy_responses:r.jumpRedeployResponses,average_responses_per_game:r.averageResponsesPerGame,
    games_with_redeploy_jump_chain_2plus:r.gamesWithRedeployOnlyChain2Plus,max_consecutive_redeploy_jumps:r.maxConsecutiveRedeployOnlyJumps,redeploy_jump_chain_max_distribution:distribution(r.redeployOnlyChainMaxDistribution),
    horizontal:count(r.formations,"horizontal"),vertical:count(r.formations,"vertical"),diagonal:count(r.formations,"diagonal"),square:count(r.formations,"square"),spaced_square:count(r.formations,"spaced-square"),
    elapsed_seconds:elapsedMs/1000
  };
}
function csvEscape(v){const s=String(v??"");return/[",\r\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;}
function writeCsv(file,rows){const headers=Object.keys(rows[0]);const lines=[headers.join(","),...rows.map(row=>headers.map(h=>csvEscape(typeof row[h]==="number"&&!Number.isInteger(row[h])?row[h].toFixed(6):row[h])).join(","))];fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,lines.join("\n")+"\n","utf8");}
function progressStep(o){return o.progressEvery||Math.max(1,Math.floor(o.games/20));}
function progressReporter(label,start,games){return({completed})=>{const elapsed=Number(process.hrtime.bigint()-start)/1e6;console.log(`  ${label}: ${completed} / ${games} (${(100*completed/games).toFixed(1)}%) | elapsed ${duration(elapsed)}`);};}
function squareLabel(rules){if(!rules.allowSquare)return"OFF";return rules.allowSpacedSquare?"tight + spaced":"tight only";}
function printResult(config,r,elapsedMs){
  const rules=config.rules;
  console.log(`\n${config.label}`);
  console.log(`  Move: OFF | Jump consequence: redeploy-pass | Squares: ${squareLabel(rules)} | Jump colour: opposite only`);
  console.log(`  Result: P1 ${r.wins[0]} (${r.firstPlayerWinPct.toFixed(2)}%), P2 ${r.wins[1]} (${r.secondPlayerWinPct.toFixed(2)}%), Draw ${r.draws} (${r.drawPct.toFixed(2)}%)`);
  console.log(`  P1 chess-style score: ${r.firstPlayerScorePct.toFixed(2)}%`);
  console.log(`  Turns: average ${r.averageTurns.toFixed(3)}, min ${r.minTurns}, max ${r.maxTurns} | max-turn draws ${r.maxTurnDraws}`);
  console.log(`  Final Four reached: ${r.finalFourPct.toFixed(2)}%`);
  console.log(`  Result phase: both normal colours ${pair(r.resultCategories.normalBoth)} | one normal colour ${pair(r.resultCategories.normalOne)} | Final Four ${pair(r.resultCategories.finalFour)} | Draw ${r.draws}`);
  console.log(`  Winning action: Placement ${pair(r.winningActionTypes.placement)} | direct Jump ${pair(r.winningActionTypes.jump)} | jumped-piece redeploy ${pair(r.winningActionTypes.redeploy)}`);
  console.log(`  Actions: placements ${r.placements}, jumps ${r.jumps}, non-winning Jumps redeployed ${r.redeployPlacements}`);
  console.log(`  Consecutive redeploy-Jump chains: games with 2+ ${r.gamesWithRedeployOnlyChain2Plus}, longest ${r.maxConsecutiveRedeployOnlyJumps}, max-chain distribution ${distribution(r.redeployOnlyChainMaxDistribution)}`);
  console.log(`  Formations: H ${count(r.formations,"horizontal")}, V ${count(r.formations,"vertical")}, D ${count(r.formations,"diagonal")}, Square ${count(r.formations,"square")}, Spaced Square ${count(r.formations,"spaced-square")}`);
  console.log(`  Time: ${duration(elapsedMs)}`);
}
function printDelta(baseConfig,base,testConfig,test){
  console.log(`\nCHANGE: ${testConfig.label} minus ${baseConfig.label}`);
  console.log(`  P1 score: ${(test.firstPlayerScorePct-base.firstPlayerScorePct).toFixed(2)} percentage points`);
  console.log(`  P1 win: ${(test.firstPlayerWinPct-base.firstPlayerWinPct).toFixed(2)} pp | P2 win: ${(test.secondPlayerWinPct-base.secondPlayerWinPct).toFixed(2)} pp | Draw: ${(test.drawPct-base.drawPct).toFixed(2)} pp`);
  console.log(`  Average turns: ${(test.averageTurns-base.averageTurns).toFixed(3)} | Final Four: ${(test.finalFourPct-base.finalFourPct).toFixed(2)} pp`);
  console.log(`  Jump frequency: ${test.jumps-base.jumps} | non-winning redeployments: ${test.redeployPlacements-base.redeployPlacements}`);
  console.log(`  Placement wins P1/P2: ${test.winningActionTypes.placement[0]-base.winningActionTypes.placement[0]} / ${test.winningActionTypes.placement[1]-base.winningActionTypes.placement[1]}`);
  console.log(`  Direct Jump wins P1/P2: ${test.winningActionTypes.jump[0]-base.winningActionTypes.jump[0]} / ${test.winningActionTypes.jump[1]-base.winningActionTypes.jump[1]}`);
  console.log(`  Games with 2+ consecutive redeploy Jumps: ${test.gamesWithRedeployOnlyChain2Plus}; longest chain ${test.maxConsecutiveRedeployOnlyJumps}; max-turn draws ${test.maxTurnDraws}`);
}
function help(){
  console.log("Usage: node .\\tools\\run-lipfty7-square-pattern-comparison.js [--games N] [--seed N] [--strength tactical|random] [--progress-every N] [--csv FILE|--no-csv]");
  console.log("Defaults: 5,000 games per configuration, tactical strength, seed 1, progress every 5%.");
  console.log("All configurations use E: Move OFF, opposite-colour Jump, opponent redeploys the jumped piece, responder gets the next normal turn, and jumper chooses that reserve colour.");
  console.log("E1 = tight + spaced Square; E2 = tight Square only; E3 = no Square win at all. H/V/Diagonal stay enabled in all three.");
}
function runOne(config,o){
  console.log(`\nStarting ${config.label}...`);
  const start=process.hrtime.bigint();
  const r=S.runBatch({rules:config.rules,games:o.games,seed:o.seed,strength:o.strength,jumpPolicy:"opposite",responsePolicy:"sequential",boundaryPolicy:"responder-choice",jumpConsequence:"redeploy-pass",progressEvery:progressStep(o),onProgress:progressReporter(config.label,start,o.games)});
  const ms=Number(process.hrtime.bigint()-start)/1e6;
  printResult(config,r,ms);
  return{config,r,ms};
}
function main(argv=process.argv.slice(2)){
  const o=parseArgs(argv);if(o.help){help();return;}
  const configs=comparisonRules();
  const csvPath=o.csv===false?null:(o.csv||defaultCsv(o));
  console.log("Lipfty 7 E-rule Square-pattern experiment");
  console.log(`${o.games} games each; strength ${o.strength}; base seed ${o.seed}.`);
  console.log("Fixed in all three: Move OFF, opposite-colour Jump, redeploy-pass consequence, 7.1 CURRENT responder-choice boundary, H/V/Diagonal wins.");
  console.log("E1 CURRENT SQUARES: tight Square + Spaced Square ON.");
  console.log("E2 TIGHT SQUARE ONLY: Spaced Square OFF.");
  console.log("E3 NO SQUARES: both tight and Spaced Square OFF.");

  const results=configs.map(c=>runOne(c,o));
  const base=results[0];
  printDelta(base.config,base.r,results[1].config,results[1].r);
  printDelta(base.config,base.r,results[2].config,results[2].r);

  if(csvPath){
    writeCsv(csvPath,results.map(x=>flat(x.config,x.r,x.ms)));
    console.log(`\nDetailed comparison CSV: ${csvPath}`);
  }
  return results;
}
if(require.main===module){try{main();}catch(err){console.error(`Error: ${err.stack||err.message}`);process.exitCode=1;}}
module.exports={parseArgs,standardRules,comparisonRules,flat,main};
