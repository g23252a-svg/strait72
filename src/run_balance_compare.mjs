// =====================================================================
// run_balance_compare.mjs  (v0.4.0-c2-measure-1 introduced)
// ---------------------------------------------------------------------
// 보상 영향을 측정하기 위한 비교 래퍼.
// run_balance_sim.mjs을 여러 (rewardSide × seed)로 spawn하고
// 결과를 표로 출력 + 경계선 자동 판정.
//
// 사용:
//   node src/run_balance_compare.mjs --runs=200 --seeds=42,100,2026 \
//     --rewardSides=none,china,both
//   node src/run_balance_compare.mjs --runs=50 --seeds=42 \
//     --rewardSides=none,taiwan,china,both --jsonOut=/tmp/cmp.json
//
// 출력:
//   [Compare] (rewardSide, seed, runs) 별 chinaWin/taiwanWin/avgFinalTurn
//   [Avg]     같은 rewardSide 시드 평균
//   [Delta vs none]  영향 측정
//   [Warnings] baseline 드리프트 / china >70% / both 중국 >50% / chinaWin > taiwanWin
// =====================================================================

import { spawnSync } from "node:child_process";
import fs from "node:fs";

const SIM = new URL("./run_balance_sim.mjs", import.meta.url).pathname;

function parseArgs(argv) {
  const out = {};
  for (const raw of argv) {
    if (!raw.startsWith("--")) continue;
    const body = raw.slice(2);
    if (body.includes("=")) {
      const [k, v] = body.split("=", 2);
      out[k] = v;
    } else {
      out[body] = true;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const RUNS = Number(args.runs || 200);
const SEEDS = String(args.seeds || "42,100,2026").split(",").map(s => Number(s.trim()));
const SIDES = String(args.rewardSides || "none,taiwan,china,both").split(",").map(s => s.trim());
const JSON_OUT = args.jsonOut || null;

// 경계선 (사용자 명세 + c2-measure-1 실측):
//   - china rewardSide에서 중국 승률 합 70% 초과: warn
//   - both rewardSide에서 중국 승률 합 50% 초과: warn
//   - none rewardSide에서 baseline 이탈: warn
//
// 주의: 이전엔 "36/58"을 baseline으로 사용했으나 이건 50 runs seed=42 한 시드만의 값이었음.
// c2-measure-1에서 200 runs × 3 seeds (42, 100, 2026)으로 큰 표본 실측 → 실제 평균 43/55.
// 이 값을 새 baseline으로 고정. 향후 패치마다 측정 → ±3%p 이탈 시 경고.
const CHINA_WIN_CEILING = 70;
const BOTH_CHINA_CEILING = 50;
const NONE_BASELINE = { chinaWin: 43.2, taiwanWin: 55.0 };
const BASELINE_DRIFT_THRESHOLD = 3.0;

function runSim(rewardSide, seed) {
  const res = spawnSync("node", [
    SIM,
    `--runs=${RUNS}`,
    `--seed=${seed}`,
    `--rewardSide=${rewardSide}`,
    `--json`
  ], { encoding: "utf8" });
  if (res.status !== 0) {
    console.error(`Sim failed: rewardSide=${rewardSide} seed=${seed}`);
    console.error(res.stderr);
    process.exit(1);
  }
  try {
    return JSON.parse(res.stdout);
  } catch (err) {
    console.error(`JSON parse failed for rewardSide=${rewardSide} seed=${seed}:`);
    console.error(res.stdout.slice(0, 200));
    process.exit(1);
  }
}

// 중국 승 합 = china_capital_pressure_win + china_capital_win
function chinaWinTotal(rates) {
  return (rates.china_capital_pressure_win || 0) + (rates.china_capital_win || 0);
}
function taiwanWinTotal(rates) {
  return (rates.taiwan_survival_win || 0);
}

console.log(`\n=== Balance Compare ===`);
console.log(`runs=${RUNS}  seeds=${SEEDS.join(",")}  rewardSides=${SIDES.join(",")}`);
console.log(`baseline expectation: china ${NONE_BASELINE.chinaWin}%, taiwan ${NONE_BASELINE.taiwanWin}% (drift ±${BASELINE_DRIFT_THRESHOLD}%p)`);

const results = []; // { rewardSide, seed, runs, chinaWin, taiwanWin, avgFinalTurn, rates }

for (const side of SIDES) {
  for (const seed of SEEDS) {
    const r = runSim(side, seed);
    const cWin = Number(chinaWinTotal(r.outcome.rates).toFixed(1));
    const tWin = Number(taiwanWinTotal(r.outcome.rates).toFixed(1));
    results.push({
      rewardSide: side, seed,
      runs: RUNS,
      chinaWin: cWin, taiwanWin: tWin,
      avgFinalTurn: r.outcome.avgFinalTurn,
      rates: r.outcome.rates,
      rewardsSummary: r.rewards
    });
  }
}

console.log(`\n[Per-cell results]`);
console.log(`  ${"side".padEnd(8)} ${"seed".padStart(6)} ${"chinaWin".padStart(10)} ${"taiwanWin".padStart(10)} ${"avgFT".padStart(7)}`);
for (const r of results) {
  console.log(`  ${r.rewardSide.padEnd(8)} ${String(r.seed).padStart(6)} ${String(r.chinaWin + "%").padStart(10)} ${String(r.taiwanWin + "%").padStart(10)} ${String(r.avgFinalTurn).padStart(7)}`);
}

// 사이드별 평균
console.log(`\n[Average across seeds]`);
console.log(`  ${"side".padEnd(8)} ${"chinaWin".padStart(10)} ${"taiwanWin".padStart(10)} ${"avgFT".padStart(7)}`);
const avgBySide = {};
for (const side of SIDES) {
  const subset = results.filter(r => r.rewardSide === side);
  const avgChina = subset.reduce((s, r) => s + r.chinaWin, 0) / subset.length;
  const avgTaiwan = subset.reduce((s, r) => s + r.taiwanWin, 0) / subset.length;
  const avgFT = subset.reduce((s, r) => s + r.avgFinalTurn, 0) / subset.length;
  avgBySide[side] = { chinaWin: Number(avgChina.toFixed(1)), taiwanWin: Number(avgTaiwan.toFixed(1)), avgFinalTurn: Number(avgFT.toFixed(2)) };
  console.log(`  ${side.padEnd(8)} ${String(avgBySide[side].chinaWin + "%").padStart(10)} ${String(avgBySide[side].taiwanWin + "%").padStart(10)} ${String(avgBySide[side].avgFinalTurn).padStart(7)}`);
}

// none baseline 대비 delta
if (avgBySide.none) {
  console.log(`\n[Delta vs none baseline (avg)]`);
  for (const side of SIDES) {
    if (side === "none") continue;
    const dChina = (avgBySide[side].chinaWin - avgBySide.none.chinaWin).toFixed(1);
    const dTaiwan = (avgBySide[side].taiwanWin - avgBySide.none.taiwanWin).toFixed(1);
    const dChinaSign = dChina > 0 ? "+" : "";
    const dTaiwanSign = dTaiwan > 0 ? "+" : "";
    console.log(`  ${side.padEnd(8)}  chinaWin ${dChinaSign}${dChina}%p   taiwanWin ${dTaiwanSign}${dTaiwan}%p`);
  }
}

// 경계 판정
const warnings = [];
if (avgBySide.none) {
  const driftChina = Math.abs(avgBySide.none.chinaWin - NONE_BASELINE.chinaWin);
  const driftTaiwan = Math.abs(avgBySide.none.taiwanWin - NONE_BASELINE.taiwanWin);
  if (driftChina > BASELINE_DRIFT_THRESHOLD || driftTaiwan > BASELINE_DRIFT_THRESHOLD) {
    warnings.push(`baseline drift: none chinaWin=${avgBySide.none.chinaWin}% (expect ${NONE_BASELINE.chinaWin}%), taiwanWin=${avgBySide.none.taiwanWin}% (expect ${NONE_BASELINE.taiwanWin}%) — drift > ±${BASELINE_DRIFT_THRESHOLD}%p`);
  }
}
if (avgBySide.china && avgBySide.china.chinaWin > CHINA_WIN_CEILING) {
  warnings.push(`china rewardSide → chinaWin ${avgBySide.china.chinaWin}% > ${CHINA_WIN_CEILING}% (사용자 경계)`);
}
if (avgBySide.both && avgBySide.both.chinaWin > BOTH_CHINA_CEILING) {
  warnings.push(`both rewardSide → chinaWin ${avgBySide.both.chinaWin}% > ${BOTH_CHINA_CEILING}% (사용자 경계)`);
}

if (warnings.length) {
  console.log(`\n[Warnings]`);
  for (const w of warnings) console.log(`  ⚠ ${w}`);
} else {
  console.log(`\n[Warnings] none — 모든 경계선 통과`);
}

// 시드별 변동성 ±x%p
console.log(`\n[Seed-to-seed variance]`);
console.log(`  ${"side".padEnd(8)} ${"chinaWin range".padStart(18)} ${"max delta %p".padStart(14)}`);
for (const side of SIDES) {
  const subset = results.filter(r => r.rewardSide === side);
  const cWins = subset.map(r => r.chinaWin);
  const minC = Math.min(...cWins), maxC = Math.max(...cWins);
  const range = `${minC}-${maxC}%`;
  const maxDelta = (maxC - minC).toFixed(1);
  console.log(`  ${side.padEnd(8)} ${range.padStart(18)} ${maxDelta.padStart(14)}`);
}

// JSON 저장
if (JSON_OUT) {
  const dump = {
    runs: RUNS, seeds: SEEDS, rewardSides: SIDES,
    perCell: results,
    avgBySide,
    warnings
  };
  fs.writeFileSync(JSON_OUT, JSON.stringify(dump, null, 2));
  console.log(`\n[Saved] ${JSON_OUT}`);
}

if (warnings.length) process.exit(2); // CI에서 warn → 비제로 종료 (선택)
console.log(`\n✓ balance compare complete`);
