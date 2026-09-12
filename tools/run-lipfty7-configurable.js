"use strict";

const fs=require("node:fs");
const path=require("node:path");
const S=require("./lipfty7-simulator.js");
const C=require("./run-lipfty7-one-colour-final-four-comparison.js");

const SQUARE_ALIASES={
  e1:"both",both:"both","tight+spaced":"both","tight-spaced":"both",
  e2:"tight",tight:"tight",
  e3:"none",none:"none",off:"none",
  e4:"spaced",spaced:"spaced","spaced-only":"spaced"
};
const FINAL_FOUR_POLICIES={player:"tactical",opponent:"opponent",random:"random"};

function positiveInt(value,name){const n=Number(value);if(!Number.isInteger(n)||n<=0)throw new Error(`${name} must be a positive integer.`);return n;}
function onOff(value,name){const v=String(value||"").toLowerCase();if(v==="on"||v==="true"||v==="1")return true;if(v==="off"||v==="false"||v==="0")return false;throw new Error(`${name} must be on or off.`);}
function choice(value,allowed,name){const v=String(value||"").toLowerCase();if(!allowed.includes(v))throw new Error(`${name} must be one of: ${allowed.join(", ")}.`);return v;}

function parseArgs(argv){
  const o={games:1000,seed:1,strength:"tactical",progressEvery:null,csv:null,configs:[],list:false,help:false,overrides:{}};
  for(let i=0;i<argv.length;i++){
    const a=argv[i];
    if(a==="--games")o.games=positiveInt(argv[++i],"--games");
    else if(a==="--seed")o.seed=positiveInt(argv[++i],"--seed");
    else if(a==="--strength")o.strength=choice(argv[++i],["tactical","random"],"--strength");
    else if(a==="--progress-every")o.progressEvery=positiveInt(argv[++i],"--progress-every");
    else if(a==="--csv")o.csv=argv[++i];
    else if(a==="--no-csv")o.csv=false;
    else if(a==="--config")o.configs.push(String(argv[++i]||"").toLowerCase());
    else if(a==="--list")o.list=true;
    else if(a==="--squares")o.overrides.squares=choice(argv[++i],Object.keys(SQUARE_ALIASES),"--squares");
    else if(a==="--move")o.overrides.move=onOff(argv[++i],"--move");
    else if(a==="--jump")o.overrides.jump=onOff(argv[++i],"--jump");
    else if(a==="--diagonal")o.overrides.diagonal=onOff(argv[++i],"--diagonal");
    else if(a==="--final-four")o.overrides.finalFour=choice(argv[++i],Object.keys(FINAL_FOUR_POLICIES),"--final-four");
    else if(a==="--one-colour")o.overrides.oneColour=choice(argv[++i],["current","placement-only"],"--one-colour");
    else if(a==="--jump-colour")o.overrides.jumpColour=choice(argv[++i],["opposite","any"],"--jump-colour");
    else if(a==="--jump-consequence")o.overrides.jumpConsequence=choice(argv[++i],["current","redeploy","redeploy-only","redeploy-pass"],"--jump-consequence");
    else if(a==="--response")o.overrides.response=choice(argv[++i],["committed","sequential"],"--response");
    else if(a==="--boundary")o.overrides.boundary=choice(argv[++i],["current","responder-choice"],"--boundary");
    else if(a==="--help"||a==="-h")o.help=true;
    else throw new Error(`Unknown option: ${a}`);
  }
  if(o.csv===undefined)throw new Error("--csv requires a file name.");
  return o;
}

function presetEntries(){
  const out=[];
  for(const c of C.comparisonRules()){
    const e=/-(E[1-4])-[^-]+(?:-[^-]+)*-move-(on|off)$/i.exec(c.key);
    const square=(c.squareKey.match(/^E[1-4]/i)||["E?"])[0].toLowerCase();
    const alias=`${square}-${c.moveLabel.toLowerCase()}-${c.policyKey}`;
    out.push({...c,alias});
  }
  return out;
}
function presetMap(){
  const m=new Map();
  for(const c of presetEntries()){
    m.set(c.alias.toLowerCase(),c);
    m.set(c.key.toLowerCase(),c);
  }
  return m;
}
function cloneConfig(c){return{...c,rules:{...c.rules}};}
function defaultConfig(){return cloneConfig(presetMap().get("e1-on-player"));}

