// =====================================================================
// run_act_objectives_smoke_test.mjs (v0.4.2-c)
// ---------------------------------------------------------------------
// 검증: ACT 1/2/3 모두 동적 목표 생성
//
// #1 generateActObjectives → { taiwan, china, actId, actName }
// #2 ACT 1: 양 진영 목표 생성 (초기 상륙 / 동맹 게이지 / 정부 안정)
// #3 ACT 2: 양 진영 목표 생성 (봉쇄 / 수도권 압박 / 미국 100)
// #4 ACT 3: b3 호환 유지 (b3 smoke 그대로 통과)
// #5 shouldShowActObjectives — full_21d 전 ACT에서 true
// #6 short_72h: ACT 1만 표시 (전체 ACT 표시되어도 OK, 코드 검증)
// #7 b3 alias (generateAct3Objectives / shouldShowAct3Objectives) 유지
// =====================================================================

import { generateActObjectives, shouldShowActObjectives, generateAct3Objectives, shouldShowAct3Objectives } from "./act_objectives.js";
import { createCampaignState } from "./campaign_state.js";

console.log("[ACT objectives generalization smoke test v0.4.2-c]");

function mkState({ turn = 5, lastActId = "ACT_1", gauges = {}, provinces = {}, persistent = {} } = {}) {
  return {
    turn, totalTurns: 84, outcome: null,
    gauges: {
      taiwanGovernment: 90, taiwanMorale: 75, taiwanSupply: 70, taiwanCommand: 90,
      usIntervention: 25, japanIntervention: 15, koreaRearSupport: 10,
      internationalOpinion: 50,
      chinaPoliticalPressure: 30, chinaTempo: 75, chinaSupply: 75,
      ...gauges
    },
    provinces: {
      taipei: { id:"taipei", name:"타이베이", controlStage:"stable_defense", landingStage:"none" },
      keelung: { id:"keelung", name:"지룽", controlStage:"stable_defense", landingStage:"none" },
      kaohsiung: { id:"kaohsiung", name:"가오슝", controlStage:"stable_defense", landingStage:"none" },
      taichung: { id:"taichung", name:"타이중", controlStage:"stable_defense", landingStage:"none" },
      tainan: { id:"tainan", name:"타이난", controlStage:"stable_defense", landingStage:"none" },
      taoyuan: { id:"taoyuan", name:"타오위안", controlStage:"stable_defense", landingStage:"none" },
      ...provinces
    },
    persistent: { lastActId, milestones: {}, ...persistent }
  };
}

const fullCamp = createCampaignState("taiwan", "normal", "full_21d");
const shortCamp = createCampaignState("taiwan", "normal", "short_72h");

// =====================================================================
// #1: 기본 schema
// =====================================================================
console.log("\n1. generateActObjectives 기본 schema");
const s1 = mkState({ turn: 5, lastActId: "ACT_1" });
const r1 = generateActObjectives(s1, fullCamp);
if (!Array.isArray(r1.taiwan) || !Array.isArray(r1.china)) {
  console.error(`FAIL: taiwan/china 배열 아님`); process.exit(1);
}
if (typeof r1.actId !== "string" || typeof r1.actName !== "string") {
  console.error(`FAIL: actId/actName 누락`); process.exit(1);
}
console.log(`  ✓ schema OK (actId=${r1.actId}, actName="${r1.actName}")`);

// =====================================================================
// #2: ACT 1 — 초기 상륙 + 동맹 게이지
// =====================================================================
console.log("\n2. ACT 1 목표 생성");
// 시나리오: 가오슝에 상륙 진척, 미국 개입 25
const act1State = mkState({
  turn: 6, lastActId: "ACT_1",
  provinces: { kaohsiung: { id:"kaohsiung", name:"가오슝", controlStage:"contested", landingStage:"landing_attempt" } }
});
const r2 = generateActObjectives(act1State, fullCamp);
if (r2.actId !== "ACT_1") {
  console.error(`FAIL: actId 'ACT_1' 아님, ${r2.actId}`); process.exit(1);
}

// 대만 측: 가오슝 상륙 저지 + 미국 개입 buildup
const taiwanHasLandingBlock = r2.taiwan.some(o => o.id === "initial_landing_block");
const taiwanHasUsBuildup = r2.taiwan.some(o => o.id === "us_buildup_early");
if (!taiwanHasLandingBlock) {
  console.error(`FAIL: ACT 1 대만 목표에 initial_landing_block 없음, ids: ${r2.taiwan.map(o=>o.id).join(",")}`); process.exit(1);
}
if (!taiwanHasUsBuildup) {
  console.error(`FAIL: ACT 1 대만 목표에 us_buildup_early 없음`); process.exit(1);
}

// 중국 측: 교두보 확보 + 미국 개입 견제
const chinaHasBeachhead = r2.china.some(o => o.id === "secure_beachhead" || o.id === "expand_beachhead");
if (!chinaHasBeachhead) {
  console.error(`FAIL: ACT 1 중국 목표에 secure/expand_beachhead 없음`); process.exit(1);
}
console.log(`  ✓ ACT 1 대만: ${r2.taiwan.length}개, 중국: ${r2.china.length}개`);
console.log(`    대만 ids: ${r2.taiwan.map(o=>o.id).join(", ")}`);
console.log(`    중국 ids: ${r2.china.map(o=>o.id).join(", ")}`);

