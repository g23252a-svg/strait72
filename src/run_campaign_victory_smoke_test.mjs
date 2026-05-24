// =====================================================================
// run_campaign_victory_smoke_test.mjs (v0.4.1.2)
// ---------------------------------------------------------------------
// short_72h vs full_21d의 승리 조건 분리 검증.
//
// 핵심:
//   short_72h: chinaPoliticalPressure >= 100 → 즉시 taiwan 승리
//   full_21d:  chinaPoliticalPressure >= 100 → milestone만, 게임 계속
//   full_21d ACT 1/2: capital pressure → milestone, 즉시 승리 X
//   full_21d ACT 3: capital pressure → china 승리 인정
//   양쪽: 타이베이 china_control → 즉시 china 승리 (유지)
//   양쪽: taiwanGovernment 0 → 즉시 china 승리 (유지)
// =====================================================================

import { checkVictoryConditions } from "./turn_resolver.js";
import { createCampaignState } from "./campaign_state.js";
import { actHudLabel } from "./act_structure.js";

console.log("[campaign-specific victory smoke test v0.4.1.2]");

function mkState({ outcome = null, turn = 10, totalTurns = 30, gauges = {}, provinces = {}, persistent = {} } = {}) {
  return {
    outcome, turn, totalTurns,
    gauges: {
      usIntervention: 30, japanIntervention: 20, koreaRearSupport: 10,
      internationalOpinion: 50, chinaPoliticalPressure: 50,
      chinaTempo: 50, chinaSupply: 50,
      taiwanMorale: 70, taiwanGovernment: 80, taiwanCommand: 80, taiwanSupply: 60,
      ...gauges
    },
    provinces: {
      taipei: { id:"taipei", name:"타이베이", type:"capital", controlStage:"stable_defense" },
      keelung: { id:"keelung", name:"지룽", type:"port", controlStage:"stable_defense" },
      taoyuan: { id:"taoyuan", name:"타오위안", type:"airport", controlStage:"stable_defense" },
      ...provinces
    },
    persistent: { capitalPressureTurns: 0, lastActId: "ACT_1", milestones: {}, ...persistent },
    thisTurn: { operationLog: [] },
    log: []
  };
}

const shortCamp = createCampaignState("taiwan", "normal", "short_72h");
const fullCamp = createCampaignState("taiwan", "normal", "full_21d");

// =====================================================================
// 1. 시나리오별 분기: 타이베이 china_control
//    short: 즉시 china_capital_win (유지)
//    full:  정부 이전 milestone, 게임 계속 (v0.4.1.3)
// =====================================================================
console.log("\n1. 타이베이 china_control — short는 즉시 승리, full은 정부 이전 milestone");
const taipeiStateShort = mkState({
  provinces: { taipei: { id:"taipei", name:"타이베이", type:"capital", controlStage:"china_control" } }
});
const oShort = checkVictoryConditions(taipeiStateShort, shortCamp);
if (oShort !== "china_capital_win") {
  console.error(`FAIL: short 타이베이 함락 → china_capital_win, got ${oShort}`); process.exit(1);
}
console.log(`  ✓ short: ${oShort} (즉시 승리)`);

