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
// 1. 양쪽 시나리오 공통: 타이베이 china_control → china_capital_win
// =====================================================================
console.log("\n1. 양쪽 공통 — 타이베이 china_control → china_capital_win");
const taipeiState = mkState({
  provinces: { taipei: { id:"taipei", name:"타이베이", type:"capital", controlStage:"china_control" } }
});
const oShort = checkVictoryConditions(taipeiState, shortCamp);
const oFull = checkVictoryConditions(taipeiState, fullCamp);
if (oShort !== "china_capital_win" || oFull !== "china_capital_win") {
  console.error(`FAIL: 타이베이 china_control: short=${oShort}, full=${oFull}`); process.exit(1);
}
console.log(`  ✓ short: ${oShort}, full: ${oFull}`);

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
// 8. ACT HUD 라벨
// =====================================================================
console.log("\n8. ACT HUD 라벨 — ACT별 다른 표시");
const mockHours = (turn) => Math.max(0, 72 - turn * 6);
const hudAct1 = actHudLabel(mkState({ turn: 5, persistent: { lastActId: "ACT_1" } }), fullCamp, mockHours);
const hudAct2 = actHudLabel(mkState({ turn: 25, persistent: { lastActId: "ACT_2" } }), fullCamp, mockHours);
const hudAct3 = actHudLabel(mkState({ turn: 60, persistent: { lastActId: "ACT_3" } }), fullCamp, mockHours);

if (!hudAct1.label.includes("72시간")) {
  console.error(`FAIL: ACT 1 HUD '72시간 목표' 없음: "${hudAct1.label}"`); process.exit(1);
}
if (hudAct2.label.includes("72시간")) {
  console.error(`FAIL: ACT 2 HUD에 '72시간' 잔재: "${hudAct2.label}"`); process.exit(1);
}
if (!hudAct2.label.includes("동맹 개입 전환기")) {
  console.error(`FAIL: ACT 2 HUD에 '동맹 개입 전환기' 없음: "${hudAct2.label}"`); process.exit(1);
}
if (!hudAct3.label.includes("장기전")) {
  console.error(`FAIL: ACT 3 HUD에 '장기전' 없음: "${hudAct3.label}"`); process.exit(1);
}
console.log(`  ✓ ACT 1: "${hudAct1.label}: ${hudAct1.value}"`);
console.log(`  ✓ ACT 2: "${hudAct2.label}: ${hudAct2.value}"`);
console.log(`  ✓ ACT 3: "${hudAct3.label}: ${hudAct3.value}"`);

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

console.log("\n✓ campaign victory smoke test passed");
