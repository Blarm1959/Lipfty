"use strict";

const fs=require("node:fs");
const path=require("node:path");
const S=require("./lipfty7-simulator.js");

function positiveInt(value,name){const n=Number(value);if(!Number.isInteger(n)||n<=0)throw new Error(`${name} must be a positive integer.`);return n;}
function parseArgs(argv){
  const o={games:1000,seed:1,strength:"tactical",csv:null,progressEvery:null};
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
  return[
    {key:"E1-current-squares",label:"E1 — CURRENT SQUARES",base:S.normaliseRules({...standard,allowSquare:true,allowSpacedSquare:true})},
    {key:"E2-tight-square-only",label:"E2 — TIGHT SQUARE ONLY",base:S.normaliseRules({...standard,allowSquare:true,allowSpacedSquare:false})},
    {key:"E3-no-squares",label:"E3 — NO SQUARES",base:S.normaliseRules({...standard,allowSquare:false,allowSpacedSquare:false})},
    {key:"E4-spaced-square-only",label:"E4 — SPACED SQUARE ONLY",base:S.normaliseRules({...standard,allowSquare:false,allowSpacedSquare:false,spacedSquareOnly:true})}
  ];
}
function comparisonRules(){
  const out=[];
  const policies=[
    {key:"player",label:"PLAYER CHOICE",finalFourColourPolicy:"tactical"},
    {key:"opponent",label:"OPPONENT CHOICE",finalFourColourPolicy:"opponent"}
  ];
  for(const policy of policies){
    for(const v of squareVariants()){
      for(const allowMove of [false,true]){
        out.push({
          key:`${policy.key}-${v.key}-move-${allowMove?"on":"off"}`,
          pairKey:`${v.key}-move-${allowMove?"on":"off"}`,
          movePairKey:`${policy.key}-${v.key}`,
          squareKey:v.key,
          policyKey:policy.key,
          policyLabel:policy.label,
          finalFourColourPolicy:policy.finalFourColourPolicy,
          moveLabel:allowMove?"ON":"OFF",
          label:`${policy.label} — ${v.label}, MOVE ${allowMove?"ON":"OFF"}`,
          rules:S.normaliseRules({...v.base,allowMove})
        });
      }
    }
  }
  return out;
}
function duration(ms){const s=ms/1000;if(s<60)return`${s.toFixed(1)}s`;const m=Math.floor(s/60),r=s-m*60;if(m<60)return`${m}m${r.toFixed(1).padStart(4,"0")}s`;return`${Math.floor(m/60)}h${String(m%60).padStart(2,"0")}m${r.toFixed(1).padStart(4,"0")}s`;}
function count(o,k){return o?.[k]||0;}
function pair(a){return`P1 ${a?.[0]||0}, P2 ${a?.[1]||0}`;}
function distribution(o){return Object.entries(o||{}).sort((a,b)=>Number(a[0])-Number(b[0])).map(([n,g])=>`${n}:${g}`).join(" ")||"none";}
function objectCounts(o){return Object.entries(o||{}).sort().map(([k,v])=>`${k}:${v}`).join(" ")||"none";}
function entrySummary(x){return`entries ${x.entries}, outcomes P1 ${x.wins[0]}, P2 ${x.wins[1]}, Draw ${x.draws}`;}
function squareLabel(rules){if(rules.spacedSquareOnly)return"spaced only";if(!rules.allowSquare)return"OFF";return rules.allowSpacedSquare?"tight + spaced":"tight only";}
function defaultCsv(o){return path.join("C:\\bxd\\Lipfty-Simulation-Results",`lipfty7-one-colour-final-four-comparison-${o.strength}-${o.games}-seed${o.seed}.csv`);}
function csvEscape(v){const s=String(v??"");return/[",\r\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;}
function writeCsv(file,rows){const headers=Object.keys(rows[0]);const lines=[headers.join(","),...rows.map(row=>headers.map(h=>csvEscape(typeof row[h]==="number"&&!Number.isInteger(row[h])?row[h].toFixed(6):row[h])).join(","))];fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,lines.join("\n")+"\n","utf8");}
function progressStep(o){return o.progressEvery||Math.max(1,Math.floor(o.games/20));}
function progressReporter(label,start,games){return({completed})=>{const elapsed=Number(process.hrtime.bigint()-start)/1e6;console.log(`  ${label}: ${completed} / ${games} (${(100*completed/games).toFixed(1)}%) | elapsed ${duration(elapsed)}`);};}
function actionPhaseLine(r,key,label){const p=r.phaseWinningActionTypes[key];return`${label}: Placement ${pair(p.placement)} | Move ${pair(p.move)} | Jump ${pair(p.jump)} | Redeploy ${pair(p.redeploy)}`;}
function flat(config,r,elapsedMs){
  const rules=config.rules,oc0=r.phaseEntryOutcomes.oneColour[0],oc1=r.phaseEntryOutcomes.oneColour[1],ff0=r.phaseEntryOutcomes.finalFour[0],ff1=r.phaseEntryOutcomes.finalFour[1];
  return{
    configuration:config.key,final_four_choice:config.policyKey,final_four_colour_policy:r.finalFourColourPolicy,one_colour_policy:r.oneColourPolicy,
    square_variant:config.squareKey,allow_move:rules.allowMove,allow_square:rules.allowSquare,allow_spaced_square:rules.allowSpacedSquare,spaced_square_only:rules.spacedSquareOnly,
    games:r.games,p1_wins:r.wins[0],p2_wins:r.wins[1],draws:r.draws,p1_win_pct:r.firstPlayerWinPct,p2_win_pct:r.secondPlayerWinPct,draw_pct:r.drawPct,p1_score_pct:r.firstPlayerScorePct,
    average_turns:r.averageTurns,min_turns:r.minTurns,max_turns:r.maxTurns,final_four_pct:r.finalFourPct,max_turn_draws:r.maxTurnDraws,
    both_p1:r.resultCategories.normalBoth[0],both_p2:r.resultCategories.normalBoth[1],one_p1:r.resultCategories.normalOne[0],one_p2:r.resultCategories.normalOne[1],final_p1:r.resultCategories.finalFour[0],final_p2:r.resultCategories.finalFour[1],
    one_placement_wins_p1:r.phaseWinningActionTypes.normalOne.placement[0],one_placement_wins_p2:r.phaseWinningActionTypes.normalOne.placement[1],one_move_wins_p1:r.phaseWinningActionTypes.normalOne.move[0],one_move_wins_p2:r.phaseWinningActionTypes.normalOne.move[1],one_jump_wins_p1:r.phaseWinningActionTypes.normalOne.jump[0],one_jump_wins_p2:r.phaseWinningActionTypes.normalOne.jump[1],
    one_entry_p1_actor:oc0.entries,one_entry_p1_actor_outcome_p1:oc0.wins[0],one_entry_p1_actor_outcome_p2:oc0.wins[1],one_entry_p2_actor:oc1.entries,one_entry_p2_actor_outcome_p1:oc1.wins[0],one_entry_p2_actor_outcome_p2:oc1.wins[1],
    one_transition_causes:objectCounts(r.phaseTransitionCauses.oneColour),one_transition_actor_p1:r.phaseTransitionActors.oneColour[0],one_transition_actor_p2:r.phaseTransitionActors.oneColour[1],
    final_entry_p1_actor:ff0.entries,final_entry_p1_actor_outcome_p1:ff0.wins[0],final_entry_p1_actor_outcome_p2:ff0.wins[1],final_entry_p2_actor:ff1.entries,final_entry_p2_actor_outcome_p1:ff1.wins[0],final_entry_p2_actor_outcome_p2:ff1.wins[1],
    final_transition_causes:objectCounts(r.phaseTransitionCauses.finalFour),final_transition_actor_p1:r.phaseTransitionActors.finalFour[0],final_transition_actor_p2:r.phaseTransitionActors.finalFour[1],
    final_entry_immediate_win_p1_actor:r.finalFourImmediateWinAvailableByActor[0],final_entry_immediate_win_p2_actor:r.finalFourImmediateWinAvailableByActor[1],final_first_colour_immediate_win_p1_actor:r.finalFourFirstChosenColourImmediateWinsByActor[0],final_first_colour_immediate_win_p2_actor:r.finalFourFirstChosenColourImmediateWinsByActor[1],final_first_action_win_p1_actor:r.finalFourFirstActionImmediateWinsByActor[0],final_first_action_win_p2_actor:r.finalFourFirstActionImmediateWinsByActor[1],final_placement_distribution:distribution(r.finalFourPlacementCountDistribution),
    placements:r.placements,moves:r.moves,jumps:r.jumps,redeployments:r.redeployPlacements,two_piece_responses:r.twoPieceResponses,boundary_responses:r.boundaryResponses,jump_redeploy_responses:r.jumpRedeployResponses,
    horizontal:count(r.formations,"horizontal"),vertical:count(r.formations,"vertical"),diagonal:count(r.formations,"diagonal"),square:count(r.formations,"square"),spaced_square:count(r.formations,"spaced-square"),
    longest_redeploy_jump_chain:r.maxConsecutiveRedeployOnlyJumps,games_with_chain_2plus:r.gamesWithRedeployOnlyChain2Plus,elapsed_seconds:elapsedMs/1000
  };
}
function printResult(config,r,elapsedMs){
  const rules=config.rules;
  console.log(`\n${config.label}`);
  console.log(`  Move: ${rules.allowMove?"ON":"OFF"} | Squares: ${squareLabel(rules)} | one-colour phase: PLACEMENT ONLY | Final Four choice: ${config.policyLabel}`);
  console.log(`  Result: P1 ${r.wins[0]} (${r.firstPlayerWinPct.toFixed(2)}%), P2 ${r.wins[1]} (${r.secondPlayerWinPct.toFixed(2)}%), Draw ${r.draws} (${r.drawPct.toFixed(2)}%) | P1 score ${r.firstPlayerScorePct.toFixed(2)}%`);
  console.log(`  Turns: average ${r.averageTurns.toFixed(3)}, min ${r.minTurns}, max ${r.maxTurns} | Final Four ${r.finalFourPct.toFixed(2)}% | max-turn draws ${r.maxTurnDraws}`);
  console.log(`  Result phase: both colours ${pair(r.resultCategories.normalBoth)} | one colour ${pair(r.resultCategories.normalOne)} | Final Four ${pair(r.resultCategories.finalFour)}`);
  console.log(`  ${actionPhaseLine(r,"normalOne","One-colour winning actions")}`);
  console.log(`  One-colour first actor P1: ${entrySummary(r.phaseEntryOutcomes.oneColour[0])}`);
  console.log(`  One-colour first actor P2: ${entrySummary(r.phaseEntryOutcomes.oneColour[1])}`);
  console.log(`  One-colour transition: ${objectCounts(r.phaseTransitionCauses.oneColour)} | transition actor ${pair(r.phaseTransitionActors.oneColour)}`);
  console.log(`  Final Four first actor P1: ${entrySummary(r.phaseEntryOutcomes.finalFour[0])}`);
  console.log(`  Final Four first actor P2: ${entrySummary(r.phaseEntryOutcomes.finalFour[1])}`);
  console.log(`  Final Four immediate win at entry: ${pair(r.finalFourImmediateWinAvailableByActor)} | chosen colour had win ${pair(r.finalFourFirstChosenColourImmediateWinsByActor)} | first action won ${pair(r.finalFourFirstActionImmediateWinsByActor)}`);
  console.log(`  Final Four placements per reached game: ${distribution(r.finalFourPlacementCountDistribution)}`);
  console.log(`  Actions: placements ${r.placements}, moves ${r.moves}, jumps ${r.jumps}, redeployments ${r.redeployPlacements} | responses two-piece ${r.twoPieceResponses}, 7.1 ${r.boundaryResponses}, redeploy-Jump ${r.jumpRedeployResponses}`);
  console.log(`  Formations: H ${count(r.formations,"horizontal")}, V ${count(r.formations,"vertical")}, D ${count(r.formations,"diagonal")}, Square ${count(r.formations,"square")}, Spaced Square ${count(r.formations,"spaced-square")}`);
  console.log(`  Jump-chain check: games with 2+ ${r.gamesWithRedeployOnlyChain2Plus}, longest ${r.maxConsecutiveRedeployOnlyJumps}`);
  console.log(`  Time: ${duration(elapsedMs)}`);
}
function printMoveEffect(off,on){
  console.log(`\nMOVE EFFECT (${on.config.policyLabel}): ${on.config.squareKey} — ON minus OFF`);
  console.log(`  P1 score ${(on.r.firstPlayerScorePct-off.r.firstPlayerScorePct).toFixed(2)} pp | P1 win ${(on.r.firstPlayerWinPct-off.r.firstPlayerWinPct).toFixed(2)} pp | P2 win ${(on.r.secondPlayerWinPct-off.r.secondPlayerWinPct).toFixed(2)} pp | Draw ${(on.r.drawPct-off.r.drawPct).toFixed(2)} pp`);
  console.log(`  Final Four ${(on.r.finalFourPct-off.r.finalFourPct).toFixed(2)} pp | moves ${on.r.moves-off.r.moves} | jumps ${on.r.jumps-off.r.jumps}`);
}
function printPolicyEffect(player,opponent){
  console.log(`\nFINAL FOUR CHOICE EFFECT: ${opponent.config.pairKey} — OPPONENT minus PLAYER`);
  console.log(`  P1 score ${(opponent.r.firstPlayerScorePct-player.r.firstPlayerScorePct).toFixed(2)} pp | P1 win ${(opponent.r.firstPlayerWinPct-player.r.firstPlayerWinPct).toFixed(2)} pp | P2 win ${(opponent.r.secondPlayerWinPct-player.r.secondPlayerWinPct).toFixed(2)} pp | Draw ${(opponent.r.drawPct-player.r.drawPct).toFixed(2)} pp`);
  console.log(`  Final Four wins P1 ${opponent.r.resultCategories.finalFour[0]-player.r.resultCategories.finalFour[0]}, P2 ${opponent.r.resultCategories.finalFour[1]-player.r.resultCategories.finalFour[1]} | Final Four reached ${(opponent.r.finalFourPct-player.r.finalFourPct).toFixed(2)} pp`);
  console.log(`  First chosen colour already winning: P1 ${opponent.r.finalFourFirstChosenColourImmediateWinsByActor[0]-player.r.finalFourFirstChosenColourImmediateWinsByActor[0]}, P2 ${opponent.r.finalFourFirstChosenColourImmediateWinsByActor[1]-player.r.finalFourFirstChosenColourImmediateWinsByActor[1]}`);
}
function runOne(config,o){
  console.log(`\nStarting ${config.label}...`);
  const start=process.hrtime.bigint();
  const r=S.runBatch({
    rules:config.rules,games:o.games,seed:o.seed,strength:o.strength,
    jumpPolicy:"opposite",responsePolicy:"sequential",boundaryPolicy:"responder-choice",jumpConsequence:"redeploy-pass",
    oneColourPolicy:"placement-only",finalFourColourPolicy:config.finalFourColourPolicy,
    progressEvery:progressStep(o),onProgress:progressReporter(config.label,start,o.games)
  });
  const ms=Number(process.hrtime.bigint()-start)/1e6;
  printResult(config,r,ms);
  return{config,r,ms};
}
function help(){
  console.log("Usage: node .\\tools\\run-lipfty7-one-colour-final-four-comparison.js [--games N] [--seed N] [--strength tactical|random] [--progress-every N] [--csv FILE|--no-csv]");
  console.log("Defaults: 1,000 games per configuration, tactical strength, seed 1, progress every 5%.");
  console.log("Runs 16 configurations: E1/E2/E3/E4 × Move OFF/ON, first with player-chosen Final Four colour, then with opponent-chosen Final Four colour.");
  console.log("In every configuration, once only one normal reserve colour remains, Move and Jump are disabled and all remaining normal pieces are placement-only.");
}
function main(argv=process.argv.slice(2)){
  const o=parseArgs(argv);if(o.help){help();return;}
  const configs=comparisonRules(),csvPath=o.csv===false?null:(o.csv||defaultCsv(o));
  console.log("Lipfty 7 one-colour placement-only + Final Four choice experiment");
  console.log(`${o.games} games each; 16 configurations; strength ${o.strength}; base seed ${o.seed}.`);
  console.log("Fixed in all 16: opposite-colour Jump, redeploy-pass, sequential Move response, 7.1 responder-choice, H/V/Diagonal wins.");
  console.log("NEW IN ALL 16: once only one normal reserve colour remains, Move/Jump stop completely and every remaining normal piece must be placed.");
  console.log("First 8: player chooses own Final Four piece/colour. Second 8: opponent chooses the Final Four piece/colour the player must place; player still chooses where to place it.");
  console.log("E1 = tight + spaced Square; E2 = tight only; E3 = no Squares; E4 = spaced only. Each is run Move OFF and Move ON.");

  const results=configs.map(c=>runOne(c,o));
  for(const policyKey of ["player","opponent"]){
    const group=results.filter(x=>x.config.policyKey===policyKey);
    for(let i=0;i<group.length;i+=2)printMoveEffect(group[i],group[i+1]);
  }
  const players=results.filter(x=>x.config.policyKey==="player");
  const opponents=results.filter(x=>x.config.policyKey==="opponent");
  for(const p of players){const q=opponents.find(x=>x.config.pairKey===p.config.pairKey);printPolicyEffect(p,q);}

  if(csvPath){writeCsv(csvPath,results.map(x=>flat(x.config,x.r,x.ms)));console.log(`\nDetailed comparison CSV: ${csvPath}`);}
  return results;
}
if(require.main===module){try{main();}catch(err){console.error(`Error: ${err.stack||err.message}`);process.exitCode=1;}}
module.exports={parseArgs,standardRules,squareVariants,comparisonRules,flat,main};