function applySquare(rules,value){
  const v=SQUARE_ALIASES[value];
  rules.allowSquare=v==="both"||v==="tight";
  rules.allowSpacedSquare=v==="both";
  rules.spacedSquareOnly=v==="spaced";
  return v;
}
function applyOverrides(config,o){
  const c=cloneConfig(config),r=c.rules,ov=o.overrides;
  let squareName=null;
  if(ov.squares!==undefined)squareName=applySquare(r,ov.squares);
  if(ov.move!==undefined)r.allowMove=ov.move;
  if(ov.jump!==undefined)r.allowJump=ov.jump;
  if(ov.diagonal!==undefined)r.allowDiagonal=ov.diagonal;
  if(ov.finalFour!==undefined){c.policyKey=ov.finalFour;c.policyLabel=ov.finalFour.toUpperCase()+" CHOICE";c.finalFourColourPolicy=FINAL_FOUR_POLICIES[ov.finalFour];}
  c.oneColourPolicy=ov.oneColour||"placement-only";
  c.jumpPolicy=ov.jumpColour||"opposite";
  c.jumpConsequence=ov.jumpConsequence||"redeploy-pass";
  c.responsePolicy=ov.response||"sequential";
  c.boundaryPolicy=ov.boundary||"responder-choice";
  if(Object.keys(ov).length){
    const sq=squareName||squareLabel(r);
    c.key=`custom-${sq}-move-${r.allowMove?"on":"off"}-${c.policyKey}`.replace(/\s+/g,"-");
    c.alias=c.key;
    c.label=`CUSTOM — squares ${sq}, Move ${r.allowMove?"ON":"OFF"}, Jump ${r.allowJump?"ON":"OFF"}, Final Four ${c.policyKey}`;
  }
  return c;
}
function resolveConfigurations(o){
  const map=presetMap();
  let configs;
  if(o.configs.length){
    configs=o.configs.map(k=>{const c=map.get(k);if(!c)throw new Error(`Unknown --config '${k}'. Use --list to see available names.`);return cloneConfig(c);});
  }else configs=[defaultConfig()];
  return configs.map(c=>applyOverrides(c,o));
}

function squareLabel(r){if(r.spacedSquareOnly)return"spaced";if(!r.allowSquare)return"none";return r.allowSpacedSquare?"both":"tight";}
function count(o,k){return o?.[k]||0;}
function pair(a){return`P1 ${a?.[0]||0}, P2 ${a?.[1]||0}`;}
function distribution(o){return Object.entries(o||{}).sort((a,b)=>Number(a[0])-Number(b[0])).map(([n,g])=>`${n}:${g}`).join(" ")||"none";}
function duration(ms){const s=ms/1000;if(s<60)return`${s.toFixed(1)}s`;const m=Math.floor(s/60),r=s-m*60;if(m<60)return`${m}m${r.toFixed(1).padStart(4,"0")}s`;return`${Math.floor(m/60)}h${String(m%60).padStart(2,"0")}m${r.toFixed(1).padStart(4,"0")}s`;}
function progressStep(o){return o.progressEvery||Math.max(1,Math.floor(o.games/20));}
function progressReporter(label,start,games){return({completed})=>{const elapsed=Number(process.hrtime.bigint()-start)/1e6;console.log(`  ${label}: ${completed} / ${games} (${(100*completed/games).toFixed(1)}%) | elapsed ${duration(elapsed)}`);};}
function objectCounts(o){return Object.entries(o||{}).sort().map(([k,v])=>`${k}:${v}`).join(" ")||"none";}