// full: 정부 이전 milestone, outcome null
const taipeiStateFull = mkState({
  turn: 18,
  totalTurns: 84,
  gauges: { taiwanGovernment: 80, taiwanMorale: 70, usIntervention: 50, japanIntervention: 30 },
  provinces: { taipei: { id:"taipei", name:"타이베이", type:"capital", controlStage:"china_control" } }
});
const oFull = checkVictoryConditions(taipeiStateFull, fullCamp);
if (oFull !== null) {
  console.error(`FAIL: full 타이베이 함락 → null (게임 계속), got ${oFull}`); process.exit(1);
}
// milestone 기록
if (taipeiStateFull.persistent.milestones?.taipeiFallsAt !== 18) {
  console.error(`FAIL: taipeiFallsAt milestone 없음, got ${JSON.stringify(taipeiStateFull.persistent.milestones)}`);
  process.exit(1);
}
// 게이지 변화 검증
if (taipeiStateFull.gauges.taiwanGovernment !== 80 - 25) {
  console.error(`FAIL: 정부 -25 안 됨, ${taipeiStateFull.gauges.taiwanGovernment}`); process.exit(1);
}
if (taipeiStateFull.gauges.taiwanMorale !== 70 - 15) {
  console.error(`FAIL: 사기 -15 안 됨`); process.exit(1);
}
if (taipeiStateFull.gauges.usIntervention !== 50 + 10) {
  console.error(`FAIL: 미국 +10 안 됨`); process.exit(1);
}
if (taipeiStateFull.gauges.japanIntervention !== 30 + 5) {
  console.error(`FAIL: 일본 +5 안 됨`); process.exit(1);
}
const hasGovLog = taipeiStateFull.thisTurn.operationLog.some(s => s.includes("정부 이전"));
if (!hasGovLog) {
  console.error(`FAIL: 정부 이전 로그 없음`); process.exit(1);
}
console.log(`  ✓ full: outcome=null, milestone T18, 정부 -25/사기 -15/미 +10/일 +5, 로그 출력`);

// =====================================================================
// 2. 양쪽 공통: 정부 0 → china_surrender_win
// =====================================================================
console.log("\n2. 양쪽 공통 — 정부 기능 0 → china_surrender_win");
const govZero = mkState({ gauges: { taiwanGovernment: 0 } });
if (checkVictoryConditions(govZero, shortCamp) !== "china_surrender_win") {
  console.error(`FAIL: short 정부 0 → china_surrender_win 아님`); process.exit(1);
}
if (checkVictoryConditions(govZero, fullCamp) !== "china_surrender_win") {
  console.error(`FAIL: full 정부 0 → china_surrender_win 아님`); process.exit(1);
}
console.log(`  ✓ 양쪽 모두 china_surrender_win`);

// =====================================================================
// 3. 핵심: chinaPoliticalPressure >= 100 — short는 승리, full은 milestone
// =====================================================================
console.log("\n3. 정치압박 100 — short는 즉시 승리, full은 milestone (게임 계속)");
const pressState = mkState({
  turn: 22,
  gauges: { chinaPoliticalPressure: 100 }
});
const shortRes = checkVictoryConditions(pressState, shortCamp);
if (shortRes !== "taiwan_political_collapse_win") {
  console.error(`FAIL: short 정치압박 100 → taiwan_political_collapse_win, got ${shortRes}`); process.exit(1);
}
console.log(`  ✓ short: ${shortRes} (즉시 종전)`);

// full_21d: 같은 state라도 outcome null (게임 계속)
const fullState = mkState({
  turn: 22,
  totalTurns: 84,
  gauges: { chinaPoliticalPressure: 100 }
});
const fullRes = checkVictoryConditions(fullState, fullCamp);
if (fullRes !== null) {
  console.error(`FAIL: full 정치압박 100은 null이어야 (milestone만, 게임 계속), got ${fullRes}`); process.exit(1);
}
// milestone 기록 확인
if (fullState.persistent.milestones?.chinaPoliticalCrisisAt !== 22) {
  console.error(`FAIL: milestone.chinaPoliticalCrisisAt 22 안 기록됨, got ${JSON.stringify(fullState.persistent.milestones)}`);
  process.exit(1);
}
// 로그 메시지 확인
const hasLog = fullState.thisTurn.operationLog.some(s => s.includes("정치위기"));
if (!hasLog) {
  console.error(`FAIL: '정치위기 진입' 로그 없음`); process.exit(1);
}
console.log(`  ✓ full: outcome=null (게임 계속), milestone T22 기록, 로그 메시지 출력`);

