// =====================================================================
// run_debrief_smoke_test.mjs (v0.4.0-d3)
// ---------------------------------------------------------------------
// 핵심 사건 선택 + 디브리핑 텍스트 생성 검증.
//
// 검증:
//   1. selectKeyMoments 빈 state 안전 (전투/이벤트 없음)
//   2. 결정적 전투 선택: 마지막 5턴 안에서 가장 큰 margin
//   3. 가장 큰 margin 전투 선택 (전체)
//   4. decisive와 biggest가 겹치면 다른 것 선택
//   5. lastDecisive는 decisive/biggest와 겹치지 않음
//   6. 주요 국제 이벤트: priority 순으로 최대 2개
//   7. 영향 큰 영구 보상: persistent + 효과 키 있는 것
//   8. generateDebrief: 3 섹션 모두 존재 + NaN/undefined 없음
//   9. generateDebrief outcome별 캠페인 평가 텍스트 다양함
//   10. buildFinalReport.summary.keyMoments + debrief 필드 추가됨
// =====================================================================

import {
  selectKeyMoments, generateDebrief, buildFinalReport
} from "./final_grade.js";

console.log("[debrief smoke test v0.4.0-d3]");

function mkState({ outcome, turn = 30, gauges = {}, provinces = {}, log = [], triggered = [], rewards = [] } = {}) {
  return {
    outcome, turn,
    gauges: {
      usIntervention: 50, japanIntervention: 30, koreaRearSupport: 15,
      internationalOpinion: 50, chinaPoliticalPressure: 30,
      chinaTempo: 60, chinaSupply: 60,
      taiwanMorale: 70, taiwanGovernment: 80, taiwanCommand: 90, taiwanSupply: 60,
      ...gauges
    },
    provinces, log,
    persistent: { rewards, triggeredOnce: triggered }
  };
}

function mkBattle(turn, sourceName, targetName, margin, success) {
  return { turn, sourceId: "x", sourceName, targetName, margin, success: success ?? (margin >= 0) };
}

// 1. 빈 state 안전
console.log("\n1. selectKeyMoments — 빈 state");
const empty = mkState({ outcome: "no_outcome", turn: 30 });
const km = selectKeyMoments(empty);
if (km.decisive !== null || km.biggest !== null || km.lastDecisive !== null) {
  console.error(`FAIL: 빈 state에 전투 데이터 있음`); process.exit(1);
}
if (km.significantEvents.length !== 0 || km.impactfulRewards.length !== 0) {
  console.error(`FAIL: 빈 state에 이벤트/보상 있음`); process.exit(1);
}
console.log(`  ✓ 빈 state — 모든 필드 null/[]`);

// 2. 결정적 전투 = 마지막 5턴 안 최대 margin
console.log("\n2. 결정적 전투 — 마지막 5턴 안 최대 margin");
const state2 = mkState({
  outcome: "taiwan_survival_win",
  turn: 30,
  log: [
    { turn: 5, combatResults: [mkBattle(5, "초기 작전", "지룽", 8, true)] },
    { turn: 12, combatResults: [mkBattle(12, "중반 압박", "타이베이", -7, false)] },
    { turn: 27, combatResults: [mkBattle(27, "종반 결전", "타이베이", 12, true)] },  // 종반, 큰 margin
    { turn: 29, combatResults: [mkBattle(29, "최후 시도", "가오슝", -4, false)] }
  ]
});
const km2 = selectKeyMoments(state2);
if (km2.decisive?.turn !== 27) {
  console.error(`FAIL: decisive turn 27이어야, got ${km2.decisive?.turn}`); process.exit(1);
}
console.log(`  ✓ decisive: T${km2.decisive.turn} ${km2.decisive.sourceName} (margin ${km2.decisive.margin})`);

// 3. 가장 큰 margin = 전체 통틀어 절대값 최대 → T27이 |12|로 최대 (decisive와 같으므로 다음으로)
if (km2.biggest && km2.biggest.turn === 27) {
  console.error(`FAIL: biggest는 decisive(T27)과 달라야`); process.exit(1);
}
// 다음 큰 margin은 T5 (|8|) 또는 T12 (|7|)
console.log(`  ✓ biggest (decisive와 다른): T${km2.biggest?.turn} margin ${km2.biggest?.margin}`);

// 4. lastDecisive는 decisive/biggest와 다른 turn
console.log("\n4. lastDecisive — decisive/biggest와 다른 turn");
const usedTurns = new Set([km2.decisive?.turn, km2.biggest?.turn].filter(t => t != null));
if (km2.lastDecisive && usedTurns.has(km2.lastDecisive.turn)) {
  console.error(`FAIL: lastDecisive turn ${km2.lastDecisive.turn}이 이미 사용됨`); process.exit(1);
}
console.log(`  ✓ lastDecisive: T${km2.lastDecisive?.turn || "없음"}`);

