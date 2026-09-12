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
function pair(a){return`P1 ${a?.[0]||0}, P2 ${a?.[1]||0}`;}
function distribution(o){return Object.entries(o||{}).sort((a,b)=>Number(a[0])-Number(b[0])).map(([n,g])=>`${n}:${g}`).join(" ")||"none";}
function objectCounts(o){return Object.entries(o||{}).sort().map(([k,v])=>`${k}:${v}`).join(" ")||"none";}
function defaultCsv(o){return path.join("C:\\bxd\\Lipfty-Simulation-Results",`lipfty7-phase-diagnostic-${o.strength}-${o.games}-seed${o.seed}.csv`);}
function entrySummary(x){return`entries ${x.entries}, outcomes P1 ${x.wins[0]}, P2 ${x.wins[1]}, Draw ${x.draws}`;}
function actionPhaseLine(r,key,label){
  const p=r.phaseWinningActionTypes[key];
  return `${label}: Placement ${pair(p.placement)} | Move ${pair(p.move)} | Jump ${pair(p.jump)} | Redeploy ${pair(p.redeploy)}`;
}
function printResult(label,r,ms){
  console.log(`\n${label}`);
  console.log(`  Final Four colour policy: ${r.finalFourColourPolicy}`);
  console.log(`  Result: P1 ${r.wins[0]} (${r.firstPlayerWinPct.toFixed(2)}%), P2 ${r.wins[1]} (${r.secondPlayerWinPct.toFixed(2)}%), Draw ${r.draws} (${r.drawPct.toFixed(2)}%)`);
  console.log(`  Turns: average ${r.averageTurns.toFixed(3)}, min ${r.minTurns}, max ${r.maxTurns} | Final Four reached ${r.finalFourPct.toFixed(2)}%`);
  console.log(`  Result phase: both colours ${pair(r.resultCategories.normalBoth)} | one colour ${pair(r.resultCategories.normalOne)} | Final Four ${pair(r.resultCategories.finalFour)}`);
  console.log(`  ${actionPhaseLine(r,"normalBoth","Both-colour winning actions")}`);
  console.log(`  ${actionPhaseLine(r,"normalOne","One-colour winning actions")}`);
  console.log(`  ${actionPhaseLine(r,"finalFour","Final Four winning actions")}`);
  console.log(`  One-colour first actor P1: ${entrySummary(r.phaseEntryOutcomes.oneColour[0])}`);
  console.log(`  One-colour first actor P2: ${entrySummary(r.phaseEntryOutcomes.oneColour[1])}`);
  console.log(`  One-colour transition cause: ${objectCounts(r.phaseTransitionCauses.oneColour)} | transition actor ${pair(r.phaseTransitionActors.oneColour)}`);
  console.log(`  Final Four first actor P1: ${entrySummary(r.phaseEntryOutcomes.finalFour[0])}`);
  console.log(`  Final Four first actor P2: ${entrySummary(r.phaseEntryOutcomes.finalFour[1])}`);
  console.log(`  Final Four transition cause: ${objectCounts(r.phaseTransitionCauses.finalFour)} | transition actor ${pair(r.phaseTransitionActors.finalFour)}`);
  console.log(`  Final Four immediate win already available at entry: ${pair(r.finalFourImmediateWinAvailableByActor)}`);
  console.log(`  Final Four first chosen colour had immediate win: ${pair(r.finalFourFirstChosenColourImmediateWinsByActor)}`);
  console.log(`  Final Four first action won immediately: ${pair(r.finalFourFirstActionImmediateWinsByActor)}`);
  console.log(`  Final Four placements per reached game: ${distribution(r.finalFourPlacementCountDistribution)}`);
  console.log(`  Total actions: placements ${r.placements}, moves ${r.moves}, jumps ${r.jumps}, redeployments ${r.redeployPlacements}`);
  console.log(`  Time: ${duration(ms)}`);
}
function flat(label,r,ms){
  const oc0=r.phaseEntryOutcomes.oneColour[0],oc1=r.phaseEntryOutcomes.oneColour[1],ff0=r.phaseEntryOutcomes.finalFour[0],ff1=r.phaseEntryOutcomes.finalFour[1];
  return{
    configuration:label,final_four_colour_policy:r.finalFourColourPolicy,games:r.games,
    p1_wins:r.wins[0],p2_wins:r.wins[1],draws:r.draws,p1_win_pct:r.firstPlayerWinPct,p2_win_pct:r.secondPlayerWinPct,draw_pct:r.drawPct,
    average_turns:r.averageTurns,final_four_pct:r.finalFourPct,
    both_phase_p1:r.resultCategories.normalBoth[0],both_phase_p2:r.resultCategories.normalBoth[1],one_phase_p1:r.resultCategories.normalOne[0],one_phase_p2:r.resultCategories.normalOne[1],final_four_p1:r.resultCategories.finalFour[0],final_four_p2:r.resultCategories.finalFour[1],
    both_jump_wins_p1:r.phaseWinningActionTypes.normalBoth.jump[0],both_jump_wins_p2:r.phaseWinningActionTypes.normalBoth.jump[1],one_jump_wins_p1:r.phaseWinningActionTypes.normalOne.jump[0],one_jump_wins_p2:r.phaseWinningActionTypes.normalOne.jump[1],final_jump_wins_p1:r.phaseWinningActionTypes.finalFour.jump[0],final_jump_wins_p2:r.phaseWinningActionTypes.finalFour.jump[1],
    one_entry_p1_actor:oc0.entries,one_entry_p1_actor_outcome_p1:oc0.wins[0],one_entry_p1_actor_outcome_p2:oc0.wins[1],one_entry_p1_actor_draw:oc0.draws,
    one_entry_p2_actor:oc1.entries,one_entry_p2_actor_outcome_p1:oc1.wins[0],one_entry_p2_actor_outcome_p2:oc1.wins[1],one_entry_p2_actor_draw:oc1.draws,
    final_entry_p1_actor:ff0.entries,final_entry_p1_actor_outcome_p1:ff0.wins[0],final_entry_p1_actor_outcome_p2:ff0.wins[1],final_entry_p1_actor_draw:ff0.draws,
    final_entry_p2_actor:ff1.entries,final_entry_p2_actor_outcome_p1:ff1.wins[0],final_entry_p2_actor_outcome_p2:ff1.wins[1],final_entry_p2_actor_draw:ff1.draws,
    one_transition_causes:objectCounts(r.phaseTransitionCauses.oneColour),final_transition_causes:objectCounts(r.phaseTransitionCauses.finalFour),
    one_transition_actor_p1:r.phaseTransitionActors.oneColour[0],one_transition_actor_p2:r.phaseTransitionActors.oneColour[1],final_transition_actor_p1:r.phaseTransitionActors.finalFour[0],final_transition_actor_p2:r.phaseTransitionActors.finalFour[1],
    final_entry_immediate_win_p1_actor:r.finalFourImmediateWinAvailableByActor[0],final_entry_immediate_win_p2_actor:r.finalFourImmediateWinAvailableByActor[1],
    final_first_colour_immediate_win_p1_actor:r.finalFourFirstChosenColourImmediateWinsByActor[0],final_first_colour_immediate_win_p2_actor:r.finalFourFirstChosenColourImmediateWinsByActor[1],
    final_first_action_win_p1_actor:r.finalFourFirstActionImmediateWinsByActor[0],final_first_action_win_p2_actor:r.finalFourFirstActionImmediateWinsByActor[1],
    final_placement_distribution:distribution(r.finalFourPlacementCountDistribution),placements:r.placements,moves:r.moves,jumps:r.jumps,redeployments:r.redeployPlacements,elapsed_seconds:ms/1000
  };
}
function csvEscape(v){const s=String(v??"");return/[",\r\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;}
function writeCsv(file,rows){const headers=Object.keys(rows[0]);const lines=[headers.join(","),...rows.map(row=>headers.map(h=>csvEscape(typeof row[h]==="number"&&!Number.isInteger(row[h])?row[h].toFixed(6):row[h])).join(","))];fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,lines.join("\n")+"\n","utf8");}
function progressStep(o){return o.progressEvery||Math.max(1,Math.floor(o.games/20));}
function runOne(label,policy,o){
  console.log(`\nStarting ${label}...`);
  const start=process.hrtime.bigint();
  const r=S.runBatch({rules:standardRules(),games:o.games,seed:o.seed,strength:o.strength,jumpPolicy:"opposite",responsePolicy:"sequential",boundaryPolicy:"responder-choice",jumpConsequence:"redeploy-pass",finalFourColourPolicy:policy,progressEvery:progressStep(o),onProgress:({completed})=>{const ms=Number(process.hrtime.bigint()-start)/1e6;console.log(`  ${label}: ${completed} / ${o.games} (${(100*completed/o.games).toFixed(1)}%) | elapsed ${duration(ms)}`);}});
  const ms=Number(process.hrtime.bigint()-start)/1e6;printResult(label,r,ms);return{label,policy,r,ms};
}
function help(){
  console.log("Usage: node .\\tools\\run-lipfty7-phase-diagnostic.js [--games N] [--seed N] [--strength tactical|random] [--progress-every N] [--csv FILE|--no-csv]");
  console.log("Runs the E1 + Move ON candidate twice: current random Final Four colour selection and tactical player-chosen Final Four colour selection.");
}
function main(argv=process.argv.slice(2)){
  const o=parseArgs(argv);if(o.help){help();return;}
  const csvPath=o.csv===false?null:(o.csv||defaultCsv(o));
  console.log("Lipfty 7 E1 + Move ON phase/Final-Four diagnostic");
  console.log(`${o.games} games each; strength ${o.strength}; base seed ${o.seed}.`);
  console.log("Fixed: Move ON, opposite-colour Jump, redeploy-pass, sequential Move response, 7.1 responder-choice, H/V/Diagonal/Tight Square/Spaced Square.");
  console.log("R CURRENT: Final Four colour chosen randomly (existing simulator behaviour).");
  console.log("T PLAYER CHOICE: Final Four player chooses the tactically best available colour, then best placement.");
  const current=runOne("R — CURRENT RANDOM FINAL FOUR COLOUR","random",o);
  const tactical=runOne("T — PLAYER-CHOSEN TACTICAL FINAL FOUR COLOUR","tactical",o);
  console.log("\nCHANGE: T minus R");
  console.log(`  P1 win: ${(tactical.r.firstPlayerWinPct-current.r.firstPlayerWinPct).toFixed(2)} pp | P2 win: ${(tactical.r.secondPlayerWinPct-current.r.secondPlayerWinPct).toFixed(2)} pp | Draw: ${(tactical.r.drawPct-current.r.drawPct).toFixed(2)} pp`);
  console.log(`  Final Four wins: P1 ${tactical.r.resultCategories.finalFour[0]-current.r.resultCategories.finalFour[0]}, P2 ${tactical.r.resultCategories.finalFour[1]-current.r.resultCategories.finalFour[1]}`);
  console.log(`  Final Four reached: ${(tactical.r.finalFourPct-current.r.finalFourPct).toFixed(2)} pp (should be 0 on matched pre-Final play)`);
  if(csvPath){writeCsv(csvPath,[flat("R-current-random-final-four",current.r,current.ms),flat("T-player-chosen-tactical-final-four",tactical.r,tactical.ms)]);console.log(`\nDetailed diagnostic CSV: ${csvPath}`);}
  return[current,tactical];
}
if(require.main===module){try{main();}catch(err){console.error(`Error: ${err.stack||err.message}`);process.exitCode=1;}}
module.exports={parseArgs,standardRules,flat,main};