// =====================================================================
// #3: ACT 2 — 봉쇄 + 수도권 압박 + 미국 100
// =====================================================================
console.log("\n3. ACT 2 목표 생성");
const act2State = mkState({
  turn: 25, lastActId: "ACT_2",
  gauges: {
    taiwanGovernment: 75, taiwanSupply: 40, usIntervention: 85,
    chinaPoliticalPressure: 78, chinaTempo: 35
  },
  provinces: {
    taipei: { id:"taipei", name:"타이베이", controlStage:"contested", landingStage:"landing_attempt" },
    kaohsiung: { id:"kaohsiung", name:"가오슝", controlStage:"china_control", landingStage:"consolidated" }
  }
});
const r3 = generateActObjectives(act2State, fullCamp);
if (r3.actId !== "ACT_2") {
  console.error(`FAIL: actId 'ACT_2' 아님, ${r3.actId}`); process.exit(1);
}
// 대만 측: 타이베이 방어 + 미국 개입 100
const taiwanCapital = r3.taiwan.some(o => o.id === "capital_defense");
const taiwanUsFull = r3.taiwan.some(o => o.id === "us_full_intervention");
if (!taiwanCapital) {
  console.error(`FAIL: ACT 2 대만 capital_defense 없음`); process.exit(1);
}
if (!taiwanUsFull) {
  console.error(`FAIL: ACT 2 대만 us_full_intervention 없음`); process.exit(1);
}
// 중국 측: 수도권 압박 또는 정치압박 관리
const chinaPP = r3.china.some(o => o.id === "pp_pressure_act2");
const chinaUsDelay = r3.china.some(o => o.id === "us_delay_act2");
if (!chinaPP) {
  console.error(`FAIL: ACT 2 중국 pp_pressure_act2 없음 (chinaPP=78)`); process.exit(1);
}
if (!chinaUsDelay) {
  console.error(`FAIL: ACT 2 중국 us_delay_act2 없음 (us=85)`); process.exit(1);
}
console.log(`  ✓ ACT 2 대만: ${r3.taiwan.length}개, 중국: ${r3.china.length}개`);

// =====================================================================
// #4: ACT 3 — b3 호환
// =====================================================================
console.log("\n4. ACT 3 b3 호환 — 모든 b3 기능 그대로");
const act3State = mkState({
  turn: 50, lastActId: "ACT_3",
  gauges: { chinaPoliticalPressure: 85, chinaTempo: 5, chinaSupply: 8 }
});
const r4 = generateActObjectives(act3State, fullCamp);
if (r4.actId !== "ACT_3") {
  console.error(`FAIL: actId 'ACT_3' 아님`); process.exit(1);
}
const hasPpRelief = r4.china.some(o => o.id === "pp_relief" && o.priority === "high");
const hasTempoRecov = r4.china.some(o => o.id === "tempo_recovery" && o.priority === "high");
const hasSupplyRefit = r4.china.some(o => o.id === "supply_refit" && o.priority === "high");
if (!hasPpRelief || !hasTempoRecov || !hasSupplyRefit) {
  console.error(`FAIL: ACT 3 b3 목표 누락`); process.exit(1);
}
console.log(`  ✓ ACT 3 b3 호환: pp_relief / tempo_recovery / supply_refit 유지`);

// =====================================================================
// #5: shouldShowActObjectives - 모든 ACT
// =====================================================================
console.log("\n5. shouldShowActObjectives 모든 ACT 활성화");
for (const [actId, turn] of [["ACT_1", 5], ["ACT_2", 25], ["ACT_3", 50]]) {
  const s = mkState({ turn, lastActId: actId });
  if (!shouldShowActObjectives(s, fullCamp)) {
    console.error(`FAIL: ${actId} 표시 안 됨`); process.exit(1);
  }
}
console.log(`  ✓ ACT 1/2/3 모두 표시 활성`);

// =====================================================================
// #6: short_72h ACT 1도 표시
// =====================================================================
console.log("\n6. short_72h ACT 1 표시");
const sShort = mkState({ turn: 5, lastActId: "ACT_1" });
if (!shouldShowActObjectives(sShort, shortCamp)) {
  console.error(`FAIL: short_72h ACT 1 표시 안 됨`); process.exit(1);
}
console.log(`  ✓ short_72h + ACT 1: 표시됨`);

// =====================================================================
// #7: b3 alias 호환
// =====================================================================
console.log("\n7. b3 호환 alias 유지");
const aliasState = mkState({ turn: 50, lastActId: "ACT_3" });
const r7 = generateAct3Objectives(aliasState);
if (!Array.isArray(r7.taiwan) || !Array.isArray(r7.china)) {
  console.error(`FAIL: generateAct3Objectives 깨짐`); process.exit(1);
}
// shouldShowAct3Objectives 기존 동작: full_21d + ACT 3에서만 true
if (!shouldShowAct3Objectives(aliasState, fullCamp)) {
  console.error(`FAIL: shouldShowAct3Objectives full+ACT3 → true 깨짐`); process.exit(1);
}
const aliasAct1 = mkState({ turn: 5, lastActId: "ACT_1" });
if (shouldShowAct3Objectives(aliasAct1, fullCamp)) {
  console.error(`FAIL: shouldShowAct3Objectives ACT1 → false 깨짐`); process.exit(1);
}
if (shouldShowAct3Objectives(aliasState, shortCamp)) {
  console.error(`FAIL: shouldShowAct3Objectives short → false 깨짐`); process.exit(1);
}
console.log(`  ✓ generateAct3Objectives / shouldShowAct3Objectives alias 동작`);

console.log("\n✓ ACT objectives generalization smoke test passed");
