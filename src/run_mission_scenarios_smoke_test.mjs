// =====================================================================
// run_mission_scenarios_smoke_test.mjs (v0.4.2-d)
// ---------------------------------------------------------------------
// 검증: 5개 시나리오 미션 정의 + applyMissionToState + evaluateMission
//
// #1 5개 미션 모두 존재 + schema 검증
// #2 applyMissionToState — 게이지/점령/persistent 오버라이드
// #3 evaluateMission — gauge_min / gauge_max
// #4 evaluateMission — province_china_held / not_china_held
// #5 evaluateMission — any_province_china_held / no_provinces_china_held
// #6 미션 완료: 모든 objective met
// #7 미션 실패: failure 하나라도 triggered
// #8 listMissions API
// #9 통합: state.mission이 없으면 일반 게임 흐름 유지 (기존 호환)
// =====================================================================

import { MISSIONS, applyMissionToState, evaluateMission, listMissions } from "./mission_scenarios.js";

console.log("[mission scenarios smoke test v0.4.2-d]");

// =====================================================================
// #1: 5개 미션 schema
// =====================================================================
console.log("\n1. 5개 미션 정의 + schema");
const expectedIds = ["first_72h", "kaohsiung_defense", "capital_pressure", "blockade_war", "allied_counter"];
for (const id of expectedIds) {
  const m = MISSIONS[id];
  if (!m) { console.error(`FAIL: 미션 ${id} 누락`); process.exit(1); }
  if (typeof m.name !== "string" || typeof m.description !== "string") {
    console.error(`FAIL: ${id} name/description 누락`); process.exit(1);
  }
  if (!["short_72h", "full_21d"].includes(m.baseScenario)) {
    console.error(`FAIL: ${id} baseScenario 비표준: ${m.baseScenario}`); process.exit(1);
  }
  if (!["taiwan", "china", "auto"].includes(m.recommendedSide)) {
    console.error(`FAIL: ${id} recommendedSide 비표준`); process.exit(1);
  }
  if (!Array.isArray(m.missionObjectives) || m.missionObjectives.length === 0) {
    console.error(`FAIL: ${id} missionObjectives 없음`); process.exit(1);
  }
  if (!Array.isArray(m.failureConditions)) {
    console.error(`FAIL: ${id} failureConditions 없음`); process.exit(1);
  }
}
console.log(`  ✓ 5개 미션 모두 존재 + schema`);

// =====================================================================
// #2: applyMissionToState
// =====================================================================
console.log("\n2. applyMissionToState — 게이지/점령/persistent 오버라이드");
function mkState() {
  return {
    turn: 1, totalTurns: 30, outcome: null,
    gauges: {
      taiwanGovernment: 100, taiwanCommand: 100, taiwanSupply: 100, taiwanMorale: 100,
      chinaTempo: 100, chinaSupply: 100, chinaPoliticalPressure: 0,
      usIntervention: 0, japanIntervention: 0
    },
    provinces: {
      taipei: { id:"taipei", name:"타이베이", controlStage:"stable_defense", landingStage:"none" },
      kaohsiung: { id:"kaohsiung", name:"가오슝", controlStage:"stable_defense", landingStage:"none" },
      tainan: { id:"tainan", name:"타이난", controlStage:"stable_defense", landingStage:"none" }
    },
    persistent: { milestones: {}, alliedIntervention: { active: false } }
  };
}

const s2 = mkState();
applyMissionToState(s2, MISSIONS.kaohsiung_defense);
if (s2.gauges.chinaTempo !== 80) {
  console.error(`FAIL: 게이지 오버라이드 안 됨, chinaTempo ${s2.gauges.chinaTempo}`); process.exit(1);
}
if (s2.provinces.kaohsiung.controlStage !== "contested") {
  console.error(`FAIL: 점령 오버라이드 안 됨`); process.exit(1);
}
if (s2.totalTurns !== MISSIONS.kaohsiung_defense.missionTurns) {
  console.error(`FAIL: totalTurns 안 변경됨, ${s2.totalTurns}`); process.exit(1);
}
if (!s2.mission || s2.mission.id !== "kaohsiung_defense") {
  console.error(`FAIL: state.mission 안 기록됨`); process.exit(1);
}
console.log(`  ✓ 게이지/점령/totalTurns/state.mission 모두 적용`);

// allied_counter는 persistent 오버라이드 — alliedIntervention.active=true
const s2b = mkState();
applyMissionToState(s2b, MISSIONS.allied_counter);
if (!s2b.persistent.alliedIntervention?.active) {
  console.error(`FAIL: allied_counter persistent.alliedIntervention.active 안 됨`); process.exit(1);
}
if (s2b.persistent.lastActId !== "ACT_3") {
  console.error(`FAIL: allied_counter persistent.lastActId 안 됨`); process.exit(1);
}
console.log(`  ✓ persistent 오버라이드: alliedIntervention.active, lastActId=ACT_3`);

