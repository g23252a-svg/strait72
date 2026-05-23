// =====================================================================
// run_final_grade_smoke_test.mjs (v0.4.0-d1)
// ---------------------------------------------------------------------
// 최종 등급/점수 엔진 검증.
//
// 사용자 명세 4가지:
//   1. 대만 생존 승리 → 적절한 등급 (B~A)
//   2. 중국 빠른 승리 → 고득점 (A~S)
//   3. 중국 정치압박 높은 승리 → 감점 (B~C)
//   4. 패배 시 낮은 등급 (D)
// 추가:
//   5. gradeFromScore 경계값 (39/40/59/60/74/75/89/90)
//   6. clamp 0~100
//   7. components 합산이 base + delta 합과 같음 (검산)
//   8. buildFinalReport 구조 완전성
// =====================================================================

import {
  calculateFinalScore,
  gradeFromScore,
  generateFinalInterpretation,
  buildFinalReport
} from "./final_grade.js";

console.log("[final_grade smoke test v0.4.0-d1]");

// 헬퍼: minimal state
function mkState({ outcome, turn = 30, gauges = {}, provinces = {} } = {}) {
  return {
    outcome,
    turn,
    gauges: {
      usIntervention: 50, japanIntervention: 30, koreaRearSupport: 15,
      internationalOpinion: 50, chinaPoliticalPressure: 30,
      chinaTempo: 60, chinaSupply: 60,
      taiwanMorale: 70, taiwanGovernment: 80, taiwanCommand: 90, taiwanSupply: 60,
      ...gauges
    },
    provinces: provinces || {},
    persistent: { rewards: [], triggeredOnce: [] },
    log: []
  };
}

// 1. 대만 생존 승리 (taiwan side) → B~A 등급 (60~89)
console.log("\n1. 대만 생존 승리");
const survivalState = mkState({
  outcome: "taiwan_survival_win",
  turn: 30,
  gauges: { taiwanGovernment: 80, taiwanMorale: 70, taiwanSupply: 65, taiwanCommand: 90,
            usIntervention: 60, japanIntervention: 40, koreaRearSupport: 20 }
});
const survResult = calculateFinalScore(survivalState, "taiwan");
const survGrade = gradeFromScore(survResult.score);
console.log(`  대만 점수: ${survResult.score}, 등급: ${survGrade}, base: ${survResult.base}`);
if (survResult.score < 60 || survResult.score > 100) {
  console.error(`FAIL: 대만 생존 승리 점수 60~100 범위 밖, got ${survResult.score}`); process.exit(1);
}
if (!["B", "A", "S"].includes(survGrade)) {
  console.error(`FAIL: 등급 B/A/S 아님, got ${survGrade}`); process.exit(1);
}
console.log(`  ✓ 대만 생존 승리 등급 적절 (${survGrade})`);

// 1-2. 같은 outcome 중국 입장 → 낮음 (실패)
const chinaInSurvival = calculateFinalScore(survivalState, "china");
const chinaSurvGrade = gradeFromScore(chinaInSurvival.score);
console.log(`  중국 점수 (대만 생존): ${chinaInSurvival.score}, 등급: ${chinaSurvGrade}`);
if (chinaInSurvival.score >= survResult.score) {
  console.error(`FAIL: 같은 outcome인데 중국 점수가 대만보다 높거나 같음`); process.exit(1);
}
console.log(`  ✓ 같은 outcome 다른 진영 — 중국이 더 낮음 (대만 ${survResult.score} > 중국 ${chinaInSurvival.score})`);

// 2. 중국 빠른 승리 (china_capital_win, turn 14) → A~S (75+)
console.log("\n2. 중국 빠른 승리 (타이베이 점령 14턴)");
const fastWinState = mkState({
  outcome: "china_capital_win",
  turn: 14,
  gauges: { taiwanGovernment: 20, taiwanMorale: 30, taiwanSupply: 40,
            chinaPoliticalPressure: 30, chinaTempo: 50, chinaSupply: 50,
            usIntervention: 35, japanIntervention: 20 },
  provinces: {
    taipei: { id: "taipei", name: "타이베이", controlStage: "china_control", landingStage: "stable" },
    keelung: { id: "keelung", name: "지룽", controlStage: "china_control", landingStage: "stable" },
    taoyuan: { id: "taoyuan", name: "타오위안", controlStage: "china_control", landingStage: "stable" }
  }
});
const fastResult = calculateFinalScore(fastWinState, "china");
const fastGrade = gradeFromScore(fastResult.score);
console.log(`  중국 점수: ${fastResult.score}, 등급: ${fastGrade}`);
if (fastResult.score < 75) {
  console.error(`FAIL: 빠른 승리 점수 75 미만, got ${fastResult.score}`); process.exit(1);
}
if (!["A", "S"].includes(fastGrade)) {
  console.error(`FAIL: 빠른 승리 등급 A/S 아님, got ${fastGrade}`); process.exit(1);
}
console.log(`  ✓ 빠른 승리 ${fastGrade} (75+)`);

