// =====================================================================
// run_china_exhaustion_v2_smoke_test.mjs (v0.4.2-b1.1)
// ---------------------------------------------------------------------
// 검증: ACT 3 중국 소진 보정 강화 (-20/-16, +5/+6/+8) + hard-exhausted soft-block
//
// #1 ACT 3 + soft-exhausted (tempo≤10 AND supply≤10): best != south_landing
// #2 ACT 3 + soft-exhausted: best == diplomatic_pressure (8 보너스로 1위 보장)
// #3 ACT 3 + hard-exhausted (tempo=0 OR supply=0): south_landing score < 0
// #4 ACT 3 + 자원 충분 (tempo=50, supply=50): 기존 동작 (south_landing 가능)
// #5 ACT 1/2 + 자원 0: 보정 적용 X
// #6 chinaExhaustedAt milestone 멱등성 (한 번만 기록)
// #7 84턴 시뮬: 후반(T55+) south_landing 선택 비율 감소
// =====================================================================

import fs from "node:fs";
import { suggestChinaAxis } from "./target_selector.js";

console.log("[china exhaustion v2 smoke test v0.4.2-b1.1]");

const axes = [
  { id: "north_pressure" }, { id: "south_landing" },
  { id: "naval_blockade" }, { id: "information_warfare" },
  { id: "diplomatic_pressure" }
];

function mkState({ turn = 60, gauges = {}, lastActId = "ACT_3" } = {}) {
  return {
    turn,
    gauges: {
      usIntervention: 80, japanIntervention: 60, koreaRearSupport: 20,
      internationalOpinion: 50, chinaPoliticalPressure: 80,
      chinaTempo: 50, chinaSupply: 50,
      taiwanMorale: 50, taiwanGovernment: 50, taiwanCommand: 50, taiwanSupply: 50,
      ...gauges
    },
    provinces: {},
    persistent: {
      lastActId, recentChinaAxes: [], milestones: {}
    },
    thisTurn: { operationLog: [] }
  };
}

// =====================================================================
// #1, #2: soft-exhausted → best != south_landing AND == diplomatic_pressure
// =====================================================================
console.log("\n1+2. soft-exhausted (tempo=5, supply=5) → diplomatic_pressure 1위");
const soft = mkState({ gauges: { chinaTempo: 5, chinaSupply: 5 } });
const r1 = suggestChinaAxis(soft, axes);
if (r1.axisId === "south_landing") {
  console.error(`FAIL: soft-exhausted인데 best=south_landing`); process.exit(1);
}
if (r1.axisId !== "diplomatic_pressure") {
  console.error(`FAIL: soft-exhausted best가 diplomatic_pressure여야, got ${r1.axisId}`); process.exit(1);
}
const sortedScores = Object.entries(r1.scores).sort((a,b) => b[1] - a[1]);
console.log(`  ✓ best=${r1.axisId}, scores:`, sortedScores.map(([k,v]) => `${k}=${v.toFixed(1)}`).join(", "));

// =====================================================================
// #3: hard-exhausted (tempo=0) → south_landing score < 0
// =====================================================================
console.log("\n3. hard-exhausted (tempo=0) → south_landing score < 0 (soft-block)");
const hardT = mkState({ gauges: { chinaTempo: 0, chinaSupply: 15 } });  // tempo=0만
const r3 = suggestChinaAxis(hardT, axes);
if (r3.scores.south_landing >= 0) {
  console.error(`FAIL: hard-exhausted south_landing score ${r3.scores.south_landing} >= 0`);
  process.exit(1);
}
if (r3.axisId === "south_landing" || r3.axisId === "north_pressure") {
  console.error(`FAIL: hard-exhausted best가 군사 axis, got ${r3.axisId}`); process.exit(1);
}
console.log(`  ✓ tempo=0: south_landing=${r3.scores.south_landing.toFixed(1)} (<0), best=${r3.axisId}`);

