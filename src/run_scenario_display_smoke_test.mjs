// =====================================================================
// run_scenario_display_smoke_test.mjs (v0.4.1.1)
// ---------------------------------------------------------------------
// hotfix 회귀 방지:
//   #1: RULES/totalTurns 표시가 시나리오에 맞게 갱신됨
//   #2: final modal totalTurns가 state.totalTurns 우선
//   #3: persistent reward 중복 차단 (applyReward 2차 방어)
// =====================================================================

import { SCENARIOS, createCampaignState, saveLastChoice, loadLastChoice } from "./campaign_state.js";
import { buildFinalReport } from "./final_grade.js";
import { applyReward } from "./reward_system.js";
import { createInitialState } from "./state.js";

console.log("[scenario display + reward dedup smoke test v0.4.1.1]");

// =====================================================================
// 검증 #1: SCENARIOS.totalTurns 정확
// =====================================================================
console.log("\n1. SCENARIOS totalTurns");
if (SCENARIOS.short_72h.totalTurns !== 30) {
  console.error(`FAIL: short_72h.totalTurns 30 아님`); process.exit(1);
}
if (SCENARIOS.full_21d.totalTurns !== 84) {
  console.error(`FAIL: full_21d.totalTurns 84 아님`); process.exit(1);
}
console.log(`  ✓ short_72h: 30턴 / full_21d: 84턴`);

// =====================================================================
// 검증 #2: createCampaignState가 totalTurns + scenarioId 정확히 반영
// =====================================================================
console.log("\n2. createCampaignState 시나리오 반영");
const cShort = createCampaignState("taiwan", "normal", "short_72h");
const cFull = createCampaignState("taiwan", "normal", "full_21d");
if (cShort.totalTurns !== 30 || cShort.scenarioId !== "short_72h") {
  console.error(`FAIL: short campaign 부정확`); process.exit(1);
}
if (cFull.totalTurns !== 84 || cFull.scenarioId !== "full_21d") {
  console.error(`FAIL: full campaign 부정확`); process.exit(1);
}
console.log(`  ✓ short: 30턴+id, full: 84턴+id`);

// =====================================================================
// 검증 #3: createInitialState totalTurnsOverride → state.totalTurns
// =====================================================================
console.log("\n3. createInitialState — totalTurnsOverride → state.totalTurns");
const dummyProvs = [{ id: "test", name: "test", type: "city" }];
const dummyRules = { version: "test", totalTurns: 30, hoursPerTurn: 6 };
const stateShort = createInitialState({
  provinces: dummyProvs, gameRules: dummyRules, axes: [],
  cardsChina: [], cardsTaiwan: [], events: [], totalTurnsOverride: null
});
const stateFull = createInitialState({
  provinces: dummyProvs, gameRules: dummyRules, axes: [],
  cardsChina: [], cardsTaiwan: [], events: [], totalTurnsOverride: 84
});
if (stateShort.totalTurns !== 30) {
  console.error(`FAIL: override null → gameRules.totalTurns 30, got ${stateShort.totalTurns}`); process.exit(1);
}
if (stateFull.totalTurns !== 84) {
  console.error(`FAIL: override 84 → state.totalTurns 84, got ${stateFull.totalTurns}`); process.exit(1);
}
console.log(`  ✓ override null → 30, override 84 → 84`);

