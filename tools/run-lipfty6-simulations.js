"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { allRuleConfigurations, runBatch } = require("./lipfty6-simulator.js");

function parsePositiveInt(value, name) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer.`);
  return n;
}

function parseArgs(argv) {
  const options = { games: 100, seed: 1, strength: "tactical", csv: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--games") options.games = parsePositiveInt(argv[++i], "--games");
    else if (arg === "--seed") options.seed = parsePositiveInt(argv[++i], "--seed");
    else if (arg === "--strength") options.strength = argv[++i];
    else if (arg === "--csv") options.csv = argv[++i];
    else if (arg === "--no-csv") options.csv = false;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!["random", "tactical"].includes(options.strength)) throw new Error("--strength must be random or tactical.");
  if (options.csv === undefined) throw new Error("--csv requires a file name.");
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

function formatDuration(ms) {
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  if (minutes < 60) return `${minutes}m${remainder.toFixed(1).padStart(4, "0")}s`;
  const hours = Math.floor(minutes / 60), mins = minutes % 60;
  return `${hours}h${String(mins).padStart(2,"0")}m${remainder.toFixed(1).padStart(4,"0")}s`;
}

function csvEscape(value) {
  const s = String(value ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function defaultCsvPath(options) {
  return path.join("tools", `lipfty6-results-${options.strength}-${options.games}-seed${options.seed}.csv`);
}

function formationCount(result, name) { return result.formations[name] || 0; }

const CSV_HEADERS = [
  "configuration","rules","games","strength","seed",
  "p1_wins","p2_wins","draws","p1_win_pct","p2_win_pct","draw_pct","p1_score_pct",
  "average_turns","shortest_game","longest_game","final_four_pct",
  "horizontal_wins","vertical_wins","diagonal_wins","square_wins","spaced_square_wins","diamond_wins","spaced_diamond_wins","other_wins",
  "placements","moves","jumps","forced_placements","line_seconds","total_seconds"
];

function csvRow(index, rules, result, options, lineMs, totalMs) {
  return [
    index + 1, ruleLabel(rules), result.games, options.strength, options.seed,
    result.wins[0], result.wins[1], result.draws,
    result.firstPlayerWinPct.toFixed(3), result.secondPlayerWinPct.toFixed(3), result.drawPct.toFixed(3), result.firstPlayerScorePct.toFixed(3),
    result.averageTurns.toFixed(3), result.minTurns, result.maxTurns, result.finalFourPct.toFixed(3),
    formationCount(result,"horizontal"), formationCount(result,"vertical"), formationCount(result,"diagonal"),
    formationCount(result,"square"), formationCount(result,"spaced-square"), formationCount(result,"diamond"), formationCount(result,"spaced-diamond"), formationCount(result,"other"),
    result.placements, result.moves, result.jumps, result.forcedPlacements,
    (lineMs/1000).toFixed(3), (totalMs/1000).toFixed(3)
  ].map(csvEscape).join(",");
}

function printHelp() {
  console.log("Usage: node .\\tools\\run-lipfty6-simulations.js [--games N] [--seed N] [--strength tactical|random] [--csv FILE|--no-csv]");
  console.log("By default a detailed CSV is written under tools\\ with a name based on strength, games and seed.");
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) { printHelp(); return; }
  const configs = allRuleConfigurations();
  const csvPath = options.csv === false ? null : (options.csv || defaultCsvPath(options));
  const csvLines = [CSV_HEADERS.join(",")];
  console.log(`Lipfty 6 simulation: ${configs.length} configurations x ${options.games} games = ${configs.length * options.games} games`);
  console.log(`Player strength: ${options.strength}; base seed: ${options.seed}`);
  if (csvPath) console.log(`Detailed CSV: ${csvPath}`);
  console.log("");
  console.log(" #  P1 win%  P2 win%  Draw%  P1 score%  Avg turns  Min  Max  Final4%  Line time  Total time  Rules");
  console.log("--  -------  -------  -----  ---------  ---------  ---  ---  -------  ---------  ----------  -----");
  const runStart = process.hrtime.bigint();
  configs.forEach((rules, index) => {
    const lineStart = process.hrtime.bigint();
    const result = runBatch({ rules, games: options.games, seed: options.seed, strength: options.strength });
    const n = String(index + 1).padStart(2);
    const p1 = result.firstPlayerWinPct.toFixed(1).padStart(7);
    const p2 = result.secondPlayerWinPct.toFixed(1).padStart(7);
    const dr = result.drawPct.toFixed(1).padStart(5);
    const score = result.firstPlayerScorePct.toFixed(1).padStart(9);
    const av = result.averageTurns.toFixed(1).padStart(9);
    const min = String(result.minTurns).padStart(3), max = String(result.maxTurns).padStart(3);
    const f4 = result.finalFourPct.toFixed(1).padStart(7);
    const now = process.hrtime.bigint();
    const lineMs = Number(now - lineStart) / 1e6, totalMs = Number(now - runStart) / 1e6;
    const lineTime = formatDuration(lineMs).padStart(9), totalTime = formatDuration(totalMs).padStart(10);
    console.log(`${n}  ${p1}  ${p2}  ${dr}  ${score}  ${av}  ${min}  ${max}  ${f4}  ${lineTime}  ${totalTime}  ${ruleLabel(rules)}`);
    if (csvPath) csvLines.push(csvRow(index,rules,result,options,lineMs,totalMs));
  });
  const elapsedMs = Number(process.hrtime.bigint() - runStart) / 1e6;
  if (csvPath) {
    fs.mkdirSync(path.dirname(csvPath), { recursive: true });
    fs.writeFileSync(csvPath, csvLines.join("\n") + "\n", "utf8");
  }
  console.log("");
  console.log(`Completed: ${configs.length * options.games} games`);
  console.log(`Total simulation time: ${formatDuration(elapsedMs)}`);
  console.log(`Average: ${(elapsedMs / (configs.length * options.games) / 1000).toFixed(3)} seconds/game`);
  if (csvPath) console.log(`Detailed CSV written: ${csvPath}`);
}

if (require.main === module) {
  try { main(); }
  catch (err) { console.error(`Error: ${err.message}`); process.exitCode = 1; }
}

module.exports = { parseArgs, ruleLabel, formatDuration, csvEscape, defaultCsvPath, csvRow, main };
