// =====================================================================
// run_act_structure_smoke_test.mjs (v0.4.1)
// ---------------------------------------------------------------------
// ACT 구조 검증.
//
// 검증:
//   1. ACT 경계 (T1-12, T13-44, T45-84) 정확
//   2. short_72h은 무조건 ACT_1
//   3. ACT 2 후반 + us 100 → ACT_3 조기 전환
//   4. actJustChanged 작동
//   5. updateLastActId 정상
//   6. computeAlliedPressure는 ACT_3에서만
//   7. actProgress 계산
//   8. SCENARIOS 정의 + createCampaignState 통합
// =====================================================================

import {
  ACT_DEFINITIONS, currentActFor, actJustChanged, updateLastActId,
  computeAlliedPressure, actProgress
} from "./act_structure.js";
import { createCampaignState, SCENARIOS } from "./campaign_state.js";

console.log("[act_structure smoke test v0.4.1]");

function mkState({ turn = 1, gauges = {}, lastActId = null } = {}) {
  return {
    turn,
    gauges: { usIntervention: 30, japanIntervention: 20, koreaRearSupport: 10, ...gauges },
    persistent: { lastActId }
  };
}

// 1. ACT 경계 (full_21d 시나리오 기준)
console.log("\n1. ACT 경계 — full_21d");
const fullCamp = createCampaignState("taiwan", "normal", "full_21d");
const cases = [
  [1, "ACT_1"], [6, "ACT_1"], [12, "ACT_1"],
  [13, "ACT_2"], [25, "ACT_2"], [44, "ACT_2"],
  [45, "ACT_3"], [70, "ACT_3"], [84, "ACT_3"]
];
for (const [turn, expected] of cases) {
  const act = currentActFor(mkState({ turn }), fullCamp);
  if (act.id !== expected) {
    console.error(`FAIL: T${turn} → expected ${expected}, got ${act.id}`); process.exit(1);
  }
}
console.log(`  ✓ ACT_1: T1-12, ACT_2: T13-44, ACT_3: T45-84 (9 경계 점)`);

// 2. short_72h은 무조건 ACT_1
console.log("\n2. short_72h은 어느 턴이든 ACT_1");
const shortCamp = createCampaignState("taiwan", "normal", "short_72h");
for (const turn of [1, 15, 30, 50, 80]) {
  const act = currentActFor(mkState({ turn }), shortCamp);
  if (act.id !== "ACT_1") {
    console.error(`FAIL: short_72h T${turn} → ${act.id}, expected ACT_1`); process.exit(1);
  }
}
console.log(`  ✓ short_72h은 모든 턴에서 ACT_1`);

// 3. 조기 ACT_3 전환: T35+ AND us≥100
console.log("\n3. 조기 ACT_3 전환 (T35+ AND us≥100)");
// T30, us=100: 아직 ACT_2 (T30은 35 미만)
let act = currentActFor(mkState({ turn: 30, gauges: { usIntervention: 100 } }), fullCamp);
if (act.id !== "ACT_2") {
  console.error(`FAIL: T30 us=100 → ACT_2이어야, got ${act.id}`); process.exit(1);
}
console.log(`  ✓ T30 us=100: 아직 ACT_2 (T35 미만)`);

// T35, us=100: ACT_3 조기 전환
act = currentActFor(mkState({ turn: 35, gauges: { usIntervention: 100 } }), fullCamp);
if (act.id !== "ACT_3") {
  console.error(`FAIL: T35 us=100 → ACT_3이어야, got ${act.id}`); process.exit(1);
}
console.log(`  ✓ T35 us=100: ACT_3 조기 전환`);

// T35, us<100: 아직 ACT_2
act = currentActFor(mkState({ turn: 35, gauges: { usIntervention: 95 } }), fullCamp);
if (act.id !== "ACT_2") {
  console.error(`FAIL: T35 us=95 → ACT_2이어야, got ${act.id}`); process.exit(1);
}
console.log(`  ✓ T35 us=95: 아직 ACT_2`);

// 4. actJustChanged
console.log("\n4. actJustChanged 작동");
const s12 = mkState({ turn: 12, lastActId: "ACT_1" });
if (actJustChanged(s12, fullCamp)) {
  console.error(`FAIL: T12에서 lastActId=ACT_1이면 변경 안 됨`); process.exit(1);
}
const s13 = mkState({ turn: 13, lastActId: "ACT_1" });
if (!actJustChanged(s13, fullCamp)) {
  console.error(`FAIL: T13 (ACT_2)에서 lastActId=ACT_1이면 변경됨이어야`); process.exit(1);
}
console.log(`  ✓ T12 ACT_1→ACT_1 no change, T13 ACT_1→ACT_2 changed`);

// 5. updateLastActId
console.log("\n5. updateLastActId 갱신");
const s = mkState({ turn: 20 });
updateLastActId(s, fullCamp);
if (s.persistent.lastActId !== "ACT_2") {
  console.error(`FAIL: T20 후 lastActId=ACT_2 아님, got ${s.persistent.lastActId}`); process.exit(1);
}
console.log(`  ✓ T20에서 lastActId = ACT_2`);

// 6. computeAlliedPressure는 ACT_3에서만 null 아님
console.log("\n6. computeAlliedPressure 활성 조건");
const act1State = mkState({ turn: 5, gauges: { usIntervention: 100, japanIntervention: 80 } });
const act2State = mkState({ turn: 25, gauges: { usIntervention: 100, japanIntervention: 80 } });
const act3State = mkState({ turn: 50, gauges: { usIntervention: 85, japanIntervention: 55, koreaRearSupport: 25 } });