// =====================================================================
// 검증 #4: final modal totalTurns가 state.totalTurns 우선
// =====================================================================
console.log("\n4. final modal subtitle은 state.totalTurns 사용");
const baseState = {
  outcome: "taiwan_survival_win",
  turn: 20,
  totalTurns: 84,  // full_21d 캠페인 중
  gauges: {
    usIntervention: 60, japanIntervention: 30, koreaRearSupport: 10,
    taiwanGovernment: 70, taiwanMorale: 70, taiwanSupply: 60, taiwanCommand: 80,
    chinaPoliticalPressure: 50, chinaTempo: 50, chinaSupply: 50
  },
  provinces: { taipei: { id:"taipei", name:"타이베이", type:"capital", controlStage:"stable_defense" } },
  persistent: { rewards: [], triggeredOnce: [] },
  log: []
};
const fullReport = buildFinalReport(
  baseState,
  createCampaignState("taiwan", "normal", "full_21d"),
  { gameRules: dummyRules }  // gameRules.totalTurns = 30, 함정
);
if (fullReport.totalTurns !== 84) {
  console.error(`FAIL: report.totalTurns 84여야 (state.totalTurns 우선), got ${fullReport.totalTurns}`);
  process.exit(1);
}
console.log(`  ✓ state.totalTurns=84 → report.totalTurns=${fullReport.totalTurns} (gameRules.totalTurns=30 무시)`);

// state.totalTurns 없을 때 fallback 체인
const stateNoTotal = { ...baseState, totalTurns: undefined };
const reportFallback1 = buildFinalReport(
  stateNoTotal,
  createCampaignState("taiwan", "normal", "full_21d"),
  { gameRules: dummyRules }
);
if (reportFallback1.totalTurns !== 84) {
  console.error(`FAIL: state.totalTurns 없으면 campaign.totalTurns(84) 사용, got ${reportFallback1.totalTurns}`); process.exit(1);
}
console.log(`  ✓ state.totalTurns 없음 → campaign.totalTurns=84 fallback`);

const reportFallback2 = buildFinalReport(stateNoTotal, null, { gameRules: dummyRules });
if (reportFallback2.totalTurns !== 30) {
  console.error(`FAIL: campaign도 없으면 gameRules.totalTurns(30), got ${reportFallback2.totalTurns}`); process.exit(1);
}
console.log(`  ✓ campaign 없음 → gameRules.totalTurns=30 fallback`);

// =====================================================================
// 검증 #5: applyReward persistent 중복 차단 (2차 방어)
// =====================================================================
console.log("\n5. applyReward — persistent 중복 차단");
const rewardState = { persistent: { rewards: [] }, turn: 5 };
const reward = {
  id: "tw_port_fortification", name: "항만 방어 공사",
  side: "taiwan", applyTiming: "persistent", effects: { defenseValueBonus: { amount: 1 } }
};

// 첫 호출 → 성공
const r1 = applyReward(rewardState, reward);
if (r1.applied !== "persistent") {
  console.error(`FAIL: 첫 호출 applied 'persistent' 아님, got ${r1.applied}`); process.exit(1);
}
if (rewardState.persistent.rewards.length !== 1) {
  console.error(`FAIL: 첫 호출 후 rewards 길이 1 아님`); process.exit(1);
}
console.log(`  ✓ 첫 호출: applied=${r1.applied}, rewards.length=1`);

// 두 번째 호출 → 중복 차단
const r2 = applyReward(rewardState, reward);
if (r2.applied !== "already_owned") {
  console.error(`FAIL: 둘째 호출 applied 'already_owned'이어야, got ${r2.applied}`); process.exit(1);
}
if (rewardState.persistent.rewards.length !== 1) {
  console.error(`FAIL: 둘째 호출 후에도 rewards 길이 1이어야 (push 안 됨), got ${rewardState.persistent.rewards.length}`);
  process.exit(1);
}
console.log(`  ✓ 둘째 호출: applied=${r2.applied}, rewards.length 여전히 1 (중복 차단됨)`);

// 세 번째 호출도 차단
const r3 = applyReward(rewardState, reward);
if (rewardState.persistent.rewards.length !== 1) {
  console.error(`FAIL: 셋째 호출에서도 1이어야`); process.exit(1);
}
console.log(`  ✓ 셋째 호출도 차단: rewards.length=1`);

