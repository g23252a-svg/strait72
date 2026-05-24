// =====================================================================
// run_capital_relocation_smoke_test.mjs (v0.4.2-a.2)
// ---------------------------------------------------------------------
// 검증: 정부 이전 페널티 1회 제한 + 재함락 시 카운터만 재시작
//
// #1 첫 함락: capitalRelocationAppliedAt + taipeiFallsAt + 게이지 페널티
// #2 탈환: taipeiFallsAt → null, capitalRelocationAppliedAt 유지
// #3 재함락: taipeiFallsAt 새 턴, 게이지 페널티 *재적용 없음*
// #4 재함락 후 8턴 + 북부 접근로 → china_capital_win
// #5 일반 피해로 government ≤ 0 → china_surrender_win (기존 유지)
// #6 final outcome 문구에 "항복 승리" 없음
// =====================================================================

import { checkVictoryConditions } from "./turn_resolver.js";
import { createCampaignState } from "./campaign_state.js";

console.log("[capital relocation smoke test v0.4.2-a.2]");

function mkState({ turn = 18, totalTurns = 84, taipeiCtrl = "stable_defense", keelungCtrl = "stable_defense", gauges = {}, persistent = {} } = {}) {
  return {
    outcome: null, turn, totalTurns,
    gauges: {
      taiwanGovernment: 80, taiwanMorale: 70, taiwanSupply: 60, taiwanCommand: 75,
      usIntervention: 50, japanIntervention: 30, koreaRearSupport: 15,
      chinaPoliticalPressure: 50, chinaTempo: 50, chinaSupply: 50,
      ...gauges
    },
    provinces: {
      taipei: { id:"taipei", name:"타이베이", type:"capital", controlStage: taipeiCtrl, landingStage: taipeiCtrl === "china_control" ? "consolidated" : "none" },
      keelung: { id:"keelung", name:"지룽", type:"port", controlStage: keelungCtrl },
      taoyuan: { id:"taoyuan", name:"타오위안", type:"airport", controlStage:"stable_defense" }
    },
    persistent: {
      capitalPressureTurns: 0, lastActId: "ACT_2",
      milestones: {}, ...persistent
    },
    thisTurn: { operationLog: [] }, log: []
  };
}

const fullCamp = createCampaignState("taiwan", "normal", "full_21d");

// =====================================================================
// #1 첫 함락: capitalRelocationAppliedAt + 게이지 페널티
// =====================================================================
console.log("\n1. 첫 타이베이 함락 — 페널티 + 두 milestone 기록");
const s1 = mkState({ turn: 18, taipeiCtrl: "china_control" });
const r1 = checkVictoryConditions(s1, fullCamp);
if (r1 !== null) {
  console.error(`FAIL: 첫 함락 outcome=null이어야, got ${r1}`); process.exit(1);
}
if (s1.persistent.milestones.taipeiFallsAt !== 18) {
  console.error(`FAIL: taipeiFallsAt 18 아님, got ${s1.persistent.milestones.taipeiFallsAt}`); process.exit(1);
}
if (s1.persistent.milestones.capitalRelocationAppliedAt !== 18) {
  console.error(`FAIL: capitalRelocationAppliedAt 18 아님, got ${s1.persistent.milestones.capitalRelocationAppliedAt}`); process.exit(1);
}
if (s1.gauges.taiwanGovernment !== 80 - 25) {
  console.error(`FAIL: 정부 -25 안 됨, ${s1.gauges.taiwanGovernment}`); process.exit(1);
}
if (s1.gauges.taiwanMorale !== 70 - 15) {
  console.error(`FAIL: 사기 -15 안 됨`); process.exit(1);
}
if (s1.gauges.usIntervention !== 50 + 10 || s1.gauges.japanIntervention !== 30 + 5) {
  console.error(`FAIL: 동맹 게이지 보정 안 됨`); process.exit(1);
}
const hasRelocationLog = s1.thisTurn.operationLog.some(x => x.includes("정부 이전"));
if (!hasRelocationLog) { console.error(`FAIL: 정부 이전 로그 없음`); process.exit(1); }
console.log(`  ✓ 정부 55, 사기 55, 미국 60, 일본 35, 두 milestone 기록, 로그 출력`);

// =====================================================================
// #2 탈환: taipeiFallsAt → null, capitalRelocationAppliedAt 유지
// =====================================================================
console.log("\n2. 타이베이 탈환 — 카운터만 리셋, capitalRelocation 플래그 유지");
// state 그대로 사용, 타이베이가 contested로 후퇴 시뮬
s1.turn = 22;
s1.provinces.taipei.controlStage = "contested";
s1.thisTurn = { operationLog: [] };
const r2 = checkVictoryConditions(s1, fullCamp);
if (r2 !== null) { console.error(`FAIL: 탈환 outcome=null이어야, got ${r2}`); process.exit(1); }
if (s1.persistent.milestones.taipeiFallsAt !== null) {
  console.error(`FAIL: taipeiFallsAt null로 리셋되지 않음, got ${s1.persistent.milestones.taipeiFallsAt}`);
  process.exit(1);
}
if (s1.persistent.milestones.capitalRelocationAppliedAt !== 18) {
  console.error(`FAIL: capitalRelocationAppliedAt 18 유지되어야 (리셋 절대 X), got ${s1.persistent.milestones.capitalRelocationAppliedAt}`);
  process.exit(1);
}
// 게이지 변화 없음
if (s1.gauges.taiwanGovernment !== 55) {
  console.error(`FAIL: 탈환 시 게이지 또 변경됨, 정부 ${s1.gauges.taiwanGovernment}`); process.exit(1);
}
console.log(`  ✓ taipeiFallsAt=null, capitalRelocationAppliedAt=18 유지, 게이지 변화 없음`);

