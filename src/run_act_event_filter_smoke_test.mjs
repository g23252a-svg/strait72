// =====================================================================
// run_act_event_filter_smoke_test.mjs (v0.4.2-a)
// ---------------------------------------------------------------------
// ACT별 이벤트 게이팅 검증.
//
// 검증:
//   #1 actFilter 없는 이벤트는 모든 ACT에서 발동 (기존 동작 유지)
//   #2 actFilter ["ACT_3"] 이벤트는 ACT 1/2에서 발동 X
//   #3 actFilter ["ACT_3"] 이벤트는 ACT 3에서 조건 만족 시 발동 O
//   #4 once 중복 처리 유지 (한 번 발동 후 다시 X)
//   #5 campaign 없이 (short_72h 가정) 호출해도 안전
//   #6 events_global.json에 7개 ACT 3 이벤트 실제 존재
// =====================================================================

import fs from "node:fs";
import { shouldTriggerEvent, phaseInternationalIntervention } from "./turn_resolver.js";
import { createCampaignState } from "./campaign_state.js";

console.log("[ACT event filter smoke test v0.4.2-a]");

function mkState({ turn = 1, gauges = {}, persistent = {}, lastActId = null } = {}) {
  return {
    turn,
    gauges: {
      usIntervention: 95, japanIntervention: 75, koreaRearSupport: 25,
      internationalOpinion: 55, chinaPoliticalPressure: 75,
      chinaTempo: 15, chinaSupply: 25,
      taiwanMorale: 60, taiwanGovernment: 70, taiwanCommand: 65, taiwanSupply: 35,
      ...gauges
    },
    persistent: {
      lastActId: lastActId, occurrenceCount: {}, eventCooldowns: {}, triggeredOnce: [],
      milestones: {}, alliedIntervention: { active: false }, ...persistent
    },
    thisTurn: { triggeredEvents: [], operationLog: [], visualEvents: [] },
    log: []
  };
}

const events = JSON.parse(fs.readFileSync(new URL("../data/events_global.json", import.meta.url), "utf8"));
const fullCamp = createCampaignState("taiwan", "normal", "full_21d");

// =====================================================================
// #6 events_global.json에 ACT 3 신규 7개 존재
// =====================================================================
console.log("\n1. ACT 3 신규 이벤트 7개 존재 확인");
const expectedAct3 = [
  "global_backchannel_ceasefire_mediation",
  "global_china_hardliner_pushback",
  "global_us_carrier_pressure_maneuver",
  "global_japan_maritime_surveillance",
  "global_taiwan_counterattack_prep",
  "global_supply_lines_reopened",
  "global_china_supply_chain_fracture"
];
for (const id of expectedAct3) {
  const e = events.find(x => x.id === id);
  if (!e) {
    console.error(`FAIL: ACT 3 이벤트 누락: ${id}`); process.exit(1);
  }
  if (!Array.isArray(e.actFilter) || !e.actFilter.includes("ACT_3")) {
    console.error(`FAIL: ${id}에 actFilter:["ACT_3"] 없음`); process.exit(1);
  }
}
console.log(`  ✓ ACT 3 신규 7개 모두 존재, 모두 actFilter:["ACT_3"]`);

// 기존 이벤트는 actFilter 없음
const oldEvent = events.find(e => e.id === "global_us_carrier_movement");
if (oldEvent.actFilter !== undefined) {
  console.error(`FAIL: 기존 이벤트에 actFilter 들어감 — 호환성 깨짐`); process.exit(1);
}
console.log(`  ✓ 기존 이벤트는 actFilter 없음 (기존 호환)`);