// =====================================================================
// 4. full_21d: milestone은 한 번만 기록 (재호출에도 갱신 X)
// =====================================================================
console.log("\n4. milestone 멱등성 — 재호출에도 한 번만 기록");
const turn22Milestone = fullState.persistent.milestones.chinaPoliticalCrisisAt;
// turn 25로 다시 호출 — 같은 milestone 유지
fullState.turn = 25;
fullState.thisTurn.operationLog = [];
const fullRes2 = checkVictoryConditions(fullState, fullCamp);
if (fullState.persistent.milestones.chinaPoliticalCrisisAt !== turn22Milestone) {
  console.error(`FAIL: milestone 갱신됨 (멱등성 깨짐), ${turn22Milestone} → ${fullState.persistent.milestones.chinaPoliticalCrisisAt}`);
  process.exit(1);
}
// 두번째에는 로그 메시지 안 나와야 (이미 한 번 기록됨)
const secondLog = fullState.thisTurn.operationLog.some(s => s.includes("정치위기"));
if (secondLog) {
  console.error(`FAIL: milestone 로그가 매 턴 반복됨`); process.exit(1);
}
console.log(`  ✓ milestone T${turn22Milestone} 유지 (재호출에도 X), 중복 로그 없음`);

// =====================================================================
// 5. full_21d ACT 1: capital pressure → milestone, 승리 X
// =====================================================================
console.log("\n5. full_21d ACT 1 — 수도권 압박 milestone (즉시 승리 X)");
const capPressureAct1 = mkState({
  turn: 10,
  totalTurns: 84,
  provinces: {
    taipei: { id:"taipei", name:"타이베이", type:"capital", controlStage:"beachhead_established", landingStage:"beachhead" },
    keelung: { id:"keelung", name:"지룽", type:"port", controlStage:"china_control" }
  },
  persistent: { capitalPressureTurns: 2, lastActId: "ACT_1", milestones: {} }
});
const act1Res = checkVictoryConditions(capPressureAct1, fullCamp);
if (act1Res !== null) {
  console.error(`FAIL: ACT 1 수도권 압박 → null이어야 (milestone), got ${act1Res}`); process.exit(1);
}
if (capPressureAct1.persistent.milestones.capitalPressureAt !== 10) {
  console.error(`FAIL: capitalPressureAt milestone 없음`); process.exit(1);
}
console.log(`  ✓ ACT 1 수도권 압박: outcome=null, milestone T10 기록`);

// 같은 상태에서 short_72h이면 즉시 승리
const capPressureShort = { ...capPressureAct1 };
const shortCapRes = checkVictoryConditions(capPressureShort, shortCamp);
if (shortCapRes !== "china_capital_pressure_win") {
  console.error(`FAIL: short_72h 같은 상태에서 china_capital_pressure_win이어야, got ${shortCapRes}`); process.exit(1);
}
console.log(`  ✓ (대조) short_72h 같은 상태: china_capital_pressure_win 즉시 승리`);

// =====================================================================
// 6. full_21d ACT 3: capital pressure → china_capital_pressure_win
// =====================================================================
console.log("\n6. full_21d ACT 3 — 수도권 압박은 즉시 승리 인정");
const capPressureAct3 = mkState({
  turn: 60,
  totalTurns: 84,
  provinces: {
    taipei: { id:"taipei", name:"타이베이", type:"capital", controlStage:"beachhead_established", landingStage:"beachhead" },
    keelung: { id:"keelung", name:"지룽", type:"port", controlStage:"china_control" }
  },
  persistent: { capitalPressureTurns: 2, lastActId: "ACT_3", milestones: {} }
});
const act3Res = checkVictoryConditions(capPressureAct3, fullCamp);
if (act3Res !== "china_capital_pressure_win") {
  console.error(`FAIL: ACT 3 수도권 압박 → china_capital_pressure_win이어야, got ${act3Res}`); process.exit(1);
}
console.log(`  ✓ ACT 3 수도권 압박: china_capital_pressure_win`);