// supply=0만
const hardS = mkState({ gauges: { chinaTempo: 15, chinaSupply: 0 } });
const r3b = suggestChinaAxis(hardS, axes);
if (r3b.scores.south_landing >= 0) {
  console.error(`FAIL: supply=0인데 south_landing >= 0`); process.exit(1);
}
console.log(`  ✓ supply=0: south_landing=${r3b.scores.south_landing.toFixed(1)} (<0), best=${r3b.axisId}`);

// =====================================================================
// #4: 자원 충분 → 기존 동작 (south_landing 선택 가능)
// =====================================================================
console.log("\n4. 자원 충분 (tempo=50, supply=50) → 기존 동작 유지");
const full = mkState({ gauges: { chinaTempo: 50, chinaSupply: 50 } });
const r4 = suggestChinaAxis(full, axes);
if (r4.scores.south_landing < 5) {
  console.error(`FAIL: 자원 충분인데 south_landing 점수 너무 낮음 ${r4.scores.south_landing}`); process.exit(1);
}
if (full.persistent.milestones.chinaExhaustedAt) {
  console.error(`FAIL: 자원 충분인데 chinaExhaustedAt 기록됨`); process.exit(1);
}
console.log(`  ✓ tempo=50,supply=50: south_landing=${r4.scores.south_landing.toFixed(1)} (정상), best=${r4.axisId}, milestone 미기록`);

// =====================================================================
// #5: ACT 1/2 + 자원 0 → 보정 적용 X
// =====================================================================
console.log("\n5. ACT 1/2 + 자원 0 → 보정 미적용");
const act1Zero = mkState({ turn: 5, lastActId: "ACT_1", gauges: { chinaTempo: 0, chinaSupply: 0 } });
const r5 = suggestChinaAxis(act1Zero, axes);
if (r5.scores.south_landing < 0) {
  console.error(`FAIL: ACT 1인데 south_landing 페널티 적용됨 (${r5.scores.south_landing})`); process.exit(1);
}
if (act1Zero.persistent.milestones.chinaExhaustedAt) {
  console.error(`FAIL: ACT 1인데 milestone 기록됨`); process.exit(1);
}
console.log(`  ✓ ACT 1 + 자원 0: south_landing=${r5.scores.south_landing.toFixed(1)} (페널티 X)`);

// =====================================================================
// #6: chinaExhaustedAt milestone 멱등성
// =====================================================================
console.log("\n6. chinaExhaustedAt milestone 한 번만 기록");
const idem = mkState({ gauges: { chinaTempo: 5, chinaSupply: 5 } });
suggestChinaAxis(idem, axes);
const firstAt = idem.persistent.milestones.chinaExhaustedAt;
idem.turn = 65;
idem.thisTurn.operationLog = [];
suggestChinaAxis(idem, axes);
if (idem.persistent.milestones.chinaExhaustedAt !== firstAt) {
  console.error(`FAIL: milestone 갱신됨, ${firstAt} → ${idem.persistent.milestones.chinaExhaustedAt}`);
  process.exit(1);
}
const dupLog = idem.thisTurn.operationLog.some(s => s.includes("상륙작전 축소"));
if (dupLog) {
  console.error(`FAIL: '상륙작전 축소' 로그 반복`); process.exit(1);
}
console.log(`  ✓ milestone T${firstAt} 유지, 로그 반복 없음`);

// =====================================================================
// #7: 84턴 시뮬 — T55+ south_landing 선택 비율 감소
// =====================================================================
console.log("\n7. 84턴 시뮬: T55+ south_landing 선택 비율 감소");
const { GAME_RULES } = await import("./game_rules.js");
const { createInitialState, buildCardIndex, buildAxisIndex } = await import("./state.js");
const { runTurn } = await import("./turn_resolver.js");
const { initializeDecks } = await import("./deck_state.js");
const aiMod = await import("./ai_decisions.js");
const { createCampaignState } = await import("./campaign_state.js");