// =====================================================================
// #1 actFilter 없는 이벤트는 모든 ACT에서 발동 가능
// =====================================================================
console.log("\n2. actFilter 없는 이벤트 — 모든 ACT에서 발동 가능");
// global_us_carrier_movement: triggerWhen us≥35 once
const carrierEvent = events.find(e => e.id === "global_us_carrier_movement");
for (const lastActId of ["ACT_1", "ACT_2", "ACT_3"]) {
  const s = mkState({ turn: 10, gauges: { usIntervention: 50 }, lastActId });
  if (!shouldTriggerEvent(s, carrierEvent, fullCamp)) {
    console.error(`FAIL: actFilter 없는데 ${lastActId}에서 발동 안 됨`); process.exit(1);
  }
}
console.log(`  ✓ global_us_carrier_movement: ACT 1/2/3 모두에서 발동 가능`);

// =====================================================================
// #2 actFilter ["ACT_3"] 이벤트는 ACT 1/2에서 발동 X
// =====================================================================
console.log("\n3. ACT 3 전용 이벤트 — ACT 1/2에서 발동 차단");
const ceasefire = events.find(e => e.id === "global_backchannel_ceasefire_mediation");
// 조건: chinaPP≥60, us≥80, once → 위 state는 만족. 그래도 ACT 1/2면 차단되어야
const act1State = mkState({ turn: 5, lastActId: "ACT_1" });
if (shouldTriggerEvent(act1State, ceasefire, fullCamp)) {
  console.error(`FAIL: ACT 1에서 ceasefire_mediation 발동 (차단되어야)`); process.exit(1);
}
const act2State = mkState({ turn: 20, lastActId: "ACT_2" });
if (shouldTriggerEvent(act2State, ceasefire, fullCamp)) {
  console.error(`FAIL: ACT 2에서 ceasefire_mediation 발동 (차단되어야)`); process.exit(1);
}
console.log(`  ✓ ACT 1/2 모두에서 ceasefire_mediation 차단`);

// =====================================================================
// #3 actFilter ["ACT_3"] 이벤트는 ACT 3에서 조건 만족 시 발동
// =====================================================================
console.log("\n4. ACT 3 전용 이벤트 — ACT 3에서 조건 만족 시 발동");
const act3State = mkState({ turn: 50, lastActId: "ACT_3" });
if (!shouldTriggerEvent(act3State, ceasefire, fullCamp)) {
  console.error(`FAIL: ACT 3에서 조건 만족인데 ceasefire_mediation 발동 안 됨`);
  process.exit(1);
}
console.log(`  ✓ ACT 3 + 조건 만족: ceasefire_mediation 발동 O`);

// 조건 미달 시 — 발동 X (actFilter 통과해도 triggerWhen 평가됨)
const act3LowState = mkState({ turn: 50, lastActId: "ACT_3", gauges: { usIntervention: 50 } });
if (shouldTriggerEvent(act3LowState, ceasefire, fullCamp)) {
  console.error(`FAIL: ACT 3인데 us=50으로 조건 미달 → 발동되면 안 됨`); process.exit(1);
}
console.log(`  ✓ ACT 3이지만 조건 미달 → 발동 X`);

// =====================================================================
// #4 once 중복 처리 — 한 번 발동 후 다시 안 됨
// =====================================================================
console.log("\n5. once 중복 처리 — ACT 3 이벤트도 한 번만");
const onceState = mkState({ turn: 50, lastActId: "ACT_3" });
// 첫 호출
if (!shouldTriggerEvent(onceState, ceasefire, fullCamp)) {
  console.error(`FAIL: 첫 호출에 발동 안 됨`); process.exit(1);
}
// 발동 후 occurrence 기록 시뮬
onceState.persistent.occurrenceCount[ceasefire.id] = 1;
// 두 번째 호출 — once라 차단
if (shouldTriggerEvent(onceState, ceasefire, fullCamp)) {
  console.error(`FAIL: 두 번째 호출에 또 발동 (once 위반)`); process.exit(1);
}
console.log(`  ✓ once 차단 작동`);

