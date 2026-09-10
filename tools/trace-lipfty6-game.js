"use strict";

const {
  allRuleConfigurations, freshState, availableColours, chooseColour, chooseAction, applyAction,
  playGame, immediateWinningActions, handoverColourDanger
} = require("./lipfty6-simulator.js");
const { ruleLabel } = require("./run-lipfty6-simulations.js");

function parsePositiveInt(v, name) {
  const n=Number(v); if(!Number.isInteger(n)||n<=0) throw new Error(`${name} must be a positive integer.`); return n;
}
function parseArgs(argv) {
  const o={config:10,seed:1,strength:"tactical",find:null,maxTurns:null,searchLimit:10000};
  for(let i=0;i<argv.length;i++) {
    const a=argv[i];
    if(a==="--config") o.config=parsePositiveInt(argv[++i],"--config");
    else if(a==="--seed") o.seed=parsePositiveInt(argv[++i],"--seed");
    else if(a==="--strength") o.strength=argv[++i];
    else if(a==="--find") o.find=argv[++i];
    else if(a==="--max-turns") o.maxTurns=parsePositiveInt(argv[++i],"--max-turns");
    else if(a==="--search-limit") o.searchLimit=parsePositiveInt(argv[++i],"--search-limit");
    else if(a==="--help"||a==="-h") o.help=true;
    else throw new Error(`Unknown option: ${a}`);
  }
  if(!["random","tactical"].includes(o.strength)) throw new Error("--strength must be random or tactical.");
  if(o.find && !["P1","P2","draw"].includes(o.find)) throw new Error("--find must be P1, P2 or draw.");
  return o;
}
function coord(i){return `${String.fromCharCode(65+(i%6))}${Math.floor(i/6)+1}`;}
function actionText(a){
  if(a.type.includes("place")) return `${a.type} ${a.colour} at ${coord(a.to)}`;
  return `${a.type} ${a.colour} ${coord(a.from)} -> ${coord(a.to)}${a.over!==undefined?` over ${coord(a.over)}`:""}`;
}
function phase(s){if(s.openingRemaining>0)return "Opening Four";if(s.finalFour)return "Final Four";if(s.forcedPlacements>0)return `Forced placement (${s.forcedPlacements} due)`;return "Normal";}
function boardText(board){
  const lines=["    A B C D E F"];
  for(let r=0;r<6;r++) lines.push(`${r+1}   `+board.slice(r*6,r*6+6).map(p=>p?(p.colour==="black"?"B":"W"):".").join(" "));
  return lines.join("\n");
}
function fmtDanger(v){return Number.isFinite(v)?v.toFixed(2):String(v);}
function colourChoiceDiagnostics(s,rules,strength){
  const colours=availableColours(s);
  const tactical=strength==="tactical" && s.openingRemaining===0 && !s.finalFour && colours.length>1;
  return {tactical,evaluations:colours.map(colour=>{
    const immediateWins=immediateWinningActions(s,colour,rules).length;
    return {colour,immediateWins,danger:tactical?handoverColourDanger(s,colour,rules):null,safe:immediateWins===0};
  })};
}
function handoverExplanation(s,rules,strength,selected){
  const d=colourChoiceDiagnostics(s,rules,strength);
  if(d.evaluations.length<=1) return [`Only available colour: ${selected}`];
  if(!d.tactical) {
    const why=s.openingRemaining>0?"Opening Four colour choice is not a tactical hand-over":s.finalFour?"Final Four colour is determined from the remaining final pieces":"Non-tactical/random colour choice";
    return [why+`. Selected: ${selected}`];
  }
  const lines=["Hand-over evaluation:"];
  for(const e of d.evaluations) lines.push(`  ${e.colour}: immediate wins=${e.immediateWins}; receiver best score=${fmtDanger(e.danger)}; ${e.safe?"safe":"IMMEDIATE WIN AVAILABLE"}`);
  const selectedEval=d.evaluations.find(e=>e.colour===selected);
  const alternatives=d.evaluations.filter(e=>e.colour!==selected);
  let reason;
  if(selectedEval && selectedEval.safe && alternatives.some(e=>!e.safe)) reason=`${selected} avoids an immediate win available with the alternative colour`;
  else if(selectedEval && alternatives.every(e=>e.safe) && alternatives.some(e=>selectedEval.danger < e.danger-1e-9)) reason=`${selected} gives the receiver the lower tactical evaluation`;
  else if(selectedEval && alternatives.every(e=>!e.safe)) reason=`both colours allow an immediate win; ${selected} is the least dangerous available choice`;
  else reason=`evaluations are tied or effectively tied; seeded tie-break selected ${selected}`;
  lines.push(`Decision: ${reason}.`);
  return lines;
}
function winnerLabel(g){return g.winner==="draw"?"draw":`P${g.winner+1}`;}
function findSeed({config,seed,strength,find,maxTurns,searchLimit}){
  const configs=allRuleConfigurations(); if(config<1||config>configs.length) throw new Error(`--config must be between 1 and ${configs.length}.`);
  const rules=configs[config-1];
  for(let candidate=seed;candidate<seed+searchLimit;candidate++) {
    const g=playGame({rules,seed:candidate,strength});
    if(winnerLabel(g)!==find) continue;
    if(maxTurns!==null && g.turns>maxTurns) continue;
    return {seed:candidate,game:g};
  }
  return null;
}
function traceGame({config=10,seed=1,strength="tactical"}={}){
  const configs=allRuleConfigurations(); if(config<1||config>configs.length) throw new Error(`--config must be between 1 and ${configs.length}.`);
  const rules=configs[config-1], s=freshState(seed);
  const lines=[`Lipfty 6 traced game`, `Configuration #${config}: ${ruleLabel(rules)}`, `Strength: ${strength}; seed: ${seed}`, "", boardText(s.board)];
  while(!s.winner && s.turns<500){
    const p=s.currentPlayer+1, ph=phase(s);
    const colour=chooseColour(s,rules,strength);
    const explanations=handoverExplanation(s,rules,strength,colour);
    const action=chooseAction(s,colour,rules,strength);
    lines.push("",`Turn ${s.turns+1} - P${p} - ${ph}`,`Handed/available colour: ${colour}`,...explanations);
    if(!action){s.winner="draw";lines.push("No legal action: draw");break;}
    lines.push(`Action: ${actionText(action)}`);
    const result=applyAction(s,action,rules); lines.push(boardText(s.board));
    if(result.ended){
      if(s.winner==="draw") lines.push("Result: draw");
      else lines.push(`Result: P${s.winner+1} wins on turn ${s.turns}${result.winType?` by ${result.winType}`:""}.`, result.win&&result.win.line?`Winning cells: ${result.win.line.map(coord).join(", ")}`:"");
      break;
    }
  }
  return lines.filter(x=>x!=="").join("\n");
}
function main(argv=process.argv.slice(2)){
  const o=parseArgs(argv);
  if(o.help){
    console.log("Usage: node .\\tools\\trace-lipfty6-game.js --config N [--seed N] [--strength tactical|random]");
    console.log("       node .\\tools\\trace-lipfty6-game.js --config N --find P1|P2|draw [--max-turns N] [--seed N] [--search-limit N]");
    return;
  }
  if(o.find){
    const found=findSeed(o);
    if(!found) throw new Error(`No ${o.find}${o.maxTurns?` result within ${o.maxTurns} turns`:""} found in ${o.searchLimit} seeds starting at ${o.seed}.`);
    console.log(`Found ${o.find} result at seed ${found.seed} in ${found.game.turns} turns.`);
    console.log("");
    o.seed=found.seed;
  }
  console.log(traceGame(o));
}
if(require.main===module){try{main();}catch(e){console.error(`Error: ${e.message}`);process.exitCode=1;}}
module.exports={parseArgs,coord,actionText,boardText,colourChoiceDiagnostics,handoverExplanation,findSeed,traceGame};
