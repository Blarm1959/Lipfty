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
function squareVariants(){
  const standard=standardRules();
  return [
    {key:"E1-current-squares",label:"E1 — CURRENT SQUARES",base:S.normaliseRules({...standard,allowSquare:true,allowSpacedSquare:true})},
    {key:"E2-tight-square-only",label:"E2 — TIGHT SQUARE ONLY",base:S.normaliseRules({...standard,allowSquare:true,allowSpacedSquare:false})},
    {key:"E3-no-squares",label:"E3 — NO SQUARES",base:S.normaliseRules({...standard,allowSquare:false,allowSpacedSquare:false})},
    {key:"E4-spaced-square-only",label:"E4 — SPACED SQUARE ONLY",base:S.normaliseRules({...standard,allowSquare:false,allowSpacedSquare:false,spacedSquareOnly:true})}
  ];
}
function comparisonRules(){
  const out=[];
  for(const v of squareVariants()){
    out.push({key:`${v.key}-move-off`,pairKey:v.key,label:`${v.label}, MOVE OFF`,moveLabel:"OFF",rules:S.normaliseRules({...v.base,allowMove:false})});
    out.push({key:`${v.key}-move-on`,pairKey:v.key,label:`${v.label}, MOVE ON`,moveLabel:"ON",rules:S.normaliseRules({...v.base,allowMove:true})});
  }
  return out;
}
function duration(ms){const s=ms/1000;if(s<60)return`${s.toFixed(1)}s`;const m=Math.floor(s/60),r=s-m*60;if(m<60)return`${m}m${r.toFixed(1).padStart(4,"0")}s`;return`${Math.floor(m/60)}h${String(m%60).padStart(2,"0")}m${r.toFixed(1).padStart(4,"0")}s`;}
function count(o,k){return o?.[k]||0;}
function pair(a){return`P1 ${a[0]}, P2 ${a[1]}`;}
function distribution(o){return Object.entries(o||{}).sort((a,b)=>Number(a[0])-Number(b[0])).map(([n,g])=>`${n}:${g}`).join(" ");}
function squareLabel(rules){if(rules.spacedSquareOnly)return"spaced only";if(!rules.allowSquare)return"OFF";return rules.allowSpacedSquare?"tight + spaced":"tight only";}
function defaultCsv(o){return path.join("C:\\bxd\\Lipfty-Simulation-Results",`lipfty7-square-move-comparison-${o.strength}-${o.games}-seed${o.seed}.csv`);}
function csvEscape(v){const s=String(v??"");return/[",\r\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;}
function writeCsv(file,rows){const headers=Object.keys(rows[0]);const lines=[headers.join(","),...rows.map(row=>headers.map(h=>csvEscape(typeof row[h]==="number"&&!Number.isInteger(row[h])?row[h].toFixed(6):row[h])).join(","))];fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,lines.join("\n")+"\n","utf8");}
function flat(config,r,elapsedMs){
  const rules=config.rules;
  return{
    configuration:config.key,pair_key:config.pairKey,allow_move:rules.allowMove,allow_square:rules.allowSquare,allow_spaced_square:rules.allowSpacedSquare,spaced_square_only:rules.spacedSquareOnly,
    jump_consequence:r.jumpConsequence,boundary_rule:r.boundaryPolicy,response_rule:r.responsePolicy,jump_colour:r.jumpPolicy,
    games:r.games,p1_wins:r.wins[0],p2_wins:r.wins[1],draws:r.draws,p1_win_pct:r.firstPlayerWinPct,p2_win_pct:r.secondPlayerWinPct,draw_pct:r.drawPct,p1_score_pct:r.firstPlayerScorePct,
    average_turns:r.averageTurns,min_turns:r.minTurns,max_turns:r.maxTurns,final_four_pct:r.finalFourPct,max_turn_draws:r.maxTurnDraws,
    both_normal_p1:r.resultCategories.normalBoth[0],both_normal_p2:r.resultCategories.normalBoth[1],one_normal_p1:r.resultCategories.normalOne[0],one_normal_p2:r.resultCategories.normalOne[1],final_four_p1:r.resultCategories.finalFour[0],final_four_p2:r.resultCategories.finalFour[1],
    placement_wins_p1:r.winningActionTypes.placement[0],placement_wins_p2:r.winningActionTypes.placement[1],move_wins_p1:r.winningActionTypes.move[0],move_wins_p2:r.winningActionTypes.move[1],jump_direct_wins_p1:r.winningActionTypes.jump[0],jump_direct_wins_p2:r.winningActionTypes.jump[1],redeploy_wins_p1:r.winningActionTypes.redeploy[0],redeploy_wins_p2:r.winningActionTypes.redeploy[1],
    placements:r.placements,moves:r.moves,jumps:r.jumps,redeploy_placements:r.redeployPlacements,compulsory_actions:r.forcedPlacements,
    two_piece_responses:r.twoPieceResponses,boundary_responses:r.boundaryResponses,jump_redeploy_responses:r.jumpRedeployResponses,average_responses_per_game:r.averageResponsesPerGame,
    games_with_redeploy_jump_chain_2plus:r.gamesWithRedeployOnlyChain2Plus,max_consecutive_redeploy_jumps:r.maxConsecutiveRedeployOnlyJumps,redeploy_jump_chain_max_distribution:distribution(r.redeployOnlyChainMaxDistribution),
    horizontal:count(r.formations,"horizontal"),vertical:count(r.formations,"vertical"),diagonal:count(r.formations,"diagonal"),square:count(r.formations,"square"),spaced_square:count(r.formations,"spaced-square"),
    elapsed_seconds:elapsedMs/1000
  };
}
function progressStep(o){return o.progressEvery||Math.max(1,Math.floor(o.games/20));}
function progressReporter(label,start,games){return({completed})=>{const elapsed=Number(process.hrtime.bigint()-start)/1e6;console.log(`  ${label}: ${completed} / ${games} (${(100*completed/games).toFixed(1)}%) | elapsed ${duration(elapsed)}`);};}
function printResult(config,r,elapsedMs){
  const rules=config.rules;
  console.log(`\n${config.label}`);
  console.log(`  Move: ${rules.allowMove?"ON":"OFF"} | Jump consequence: redeploy-pass | Squares: ${squareLabel(rules)} | Jump colour: opposite only`);
  console.log(`  Result: P1 ${r.wins[0]} (${r.firstPlayerWinPct.toFixed(2)}%), P2 ${r.wins[1]} (${r.secondPlayerWinPct.toFixed(2)}%), Draw ${r.draws} (${r.drawPct.toFixed(2)}%)`);
  console.log(`  P1 chess-style score: ${r.firstPlayerScorePct.toFixed(2)}%`);
  console.log(`  Turns: average ${r.averageTurns.toFixed(3)}, min ${r.minTurns}, max ${r.maxTurns} | max-turn draws ${r.maxTurnDraws}`);
  console.log(`  Final Four reached: ${r.finalFourPct.toFixed(2)}%`);
  console.log(`  Result phase: both normal colours ${pair(r.resultCategories.normalBoth)} | one normal colour ${pair(r.resultCategories.normalOne)} | Final Four ${pair(r.resultCategories.finalFour)} | Draw ${r.draws}`);
  console.log(`  Winning action: Placement ${pair(r.winningActionTypes.placement)} | Move ${pair(r.winningActionTypes.move)} | direct Jump ${pair(r.winningActionTypes.jump)} | jumped-piece redeploy ${pair(r.winningActionTypes.redeploy)}`);
  console.log(`  Actions: placements ${r.placements}, moves ${r.moves}, jumps ${r.jumps}, non-winning Jumps redeployed ${r.redeployPlacements}, compulsory actions ${r.forcedPlacements}`);
  console.log(`  Responses: normal two-piece ${r.twoPieceResponses}, 7.1 boundary ${r.boundaryResponses}, redeploy-Jump ${r.jumpRedeployResponses}, average/game ${r.averageResponsesPerGame.toFixed(3)}`);
  console.log(`  Consecutive redeploy-Jump chains: games with 2+ ${r.gamesWithRedeployOnlyChain2Plus}, longest ${r.maxConsecutiveRedeployOnlyJumps}, max-chain distribution ${distribution(r.redeployOnlyChainMaxDistribution)}`);
  console.log(`  Formations: H ${count(r.formations,"horizontal")}, V ${count(r.formations,"vertical")}, D ${count(r.formations,"diagonal")}, Square ${count(r.formations,"square")}, Spaced Square ${count(r.formations,"spaced-square")}`);
  console.log(`  Time: ${duration(elapsedMs)}`);
}
function printPairDelta(off,on){
  console.log(`\nMOVE EFFECT: ${on.config.pairKey} — MOVE ON minus MOVE OFF`);
  console.log(`  P1 score: ${(on.r.firstPlayerScorePct-off.r.firstPlayerScorePct).toFixed(2)} percentage points`);
  console.log(`  P1 win: ${(on.r.firstPlayerWinPct-off.r.firstPlayerWinPct).toFixed(2)} pp | P2 win: ${(on.r.secondPlayerWinPct-off.r.secondPlayerWinPct).toFixed(2)} pp | Draw: ${(on.r.drawPct-off.r.drawPct).toFixed(2)} pp`);
  console.log(`  Average turns: ${(on.r.averageTurns-off.r.averageTurns).toFixed(3)} | Final Four: ${(on.r.finalFourPct-off.r.finalFourPct).toFixed(2)} pp`);
  console.log(`  Moves: ${on.r.moves-off.r.moves} | Jumps: ${on.r.jumps-off.r.jumps} | redeployments: ${on.r.redeployPlacements-off.r.redeployPlacements}`);
  console.log(`  Move wins P1/P2: ${on.r.winningActionTypes.move[0]-off.r.winningActionTypes.move[0]} / ${on.r.winningActionTypes.move[1]-off.r.winningActionTypes.move[1]}`);
  console.log(`  Final Four wins P1/P2: ${on.r.resultCategories.finalFour[0]-off.r.resultCategories.finalFour[0]} / ${on.r.resultCategories.finalFour[1]-off.r.resultCategories.finalFour[1]}`);
  console.log(`  Max-turn draws: ${on.r.maxTurnDraws} | longest consecutive redeploy-Jump chain: ${on.r.maxConsecutiveRedeployOnlyJumps}`);
}
function help(){
  console.log("Usage: node .\\tools\\run-lipfty7-square-move-comparison.js [--games N] [--seed N] [--strength tactical|random] [--progress-every N] [--csv FILE|--no-csv]");
  console.log("Defaults: 5,000 games per configuration, tactical strength, seed 1, progress every 5%.");
  console.log("Eight configurations are run: E1/E2/E3/E4 once with Move OFF and once with Move ON.");
  console.log("Jump is always opposite-colour and uses redeploy-pass: opponent redeploys the jumped piece, then receives the next normal turn; jumper chooses that reserve colour.");
  console.log("When Move is ON, ordinary Move keeps the existing sequential two-reserve response and 7.1 responder-choice boundary rule.");
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
  console.log("Lipfty 7 E-rule Square-pattern + Move experiment");
  console.log(`${o.games} games each; 8 configurations; strength ${o.strength}; base seed ${o.seed}.`);
  console.log("Fixed in all eight: opposite-colour Jump, redeploy-pass consequence, 7.1 CURRENT responder-choice boundary, H/V/Diagonal wins.");
  console.log("Each Square pattern is run twice: Move OFF and Move ON.");
  console.log("E1 CURRENT SQUARES: tight + Spaced Square ON.");
  console.log("E2 TIGHT SQUARE ONLY: Spaced Square OFF.");
  console.log("E3 NO SQUARES: both tight and Spaced Square OFF.");
  console.log("E4 SPACED SQUARE ONLY: tight Square OFF; Spaced Square ON.");

  const results=configs.map(c=>runOne(c,o));
  for(let i=0;i<results.length;i+=2)printPairDelta(results[i],results[i+1]);

  if(csvPath){
    writeCsv(csvPath,results.map(x=>flat(x.config,x.r,x.ms)));
    console.log(`\nDetailed comparison CSV: ${csvPath}`);
  }
  return results;
}
if(require.main===module){try{main();}catch(err){console.error(`Error: ${err.stack||err.message}`);process.exitCode=1;}}
module.exports={parseArgs,standardRules,squareVariants,comparisonRules,flat,main};