// =====================================================================
// 7. 양쪽 공통: T84 도달 → taiwan_survival_win
// =====================================================================
console.log("\n7. 최종 턴 도달 — taiwan_survival_win");
const finalShort = mkState({ turn: 30, totalTurns: 30 });
const finalFull = mkState({ turn: 84, totalTurns: 84 });
if (checkVictoryConditions(finalShort, shortCamp) !== "taiwan_survival_win") {
  console.error(`FAIL: short T30 → taiwan_survival_win 아님`); process.exit(1);
}
if (checkVictoryConditions(finalFull, fullCamp) !== "taiwan_survival_win") {
  console.error(`FAIL: full T84 → taiwan_survival_win 아님`); process.exit(1);
}
console.log(`  ✓ T30 (short), T84 (full) 모두 taiwan_survival_win`);

// =====================================================================
// 8. ACT HUD label/value 기본 확인 (자세한 분리 검증은 16번에서)
// =====================================================================
console.log("\n8. ACT HUD 라벨 — ACT별 다른 값");
const mockHours = (turn) => Math.max(0, 72 - turn * 6);
const hudAct1 = actHudLabel(mkState({ turn: 5, persistent: { lastActId: "ACT_1" } }), fullCamp, mockHours);
const hudAct3Pre = actHudLabel(mkState({ turn: 60, persistent: { lastActId: "ACT_3" } }), fullCamp, mockHours);
if (hudAct1.value === hudAct3Pre.value) {
  console.error(`FAIL: ACT 1/3 HUD value 같음`); process.exit(1);
}
console.log(`  ✓ ACT 1 ≠ ACT 3 HUD value`);

// =====================================================================
// 9. campaign null fallback — 기존 동작 유지 (호환)
// =====================================================================
console.log("\n9. campaign null fallback — 기존 동작 (short_72h처럼)");
const noCamp = mkState({ gauges: { chinaPoliticalPressure: 100 } });
const noCampRes = checkVictoryConditions(noCamp, null);
if (noCampRes !== "taiwan_political_collapse_win") {
  console.error(`FAIL: campaign null이면 short처럼 동작해야, got ${noCampRes}`); process.exit(1);
}
console.log(`  ✓ campaign null: ${noCampRes} (호환 유지)`);

// =====================================================================
// v0.4.1.3: 정부 이전 milestone 멱등성 + 장기 점령 + 반격
// =====================================================================
console.log("\n[v0.4.1.3 정부 이전 검증]");

// 10. 정부 이전 milestone 멱등성 — 한 번만 발동
console.log("\n10. taipeiFallsAt milestone 멱등성 (반복 호출에도 한 번)");
const idemState = mkState({
  turn: 15, totalTurns: 84,
  gauges: { taiwanGovernment: 80, taiwanMorale: 70, usIntervention: 40, japanIntervention: 25 },
  provinces: { taipei: { id:"taipei", name:"타이베이", type:"capital", controlStage:"china_control" } }
});
checkVictoryConditions(idemState, fullCamp);
const govAfter1st = idemState.gauges.taiwanGovernment;
const fallTurn1st = idemState.persistent.milestones.taipeiFallsAt;

// 다음 턴 — 게이지 또 떨어지면 안 됨
idemState.turn = 16;
idemState.thisTurn.operationLog = [];
checkVictoryConditions(idemState, fullCamp);
if (idemState.gauges.taiwanGovernment !== govAfter1st) {
  console.error(`FAIL: 정부 game 두 번째 호출에 또 -25 됨, ${govAfter1st} → ${idemState.gauges.taiwanGovernment}`);
  process.exit(1);
}
if (idemState.persistent.milestones.taipeiFallsAt !== fallTurn1st) {
  console.error(`FAIL: taipeiFallsAt 갱신됨 (멱등성 깨짐), ${fallTurn1st} → ${idemState.persistent.milestones.taipeiFallsAt}`);
  process.exit(1);
}
const dupLog = idemState.thisTurn.operationLog.some(s => s.includes("정부 이전"));
if (dupLog) {
  console.error(`FAIL: 정부 이전 로그 반복`); process.exit(1);
}
console.log(`  ✓ taipeiFallsAt T${fallTurn1st} 유지, 정부 ${govAfter1st} 유지, 로그 반복 없음`);

