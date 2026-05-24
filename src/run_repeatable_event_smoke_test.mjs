// =====================================================================
// run_repeatable_event_smoke_test.mjs (v0.4.2-b1)
// ---------------------------------------------------------------------
// 검증: ACT 3 repeatable 이벤트 + cooldown 시스템
//
// #1 events_global.json에 6개 repeatable ACT 3 이벤트 존재
// #2 once 이벤트는 여전히 한 번만 발동 (기존 동작 유지)
// #3 repeatable 이벤트는 cooldown 중 재발동 X
// #4 cooldown 경과 후 재발동 O
// #5 ACT 1/2에서는 발동 X (actFilter 작동)
// #6 phaseTurnEnd가 cooldown 감소 (인프라 검증)
// #7 84턴 시뮬에서 ACT 3 후반 (T55+) 이벤트 발생 여부
// =====================================================================

import fs from "node:fs";
import { shouldTriggerEvent, phaseInternationalIntervention, phaseTurnEnd } from "./turn_resolver.js";
import { createCampaignState } from "./campaign_state.js";

console.log("[repeatable event smoke test v0.4.2-b1]");

const events = JSON.parse(fs.readFileSync(new URL("../data/events_global.json", import.meta.url), "utf8"));
const fullCamp = createCampaignState("taiwan", "normal", "full_21d");

function mkState({ turn = 50, persistent = {}, gauges = {} } = {}) {
  return {
    outcome: null, turn, totalTurns: 84,
    gauges: {
      usIntervention: 80, japanIntervention: 65, koreaRearSupport: 20,
      internationalOpinion: 55, chinaPoliticalPressure: 60,
      chinaTempo: 20, chinaSupply: 30,
      taiwanMorale: 55, taiwanGovernment: 60, taiwanCommand: 60, taiwanSupply: 50,
      ...gauges
    },
    provinces: {
      taipei: { id:"taipei", controlStage:"stable_defense" },
      keelung: { id:"keelung", controlStage:"stable_defense" },
      taoyuan: { id:"taoyuan", controlStage:"stable_defense" }
    },
    persistent: {
      lastActId: "ACT_3", occurrenceCount: {}, eventCooldowns: {}, triggeredOnce: [],
      milestones: { act3EnteredAt: 45 },
      alliedIntervention: { active: false },
      activeBuffs: [], weatherEffect: null, recentBattles: [],
      ...persistent
    },
    thisTurn: { triggeredEvents: [], operationLog: [], visualEvents: [], combatResults: [] },
    log: []
  };
}

// =====================================================================
// #1 6개 repeatable 이벤트 존재
// =====================================================================
console.log("\n1. 6개 repeatable ACT 3 이벤트 존재 + cooldown 필드");
const expectedRepeatable = [
  "global_us_carrier_recon_pressure",
  "global_china_limited_blockade_maintained",
  "global_taiwan_resupply_attempt",
  "global_ceasefire_opinion_spread",
  "global_china_hardliner_reignite",
  "global_japan_naval_surveillance_rotation"
];
for (const id of expectedRepeatable) {
  const e = events.find(x => x.id === id);
  if (!e) { console.error(`FAIL: ${id} 누락`); process.exit(1); }
  if (e.type !== "random_recurring") {
    console.error(`FAIL: ${id} type 'random_recurring' 아님, got ${e.type}`); process.exit(1);
  }
  if (!e.triggerWhen.cooldownTurns) {
    console.error(`FAIL: ${id} cooldownTurns 없음`); process.exit(1);
  }
  // once: true 없음 확인
  const hasOnce = e.triggerWhen.once === true
    || (e.triggerWhen.all || []).some(p => p.once === true);
  if (hasOnce) {
    console.error(`FAIL: ${id} once:true 있음 — repeatable 아님`); process.exit(1);
  }
  if (!Array.isArray(e.actFilter) || !e.actFilter.includes("ACT_3")) {
    console.error(`FAIL: ${id} actFilter ACT_3 없음`); process.exit(1);
  }
}
console.log(`  ✓ 6개 모두 random_recurring + cooldown + actFilter:["ACT_3"], once 없음`);