// 3. 중국 정치압박 높은 승리 → 감점
console.log("\n3. 중국 승리지만 정치압박 높음");
const messyWinState = mkState({
  outcome: "china_capital_pressure_win",
  turn: 28,
  gauges: { taiwanGovernment: 40, taiwanMorale: 50, taiwanSupply: 35,
            chinaPoliticalPressure: 80,  // 매우 높음
            chinaTempo: 25, chinaSupply: 30,  // 자원 고갈
            usIntervention: 75, japanIntervention: 55 },
  provinces: {
    taipei: { id: "taipei", name: "타이베이", controlStage: "contested", landingStage: "beachhead" },
    kaohsiung: { id: "kaohsiung", name: "가오슝", controlStage: "china_control" }
  }
});
const messyResult = calculateFinalScore(messyWinState, "china");
const messyGrade = gradeFromScore(messyResult.score);
console.log(`  중국 점수: ${messyResult.score}, 등급: ${messyGrade}`);
// 정치압박 -20점, 자원 고갈 페널티 등으로 B~C 정도
if (messyResult.score >= fastResult.score) {
  console.error(`FAIL: 더 어려운 승리가 더 깔끔한 승리보다 점수 높음`); process.exit(1);
}
console.log(`  ✓ 정치압박/자원고갈 페널티 정상 (깔끔한 빠른 승리 ${fastResult.score} > 어려운 승리 ${messyResult.score})`);

// 4. 패배 시 낮은 등급 (D)
console.log("\n4. 패배");
const taiwanLossState = mkState({
  outcome: "china_capital_win",
  turn: 18,
  gauges: { taiwanGovernment: 10, taiwanMorale: 20, taiwanSupply: 15, taiwanCommand: 40,
            usIntervention: 30, japanIntervention: 15, koreaRearSupport: 5 },
  provinces: {
    taipei: { id: "taipei", name: "타이베이", controlStage: "china_control" },
    taoyuan: { id: "taoyuan", name: "타오위안", controlStage: "china_control" }
  }
});
const lossResult = calculateFinalScore(taiwanLossState, "taiwan");
const lossGrade = gradeFromScore(lossResult.score);
console.log(`  대만 점수 (패배): ${lossResult.score}, 등급: ${lossGrade}`);
if (lossResult.score >= 40) {
  console.error(`FAIL: 패배 점수 40 미만이어야, got ${lossResult.score}`); process.exit(1);
}
if (lossGrade !== "D") {
  console.error(`FAIL: 패배 등급 D 아님, got ${lossGrade}`); process.exit(1);
}
console.log(`  ✓ 패배 D (점수 ${lossResult.score})`);

// 5. gradeFromScore 경계값
console.log("\n5. gradeFromScore 경계값");
const cases = [
  [0, "D"], [39, "D"], [40, "C"], [59, "C"], [60, "B"], [74, "B"],
  [75, "A"], [89, "A"], [90, "S"], [100, "S"]
];
for (const [s, expected] of cases) {
  const got = gradeFromScore(s);
  if (got !== expected) {
    console.error(`FAIL: score ${s} → expected ${expected}, got ${got}`); process.exit(1);
  }
}
console.log(`  ✓ 경계값 10개 모두 정확 (D<40, C<60, B<75, A<90, S 90+)`);

// 6. clamp 0~100
console.log("\n6. clamp 검증");
const extremeHigh = mkState({
  outcome: "china_capital_win",
  turn: 8,  // 매우 빠름
  gauges: { taiwanGovernment: 0, taiwanMorale: 0, taiwanSupply: 0,
            chinaPoliticalPressure: 0, chinaTempo: 90, chinaSupply: 90,
            usIntervention: 0, japanIntervention: 0 },
  provinces: Object.fromEntries(["taipei","keelung","taoyuan","kaohsiung","tainan","taichung"]
    .map(id => [id, { id, name: id, controlStage: "china_control", landingStage: "stable" }]))
});
const extremeHResult = calculateFinalScore(extremeHigh, "china");
console.log(`  극한 시나리오 score=${extremeHResult.score} rawScore=${extremeHResult.rawScore}`);
if (extremeHResult.score > 100 || extremeHResult.score < 0) {
  console.error(`FAIL: clamp 작동 안 함`); process.exit(1);
}
console.log(`  ✓ clamp 0~100 정상`);

