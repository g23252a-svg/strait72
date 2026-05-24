// =====================================================================
// run_act3_cards_smoke_test.mjs (v0.4.2-b2)
// ---------------------------------------------------------------------
// 검증:
//   #1 cards_china.json에 4장, cards_taiwan.json에 4장 신규 ACT 3 카드
//   #2 모든 신규 카드가 actFilter: ["ACT_3"] 보유
//   #3 phaseCardPlacement: ACT 1/2에서 ACT 3 카드 차단
//   #4 phaseCardPlacement: ACT 3에서 ACT 3 카드 허용
//   #5 기존 카드 (actFilter 없음)는 모든 ACT에서 허용 (호환)
//   #6 신규 카드 cost 적절성 (tempo/command 0-1)
//   #7 신규 카드의 effect 키들이 EFFECT_LABELS에 모두 매핑
// =====================================================================

import fs from "node:fs";
import { phaseCardPlacement } from "./turn_resolver.js";
import { EFFECT_LABELS } from "./card_tooltip.js";
import { createCampaignState } from "./campaign_state.js";

console.log("[ACT 3 cards smoke test v0.4.2-b2]");

const cardsChina = JSON.parse(fs.readFileSync(new URL("../data/cards_china.json", import.meta.url), "utf8"));
const cardsTaiwan = JSON.parse(fs.readFileSync(new URL("../data/cards_taiwan.json", import.meta.url), "utf8"));

const expectedChinaAct3 = [
  "china_limited_war_maintenance",
  "china_negotiation_leverage",
  "china_naval_blockade_refit",
  "china_hardliner_mobilization"
];
const expectedTaiwanAct3 = [
  "taiwan_supply_lane_secured",
  "taiwan_beachhead_reduction",
  "taiwan_allied_intel_network",
  "taiwan_wartime_govt_rebuild"
];

// =====================================================================
// #1, #2: 카드 존재 + actFilter
// =====================================================================
console.log("\n1+2. 신규 ACT 3 카드 8장 존재 + actFilter:['ACT_3']");
for (const id of expectedChinaAct3) {
  const c = cardsChina.find(x => x.id === id);
  if (!c) { console.error(`FAIL: ${id} 누락 (china)`); process.exit(1); }
  if (!Array.isArray(c.actFilter) || !c.actFilter.includes("ACT_3")) {
    console.error(`FAIL: ${id} actFilter:['ACT_3'] 없음`); process.exit(1);
  }
  if (c.side !== "china") {
    console.error(`FAIL: ${id} side 'china' 아님`); process.exit(1);
  }
}
for (const id of expectedTaiwanAct3) {
  const c = cardsTaiwan.find(x => x.id === id);
  if (!c) { console.error(`FAIL: ${id} 누락 (taiwan)`); process.exit(1); }
  if (!Array.isArray(c.actFilter) || !c.actFilter.includes("ACT_3")) {
    console.error(`FAIL: ${id} actFilter:['ACT_3'] 없음`); process.exit(1);
  }
  if (c.side !== "taiwan") {
    console.error(`FAIL: ${id} side 'taiwan' 아님`); process.exit(1);
  }
}
console.log(`  ✓ 중국 4장 + 대만 4장 모두 존재, actFilter:["ACT_3"] 보유`);

// 기존 카드는 actFilter 없어야
const oldChina = cardsChina.find(c => c.id === "china_blitz_order");
if (oldChina.actFilter !== undefined) {
  console.error(`FAIL: 기존 카드에 actFilter 들어감 — 호환성 깨짐`); process.exit(1);
}
console.log(`  ✓ 기존 카드는 actFilter 없음 (호환)`);

// =====================================================================
// #3, #4: phaseCardPlacement actFilter 차단
// =====================================================================
console.log("\n3+4. phaseCardPlacement ACT 1/2 차단 + ACT 3 허용");

const cardIndex = new Map();
for (const c of [...cardsChina, ...cardsTaiwan]) cardIndex.set(c.id, c);

function mkState({ turn = 5, lastActId = "ACT_1" } = {}) {
  return {
    outcome: null, turn, totalTurns: 84,
    gauges: {
      chinaTempo: 50, chinaSupply: 50,
      taiwanCommand: 50, taiwanSupply: 50, taiwanGovernment: 50, taiwanMorale: 50,
      taiwanReserveTroops: 50, chinaReserveTroops: 50
    },
    provinces: {},
    persistent: { lastActId, milestones: {}, activeBuffs: [] },
    thisTurn: { operationLog: [], visualEvents: [], chinaPlayed: [], taiwanPlayed: [] },
    log: []
  };
}
const fullCamp = createCampaignState("taiwan", "normal", "full_21d");