// 11. 장기 점령: taipeiFallsAt + 8턴 + 북부 접근로 → china_capital_win
console.log("\n11. 장기 점령 (8턴 + 북부 접근로) → china_capital_win");
// taipeiFallsAt T15, 현재 T23 (8턴 경과), 지룽 점령
const longOccState = mkState({
  turn: 23, totalTurns: 84,
  provinces: {
    taipei: { id:"taipei", name:"타이베이", type:"capital", controlStage:"china_control" },
    keelung: { id:"keelung", name:"지룽", type:"port", controlStage:"china_control" }
  },
  persistent: {
    capitalPressureTurns: 0, lastActId: "ACT_2",
    milestones: { taipeiFallsAt: 15 }
  }
});
const longRes = checkVictoryConditions(longOccState, fullCamp);
if (longRes !== "china_capital_win") {
  console.error(`FAIL: 장기 점령 8턴 + 지룽 → china_capital_win, got ${longRes}`); process.exit(1);
}
console.log(`  ✓ T15 함락 → T23 (8턴) + 지룽 점령: china_capital_win`);

// 12. 장기 점령 — 8턴 미만이면 발동 안 함
console.log("\n12. 7턴 경과만 — 아직 china_capital_win 안 됨");
const not8State = mkState({
  turn: 22, totalTurns: 84,
  provinces: {
    taipei: { id:"taipei", name:"타이베이", type:"capital", controlStage:"china_control" },
    keelung: { id:"keelung", name:"지룽", type:"port", controlStage:"china_control" }
  },
  persistent: {
    capitalPressureTurns: 0, lastActId: "ACT_2",
    milestones: { taipeiFallsAt: 15 }
  }
});
const not8Res = checkVictoryConditions(not8State, fullCamp);
if (not8Res !== null) {
  console.error(`FAIL: 7턴만 경과인데 ${not8Res}이 됨 (null이어야)`); process.exit(1);
}
console.log(`  ✓ 7턴 경과 (T15 → T22): outcome=null`);

// 13. 장기 점령 — 북부 접근로 없으면 발동 안 함
console.log("\n13. 8턴 경과 BUT 북부 접근로 없으면 china_capital_win 안 됨");
const noAccessState = mkState({
  turn: 23, totalTurns: 84,
  provinces: {
    taipei: { id:"taipei", name:"타이베이", type:"capital", controlStage:"china_control" }
    // keelung, taoyuan은 default stable_defense
  },
  persistent: {
    capitalPressureTurns: 0, lastActId: "ACT_2",
    milestones: { taipeiFallsAt: 15 }
  }
});
const noAccessRes = checkVictoryConditions(noAccessState, fullCamp);
if (noAccessRes !== null) {
  console.error(`FAIL: 북부 접근로 없으면 null이어야, got ${noAccessRes}`); process.exit(1);
}
console.log(`  ✓ 북부 접근로 없음: outcome=null`);