// 7. components 합산 검증 (base + sum(deltas) = rawScore)
console.log("\n7. components 합산 검증");
const compsCheck = calculateFinalScore(fastWinState, "china");
const deltaSum = compsCheck.components.reduce((s, c) => s + c.delta, 0);
const expectedRaw = compsCheck.base + deltaSum;
if (expectedRaw !== compsCheck.rawScore) {
  console.error(`FAIL: base ${compsCheck.base} + Σdelta ${deltaSum} = ${expectedRaw}, but rawScore ${compsCheck.rawScore}`);
  process.exit(1);
}
console.log(`  ✓ base ${compsCheck.base} + Σdelta ${deltaSum} = rawScore ${compsCheck.rawScore}`);

// 8. buildFinalReport 구조 완전성
console.log("\n8. buildFinalReport 구조");
const report = buildFinalReport(survivalState, { selectedSide: "taiwan" }, { gameRules: { totalTurns: 30 } });
const requiredKeys = ["outcome", "title", "finalTurn", "taiwan", "china", "summary", "campaignSide"];
for (const k of requiredKeys) {
  if (!(k in report)) {
    console.error(`FAIL: report.${k} 누락`); process.exit(1);
  }
}
const sideKeys = ["score", "base", "components", "grade", "interpretation"];
for (const sk of sideKeys) {
  if (!(sk in report.taiwan)) {
    console.error(`FAIL: report.taiwan.${sk} 누락`); process.exit(1);
  }
}
const summaryKeys = ["occupiedProvinces", "majorBattles", "triggeredEvents", "ownedRewards", "finalGauges"];
for (const sk of summaryKeys) {
  if (!(sk in report.summary)) {
    console.error(`FAIL: report.summary.${sk} 누락`); process.exit(1);
  }
}
console.log(`  ✓ 보고서 키 ${requiredKeys.length + sideKeys.length + summaryKeys.length}개 모두 존재`);
console.log(`    title: "${report.title}"`);
console.log(`    taiwan: ${report.taiwan.grade} (${report.taiwan.score}점)`);
console.log(`    china:  ${report.china.grade} (${report.china.score}점)`);
console.log(`    interp: ${report.taiwan.interpretation.slice(0, 50)}…`);

// 9. interpretation 매트릭스 — 모든 outcome × 진영에 최소 1개 등급 메시지
console.log("\n9. interpretation 매트릭스 커버리지");
const allOutcomes = [
  "taiwan_survival_win", "taiwan_political_collapse_win",
  "china_capital_win", "china_capital_pressure_win",
  "china_blockade_win", "china_surrender_win", "no_outcome"
];
let interpCount = 0;
for (const oc of allOutcomes) {
  for (const sd of ["taiwan", "china"]) {
    // 다양한 점수에서 메시지가 나오는지
    for (const sc of [10, 30, 50, 70, 95]) {
      const msg = generateFinalInterpretation(oc, sc, sd);
      if (msg && typeof msg === "string" && msg.length > 5) interpCount++;
    }
  }
}
console.log(`  ✓ ${interpCount}/${allOutcomes.length * 2 * 5} 조合에서 해설 반환`);

// =====================================================================
// d1.1 exact component 검증 — P0 회귀 방지
// =====================================================================
console.log("\n10. d1.1 — exact component 값 (P0 회귀 방지)");

function findDelta(comps, label) {
  return comps.find(c => c.label === label)?.delta;
}

// gauge=100 → 미국 +20, 일본 +15, 한국 +30→cap +10
const maxAllyState = mkState({
  outcome: "taiwan_survival_win",
  turn: 30,
  gauges: { usIntervention: 100, japanIntervention: 100, koreaRearSupport: 100,
            taiwanGovernment: 80, taiwanMorale: 70, taiwanSupply: 70, taiwanCommand: 90 }
});
const maxAlly = calculateFinalScore(maxAllyState, "taiwan");
const usDelta = findDelta(maxAlly.components, "미국 개입 유도");
const jpDelta = findDelta(maxAlly.components, "일본 개입 유도");
const krDelta = findDelta(maxAlly.components, "한국 후방 지원");
if (usDelta !== 20) { console.error(`FAIL: 미국 100 → 20 아님, got ${usDelta} (P0 회귀!)`); process.exit(1); }
if (jpDelta !== 15) { console.error(`FAIL: 일본 100 → 15 아님, got ${jpDelta} (P0 회귀!)`); process.exit(1); }
if (krDelta !== 10) { console.error(`FAIL: 한국 100 → 10 cap 아님, got ${krDelta} (P0 회귀!)`); process.exit(1); }
console.log(`  ✓ gauge 100 → 미국 +${usDelta} 일본 +${jpDelta} 한국 +${krDelta} (cap 후 정확)`);

