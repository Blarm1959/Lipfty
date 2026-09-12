"use strict";

const fs=require("node:fs");
const path=require("node:path");
const S=require("./lipfty7-simulator.js");
const C=require("./run-lipfty7-one-colour-final-four-comparison.js");

const FINALIST_KEYS=[
  "player-E1-current-squares-move-on",
  "opponent-E4-spaced-square-only-move-on",
  "player-E4-spaced-square-only-move-on",
  "player-E1-current-squares-move-off",
  "opponent-E2-tight-square-only-move-off"
];

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

function finalistConfigs(){
  const all=C.comparisonRules();
  return FINALIST_KEYS.map(key=>{
    const config=all.find(x=>x.key===key);
    if(!config)throw new Error(`Finalist configuration not found: ${key}`);
    return config;
  });
}
function duration(ms){const s=ms/1000;if(s<60)return`${s.toFixed(1)}s`;const m=Math.floor(s/60),r=s-m*60;if(m<60)return`${m}m${r.toFixed(1).padStart(4,"0")}s`;return`${Math.floor(m/60)}h${String(m%60).padStart(2,"0")}m${r.toFixed(1).padStart(4,"0")}s`;}
function pair(a){return`P1 ${a?.[0]||0}, P2 ${a?.[1]||0}`;}
function count(o,k){return o?.[k]||0;}
function distribution(o){return Object.entries(o||{}).sort((a,b)=>Number(a[0])-Number(b[0])).map(([n,g])=>`${n}:${g}`).join(" ")||"none";}
function entrySummary(x){return`entries ${x.entries}, outcomes P1 ${x.wins[0]}, P2 ${x.wins[1]}, Draw ${x.draws}`;}
function squareLabel(rules){if(rules.spacedSquareOnly)return"spaced only";if(!rules.allowSquare)return"OFF";return rules.allowSpacedSquare?"tight + spaced":"tight only";}
function progressStep(o){return o.progressEvery||Math.max(1,Math.floor(o.games/20));}
function progressReporter(label,start,games){return({completed})=>{const elapsed=Number(process.hrtime.bigint()-start)/1e6;console.log(`  ${label}: ${completed} / ${games} (${(100*completed/games).toFixed(1)}%) | elapsed ${duration(elapsed)}`);};}
function defaultCsv(o){return path.join("C:\\bxd\\Lipfty-Simulation-Results",`lipfty7-finalists-${o.strength}-${o.games}-seed${o.seed}.csv`);}
function csvEscape(v){const s=String(v??"");return/[",\r\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;}
function writeCsv(file,rows){const headers=Object.keys(rows[0]);const lines=[headers.join(","),...rows.map(row=>headers.map(h=>csvEscape(typeof row[h]==="number"&&!Number.isInteger(row[h])?row[h].toFixed(6):row[h])).join(","))];fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,lines.join("\n")+"\n","utf8");}

function printResult(config,r,elapsedMs){
  console.log(`\n${config.label}`);
  console.log(`  Move: ${config.rules.allowMove?"ON":"OFF"} | Squares: ${squareLabel(config.rules)} | Final Four: ${config.policyLabel}`);
  console.log(`  Result: P1 ${r.wins[0]} (${r.firstPlayerWinPct.toFixed(2)}%), P2 ${r.wins[1]} (${r.secondPlayerWinPct.toFixed(2)}%), Draw ${r.draws} (${r.drawPct.toFixed(2)}%) | P1 score ${r.firstPlayerScorePct.toFixed(2)}%`);
  console.log(`  Turns: avg ${r.averageTurns.toFixed(3)}, min ${r.minTurns}, max ${r.maxTurns} | Final Four ${r.finalFourPct.toFixed(2)}% | max-turn draws ${r.maxTurnDraws}`);
  console.log(`  Result phase: both colours ${pair(r.resultCategories.normalBoth)} | one colour ${pair(r.resultCategories.normalOne)} | Final Four ${pair(r.resultCategories.finalFour)}`);
  console.log(`  One-colour first actor P1: ${entrySummary(r.phaseEntryOutcomes.oneColour[0])}`);
  console.log(`  One-colour first actor P2: ${entrySummary(r.phaseEntryOutcomes.oneColour[1])}`);
  console.log(`  Final Four first actor P1: ${entrySummary(r.phaseEntryOutcomes.finalFour[0])}`);
  console.log(`  Final Four first actor P2: ${entrySummary(r.phaseEntryOutcomes.finalFour[1])}`);
  console.log(`  Final Four immediate win at entry: ${pair(r.finalFourImmediateWinAvailableByActor)} | chosen colour had win ${pair(r.finalFourFirstChosenColourImmediateWinsByActor)} | first action won ${pair(r.finalFourFirstActionImmediateWinsByActor)}`);
  console.log(`  Final Four placements per reached game: ${distribution(r.finalFourPlacementCountDistribution)}`);
  console.log(`  Actions: placements ${r.placements}, moves ${r.moves}, jumps ${r.jumps}, redeployments ${r.redeployPlacements}`);
  console.log(`  Formations: H ${count(r.formations,"horizontal")}, V ${count(r.formations,"vertical")}, D ${count(r.formations,"diagonal")}, Square ${count(r.formations,"square")}, Spaced Square ${count(r.formations,"spaced-square")}`);
  console.log(`  Jump-chain check: games with 2+ ${r.gamesWithRedeployOnlyChain2Plus}, longest ${r.maxConsecutiveRedeployOnlyJumps}`);
  console.log(`  Time: ${duration(elapsedMs)}`);
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
  console.log("Usage: node .\\tools\\run-lipfty7-finalists.js [--games N] [--seed N] [--strength tactical|random] [--progress-every N] [--csv FILE|--no-csv]");
  console.log("Defaults: 5,000 games per finalist, tactical strength, seed 1, progress every 5%.");
  console.log("Runs the five finalists selected from the 1,000-game 16-way screen.");
}
function main(argv=process.argv.slice(2)){
  const o=parseArgs(argv);if(o.help){help();return[];}
  const configs=finalistConfigs(),csvPath=o.csv===false?null:(o.csv||defaultCsv(o));
  console.log("Lipfty 7 — five-finalist confirmation run");
  console.log(`${o.games} games each; ${configs.length} finalists; strength ${o.strength}; base seed ${o.seed}.`);
  console.log("Fixed: one-colour placement-only, opposite-colour Jump, redeploy-pass, sequential Move response, 7.1 responder-choice, H/V/Diagonal wins.");
  configs.forEach((c,i)=>console.log(`  ${i+1}. ${c.label}`));
  const results=configs.map(c=>runOne(c,o));
  console.log("\nFINALIST RANKING BY DISTANCE FROM 50% P1 SCORE");
  [...results].sort((a,b)=>Math.abs(a.r.firstPlayerScorePct-50)-Math.abs(b.r.firstPlayerScorePct-50)).forEach((x,i)=>{
    console.log(`  ${i+1}. ${x.config.label}: P1 score ${x.r.firstPlayerScorePct.toFixed(2)}%, draw ${x.r.drawPct.toFixed(2)}%, distance ${Math.abs(x.r.firstPlayerScorePct-50).toFixed(2)} pp`);
  });
  if(csvPath){writeCsv(csvPath,results.map(x=>C.flat(x.config,x.r,x.ms)));console.log(`\nDetailed finalists CSV: ${csvPath}`);}
  return results;
}

if(require.main===module){try{main();}catch(err){console.error(`Error: ${err.stack||err.message}`);process.exitCode=1;}}
module.exports={FINALIST_KEYS,parseArgs,finalistConfigs,defaultCsv,main};