// 14. 대만 반격 — 타이베이 함락 후 contested로 후퇴
console.log("\n14. 대만 반격: 타이베이 china_control에서 contested로 후퇴 → 카운터 reset");
const counterState = mkState({
  turn: 25, totalTurns: 84,
  provinces: {
    // 한때 china_control이었으나 이번 턴엔 contested로 후퇴
    taipei: { id:"taipei", name:"타이베이", type:"capital", controlStage:"contested" },
    keelung: { id:"keelung", name:"지룽", type:"port", controlStage:"china_control" }
  },
  persistent: {
    capitalPressureTurns: 0, lastActId: "ACT_2",
    milestones: { taipeiFallsAt: 15 }  // 함락 후 10턴
  }
});
const counterRes = checkVictoryConditions(counterState, fullCamp);
if (counterRes !== null) {
  console.error(`FAIL: 반격 후 china_control 아니면 outcome null이어야, got ${counterRes}`); process.exit(1);
}
// taipeiFallsAt가 reset되었는지 확인 — 다음 함락 시 새로운 8턴 시작
if (counterState.persistent.milestones.taipeiFallsAt !== null) {
  console.error(`FAIL: 반격으로 taipeiFallsAt 리셋 안 됨, got ${counterState.persistent.milestones.taipeiFallsAt}`);
  process.exit(1);
}
console.log(`  ✓ 반격으로 taipeiFallsAt null로 리셋 (다음 함락 시 새로운 8턴 시작)`);

// 15. 정부 -25로 0이 되어도 — china_surrender_win
console.log("\n15. 정부 25 이하인데 함락 → -25 효과로 0 이하 → china_surrender_win");
const lowGovState = mkState({
  turn: 18, totalTurns: 84,
  gauges: { taiwanGovernment: 20, taiwanMorale: 50, usIntervention: 50, japanIntervention: 30 },
  provinces: { taipei: { id:"taipei", name:"타이베이", type:"capital", controlStage:"china_control" } }
});
const lowGovRes = checkVictoryConditions(lowGovState, fullCamp);
if (lowGovRes !== "china_surrender_win") {
  console.error(`FAIL: 정부 20 - 25 = -5 → china_surrender_win, got ${lowGovRes}`); process.exit(1);
}
console.log(`  ✓ 정부 20 → 정부 이전 효과로 -5 (clamp 0) → china_surrender_win`);

// 16. ACT HUD label/value 분리 검증
console.log("\n16. actHudLabel 표시 — label/value 명확 분리");
const hudFullAct1 = actHudLabel(mkState({ turn: 5, persistent: { lastActId: "ACT_1" } }), fullCamp, mockHours);
const hudFullAct2 = actHudLabel(mkState({ turn: 25, persistent: { lastActId: "ACT_2" } }), fullCamp, mockHours);
const hudFullAct3 = actHudLabel(mkState({ turn: 60, persistent: { lastActId: "ACT_3" } }), fullCamp, mockHours);

// ACT 1: label "중국 72시간 목표", value "Xh 남음"
if (hudFullAct1.label !== "중국 72시간 목표") {
  console.error(`FAIL: ACT 1 label "${hudFullAct1.label}"`); process.exit(1);
}
// ACT 2: label "현재 국면", value에 ACT명 + 설명
if (hudFullAct2.label !== "현재 국면") {
  console.error(`FAIL: ACT 2 label "${hudFullAct2.label}" 이어야 "현재 국면"`); process.exit(1);
}
if (!hudFullAct2.value.includes("동맹 개입 전환기")) {
  console.error(`FAIL: ACT 2 value에 ACT명 없음 "${hudFullAct2.value}"`); process.exit(1);
}
if (hudFullAct3.label !== "현재 국면") {
  console.error(`FAIL: ACT 3 label`); process.exit(1);
}
if (!hudFullAct3.value.includes("장기전")) {
  console.error(`FAIL: ACT 3 value에 '장기전' 없음`); process.exit(1);
}
console.log(`  ✓ ACT 1: ${hudFullAct1.label} = ${hudFullAct1.value}`);
console.log(`  ✓ ACT 2: ${hudFullAct2.label} = ${hudFullAct2.value}`);
console.log(`  ✓ ACT 3: ${hudFullAct3.label} = ${hudFullAct3.value}`);

console.log("\n✓ campaign victory smoke test passed");