function runOne(config,o){
  console.log(`\nStarting ${config.label}...`);
  const start=process.hrtime.bigint();
  const r=S.runBatch({
    rules:config.rules,games:o.games,seed:o.seed,strength:o.strength,
    jumpPolicy:config.jumpPolicy,responsePolicy:config.responsePolicy,boundaryPolicy:config.boundaryPolicy,jumpConsequence:config.jumpConsequence,
    oneColourPolicy:config.oneColourPolicy,finalFourColourPolicy:config.finalFourColourPolicy,
    progressEvery:progressStep(o),onProgress:progressReporter(config.label,start,o.games)
  });
  const ms=Number(process.hrtime.bigint()-start)/1e6;
  const oc0=r.phaseEntryOutcomes.oneColour[0],oc1=r.phaseEntryOutcomes.oneColour[1],ff0=r.phaseEntryOutcomes.finalFour[0],ff1=r.phaseEntryOutcomes.finalFour[1];
  console.log(`\n${config.label}`);
  console.log(`  Rules: squares ${squareLabel(config.rules)} | Move ${config.rules.allowMove?"ON":"OFF"} | Jump ${config.rules.allowJump?"ON":"OFF"} | diagonal ${config.rules.allowDiagonal?"ON":"OFF"}`);
  console.log(`  Policies: one-colour ${config.oneColourPolicy} | Final Four ${config.policyKey} | Jump colour ${config.jumpPolicy} | Jump consequence ${config.jumpConsequence} | response ${config.responsePolicy} | boundary ${config.boundaryPolicy}`);
  console.log(`  Result: P1 ${r.wins[0]} (${r.firstPlayerWinPct.toFixed(2)}%), P2 ${r.wins[1]} (${r.secondPlayerWinPct.toFixed(2)}%), Draw ${r.draws} (${r.drawPct.toFixed(2)}%) | P1 score ${r.firstPlayerScorePct.toFixed(2)}%`);
  console.log(`  Turns: avg ${r.averageTurns.toFixed(3)}, min ${r.minTurns}, max ${r.maxTurns} | Final Four ${r.finalFourPct.toFixed(2)}% | max-turn draws ${r.maxTurnDraws}`);
  console.log(`  Result phase: both colours ${pair(r.resultCategories.normalBoth)} | one colour ${pair(r.resultCategories.normalOne)} | Final Four ${pair(r.resultCategories.finalFour)}`);
  console.log(`  One-colour first actor P1: entries ${oc0.entries}, outcomes P1 ${oc0.wins[0]}, P2 ${oc0.wins[1]}, Draw ${oc0.draws}`);
  console.log(`  One-colour first actor P2: entries ${oc1.entries}, outcomes P1 ${oc1.wins[0]}, P2 ${oc1.wins[1]}, Draw ${oc1.draws}`);
  console.log(`  One-colour transition: ${objectCounts(r.phaseTransitionCauses.oneColour)} | transition actor ${pair(r.phaseTransitionActors.oneColour)}`);
  console.log(`  Final Four first actor P1: entries ${ff0.entries}, outcomes P1 ${ff0.wins[0]}, P2 ${ff0.wins[1]}, Draw ${ff0.draws}`);
  console.log(`  Final Four first actor P2: entries ${ff1.entries}, outcomes P1 ${ff1.wins[0]}, P2 ${ff1.wins[1]}, Draw ${ff1.draws}`);
  console.log(`  Final Four immediate win at entry: ${pair(r.finalFourImmediateWinAvailableByActor)} | chosen colour had win ${pair(r.finalFourFirstChosenColourImmediateWinsByActor)} | first action won ${pair(r.finalFourFirstActionImmediateWinsByActor)}`);
  console.log(`  Final Four placements per reached game: ${distribution(r.finalFourPlacementCountDistribution)}`);
  console.log(`  Actions: placements ${r.placements}, moves ${r.moves}, jumps ${r.jumps}, redeployments ${r.redeployPlacements}`);
  console.log(`  Formations: H ${count(r.formations,"horizontal")}, V ${count(r.formations,"vertical")}, D ${count(r.formations,"diagonal")}, Square ${count(r.formations,"square")}, Spaced Square ${count(r.formations,"spaced-square")}`);
  console.log(`  Jump-chain check: games with 2+ ${r.gamesWithRedeployOnlyChain2Plus}, longest ${r.maxConsecutiveRedeployOnlyJumps}`);
  console.log(`  Time: ${duration(ms)}`);
  return{config,r,ms};
}