// =====================================================================
// #2 once 이벤트는 여전히 한 번만 (기존 동작 유지)
// =====================================================================
console.log("\n2. once 이벤트 기존 동작 유지");
const onceEvent = events.find(e => e.id === "global_backchannel_ceasefire_mediation");
const s = mkState();
if (!shouldTriggerEvent(s, onceEvent, fullCamp)) {
  console.error(`FAIL: once 이벤트 첫 호출 발동 안 됨`); process.exit(1);
}
// 첫 발동 시뮬
s.persistent.occurrenceCount[onceEvent.id] = 1;
if (shouldTriggerEvent(s, onceEvent, fullCamp)) {
  console.error(`FAIL: once 이벤트 두 번째 발동 (한 번만이어야)`); process.exit(1);
}
console.log(`  ✓ once 이벤트는 첫 호출에만 발동`);

// =====================================================================
// #3 repeatable cooldown 중 재발동 X
// =====================================================================
console.log("\n3. repeatable cooldown 중 재발동 X");
const repEvent = events.find(e => e.id === "global_us_carrier_recon_pressure");
const s3 = mkState();
// probability를 우회하기 위해 직접 cooldown 설정
s3.persistent.eventCooldowns[repEvent.id] = 3;
if (shouldTriggerEvent(s3, repEvent, fullCamp)) {
  console.error(`FAIL: cooldown 3턴 남았는데 발동됨`); process.exit(1);
}
console.log(`  ✓ cooldown 3턴 남음 → 발동 X`);

// =====================================================================
// #4 cooldown 0이 되면 발동 가능 (probability 0.55라 5번 시도)
// =====================================================================
console.log("\n4. cooldown 0 후 재발동 가능 (probability 통계로)");
let triggeredCount = 0;
for (let i = 0; i < 20; i++) {
  const s4 = mkState();
  // cooldown 0 (없음)
  if (shouldTriggerEvent(s4, repEvent, fullCamp)) triggeredCount++;
}
// probability 0.55 → 20번 중 약 11번 발동 예상. 최소 3번 이상은 안정적.
if (triggeredCount < 3) {
  console.error(`FAIL: cooldown 없는데 20번 시도해서 ${triggeredCount}번만 발동`); process.exit(1);
}
console.log(`  ✓ 20번 시도 중 ${triggeredCount}번 발동 (probability 0.55)`);

// =====================================================================
// #5 ACT 1/2에서는 발동 X
// =====================================================================
console.log("\n5. ACT 1/2 게이팅 — repeatable 이벤트도 ACT 3에서만");
const s5 = mkState();
s5.persistent.lastActId = "ACT_1";
let hit = false;
for (let i = 0; i < 30; i++) {
  if (shouldTriggerEvent(s5, repEvent, fullCamp)) { hit = true; break; }
}
if (hit) {
  console.error(`FAIL: ACT 1에서 repeatable ACT 3 이벤트 발동`); process.exit(1);
}
console.log(`  ✓ ACT 1: repeatable 이벤트 30번 시도 모두 차단`);

s5.persistent.lastActId = "ACT_2";
hit = false;
for (let i = 0; i < 30; i++) {
  if (shouldTriggerEvent(s5, repEvent, fullCamp)) { hit = true; break; }
}
if (hit) {
  console.error(`FAIL: ACT 2에서 repeatable ACT 3 이벤트 발동`); process.exit(1);
}
console.log(`  ✓ ACT 2: repeatable 이벤트 30번 시도 모두 차단`);

// =====================================================================
// #6 phaseTurnEnd가 cooldown 감소
// =====================================================================
console.log("\n6. phaseTurnEnd가 매 턴 cooldown 1씩 감소");
const s6 = mkState({ turn: 50 });
s6.persistent.eventCooldowns["test_event"] = 3;
phaseTurnEnd(s6, fullCamp);
if (s6.persistent.eventCooldowns["test_event"] !== 2) {
  console.error(`FAIL: cooldown 1턴 감소 안 됨, ${s6.persistent.eventCooldowns["test_event"]}`); process.exit(1);
}
phaseTurnEnd(s6, fullCamp);
if (s6.persistent.eventCooldowns["test_event"] !== 1) {
  console.error(`FAIL: 2번째 감소 안 됨`); process.exit(1);
}
phaseTurnEnd(s6, fullCamp);
if ("test_event" in s6.persistent.eventCooldowns) {
  console.error(`FAIL: cooldown 0 도달 시 키 삭제 안 됨`); process.exit(1);
}
console.log(`  ✓ 3→2→1→삭제 (3턴 후 cooldown 만료)`);

// =====================================================================
// #7 84턴 시뮬: ACT 3 후반 (T55+)에도 이벤트 발생
// =====================================================================
console.log("\n7. 84턴 시뮬: T55+ ACT 3 후반에도 repeatable 이벤트 발생 여부");
const { GAME_RULES } = await import("./game_rules.js");
const { createInitialState, buildCardIndex, buildAxisIndex } = await import("./state.js");
const { runTurn } = await import("./turn_resolver.js");
const { initializeDecks } = await import("./deck_state.js");
const { decideChinaAxis, decideTaiwanFocus, chooseChinaCards, chooseTaiwanCards } = await import("./ai_decisions.js");