// =====================================================================
// #3: gauge_min / gauge_max
// =====================================================================
console.log("\n3. evaluateMission — gauge 조건");
const s3 = mkState();
applyMissionToState(s3, MISSIONS.first_72h);
const r3a = evaluateMission(s3, MISSIONS.first_72h);
// first_72h 시작 시: gov 100, command 100 → 모두 met
if (!r3a.objectiveStatus.find(o => o.id === "govt_80").met) {
  console.error(`FAIL: govt 100인데 govt_80 met X`); process.exit(1);
}

// 게이지 낮추면 못 미침
s3.gauges.taiwanGovernment = 70;
const r3b = evaluateMission(s3, MISSIONS.first_72h);
if (r3b.objectiveStatus.find(o => o.id === "govt_80").met) {
  console.error(`FAIL: govt 70인데 govt_80 met`); process.exit(1);
}
console.log(`  ✓ gauge_min 정상 (govt 100→met, 70→not met)`);

// gauge_min (실패 조건) — capital_pressure pp_collapse: PP 100 도달 시 실패
const s3c = mkState();
applyMissionToState(s3c, MISSIONS.capital_pressure);
s3c.gauges.chinaPoliticalPressure = 80;
const r3c = evaluateMission(s3c, MISSIONS.capital_pressure);
if (r3c.failureStatus.find(f => f.id === "pp_collapse").triggered) {
  console.error(`FAIL: PP 80인데 pp_collapse triggered (gauge_min 100)`); process.exit(1);
}
s3c.gauges.chinaPoliticalPressure = 100;
const r3d = evaluateMission(s3c, MISSIONS.capital_pressure);
if (!r3d.failureStatus.find(f => f.id === "pp_collapse").triggered) {
  console.error(`FAIL: PP 100인데 pp_collapse 안 triggered`); process.exit(1);
}
console.log(`  ✓ gauge_min as failure (pp 80→OK, 100→failure)`);

// =====================================================================
// #4, #5: province 조건
// =====================================================================
console.log("\n4+5. province 조건");
const s4 = mkState();
applyMissionToState(s4, MISSIONS.kaohsiung_defense);
// 가오슝 시작 시 contested → not_china_held met
const r4a = evaluateMission(s4, MISSIONS.kaohsiung_defense);
if (!r4a.objectiveStatus.find(o => o.id === "kaohsiung_held").met) {
  console.error(`FAIL: 가오슝 contested인데 kaohsiung_held met X`); process.exit(1);
}
// 가오슝 함락 → failure triggered
s4.provinces.kaohsiung.controlStage = "china_control";
const r4b = evaluateMission(s4, MISSIONS.kaohsiung_defense);
if (r4b.objectiveStatus.find(o => o.id === "kaohsiung_held").met) {
  console.error(`FAIL: 가오슝 china_control인데 held met`); process.exit(1);
}
if (!r4b.failureStatus.find(f => f.id === "kaohsiung_fall").triggered) {
  console.error(`FAIL: 가오슝 china_control인데 failure 안 triggered`); process.exit(1);
}
console.log(`  ✓ province_not_china_held + province_china_held 정상`);

// no_provinces_china_held (first_72h)
const s5 = mkState();
applyMissionToState(s5, MISSIONS.first_72h);
const r5a = evaluateMission(s5, MISSIONS.first_72h);
if (!r5a.objectiveStatus.find(o => o.id === "no_china_held").met) {
  console.error(`FAIL: 시작 시 no_china_held 안 met`); process.exit(1);
}
s5.provinces.tainan.controlStage = "beachhead_established";
const r5b = evaluateMission(s5, MISSIONS.first_72h);
if (r5b.objectiveStatus.find(o => o.id === "no_china_held").met) {
  console.error(`FAIL: 타이난 beachhead인데 no_china_held met`); process.exit(1);
}
console.log(`  ✓ no_provinces_china_held 정상`);

// =====================================================================
// #6, #7: 완료/실패 판정
// =====================================================================
console.log("\n6+7. 미션 완료/실패");

// first_72h 시작 상태: gov/command 100, no losses → 완료 조건 만족
const s6 = mkState();
applyMissionToState(s6, MISSIONS.first_72h);
const r6 = evaluateMission(s6, MISSIONS.first_72h);
if (!r6.complete) {
  console.error(`FAIL: first_72h 이상 상태인데 complete X: ${JSON.stringify(r6)}`); process.exit(1);
}
if (r6.failed) {
  console.error(`FAIL: complete인데 failed=true`); process.exit(1);
}
console.log(`  ✓ first_72h 모든 objective met → complete=true`);

// failure 조건 한 개라도 → failed
const s7 = mkState();
applyMissionToState(s7, MISSIONS.first_72h);
s7.provinces.taipei.controlStage = "china_control";  // 타이베이 함락
const r7 = evaluateMission(s7, MISSIONS.first_72h);
if (!r7.failed) {
  console.error(`FAIL: 타이베이 함락인데 failed X`); process.exit(1);
}
if (r7.complete) {
  console.error(`FAIL: failed인데 complete=true`); process.exit(1);
}
console.log(`  ✓ 타이베이 함락 → failed=true`);