// 5. decisive와 biggest 같은 거 fallback
console.log("\n5. 게임에 큰 전투 1개만 있는 경우");
const oneState = mkState({
  outcome: "taiwan_survival_win",
  turn: 28,
  log: [
    { turn: 26, combatResults: [mkBattle(26, "결정적 한 방", "타이베이", 15, true)] }
  ]
});
const km5 = selectKeyMoments(oneState);
if (km5.decisive?.turn !== 26) {
  console.error(`FAIL: 하나뿐인 전투가 decisive 안 됨`); process.exit(1);
}
if (km5.biggest !== null) {
  console.error(`FAIL: 다른 전투 없으면 biggest는 null이어야`); process.exit(1);
}
console.log(`  ✓ 전투 1개: decisive만 채워지고 나머지는 null`);

// 6. 주요 국제 이벤트 — priority 순
console.log("\n6. 주요 국제 이벤트 — priority 순 최대 2개");
const state6 = mkState({
  outcome: "taiwan_survival_win",
  turn: 30,
  triggered: [
    "global_bad_weather",            // priority 낮음
    "global_us_carrier_movement",    // priority 1
    "global_market_crash",           // priority 6
    "global_japan_security_council", // priority 2
    "global_un_emergency_session"    // priority 4
  ]
});
const km6 = selectKeyMoments(state6);
if (km6.significantEvents.length !== 2) {
  console.error(`FAIL: 이벤트 2개여야, got ${km6.significantEvents.length}`); process.exit(1);
}
if (km6.significantEvents[0].id !== "global_us_carrier_movement") {
  console.error(`FAIL: 첫 이벤트는 us_carrier여야, got ${km6.significantEvents[0].id}`); process.exit(1);
}
if (km6.significantEvents[1].id !== "global_japan_security_council") {
  console.error(`FAIL: 둘째 이벤트는 japan_security여야, got ${km6.significantEvents[1].id}`); process.exit(1);
}
console.log(`  ✓ 이벤트 priority 순: ${km6.significantEvents.map(e => e.name).join(" / ")}`);

// 7. 영향 큰 영구 보상
console.log("\n7. 영향 큰 영구 보상");
const state7 = mkState({
  outcome: "taiwan_survival_win",
  turn: 30,
  rewards: [
    { id: "r1", name: "보상1", applyTiming: "instant", effects: { taiwanGovernment: 8 } },  // instant — 제외
    { id: "r2", name: "보상2", applyTiming: "persistent", effects: { rangedAttackBonus: 1 } },
    { id: "r3", name: "보상3", applyTiming: "persistent", effects: { perTurnGain: { usIntervention: 2 } } },
    { id: "r4", name: "보상4", applyTiming: "persistent", effects: {} },  // 효과 없음 — 제외
    { id: "r5", name: "보상5", applyTiming: "persistent", effects: { defenseValueBonus: { regions: ["taipei"], amount: 1 } } }
  ]
});
const km7 = selectKeyMoments(state7);
if (km7.impactfulRewards.length !== 2) {
  console.error(`FAIL: 영향 큰 보상 2개여야 (cap 2), got ${km7.impactfulRewards.length}`); process.exit(1);
}
if (km7.impactfulRewards.some(r => r.applyTiming !== "persistent")) {
  console.error(`FAIL: persistent 아닌 것 포함`); process.exit(1);
}
console.log(`  ✓ 영향 큰 보상 2개: ${km7.impactfulRewards.map(r => r.name).join(", ")}`);

// 8. generateDebrief 3 섹션 모두 존재 + NaN/undefined 없음
console.log("\n8. generateDebrief 3 섹션 채워짐");
const debrief = generateDebrief(state2, km2);
const sectionKeys = ["decisiveMoment", "internationalTurning", "campaignAssessment"];
for (const k of sectionKeys) {
  if (!debrief[k] || typeof debrief[k] !== "string") {
    console.error(`FAIL: ${k} 누락 또는 문자열 아님`); process.exit(1);
  }
  if (debrief[k].includes("NaN") || debrief[k].includes("undefined")) {
    console.error(`FAIL: ${k}에 NaN/undefined: "${debrief[k]}"`); process.exit(1);
  }
}
console.log(`  ✓ 결정적 순간: ${debrief.decisiveMoment.slice(0, 50)}…`);
console.log(`  ✓ 국제 전환점: ${debrief.internationalTurning.slice(0, 50)}…`);
console.log(`  ✓ 캠페인 평가: ${debrief.campaignAssessment.slice(0, 50)}…`);

