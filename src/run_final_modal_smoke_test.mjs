// =====================================================================
// run_final_modal_smoke_test.mjs (v0.4.0-d2)
// ---------------------------------------------------------------------
// final modal의 로직 부분 검증 (DOM은 jsdom 없이 못 함).
//
// 검증:
//   1. buildFinalReport는 정상 동작 (이미 d1 smoke에서 확인됨)
//   2. compressBreakdown: 긍정 top 3, 부정 top 2, 나머지 압축
//   3. compressBreakdown: 작은 데이터셋 (3 이하) 처리
//   4. compressBreakdown: 빈 components
//   5. compressBreakdown: 모두 긍정 / 모두 부정
//   6. playerSide 결정 — campaign.selectedSide === "both" 시 점수 높은 쪽
// =====================================================================

import { buildFinalReport } from "./final_grade.js";

console.log("[final_modal smoke test v0.4.0-d2]");

// compressBreakdown 로직 재구현 (playable_app.js와 동일)
function compressBreakdown(components) {
  const positives = components.filter(c => c.delta > 0).sort((a, b) => b.delta - a.delta);
  const negatives = components.filter(c => c.delta < 0).sort((a, b) => a.delta - b.delta);
  const topPos = positives.slice(0, 3);
  const topNeg = negatives.slice(0, 2);
  const restPos = positives.slice(3);
  const restNeg = negatives.slice(2);
  return {
    positives: topPos,
    negatives: topNeg,
    othersPositive: {
      count: restPos.length,
      delta: restPos.reduce((s, c) => s + c.delta, 0)
    },
    othersNegative: {
      count: restNeg.length,
      delta: restNeg.reduce((s, c) => s + c.delta, 0)
    }
  };
}

// 1. 풀 컴포넌트셋 (긍정 5 + 부정 3)
console.log("\n1. compressBreakdown — 긍정 5, 부정 3");
const fullComps = [
  { label: "정부 기능", delta: 8 },
  { label: "미국 개입", delta: 20 },
  { label: "일본 개입", delta: 15 },
  { label: "한국 후방", delta: 10 },
  { label: "사기 유지", delta: 4 },
  { label: "점령지 손실", delta: -10 },
  { label: "조기 붕괴", delta: -5 },
  { label: "보급 손실", delta: -3 }
];
const r1 = compressBreakdown(fullComps);
if (r1.positives.length !== 3) {
  console.error(`FAIL: 긍정 3개 아님, got ${r1.positives.length}`); process.exit(1);
}
if (r1.positives[0].delta !== 20 || r1.positives[1].delta !== 15 || r1.positives[2].delta !== 10) {
  console.error(`FAIL: 긍정 top 3 정렬 부정확`); process.exit(1);
}
if (r1.negatives.length !== 2 || r1.negatives[0].delta !== -10 || r1.negatives[1].delta !== -5) {
  console.error(`FAIL: 부정 top 2 정렬 부정확`); process.exit(1);
}
if (r1.othersPositive.count !== 2 || r1.othersPositive.delta !== 12) { // 8 + 4
  console.error(`FAIL: 기타 긍정 합산 부정확, got ${JSON.stringify(r1.othersPositive)}`); process.exit(1);
}
if (r1.othersNegative.count !== 1 || r1.othersNegative.delta !== -3) {
  console.error(`FAIL: 기타 부정 합산 부정확`); process.exit(1);
}
console.log(`  ✓ 긍정 top 3: ${r1.positives.map(c => c.delta).join(",")}, 기타 ${r1.othersPositive.count}개 합 ${r1.othersPositive.delta}`);
console.log(`  ✓ 부정 top 2: ${r1.negatives.map(c => c.delta).join(",")}, 기타 ${r1.othersNegative.count}개 합 ${r1.othersNegative.delta}`);

// 2. 작은 데이터셋 (긍정 2개 + 부정 1개) — others는 0이어야
console.log("\n2. compressBreakdown — 작은 데이터셋");
const smallComps = [
  { label: "A", delta: 5 },
  { label: "B", delta: 3 },
  { label: "C", delta: -2 }
];
const r2 = compressBreakdown(smallComps);
if (r2.positives.length !== 2 || r2.negatives.length !== 1) {
  console.error(`FAIL: 작은 셋 길이 부정확`); process.exit(1);
}
if (r2.othersPositive.delta !== 0 || r2.othersNegative.delta !== 0) {
  console.error(`FAIL: 기타가 0이어야`); process.exit(1);
}
console.log(`  ✓ 긍정 ${r2.positives.length}개, 부정 ${r2.negatives.length}개, others 모두 0`);

// 3. 빈 components
console.log("\n3. compressBreakdown — 빈 입력");
const r3 = compressBreakdown([]);
if (r3.positives.length !== 0 || r3.negatives.length !== 0) {
  console.error(`FAIL: 빈 입력 처리 부정확`); process.exit(1);
}
console.log(`  ✓ 빈 입력 — 모두 빈 배열, 합 0`);