// =====================================================================
// #8: listMissions
// =====================================================================
console.log("\n8. listMissions API");
const list = listMissions();
if (list.length !== 5) {
  console.error(`FAIL: listMissions 5개 아님, ${list.length}`); process.exit(1);
}
for (const m of list) {
  if (!m.id || !m.name || !m.description || !m.recommendedSide) {
    console.error(`FAIL: ${m.id} 메타 누락`); process.exit(1);
  }
}
console.log(`  ✓ 5개 미션 메타 목록: ${list.map(m => m.id).join(", ")}`);

// =====================================================================
// #9: 통합 — state.mission 없으면 일반 게임 흐름
// =====================================================================
console.log("\n9. 통합: state.mission 없으면 미션 평가 skip");
const fs = await import("node:fs");
const { GAME_RULES } = await import("./game_rules.js");
const { createInitialState, buildCardIndex, buildAxisIndex } = await import("./state.js");
const { runTurn } = await import("./turn_resolver.js");
const { initializeDecks } = await import("./deck_state.js");
const aiMod = await import("./ai_decisions.js");
const { createCampaignState } = await import("./campaign_state.js");

const provinces = JSON.parse(fs.readFileSync(new URL("../data/provinces.json", import.meta.url), "utf8"));
const axes = JSON.parse(fs.readFileSync(new URL("../data/axes.json", import.meta.url), "utf8"));
const cardsChina = JSON.parse(fs.readFileSync(new URL("../data/cards_china.json", import.meta.url), "utf8"));
const cardsTaiwan = JSON.parse(fs.readFileSync(new URL("../data/cards_taiwan.json", import.meta.url), "utf8"));
const events = JSON.parse(fs.readFileSync(new URL("../data/events_global.json", import.meta.url), "utf8"));

const camp9 = createCampaignState("taiwan", "normal", "full_21d");
const state9 = createInitialState({ provinces, gameRules: GAME_RULES, axes, cardsChina, cardsTaiwan, events, totalTurnsOverride: camp9.totalTurns });
initializeDecks(state9, cardsChina, cardsTaiwan);
const indices9 = { cardIndex: buildCardIndex(cardsChina, cardsTaiwan), axisIndex: buildAxisIndex(axes), events };
// 미션 모드 X — 일반 게임
const decisions9 = {
  chinaAxis: aiMod.decideChinaAxis(state9, axes),
  taiwanFocus: aiMod.decideTaiwanFocus(state9, axes),
  chinaCards: [], taiwanCards: [], chinaFacedown: [], taiwanFacedown: []
};
decisions9.chinaCards = aiMod.chooseChinaCards(state9, decisions9.chinaAxis, indices9.cardIndex);
decisions9.taiwanCards = aiMod.chooseTaiwanCards(state9, decisions9.chinaAxis, decisions9.taiwanFocus, indices9.cardIndex);
runTurn(state9, decisions9, indices9, camp9);
if (state9.outcome === "mission_complete" || state9.outcome === "mission_failed" || state9.outcome === "mission_timeout") {
  console.error(`FAIL: 미션 모드 아닌데 미션 outcome 발생: ${state9.outcome}`); process.exit(1);
}
console.log(`  ✓ 일반 게임 모드에서 미션 outcome 발생 X (state.outcome=${state9.outcome})`);

// =====================================================================
// #10: 미션 모드 — 시작 직후 first_72h 평가
// =====================================================================
console.log("\n10. 미션 모드 — runTurn 후 미션 evaluate가 일반 outcome 우선");
const camp10 = createCampaignState("taiwan", "normal", "short_72h");
const state10 = createInitialState({ provinces, gameRules: GAME_RULES, axes, cardsChina, cardsTaiwan, events, totalTurnsOverride: camp10.totalTurns });
initializeDecks(state10, cardsChina, cardsTaiwan);
const indices10 = { cardIndex: buildCardIndex(cardsChina, cardsTaiwan), axisIndex: buildAxisIndex(axes), events };
applyMissionToState(state10, MISSIONS.first_72h);
// 첫 턴 — 아직 진척 없음, 미션도 평가 가능
const decisions10 = {
  chinaAxis: aiMod.decideChinaAxis(state10, axes),
  taiwanFocus: aiMod.decideTaiwanFocus(state10, axes),
  chinaCards: [], taiwanCards: [], chinaFacedown: [], taiwanFacedown: []
};
decisions10.chinaCards = aiMod.chooseChinaCards(state10, decisions10.chinaAxis, indices10.cardIndex);
decisions10.taiwanCards = aiMod.chooseTaiwanCards(state10, decisions10.chinaAxis, decisions10.taiwanFocus, indices10.cardIndex);
runTurn(state10, decisions10, indices10, camp10);

// outcome이 있다면 mission_* 가능 (일반 outcome은 첫 턴엔 거의 안 옴)
// 핵심은 state.mission이 살아있고 평가가 작동한다는 점
if (!state10.mission?.id) {
  console.error(`FAIL: 미션이 turnEnd 후 사라짐`); process.exit(1);
}
console.log(`  ✓ 미션 mode 첫 턴 실행 OK (state.mission.id=${state10.mission.id})`);

console.log("\n✓ mission scenarios smoke test passed");