// ACT 1: ACT 3 카드 차단
const s1 = mkState({ turn: 5, lastActId: "ACT_1" });
phaseCardPlacement(s1, {
  chinaCards: ["china_limited_war_maintenance"],
  taiwanCards: ["taiwan_supply_lane_secured"]
}, cardIndex, fullCamp);
if (s1.thisTurn.chinaPlayed.length !== 0) {
  console.error(`FAIL: ACT 1에서 ACT 3 china 카드 played, ${s1.thisTurn.chinaPlayed}`); process.exit(1);
}
if (s1.thisTurn.taiwanPlayed.length !== 0) {
  console.error(`FAIL: ACT 1에서 ACT 3 taiwan 카드 played, ${s1.thisTurn.taiwanPlayed}`); process.exit(1);
}
const hasBlockLog = s1.log.some(l => l.msg && l.msg.includes("act-filter blocked"));
if (!hasBlockLog) {
  console.error(`FAIL: act-filter 차단 로그 없음`); process.exit(1);
}
console.log(`  ✓ ACT 1: china/taiwan ACT 3 카드 모두 차단 + 로그 출력`);

// ACT 2: ACT 3 카드 차단
const s2 = mkState({ turn: 25, lastActId: "ACT_2" });
phaseCardPlacement(s2, {
  chinaCards: ["china_hardliner_mobilization"],
  taiwanCards: ["taiwan_wartime_govt_rebuild"]
}, cardIndex, fullCamp);
if (s2.thisTurn.chinaPlayed.length !== 0 || s2.thisTurn.taiwanPlayed.length !== 0) {
  console.error(`FAIL: ACT 2에서 ACT 3 카드 played`); process.exit(1);
}
console.log(`  ✓ ACT 2: ACT 3 카드 차단`);

// ACT 3: ACT 3 카드 허용
const s3 = mkState({ turn: 50, lastActId: "ACT_3" });
phaseCardPlacement(s3, {
  chinaCards: ["china_naval_blockade_refit"],
  taiwanCards: ["taiwan_allied_intel_network"]
}, cardIndex, fullCamp);
if (s3.thisTurn.chinaPlayed.length !== 1) {
  console.error(`FAIL: ACT 3 china 카드 미플레이, ${s3.thisTurn.chinaPlayed}`); process.exit(1);
}
if (s3.thisTurn.taiwanPlayed.length !== 1) {
  console.error(`FAIL: ACT 3 taiwan 카드 미플레이, ${s3.thisTurn.taiwanPlayed}`); process.exit(1);
}
console.log(`  ✓ ACT 3: china/taiwan ACT 3 카드 모두 played`);

// =====================================================================
// #5: 기존 카드는 모든 ACT에서 허용
// =====================================================================
console.log("\n5. 기존 카드 (actFilter 없음) ACT 1/2/3 모두 허용");
for (const actId of ["ACT_1", "ACT_2", "ACT_3"]) {
  const s = mkState({ turn: actId === "ACT_1" ? 5 : actId === "ACT_2" ? 25 : 50, lastActId: actId });
  phaseCardPlacement(s, {
    chinaCards: ["china_blitz_order"],
    taiwanCards: ["taiwan_emergency_restoration"]
  }, cardIndex, fullCamp);
  if (s.thisTurn.chinaPlayed.length === 0 || s.thisTurn.taiwanPlayed.length === 0) {
    console.error(`FAIL: ${actId}에서 기존 카드 차단됨`); process.exit(1);
  }
}
console.log(`  ✓ 기존 카드는 ACT 1/2/3 모두에서 정상 플레이`);

// =====================================================================
// #6: 신규 카드 cost
// =====================================================================
console.log("\n6. 신규 카드 cost 적절성");
const allNew = [...expectedChinaAct3.map(id => cardIndex.get(id)), ...expectedTaiwanAct3.map(id => cardIndex.get(id))];
for (const c of allNew) {
  if (!c.cost || typeof c.cost !== "object") {
    console.error(`FAIL: ${c.id} cost 없음`); process.exit(1);
  }
  const totalCost = Object.values(c.cost).reduce((s, v) => s + (v || 0), 0);
  if (totalCost > 2) {
    console.error(`FAIL: ${c.id} cost ${totalCost} 너무 높음 (≤2)`); process.exit(1);
  }
}
console.log(`  ✓ 8장 모두 cost ≤2 (적절)`);

// =====================================================================
// #7: effect 키 EFFECT_LABELS 매핑
// =====================================================================
console.log("\n7. 신규 카드 effect 키들이 EFFECT_LABELS에 모두 매핑");
const missing = new Set();
function collect(eff) {
  for (const k of Object.keys(eff || {})) {
    if (!EFFECT_LABELS[k]) missing.add(k);
  }
}
for (const c of allNew) {
  collect(c.effects);
  if (c.riskOnFailure) collect(c.riskOnFailure);
  if (c.combos?.bonusEffect) collect(c.combos.bonusEffect);
}
if (missing.size > 0) {
  console.error(`FAIL: EFFECT_LABELS 미정의 키: ${[...missing].join(", ")}`); process.exit(1);
}
console.log(`  ✓ 신규 카드 8장 effect 키 모두 EFFECT_LABELS 매핑됨`);

console.log("\n✓ ACT 3 cards smoke test passed");