if (computeAlliedPressure(act1State, fullCamp) !== null) {
  console.error(`FAIL: ACT_1에서 alliedPressure null이어야`); process.exit(1);
}
if (computeAlliedPressure(act2State, fullCamp) !== null) {
  console.error(`FAIL: ACT_2에서 alliedPressure null이어야`); process.exit(1);
}
const p3 = computeAlliedPressure(act3State, fullCamp);
if (!p3) {
  console.error(`FAIL: ACT_3에서 alliedPressure null 아니어야`); process.exit(1);
}
if (p3.usAttackPenalty !== 1) {
  console.error(`FAIL: us 85 ≥ 80 → attackPenalty 1, got ${p3.usAttackPenalty}`); process.exit(1);
}
if (p3.japanSupplyDrain !== 2) {
  console.error(`FAIL: japan 55 ≥ 50 → drain 2, got ${p3.japanSupplyDrain}`); process.exit(1);
}
if (p3.koreaLogisticsBonus !== 1) {
  console.error(`FAIL: korea 25 ≥ 20 → bonus 1, got ${p3.koreaLogisticsBonus}`); process.exit(1);
}
console.log(`  ✓ ACT_1/2: null, ACT_3: us-${p3.usAttackPenalty} jp-drain${p3.japanSupplyDrain} kr+${p3.koreaLogisticsBonus}`);

// 7. actProgress
console.log("\n7. actProgress");
const prog = actProgress(mkState({ turn: 18 }), fullCamp);
if (prog.actId !== "ACT_2") {
  console.error(`FAIL: T18 actId ACT_2`); process.exit(1);
}
// ACT_2 span = 32 (T13-44), elapsed at T18 = 6, progress = 6/32 ≈ 0.1875
if (Math.abs(prog.progress - 6/32) > 0.01) {
  console.error(`FAIL: T18 in ACT_2 progress 6/32 아님, got ${prog.progress}`); process.exit(1);
}
console.log(`  ✓ T18 ACT_2 progress ${(prog.progress*100).toFixed(1)}% (${prog.actName})`);

// 8. SCENARIOS + createCampaignState 통합
console.log("\n8. SCENARIOS + createCampaignState");
if (!SCENARIOS.short_72h || !SCENARIOS.full_21d) {
  console.error(`FAIL: SCENARIOS 정의 누락`); process.exit(1);
}
if (SCENARIOS.short_72h.totalTurns !== 30) {
  console.error(`FAIL: short_72h totalTurns 30 아님`); process.exit(1);
}
if (SCENARIOS.full_21d.totalTurns !== 84) {
  console.error(`FAIL: full_21d totalTurns 84 아님`); process.exit(1);
}
const c1 = createCampaignState("taiwan", "normal", "short_72h");
const c2 = createCampaignState("taiwan", "normal", "full_21d");
if (c1.totalTurns !== 30 || c2.totalTurns !== 84) {
  console.error(`FAIL: campaign.totalTurns 부정확`); process.exit(1);
}
if (c1.scenarioId !== "short_72h" || c2.scenarioId !== "full_21d") {
  console.error(`FAIL: scenarioId 부정확`); process.exit(1);
}
console.log(`  ✓ short_72h: ${c1.totalTurns}턴, full_21d: ${c2.totalTurns}턴`);

// 9. 잘못된 scenarioId fallback
console.log("\n9. 잘못된 scenarioId → short_72h fallback");
const cBad = createCampaignState("taiwan", "normal", "invalid_id");
if (cBad.scenarioId !== "short_72h") {
  console.error(`FAIL: invalid scenarioId fallback 안 됨`); process.exit(1);
}
console.log(`  ✓ fallback to short_72h`);

// 10. ACT 단방향 진행 — 한 번 ACT_3 진입했으면 us 떨어져도 ACT_3 유지
console.log("\n10. ACT 진행 단방향 (3→2 되돌아가지 않음)");
// T36 us=100 → ACT_3 (조기), lastActId=ACT_3 저장
const stateAt36 = mkState({ turn: 36, gauges: { usIntervention: 100 } });
const actAt36 = currentActFor(stateAt36, fullCamp);
if (actAt36.id !== "ACT_3") {
  console.error(`FAIL: T36 us=100 → ACT_3, got ${actAt36.id}`); process.exit(1);
}
updateLastActId(stateAt36, fullCamp);

// T40에서 us가 떨어지면? ACT_3 유지되어야 (lastActId가 ACT_3)
const stateAt40 = mkState({ turn: 40, gauges: { usIntervention: 75 }, lastActId: "ACT_3" });
const actAt40 = currentActFor(stateAt40, fullCamp);
if (actAt40.id !== "ACT_3") {
  console.error(`FAIL: T40에서 us=75인데 lastActId=ACT_3이면 ACT_3 유지되어야, got ${actAt40.id}`);
  process.exit(1);
}
console.log(`  ✓ T36 us=100 → ACT_3, T40 us=75 + lastAct=ACT_3 → 여전히 ACT_3 (lock 작동)`);

// 11. ACT_1 → ACT_2 진입 후 lastActId가 ACT_2면, 같은 ACT_2 끝 turn에서도 ACT_2
const stateAt12Restored = mkState({ turn: 12, lastActId: "ACT_2" });
const actAt12 = currentActFor(stateAt12Restored, fullCamp);
// T12은 자연 ACT_1이지만 lastActId가 ACT_2였으면 ACT_2 유지 (state 복구 안전)
if (actAt12.id !== "ACT_2") {
  console.error(`FAIL: T12 lastAct=ACT_2 (복구 시나리오) → ACT_2 유지, got ${actAt12.id}`); process.exit(1);
}
console.log(`  ✓ state 복구: T12 + lastAct=ACT_2 → ACT_2 유지 (단방향 보존)`);

console.log("\n✓ act_structure smoke test passed");
