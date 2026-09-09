"use strict";

const { allRuleConfigurations, runBatch } = require("./lipfty6-simulator.js");

function parsePositiveInt(value, name) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer.`);
  return n;
}

function parseArgs(argv) {
  const options = { games: 100, seed: 1, strength: "tactical" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--games") options.games = parsePositiveInt(argv[++i], "--games");
    else if (arg === "--seed") options.seed = parsePositiveInt(argv[++i], "--seed");
    else if (arg === "--strength") options.strength = argv[++i];
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!["random", "tactical"].includes(options.strength)) throw new Error("--strength must be random or tactical.");
  return options;
}

function ruleLabel(r) {
  const enabled = [];
  if (r.allowJump) enabled.push("Jump");
  if (r.allowMove) enabled.push("Move");
  if (r.allowDiagonal) enabled.push("Diagonal");
  if (r.allowSquare) enabled.push(r.allowSpacedSquare ? "Square+Spaced" : "Square");
  if (r.allowDiamond) enabled.push(r.allowSpacedDiamond ? "Diamond+Spaced" : "Diamond");
  return enabled.length ? enabled.join(", ") : "Basic (all optional rules off)";
}

function printHelp() {
  console.log("Usage: node .\\tools\\run-lipfty6-simulations.js [--games N] [--seed N] [--strength tactical|random]");
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) { printHelp(); return; }
  const configs = allRuleConfigurations();
  console.log(`Lipfty 6 simulation: ${configs.length} configurations x ${options.games} games = ${configs.length * options.games} games`);
  console.log(`Player strength: ${options.strength}; base seed: ${options.seed}`);
  console.log("");
  console.log(" #  P1 win%  P2 win%  Draw%  Avg turns  Final4%  Rules");
  console.log("--  -------  -------  -----  ---------  -------  -----");
  configs.forEach((rules, index) => {
    const result = runBatch({ rules, games: options.games, seed: options.seed, strength: options.strength });
    const n = String(index + 1).padStart(2);
    const p1 = result.firstPlayerWinPct.toFixed(1).padStart(7);
    const p2 = result.secondPlayerWinPct.toFixed(1).padStart(7);
    const dr = result.drawPct.toFixed(1).padStart(5);
    const av = result.averageTurns.toFixed(1).padStart(9);
    const f4 = result.finalFourPct.toFixed(1).padStart(7);
    console.log(`${n}  ${p1}  ${p2}  ${dr}  ${av}  ${f4}  ${ruleLabel(rules)}`);
  });
}

if (require.main === module) {
  try { main(); }
  catch (err) { console.error(`Error: ${err.message}`); process.exitCode = 1; }
}

module.exports = { parseArgs, ruleLabel, main };