// 9. outcome별 캠페인 평가 텍스트 다양
console.log("\n9. outcome별 캠페인 평가 다름");
const outcomes = ["taiwan_survival_win", "taiwan_political_collapse_win", "china_capital_win",
                  "china_capital_pressure_win", "china_blockade_win", "china_surrender_win"];
const assessments = new Set();
for (const oc of outcomes) {
  const s = mkState({ outcome: oc, turn: 22, gauges: { chinaPoliticalPressure: 90, taiwanGovernment: 70 } });
  const kmX = selectKeyMoments(s);
  const dX = generateDebrief(s, kmX);
  assessments.add(dX.campaignAssessment.slice(0, 30)); // 첫 30자가 outcome별 달라야
  if (dX.campaignAssessment.includes("NaN") || dX.campaignAssessment.includes("undefined")) {
    console.error(`FAIL: ${oc} 평가에 NaN: "${dX.campaignAssessment}"`); process.exit(1);
  }
}
if (assessments.size < 4) {
  console.error(`FAIL: 6 outcome인데 평가 텍스트가 ${assessments.size}종류로 너무 적음`); process.exit(1);
}
console.log(`  ✓ ${outcomes.length} outcome → ${assessments.size}종류 평가 텍스트`);

// 10. buildFinalReport.summary.keyMoments + debrief 필드 추가
console.log("\n10. buildFinalReport에 keyMoments + debrief 통합");
const intState = mkState({
  outcome: "taiwan_survival_win",
  turn: 30,
  triggered: ["global_us_carrier_movement"],
  log: [
    { turn: 28, combatResults: [mkBattle(28, "최종전", "타이베이", 7, true)] }
  ]
});
const report = buildFinalReport(intState, { selectedSide: "taiwan" }, { gameRules: { totalTurns: 30 } });
if (!report.summary.keyMoments) {
  console.error(`FAIL: report.summary.keyMoments 누락`); process.exit(1);
}
if (!report.summary.debrief) {
  console.error(`FAIL: report.summary.debrief 누락`); process.exit(1);
}
if (!report.summary.debrief.decisiveMoment) {
  console.error(`FAIL: debrief.decisiveMoment 누락`); process.exit(1);
}
console.log(`  ✓ summary.keyMoments + summary.debrief 통합`);
console.log(`    decisive: "${report.summary.debrief.decisiveMoment.slice(0, 60)}…"`);

// 11. 빈 데이터에서 fallback 메시지
console.log("\n11. 빈 데이터 fallback 메시지");
const emptyReport = buildFinalReport(empty, { selectedSide: "taiwan" }, { gameRules: { totalTurns: 30 } });
if (!emptyReport.summary.debrief.decisiveMoment.includes("결정적") &&
    !emptyReport.summary.debrief.decisiveMoment.includes("자원 소모전")) {
  console.error(`FAIL: 빈 데이터 fallback 메시지 부정확`); process.exit(1);
}
if (!emptyReport.summary.debrief.internationalTurning.includes("국제 이벤트") &&
    !emptyReport.summary.debrief.internationalTurning.includes("군사적")) {
  console.error(`FAIL: 이벤트 fallback 부정확`); process.exit(1);
}
console.log(`  ✓ 빈 데이터 fallback: ${emptyReport.summary.debrief.decisiveMoment.slice(0, 40)}…`);

// 12. 조사 자동 처리 — 받침 있는 단어/없는 단어
console.log("\n12. 조사 자동 처리");
// '발표' (받침 없음) → "발표와" / "발표가"
// '회의' (받침 없음) → "회의와" / "회의가"
// '소집' (받침 있음) → "소집과" / "소집이"
// '보도' (받침 없음) → "보도가"
const joState = mkState({
  outcome: "taiwan_survival_win",
  turn: 30,
  triggered: ["global_us_carrier_movement", "global_japan_security_council"]
});
const joKm = selectKeyMoments(joState);
const joDebrief = generateDebrief(joState, joKm);
// "미국 항모 이동 발표"(받침X)와 + "일본 안보회의 소집"(받침O)이
if (!joDebrief.internationalTurning.includes("발표와")) {
  console.error(`FAIL: '발표' (받침X) → '발표와' 안 됨: "${joDebrief.internationalTurning}"`); process.exit(1);
}
if (!joDebrief.internationalTurning.includes("소집이")) {
  console.error(`FAIL: '소집' (받침O) → '소집이' 안 됨: "${joDebrief.internationalTurning}"`); process.exit(1);
}
console.log(`  ✓ 받침 자동 처리: ${joDebrief.internationalTurning}`);

console.log("\n✓ debrief smoke test passed");