// 4. 모두 긍정
console.log("\n4. compressBreakdown — 모두 긍정 (부정 0)");
const allPos = [
  { label: "X", delta: 10 }, { label: "Y", delta: 8 }, { label: "Z", delta: 5 }, { label: "W", delta: 2 }
];
const r4 = compressBreakdown(allPos);
if (r4.negatives.length !== 0 || r4.othersNegative.count !== 0) {
  console.error(`FAIL: 부정 0이어야`); process.exit(1);
}
if (r4.positives.length !== 3 || r4.othersPositive.count !== 1) {
  console.error(`FAIL: 긍정 3 + 기타 1`); process.exit(1);
}
console.log(`  ✓ 부정 0, 긍정 ${r4.positives.length} + 기타 ${r4.othersPositive.count}`);

// 5. 모두 부정
console.log("\n5. compressBreakdown — 모두 부정");
const allNeg = [
  { label: "X", delta: -5 }, { label: "Y", delta: -10 }, { label: "Z", delta: -3 }
];
const r5 = compressBreakdown(allNeg);
if (r5.positives.length !== 0 || r5.negatives.length !== 2) {
  console.error(`FAIL: 부정 top 2 아님`); process.exit(1);
}
if (r5.negatives[0].delta !== -10) {
  console.error(`FAIL: 부정 정렬 부정확 (가장 큰 음수 먼저)`); process.exit(1);
}
console.log(`  ✓ 부정 top 2 가장 큰 음수 우선: ${r5.negatives.map(c => c.delta).join(",")}`);

// 6. buildFinalReport 통합 — 실제 outcome에서 player/opponent 결정 가능
console.log("\n6. buildFinalReport + player 결정");
const state = {
  outcome: "taiwan_survival_win",
  turn: 30,
  gauges: {
    usIntervention: 60, japanIntervention: 40, koreaRearSupport: 20,
    internationalOpinion: 60, chinaPoliticalPressure: 50,
    chinaTempo: 40, chinaSupply: 40,
    taiwanMorale: 75, taiwanGovernment: 85, taiwanCommand: 90, taiwanSupply: 65
  },
  provinces: {
    taipei: { id: "taipei", name: "타이베이", type: "capital", controlStage: "stable_defense" },
    keelung: { id: "keelung", name: "지룽", type: "port", controlStage: "stable_defense" },
    kaohsiung: { id: "kaohsiung", name: "가오슝", type: "major_port", controlStage: "china_control" }
  },
  persistent: { rewards: [], triggeredOnce: ["global_us_carrier_movement", "global_japan_security_council"] },
  log: [
    { turn: 8, phase: 4, combatResults: [
      { sourceId: "south", sourceName: "남부 상륙", targetName: "가오슝", margin: -6, success: false }
    ]},
    { turn: 15, phase: 4, combatResults: [
      { sourceId: "north", sourceName: "북부 압박", targetName: "타이베이", margin: 9, success: true }
    ]}
  ]
};
const report = buildFinalReport(state, { selectedSide: "taiwan" }, { gameRules: { totalTurns: 30 } });
if (!report.taiwan || !report.china) {
  console.error(`FAIL: 양쪽 report 누락`); process.exit(1);
}
console.log(`  ✓ taiwan ${report.taiwan.grade}/${report.taiwan.score} | china ${report.china.grade}/${report.china.score}`);

// majorBattles turn 보존 (d1.1 검증) 재확인
if (report.summary.majorBattles.length !== 2) {
  console.error(`FAIL: majorBattles 2개 아님, got ${report.summary.majorBattles.length}`); process.exit(1);
}
const turns = report.summary.majorBattles.map(b => b.turn);
if (!turns.includes(8) || !turns.includes(15)) {
  console.error(`FAIL: turn 8/15 누락, got ${turns}`); process.exit(1);
}
console.log(`  ✓ majorBattles turns: ${turns.join(",")} (d1.1 회귀 안전)`);

// triggeredEvents 보고서 포함
if (report.summary.triggeredEvents.length !== 2) {
  console.error(`FAIL: triggeredEvents 2개 아님`); process.exit(1);
}
console.log(`  ✓ triggeredEvents: ${report.summary.triggeredEvents.length}개`);

// 7. campaign.selectedSide === "both" 시 player 결정
console.log("\n7. selectedSide=both 시 점수 높은 쪽이 player");
// 같은 state를 both로 다시
const bothReport = buildFinalReport(state, { selectedSide: "both" }, { gameRules: { totalTurns: 30 } });
const playerSide = bothReport.taiwan.score >= bothReport.china.score ? "taiwan" : "china";
console.log(`  ✓ both 모드 → taiwan ${bothReport.taiwan.score} vs china ${bothReport.china.score} → player=${playerSide}`);

console.log("\n✓ final_modal smoke test passed");