// =====================================================================
// #5 campaign 없이 호출도 안전 (호환)
// =====================================================================
console.log("\n6. campaign null 호환 — turn 기반 ACT 추론 fallback");
const stateAct1NoLast = mkState({ turn: 5 }); // lastActId 없음
const stateAct3NoLast = mkState({ turn: 60 });
// campaign null → ACT 추론은 turn 기반 (1-12=ACT1, 13-44=ACT2, 45+=ACT3)
if (shouldTriggerEvent(stateAct1NoLast, ceasefire, null)) {
  console.error(`FAIL: campaign null + T5 → ACT 1 추론 → ACT 3 이벤트 차단되어야`);
  process.exit(1);
}
if (!shouldTriggerEvent(stateAct3NoLast, ceasefire, null)) {
  console.error(`FAIL: campaign null + T60 → ACT 3 추론 → 발동되어야`);
  process.exit(1);
}
console.log(`  ✓ campaign null T5 → ACT 1 추론 차단, T60 → ACT 3 추론 발동`);

// =====================================================================
// #7 phaseInternationalIntervention 통합 — campaign 전달 후 ACT 게이팅 작동
// =====================================================================
console.log("\n7. phaseInternationalIntervention 통합 — ACT 1에서 ACT 3 이벤트 전체 차단");
const integState = mkState({ turn: 5, lastActId: "ACT_1" });
phaseInternationalIntervention(integState, events, "start_of_turn", fullCamp);
const triggered = integState.thisTurn.triggeredEvents;
// ACT 3 전용 이벤트 7개는 하나도 발동되면 안 됨
const act3Triggered = triggered.filter(id => expectedAct3.includes(id));
if (act3Triggered.length > 0) {
  console.error(`FAIL: ACT 1에서 ACT 3 이벤트 발동: ${act3Triggered.join(",")}`); process.exit(1);
}
console.log(`  ✓ ACT 1에서 ACT 3 이벤트 발동 0건`);

// ACT 3에서는 발동 가능 (조건 만족하는 이벤트 한정, v0.4.2-a.1: 캡으로 1~2개)
const integAct3 = mkState({ turn: 60, lastActId: "ACT_3" });
phaseInternationalIntervention(integAct3, events, "start_of_turn", fullCamp);
const triggeredAct3 = integAct3.thisTurn.triggeredEvents;
const act3Hits = triggeredAct3.filter(id => expectedAct3.includes(id));
if (act3Hits.length === 0) {
  console.error(`FAIL: ACT 3 + 만족 조건인데 ACT 3 이벤트 0건 발동`); process.exit(1);
}
// v0.4.2-a.1: ACT 전용 이벤트는 턴당 최대 1개
if (act3Hits.length > 1) {
  console.error(`FAIL: ACT 3 이벤트 ${act3Hits.length}건 발동 — 캡 1개 위반`); process.exit(1);
}
// 전체 이벤트는 턴당 최대 2개
if (triggeredAct3.length > 2) {
  console.error(`FAIL: 전체 이벤트 ${triggeredAct3.length}건 발동 — 캡 2개 위반`); process.exit(1);
}
console.log(`  ✓ ACT 3 이벤트 캡 작동: ACT3 전용 ${act3Hits.length}건 (≤1), 전체 ${triggeredAct3.length}건 (≤2)`);

// =====================================================================
// #8 actFilter 잘못된 값 — 안전 동작 (event는 발동 X)
// =====================================================================
console.log("\n8. actFilter ['ACT_99'] 같은 미정의 값 — 발동 X (안전 fallback)");
const badEvent = { ...ceasefire, actFilter: ["ACT_99"] };
const stateAct3 = mkState({ turn: 50, lastActId: "ACT_3" });
if (shouldTriggerEvent(stateAct3, badEvent, fullCamp)) {
  console.error(`FAIL: actFilter['ACT_99']인데 발동됨`); process.exit(1);
}
console.log(`  ✓ 모르는 ACT id면 발동 X`);

console.log("\n✓ ACT event filter smoke test passed");
