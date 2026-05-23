// =====================================================================
// run_sim_reward_smoke_test.mjs (v0.4.0-c2-z-lite.1)
// ---------------------------------------------------------------------
// 시뮬레이션의 보상 자동 선택 동작 검증.
// node로 run_balance_sim.mjs을 spawn해서 rewardSide별 동작 검증.
// =====================================================================

import { spawnSync } from "node:child_process";

const SIM_PATH = new URL("./run_balance_sim.mjs", import.meta.url).pathname;

function runSim(args) {
  const res = spawnSync("node", [SIM_PATH, ...args], { encoding: "utf8" });
  if (res.status !== 0) {
    console.error(`sim 실행 실패: node ${SIM_PATH} ${args.join(" ")}`);
    console.error(res.stderr);
    process.exit(1);
  }
  return res.stdout;
}

console.log("[c2-z-lite.1 sim reward smoke]");

// 1. rewardSide=none → [Rewards] 섹션이 없어야 (또는 비어야)
const noneOut = runSim(["--runs=5", "--seed=42", "--rewardSide=none"]);
if (noneOut.includes("[Rewards]")) {
  console.error(`FAIL: rewardSide=none인데 [Rewards] 섹션 출력됨`);
  process.exit(1);
}
console.log(`  ✓ rewardSide=none: [Rewards] 섹션 없음 (rewardLog 0)`);

// 2. rewardSide=taiwan → 보상 선택 + persistent 등록
const tw = runSim(["--runs=5", "--seed=42", "--rewardSide=taiwan"]);
if (!tw.includes("[Rewards] rewardSide=taiwan")) {
  console.error(`FAIL: [Rewards] 섹션 누락`); process.exit(1);
}
const selectedMatch = tw.match(/selected total=(\d+)/);
if (!selectedMatch || Number(selectedMatch[1]) === 0) {
  console.error(`FAIL: selected total 0 또는 누락`); process.exit(1);
}
console.log(`  ✓ rewardSide=taiwan: selected total=${selectedMatch[1]} (5 runs × DAY 1~6)`);

const persistMatch = tw.match(/persistent owned avg:\s+taiwan ([\d.]+)/);
if (!persistMatch || Number(persistMatch[1]) === 0) {
  console.error(`FAIL: persistent owned avg taiwan 0 또는 누락`); process.exit(1);
}
console.log(`  ✓ persistent owned avg taiwan = ${persistMatch[1]} (보상 등록 정상)`);

// 3. deterministic: 같은 옵션 두 번 → 출력 동일
const a = runSim(["--runs=3", "--seed=999", "--rewardSide=taiwan"]);
const b = runSim(["--runs=3", "--seed=999", "--rewardSide=taiwan"]);
if (a !== b) {
  console.error(`FAIL: 같은 옵션 두 번 결과 다름 (non-deterministic)`);
  process.exit(1);
}
console.log(`  ✓ deterministic (같은 seed/옵션 두 번 동일 출력)`);

// 4. rewardSide=none이 baseline과 정확히 동일한지 (회귀)
//   baseline (rewardSide 옵션 없이) === rewardSide=none
const baseline = runSim(["--runs=10", "--seed=42"]);
const explicitNone = runSim(["--runs=10", "--seed=42", "--rewardSide=none"]);
// 출력 일부 (Outcome 라인들)이 동일해야
const baselineOutcome = baseline.match(/\[Outcome\]([\s\S]*?)\[Final/)?.[1];
const noneOutcome = explicitNone.match(/\[Outcome\]([\s\S]*?)\[Final/)?.[1];
if (baselineOutcome !== noneOutcome) {
  console.error(`FAIL: 기본값(rewardSide=none)이 baseline과 다름`);
  console.error(`baseline: ${baselineOutcome}`);
  console.error(`explicit none: ${noneOutcome}`);
  process.exit(1);
}
console.log(`  ✓ 기본값 ≡ rewardSide=none ≡ baseline (회귀 안전)`);

console.log("\n✓ run_sim_reward_smoke_test passed");