const provinces = JSON.parse(fs.readFileSync(new URL("../data/provinces.json", import.meta.url), "utf8"));
const allAxes = JSON.parse(fs.readFileSync(new URL("../data/axes.json", import.meta.url), "utf8"));
const cardsChina = JSON.parse(fs.readFileSync(new URL("../data/cards_china.json", import.meta.url), "utf8"));
const cardsTaiwan = JSON.parse(fs.readFileSync(new URL("../data/cards_taiwan.json", import.meta.url), "utf8"));
const events = JSON.parse(fs.readFileSync(new URL("../data/events_global.json", import.meta.url), "utf8"));

const campaign = createCampaignState("taiwan", "normal", "full_21d");
const state = createInitialState({
  provinces, gameRules: GAME_RULES, axes: allAxes, cardsChina, cardsTaiwan, events,
  totalTurnsOverride: campaign.totalTurns
});
initializeDecks(state, cardsChina, cardsTaiwan);
const indices = {
  cardIndex: buildCardIndex(cardsChina, cardsTaiwan),
  axisIndex: buildAxisIndex(allAxes), events
};

const axisByTurn = [];  // [{turn, axis, exhausted}]
let safety = 100;
while (!state.outcome && state.turn <= state.totalTurns && safety-- > 0) {
  const decisions = {
    chinaAxis: aiMod.decideChinaAxis(state, allAxes),
    taiwanFocus: aiMod.decideTaiwanFocus(state, allAxes),
    chinaCards: [], taiwanCards: [],
    chinaFacedown: [], taiwanFacedown: []
  };
  decisions.chinaCards = aiMod.chooseChinaCards(state, decisions.chinaAxis, indices.cardIndex);
  decisions.taiwanCards = aiMod.chooseTaiwanCards(state, decisions.chinaAxis, decisions.taiwanFocus, indices.cardIndex);
  const turnBefore = state.turn;
  const exhausted = (state.gauges.chinaTempo <= 10 && state.gauges.chinaSupply <= 10);
  axisByTurn.push({ turn: turnBefore, axis: decisions.chinaAxis, exhausted });
  runTurn(state, decisions, indices, campaign);
}

console.log(`  Final: T${state.turn}/${state.totalTurns}, outcome=${state.outcome}`);

// T55+ axis 분포
const lateAxes = axisByTurn.filter(a => a.turn >= 55);
const lateAxisCounts = {};
for (const a of lateAxes) lateAxisCounts[a.axis] = (lateAxisCounts[a.axis] || 0) + 1;
const lateExhaustedAxes = lateAxes.filter(a => a.exhausted);
const lateExhaustedCounts = {};
for (const a of lateExhaustedAxes) lateExhaustedCounts[a.axis] = (lateExhaustedCounts[a.axis] || 0) + 1;

console.log(`  T55+ 전체 axis (${lateAxes.length}턴):`, Object.entries(lateAxisCounts).map(([k,v]) => `${k}×${v}`).join(", "));
if (lateExhaustedAxes.length > 0) {
  console.log(`  T55+ 소진 상태 axis (${lateExhaustedAxes.length}턴):`, Object.entries(lateExhaustedCounts).map(([k,v]) => `${k}×${v}`).join(", "));
  // 소진 상태에서 south_landing 비율이 30% 이하여야
  const exhaustedSouthRatio = (lateExhaustedCounts.south_landing || 0) / lateExhaustedAxes.length;
  if (exhaustedSouthRatio > 0.3) {
    console.error(`FAIL: 소진 상태인데 south_landing 비율 ${(exhaustedSouthRatio*100).toFixed(0)}% (≤30% 목표)`);
    process.exit(1);
  }
  console.log(`  ✓ 소진 시 south_landing 비율 ${(exhaustedSouthRatio*100).toFixed(0)}% (목표 ≤30%)`);
}

console.log("\n✓ china exhaustion v2 smoke test passed");
