"use strict";

const {
  allRuleConfigurations, freshState, chooseColour, chooseAction, applyAction
} = require("./lipfty6-simulator.js");
const { ruleLabel } = require("./run-lipfty6-simulations.js");

function parsePositiveInt(v, name) {
  const n=Number(v); if(!Number.isInteger(n)||n<=0) throw new Error(`${name} must be a positive integer.`); return n;
}
function parseArgs(argv) {
  const o={config:10,seed:1,strength:"tactical"};
  for(let i=0;i<argv.length;i++) {
    const a=argv[i];
    if(a==="--config") o.config=parsePositiveInt(argv[++i],"--config");
    else if(a==="--seed") o.seed=parsePositiveInt(argv[++i],"--seed");
    else if(a==="--strength") o.strength=argv[++i];
    else if(a==="--help"||a==="-h") o.help=true;
    else throw new Error(`Unknown option: ${a}`);
  }
  if(!["random","tactical"].includes(o.strength)) throw new Error("--strength must be random or tactical.");
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
function traceGame({config=10,seed=1,strength="tactical"}={}){
  const configs=allRuleConfigurations(); if(config<1||config>configs.length) throw new Error(`--config must be between 1 and ${configs.length}.`);
  const rules=configs[config-1], s=freshState(seed);
  const lines=[`Lipfty 6 traced game`, `Configuration #${config}: ${ruleLabel(rules)}`, `Strength: ${strength}; seed: ${seed}`, "", boardText(s.board)];
  while(!s.winner && s.turns<500){
    const p=s.currentPlayer+1, ph=phase(s), colour=chooseColour(s,rules,strength), action=chooseAction(s,colour,rules,strength);
    lines.push("",`Turn ${s.turns+1} - P${p} - ${ph}`,`Handed/available colour: ${colour}`);
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
  const o=parseArgs(argv); if(o.help){console.log("Usage: node .\\tools\\trace-lipfty6-game.js --config N [--seed N] [--strength tactical|random]");return;}
  console.log(traceGame(o));
}
if(require.main===module){try{main();}catch(e){console.error(`Error: ${e.message}`);process.exitCode=1;}}
module.exports={parseArgs,coord,actionText,boardText,traceGame};