// gauge=50 → 미국 round(50×0.2)=10, 일본 round(50×0.15)=8, 한국 round(50×0.3)=15→cap 10
const midAllyState = mkState({
  outcome: "taiwan_survival_win",
  turn: 30,
  gauges: { usIntervention: 50, japanIntervention: 50, koreaRearSupport: 50,
            taiwanGovernment: 80, taiwanMorale: 70, taiwanSupply: 70, taiwanCommand: 90 }
});
const midAlly = calculateFinalScore(midAllyState, "taiwan");
const us50 = findDelta(midAlly.components, "미국 개입 유도");
const jp50 = findDelta(midAlly.components, "일본 개입 유도");
const kr50 = findDelta(midAlly.components, "한국 후방 지원");
if (us50 !== 10) { console.error(`FAIL: us 50 → 10 아님, got ${us50}`); process.exit(1); }
if (jp50 !== 8) { console.error(`FAIL: japan 50 → 8 아님 (round), got ${jp50}`); process.exit(1); }
if (kr50 !== 10) { console.error(`FAIL: korea 50 → 10 cap 아님, got ${kr50}`); process.exit(1); }
console.log(`  ✓ gauge 50 → 미국 +${us50} 일본 +${jp50} 한국 +${kr50}`);

// gauge=0 → 모두 0
const zeroAllyState = mkState({
  outcome: "taiwan_survival_win",
  turn: 30,
  gauges: { usIntervention: 0, japanIntervention: 0, koreaRearSupport: 0,
            taiwanGovernment: 80, taiwanMorale: 70, taiwanSupply: 70, taiwanCommand: 90 }
});
const zeroAlly = calculateFinalScore(zeroAllyState, "taiwan");
const us0 = findDelta(zeroAlly.components, "미국 개입 유도");
const jp0 = findDelta(zeroAlly.components, "일본 개입 유도");
const kr0 = findDelta(zeroAlly.components, "한국 후방 지원");
if (us0 !== 0 || jp0 !== 0 || kr0 !== 0) {
  console.error(`FAIL: gauge 0 → 모두 0 아님: us=${us0}, jp=${jp0}, kr=${kr0}`); process.exit(1);
}
console.log(`  ✓ gauge 0 → 모두 0`);

// 11. sea_zone (strait) 제외 검증
console.log("\n11. d1.1 — sea_zone 비영토 노드 카운트 제외");
const seaZoneState = mkState({
  outcome: "taiwan_survival_win",
  turn: 30,
  provinces: {
    taipei: { id: "taipei", name: "타이베이", type: "capital", controlStage: "stable_defense" },
    strait: { id: "strait", name: "대만 해협", type: "sea_zone", controlStage: "china_control" },  // 비영토인데 china_control
    keelung: { id: "keelung", name: "지룽", type: "port", controlStage: "china_control" }
  }
});
const seaResult = calculateFinalScore(seaZoneState, "taiwan");
// 점령지 손실은 keelung 1개만 (strait는 sea_zone이라 제외)
const lossDelta = findDelta(seaResult.components, "점령지 손실 (1곳)");
if (lossDelta !== -5) {
  console.error(`FAIL: strait 포함되면 2곳 손실이 될 텐데, 1곳 (-5)이어야. components: ${JSON.stringify(seaResult.components.filter(c => c.label.includes("점령")))}`);
  process.exit(1);
}
console.log(`  ✓ strait(sea_zone) 제외, keelung(port)만 카운트: -5`);

// 12. majorBattles turn 보존 검증
console.log("\n12. d1.1 — majorBattles turn 보존");
const battleState = mkState({
  outcome: "taiwan_survival_win",
  turn: 30,
  gauges: {}
});
battleState.log = [
  { turn: 7, phase: 4, combatResults: [
    { sourceId: "test_op", sourceName: "테스트 공격", targetName: "지룽", margin: 8, success: true }
  ]},
  { turn: 12, phase: 4, combatResults: [
    { sourceId: "test_op2", sourceName: "테스트 봉쇄", targetName: "전역", margin: -7, success: false }
  ]}
];
const battleReport = buildFinalReport(battleState, { selectedSide: "taiwan" }, {});
if (battleReport.summary.majorBattles.length !== 2) {
  console.error(`FAIL: majorBattles 2개 아님, got ${battleReport.summary.majorBattles.length}`); process.exit(1);
}
if (battleReport.summary.majorBattles[0].turn !== 7) {
  console.error(`FAIL: 첫 전투 turn=7 아님, got ${battleReport.summary.majorBattles[0].turn}`); process.exit(1);
}
if (battleReport.summary.majorBattles[1].turn !== 12) {
  console.error(`FAIL: 둘째 전투 turn=12 아님, got ${battleReport.summary.majorBattles[1].turn}`); process.exit(1);
}
console.log(`  ✓ majorBattles turn 보존: T7 / T12`);

console.log("\n✓ final_grade smoke test passed");