// =====================================================================
// 검증 #6: 디브리핑/ownedRewards가 중복 reward에도 1회만 표시 (dedup 안전망)
// =====================================================================
console.log("\n6. ownedRewards/디브리핑 — 중복 reward에 dedup 적용");
// state에 의도적으로 중복을 넣어서 dedup 안전망 작동 확인
const dupState = {
  outcome: "taiwan_survival_win",
  turn: 30,
  totalTurns: 30,
  gauges: {
    usIntervention: 60, japanIntervention: 30, koreaRearSupport: 10,
    taiwanGovernment: 70, taiwanMorale: 70, taiwanSupply: 60, taiwanCommand: 80
  },
  provinces: { taipei: { id:"taipei", name:"타이베이", type:"capital", controlStage:"stable_defense" } },
  persistent: {
    rewards: [
      { id: "tw_port_fortification", name: "항만 방어 공사", side: "taiwan", applyTiming: "persistent", effects: { defenseValueBonus: { amount: 1 } } },
      // 의도적 중복 (applyReward 가드가 뚫린 상황 시뮬)
      { id: "tw_port_fortification", name: "항만 방어 공사", side: "taiwan", applyTiming: "persistent", effects: { defenseValueBonus: { amount: 1 } } },
      { id: "tw_humanitarian_campaign", name: "인도주의 캠페인", side: "taiwan", applyTiming: "persistent", effects: { perTurnGain: { usIntervention: 2 } } }
    ],
    triggeredOnce: []
  },
  log: []
};
const dupReport = buildFinalReport(dupState, createCampaignState("taiwan", "normal", "short_72h"), { gameRules: dummyRules });

// summary.ownedRewards에서 dedup
const ownedNames = dupReport.summary.ownedRewards.map(r => r.name);
const portCount = ownedNames.filter(n => n === "항만 방어 공사").length;
if (portCount !== 1) {
  console.error(`FAIL: '항만 방어 공사' ownedRewards에 ${portCount}번 표시 (1번이어야)`); process.exit(1);
}
console.log(`  ✓ ownedRewards 중 '항만 방어 공사' 1번만 (dedup 작동)`);

// impactfulRewards에서 dedup
const impactNames = dupReport.summary.keyMoments.impactfulRewards.map(r => r.name);
const impactPortCount = impactNames.filter(n => n === "항만 방어 공사").length;
if (impactPortCount > 1) {
  console.error(`FAIL: impactfulRewards에 '항만 방어 공사' 중복: ${impactPortCount}번`); process.exit(1);
}
console.log(`  ✓ impactfulRewards 중복 없음`);

// debrief.campaignAssessment에 같은 이름 두 번 안 나옴
const assess = dupReport.summary.debrief.campaignAssessment;
const portInAssess = (assess.match(/항만 방어 공사/g) || []).length;
if (portInAssess > 1) {
  console.error(`FAIL: 디브리핑에 '항만 방어 공사' ${portInAssess}번 — 한 번이어야: "${assess}"`); process.exit(1);
}
console.log(`  ✓ 디브리핑에 '항만 방어 공사' ${portInAssess}번 표시`);

// =====================================================================
// 검증 #7: saveLastChoice + loadLastChoice round-trip — scenarioId 보존
// =====================================================================
console.log("\n7. saveLastChoice ↔ loadLastChoice — scenarioId 보존");
if (typeof globalThis.localStorage === "undefined") {
  // Node 환경 — mock
  globalThis.localStorage = {
    _data: {},
    setItem(k, v) { this._data[k] = v; },
    getItem(k) { return this._data[k] || null; },
    removeItem(k) { delete this._data[k]; }
  };
}
saveLastChoice("taiwan", "normal", "full_21d");
const loaded = loadLastChoice();
if (!loaded) {
  console.error(`FAIL: loadLastChoice null`); process.exit(1);
}
if (loaded.scenarioId !== "full_21d") {
  console.error(`FAIL: scenarioId 보존 안 됨, got ${loaded.scenarioId}`); process.exit(1);
}
console.log(`  ✓ saveLastChoice('full_21d') → loadLastChoice.scenarioId='${loaded.scenarioId}'`);

console.log("\n✓ scenario display + reward dedup smoke test passed");