// =====================================================================
// #3 재함락: 페널티 *재적용 없음*, taipeiFallsAt만 새 턴
// =====================================================================
console.log("\n3. 타이베이 재함락 — 페널티 재적용 없음, 카운터만 새 시작");
const govBeforeRecapture = s1.gauges.taiwanGovernment;  // 55
const moraleBefore = s1.gauges.taiwanMorale;            // 55
const usBefore = s1.gauges.usIntervention;              // 60
const jpBefore = s1.gauges.japanIntervention;           // 35

s1.turn = 25;
s1.provinces.taipei.controlStage = "china_control";
s1.provinces.taipei.landingStage = "consolidated";
s1.thisTurn = { operationLog: [] };
const r3 = checkVictoryConditions(s1, fullCamp);
if (r3 !== null) { console.error(`FAIL: 재함락 outcome=null이어야 (8턴 미만), got ${r3}`); process.exit(1); }
if (s1.persistent.milestones.taipeiFallsAt !== 25) {
  console.error(`FAIL: taipeiFallsAt 25 새로 기록 안 됨, got ${s1.persistent.milestones.taipeiFallsAt}`); process.exit(1);
}
if (s1.persistent.milestones.capitalRelocationAppliedAt !== 18) {
  console.error(`FAIL: capitalRelocationAppliedAt 갱신됨 (18 유지되어야)`); process.exit(1);
}
// 게이지 재변경 없음 — 핵심 검증
if (s1.gauges.taiwanGovernment !== govBeforeRecapture) {
  console.error(`FAIL: 재함락 시 정부 또 -25 됨 ${govBeforeRecapture} → ${s1.gauges.taiwanGovernment}`); process.exit(1);
}
if (s1.gauges.taiwanMorale !== moraleBefore) {
  console.error(`FAIL: 재함락 시 사기 또 -15 됨`); process.exit(1);
}
if (s1.gauges.usIntervention !== usBefore || s1.gauges.japanIntervention !== jpBefore) {
  console.error(`FAIL: 재함락 시 동맹 또 +10/+5 됨`); process.exit(1);
}
// 재함락 로그
const hasRecaptureLog = s1.thisTurn.operationLog.some(x => x.includes("재함락"));
if (!hasRecaptureLog) {
  console.error(`FAIL: 재함락 로그 없음: ${JSON.stringify(s1.thisTurn.operationLog)}`); process.exit(1);
}
console.log(`  ✓ taipeiFallsAt=25, capitalRelocationAppliedAt=18 유지, 게이지 그대로, 재함락 로그 출력`);

// =====================================================================
// #4 재함락 후 8턴 + 북부 접근로 → china_capital_win
// =====================================================================
console.log("\n4. 재함락 후 8턴 + 지룽 점령 → china_capital_win");
s1.turn = 33;  // 재함락 25 + 8 = 33
s1.provinces.keelung.controlStage = "china_control";
s1.thisTurn = { operationLog: [] };
const r4 = checkVictoryConditions(s1, fullCamp);
if (r4 !== "china_capital_win") {
  console.error(`FAIL: 재함락 8턴 + 북부 → china_capital_win, got ${r4}`); process.exit(1);
}
console.log(`  ✓ T25 재함락 → T33 (8턴) + 지룽: china_capital_win`);

// =====================================================================
// #5 일반 피해로 government ≤ 0 → china_surrender_win (기존 유지)
// =====================================================================
console.log("\n5. 일반 피해 government 0 — china_surrender_win 유지");
const govZero = mkState({ turn: 30, gauges: { taiwanGovernment: 0 } });
const r5 = checkVictoryConditions(govZero, fullCamp);
if (r5 !== "china_surrender_win") {
  console.error(`FAIL: government 0 → china_surrender_win 유지되어야, got ${r5}`); process.exit(1);
}
console.log(`  ✓ government 0: china_surrender_win 유지`);

// =====================================================================
// #6 정부 이전 페널티로 government 0 되어도 surrender_win
// =====================================================================
console.log("\n6. 정부 20에서 함락 → -25로 0이 되면 china_surrender_win");
const lowGov = mkState({ turn: 18, taipeiCtrl: "china_control", gauges: { taiwanGovernment: 20 } });
const r6 = checkVictoryConditions(lowGov, fullCamp);
if (r6 !== "china_surrender_win") {
  console.error(`FAIL: 정부 20 + 함락 -25 → china_surrender_win, got ${r6}`); process.exit(1);
}
console.log(`  ✓ 정부 20 → -25 → china_surrender_win`);

// =====================================================================
// #7 final outcome 문구에 "항복 승리" 없음
// =====================================================================
console.log("\n7. outcome 문구 — '중국 항복 승리' 표현 제거됨");
import("node:fs").then(fsMod => {
  const source = fsMod.readFileSync(new URL("./final_grade.js", import.meta.url), "utf8");
  if (source.includes("중국 항복 승리")) {
    console.error(`FAIL: '중국 항복 승리' 문자열 잔재`); process.exit(1);
  }
  console.log(`  ✓ '중국 항복 승리' 표현 코드에서 제거됨`);
  console.log("\n✓ capital relocation smoke test passed");
});