const provinces = JSON.parse(fs.readFileSync(new URL("../data/provinces.json", import.meta.url), "utf8"));
const axes = JSON.parse(fs.readFileSync(new URL("../data/axes.json", import.meta.url), "utf8"));
const cardsChina = JSON.parse(fs.readFileSync(new URL("../data/cards_china.json", import.meta.url), "utf8"));
const cardsTaiwan = JSON.parse(fs.readFileSync(new URL("../data/cards_taiwan.json", import.meta.url), "utf8"));

const campaign = createCampaignState("taiwan", "normal", "full_21d");
const state = createInitialState({
  provinces, gameRules: GAME_RULES, axes, cardsChina, cardsTaiwan, events,
  totalTurnsOverride: campaign.totalTurns
});
initializeDecks(state, cardsChina, cardsTaiwan);
const indices = {
  cardIndex: buildCardIndex(cardsChina, cardsTaiwan),
  axisIndex: buildAxisIndex(axes), events
};

const repeatableIds = new Set(expectedRepeatable);
const eventByTurn = {};  // turn → [{ id, repeatable }]
let safety = 100;
while (!state.outcome && state.turn <= state.totalTurns && safety-- > 0) {
  const beforeTriggered = new Set(state.thisTurn?.triggeredEvents || []);
  const decisions = {
    chinaAxis: decideChinaAxis(state, indices.axisIndex),
    taiwanFocus: decideTaiwanFocus(state, axes),
    chinaCards: [], taiwanCards: [],
    chinaFacedown: [], taiwanFacedown: []
  };
  decisions.chinaCards = chooseChinaCards(state, decisions.chinaAxis, indices.cardIndex);
  decisions.taiwanCards = chooseTaiwanCards(state, decisions.chinaAxis, decisions.taiwanFocus, indices.cardIndex);
  const turnBefore = state.turn;
  runTurn(state, decisions, indices, campaign);
  // 이번 턴 발동 이벤트 (log 기준)
  const recent = state.log.filter(l => l.turn === turnBefore && l.triggeredEvents);
  const triggered = recent.flatMap(l => l.triggeredEvents);
  if (triggered.length > 0) {
    eventByTurn[turnBefore] = triggered.map(id => ({
      id, repeatable: repeatableIds.has(id)
    }));
  }
}

// T45+ 이벤트, T55+ 이벤트
const act3Turns = Object.entries(eventByTurn).filter(([t]) => parseInt(t) >= 45);
const lateAct3 = Object.entries(eventByTurn).filter(([t]) => parseInt(t) >= 55);
const repeatableHits = Object.entries(eventByTurn).flatMap(([t, evs]) =>
  evs.filter(e => e.repeatable).map(e => ({ turn: parseInt(t), id: e.id }))
);

console.log(`  Final: T${state.turn}/${state.totalTurns}, outcome=${state.outcome}`);
console.log(`  ACT 3 (T45+) 이벤트 turns: ${act3Turns.length}`);
console.log(`  ACT 3 후반 (T55+) 이벤트 turns: ${lateAct3.length}`);
console.log(`  Repeatable 이벤트 발동 횟수: ${repeatableHits.length}`);

if (lateAct3.length === 0) {
  console.error(`FAIL: T55+ 후반에 이벤트 0건 — repeatable 이벤트 작동 안 함`);
  process.exit(1);
}
if (repeatableHits.length === 0) {
  console.error(`FAIL: repeatable 이벤트 한 번도 발동 안 함`); process.exit(1);
}
console.log(`  ✓ T55+ 후반 활성, repeatable 이벤트 동작`);

// 같은 이벤트가 두 번 이상 발동했는지 (cooldown 통과 후 재발동)
const idCount = {};
for (const h of repeatableHits) idCount[h.id] = (idCount[h.id] || 0) + 1;
const refired = Object.entries(idCount).filter(([_, c]) => c >= 2);
console.log(`  Repeatable id 별 발동: ${Object.entries(idCount).map(([k,v]) => k.replace("global_","")+"×"+v).join(", ")}`);
if (refired.length > 0) {
  console.log(`  ✓ Cooldown 후 재발동 확인: ${refired.length}개 이벤트 2회+`);
}

console.log("\n✓ repeatable event smoke test passed");