function csvEscape(v){const s=String(v??"");return/[",\r\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;}
function flat(x){
  const {config:c,r,ms}=x;
  return{
    configuration:c.alias||c.key,label:c.label,games:r.games,seed_start:c._seed||"",strength:r.strength||"",
    squares:squareLabel(c.rules),move:c.rules.allowMove,jump:c.rules.allowJump,diagonal:c.rules.allowDiagonal,
    final_four_choice:c.policyKey,final_four_colour_policy:r.finalFourColourPolicy,one_colour_policy:r.oneColourPolicy,jump_colour:r.jumpPolicy,jump_consequence:r.jumpConsequence,response_policy:r.responsePolicy,boundary_policy:r.boundaryPolicy,
    p1_wins:r.wins[0],p2_wins:r.wins[1],draws:r.draws,p1_win_pct:r.firstPlayerWinPct,p2_win_pct:r.secondPlayerWinPct,draw_pct:r.drawPct,p1_score_pct:r.firstPlayerScorePct,
    average_turns:r.averageTurns,min_turns:r.minTurns,max_turns:r.maxTurns,final_four_pct:r.finalFourPct,max_turn_draws:r.maxTurnDraws,
    both_p1:r.resultCategories.normalBoth[0],both_p2:r.resultCategories.normalBoth[1],one_p1:r.resultCategories.normalOne[0],one_p2:r.resultCategories.normalOne[1],final_p1:r.resultCategories.finalFour[0],final_p2:r.resultCategories.finalFour[1],
    placements:r.placements,moves:r.moves,jumps:r.jumps,redeployments:r.redeployPlacements,horizontal:count(r.formations,"horizontal"),vertical:count(r.formations,"vertical"),diagonal_wins:count(r.formations,"diagonal"),square:count(r.formations,"square"),spaced_square:count(r.formations,"spaced-square"),
    games_with_chain_2plus:r.gamesWithRedeployOnlyChain2Plus,longest_redeploy_jump_chain:r.maxConsecutiveRedeployOnlyJumps,elapsed_seconds:ms/1000
  };
}
function writeCsv(file,rows){const headers=Object.keys(rows[0]);const lines=[headers.join(","),...rows.map(row=>headers.map(h=>csvEscape(typeof row[h]==="number"&&!Number.isInteger(row[h])?row[h].toFixed(6):row[h])).join(","))];fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,lines.join("\n")+"\n","utf8");}
function safeToken(s){return String(s).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,80);}
function defaultCsv(o,configs){const token=configs.length===1?safeToken(configs[0].alias||configs[0].key):`multi-${configs.length}`;return path.join("C:\\bxd\\Lipfty-Simulation-Results",`lipfty7-run-${token}-${o.strength}-${o.games}-seed${o.seed}.csv`);}

function listConfigs(){
  console.log("Available saved configurations:");
  for(const c of presetEntries())console.log(`  ${c.alias.padEnd(18)} ${c.label}`);
  console.log("\nCurrent recommended Standard: e1-on-player");
}
function help(){
  console.log("Lipfty 7 configurable simulation runner");
  console.log("\nSaved configuration mode:");
  console.log("  node .\\tools\\run-lipfty7-configurable.js --config e1-on-player --games 10000 --seed 5001");
  console.log("  Repeat --config to run several saved configurations in one command.");
  console.log("  Use --list to show all saved configuration names.");
  console.log("\nDirect rule mode / overrides:");
  console.log("  --squares both|tight|none|spaced   (also e1|e2|e3|e4)");
  console.log("  --move on|off   --jump on|off   --diagonal on|off");
  console.log("  --final-four player|opponent|random");
  console.log("  --one-colour current|placement-only");
  console.log("  --jump-colour opposite|any");
  console.log("  --jump-consequence current|redeploy|redeploy-only|redeploy-pass");
  console.log("  --response committed|sequential");
  console.log("  --boundary current|responder-choice");
  console.log("\nRun controls: --games N --seed N --strength tactical|random --progress-every N --csv FILE --no-csv");
  console.log("\nWith no --config or rule overrides, the runner uses current recommended Standard: e1-on-player.");
}
function main(argv=process.argv.slice(2)){
  const o=parseArgs(argv);if(o.help){help();return[];}if(o.list){listConfigs();return[];}
  const configs=resolveConfigurations(o),csvPath=o.csv===false?null:(o.csv||defaultCsv(o,configs));
  console.log("Lipfty 7 — configurable simulation runner");
  console.log(`${o.games} games per configuration; ${configs.length} configuration${configs.length===1?"":"s"}; strength ${o.strength}; starting seed ${o.seed}.`);
  configs.forEach((c,i)=>console.log(`  ${i+1}. ${c.alias||c.key} — ${c.label}`));
  const results=configs.map(c=>runOne(c,o));
  if(results.length>1){
    console.log("\nRANKING BY DISTANCE FROM 50% P1 SCORE");
    [...results].sort((a,b)=>Math.abs(a.r.firstPlayerScorePct-50)-Math.abs(b.r.firstPlayerScorePct-50)).forEach((x,i)=>console.log(`  ${i+1}. ${x.config.alias||x.config.key}: P1 score ${x.r.firstPlayerScorePct.toFixed(2)}%, draw ${x.r.drawPct.toFixed(2)}%, distance ${Math.abs(x.r.firstPlayerScorePct-50).toFixed(2)} pp`));
  }
  if(csvPath){writeCsv(csvPath,results.map(flat));console.log(`\nDetailed CSV: ${csvPath}`);}
  return results;
}

if(require.main===module){try{main();}catch(err){console.error(`Error: ${err.stack||err.message}`);process.exitCode=1;}}
module.exports={parseArgs,presetEntries,presetMap,resolveConfigurations,defaultConfig,applyOverrides,main};
