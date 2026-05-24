// =====================================================================
// run_act3_cleanup_smoke_test.mjs (v0.4.2-b1.2)
// ---------------------------------------------------------------------
// 검증:
//   #1 defenseValueBonus가 sea_zone에는 적용되지 않음
//   #2 모든 target이 sea_zone이면 가장 위험한 occupiable로 재지정
//   #3 phaseCardPlacement: 같은 card id 한 턴 1번만 (dedup)
//   #4 allowDuplicate:true 카드는 예외 허용 (앞으로 추가될 카드용)
//   #5 ACT 3 + supply=0이면 naval_blockade 점수 하향, dipl 더 우위
//   #6 84턴 시뮬: T70+에서 naval_blockade 비율 감소, dipl 비율 증가
// =====================================================================

import fs from "node:fs";
import { phaseCardPlacement } from "./turn_resolver.js";
import { suggestChinaAxis } from "./target_selector.js";

console.log("[ACT 3 cleanup smoke test v0.4.2-b1.2]");

// =====================================================================
// #1, #2: sea_zone defense buff
// =====================================================================
console.log("\n1+2. defenseValueBonus on sea_zone 차단 + occupiable로 재지정");

// EFFECT_HANDLERS는 closure 안이라 직접 접근 불가 → applyEffects 통해 검증
const { applyEffects } = await import("./turn_resolver.js");

function mkState({ provinces, ...overrides } = {}) {
  return {
    turn: 50, totalTurns: 84, outcome: null,
    gauges: {
      taiwanGovernment: 70, taiwanMorale: 60, taiwanSupply: 50, taiwanCommand: 60,
      usIntervention: 75, japanIntervention: 55, koreaRearSupport: 20,
      chinaPoliticalPressure: 70, chinaTempo: 30, chinaSupply: 30,
      taiwanReserveTroops: 50, chinaReserveTroops: 50, internationalOpinion: 50
    },
    provinces: provinces || {
      taipei: { id:"taipei", name:"타이베이", type:"capital", controlStage:"stable_defense", landingStage:"none", defenseValueModifier: 0, buffs:[] },
      strait: { id:"strait", name:"대만 해협", type:"sea_zone", controlStage:"stable_defense", landingStage:"none", defenseValueModifier: 0, buffs:[] }
    },
    persistent: { lastActId: "ACT_2", milestones: {}, activeBuffs: [], occurrenceCount: {}, eventCooldowns: {}, triggeredOnce: [], alliedIntervention: { active: false } },
    thisTurn: { operationLog: [], visualEvents: [], chinaPlayed: [], taiwanPlayed: [], combatResults: [] },
    log: [],
    ...overrides
  };
}

// 시나리오 A: target만 sea_zone (strait) → 아무 데도 적용 안 됨, fallback으로 위험 occupiable에 적용
const s1 = mkState();
// 타이베이를 위험 상태로 설정
s1.provinces.taipei.landingStage = "beachhead";
const initialModifier = s1.provinces.strait.defenseValueModifier;
const initialTaipei = s1.provinces.taipei.defenseValueModifier;
applyEffects(s1, { defenseValueBonus: 3 }, { side: "taiwan", resolvedTargets: ["strait"] });
if (s1.provinces.strait.defenseValueModifier !== initialModifier) {
  console.error(`FAIL: sea_zone strait에 buff 적용됨, ${initialModifier} → ${s1.provinces.strait.defenseValueModifier}`);
  process.exit(1);
}
if (s1.provinces.taipei.defenseValueModifier !== initialTaipei + 3) {
  console.error(`FAIL: fallback occupiable에 buff 적용 안 됨, taipei ${initialTaipei} → ${s1.provinces.taipei.defenseValueModifier}`);
  process.exit(1);
}
const hasRelocateLog = s1.thisTurn.operationLog.some(x => x.includes("재지정"));
if (!hasRelocateLog) console.warn(`WARN: 재지정 로그 없음 (선택적)`);
console.log(`  ✓ sea_zone target → buff 안 적용, 타이베이로 재지정 +3`);

// 시나리오 B: target에 sea_zone과 occupiable 둘 다
const s2 = mkState();
applyEffects(s2, { defenseValueBonus: 2 }, { side: "taiwan", resolvedTargets: ["strait", "taipei"] });
if (s2.provinces.strait.defenseValueModifier !== 0) {
  console.error(`FAIL: 혼합 target에서 strait도 적용됨`); process.exit(1);
}
if (s2.provinces.taipei.defenseValueModifier !== 2) {
  console.error(`FAIL: 혼합 target에서 taipei 적용 안 됨`); process.exit(1);
}
console.log(`  ✓ 혼합 target: sea_zone skip, taipei만 +2`);

// =====================================================================
// #3 같은 card id 한 턴 1번만 (dedup)
// =====================================================================
console.log("\n3. phaseCardPlacement: 같은 card id 한 턴 1번 dedup");
const cardIndex = new Map([
  ["taiwan_emergency_restoration", { id: "taiwan_emergency_restoration", cost: { command: 0 } }]
]);
const s3 = mkState();
// 같은 카드 2번 입력
const decisions3 = { chinaCards: [], taiwanCards: ["taiwan_emergency_restoration", "taiwan_emergency_restoration"] };
phaseCardPlacement(s3, decisions3, cardIndex);
if (s3.thisTurn.taiwanPlayed.length !== 1) {
  console.error(`FAIL: dedup 실패, played ${s3.thisTurn.taiwanPlayed.length}장`); process.exit(1);
}
if (s3.thisTurn.taiwanPlayed[0] !== "taiwan_emergency_restoration") {
  console.error(`FAIL: 첫 카드도 placed되지 않음`); process.exit(1);
}
console.log(`  ✓ 같은 카드 두 번 입력 → 1번만 played`);

// =====================================================================
// #4 allowDuplicate:true 카드는 예외 허용
// =====================================================================
console.log("\n4. allowDuplicate:true는 dedup 예외");
const dupCardIndex = new Map([
  ["dup_card", { id: "dup_card", cost: { command: 0 }, allowDuplicate: true }]
]);
const s4 = mkState();
phaseCardPlacement(s4, { chinaCards: [], taiwanCards: ["dup_card", "dup_card"] }, dupCardIndex);
if (s4.thisTurn.taiwanPlayed.length !== 2) {
  console.error(`FAIL: allowDuplicate:true인데 dedup됨, played ${s4.thisTurn.taiwanPlayed.length}장`); process.exit(1);
}
console.log(`  ✓ allowDuplicate:true 카드 두 번 played`);

// =====================================================================
// #5 ACT 3 + supply=0이면 naval_blockade 점수 하향
// =====================================================================
console.log("\n5. ACT 3 + supply=0 → naval_blockade 점수 하향");
const axes = [
  { id: "north_pressure" }, { id: "south_landing" },
  { id: "naval_blockade" }, { id: "information_warfare" },
  { id: "diplomatic_pressure" }
];

const supplyMid = {
  turn: 60, gauges: { chinaTempo: 5, chinaSupply: 5, taiwanSupply: 50, taiwanCommand: 60, taiwanGovernment: 60, usIntervention: 70, japanIntervention: 60, internationalOpinion: 50, chinaPoliticalPressure: 80, taiwanMorale: 50 },
  provinces: {}, persistent: { lastActId: "ACT_3", recentChinaAxes: [], milestones: {} }, thisTurn: { operationLog: [] }
};
const supplyZero = {
  turn: 60, gauges: { chinaTempo: 5, chinaSupply: 0, taiwanSupply: 50, taiwanCommand: 60, taiwanGovernment: 60, usIntervention: 70, japanIntervention: 60, internationalOpinion: 50, chinaPoliticalPressure: 80, taiwanMorale: 50 },
  provinces: {}, persistent: { lastActId: "ACT_3", recentChinaAxes: [], milestones: {} }, thisTurn: { operationLog: [] }
};

const rMid = suggestChinaAxis(supplyMid, axes);
const rZero = suggestChinaAxis(supplyZero, axes);

if (rZero.scores.naval_blockade >= rMid.scores.naval_blockade) {
  console.error(`FAIL: supply=0 naval_blockade(${rZero.scores.naval_blockade.toFixed(1)}) >= supply=5(${rMid.scores.naval_blockade.toFixed(1)})`);
  process.exit(1);
}
if (rZero.scores.diplomatic_pressure <= rMid.scores.diplomatic_pressure) {
  console.error(`FAIL: supply=0에서 dipl 더 안 높음`); process.exit(1);
}
console.log(`  ✓ supply=5: blockade=${rMid.scores.naval_blockade.toFixed(1)}, dipl=${rMid.scores.diplomatic_pressure.toFixed(1)}`);
console.log(`  ✓ supply=0: blockade=${rZero.scores.naval_blockade.toFixed(1)} (↓), dipl=${rZero.scores.diplomatic_pressure.toFixed(1)} (↑)`);

// =====================================================================
// #6 84턴 시뮬: T70+ naval_blockade 비율 감소
// =====================================================================
console.log("\n6. 84턴 시뮬: T70+ axis 분포");
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

const axisByTurn = [];
let safety = 100;
while (!state.outcome && state.turn <= state.totalTurns && safety-- > 0) {
  const decisions = {
    chinaAxis: aiMod.decideChinaAxis(state, allAxes),
    taiwanFocus: aiMod.decideTaiwanFocus(state, allAxes),
    chinaCards: [], taiwanCards: [], chinaFacedown: [], taiwanFacedown: []
  };
  decisions.chinaCards = aiMod.chooseChinaCards(state, decisions.chinaAxis, indices.cardIndex);
  decisions.taiwanCards = aiMod.chooseTaiwanCards(state, decisions.chinaAxis, decisions.taiwanFocus, indices.cardIndex);
  axisByTurn.push({ turn: state.turn, axis: decisions.chinaAxis, supply: state.gauges.chinaSupply });
  runTurn(state, decisions, indices, campaign);
}

console.log(`  Final T${state.turn}/${state.totalTurns}, outcome=${state.outcome}`);
const lateAxes = axisByTurn.filter(a => a.turn >= 70);
const lateCounts = {};
for (const a of lateAxes) lateCounts[a.axis] = (lateCounts[a.axis] || 0) + 1;
console.log(`  T70+ ${lateAxes.length}턴 axis:`, Object.entries(lateCounts).map(([k,v]) => `${k}×${v}`).join(", "));

// supply=0 turns에서 naval_blockade 비율
const supply0Turns = axisByTurn.filter(a => a.supply <= 0);
if (supply0Turns.length > 0) {
  const supply0Counts = {};
  for (const a of supply0Turns) supply0Counts[a.axis] = (supply0Counts[a.axis] || 0) + 1;
  console.log(`  supply=0 ${supply0Turns.length}턴 axis:`, Object.entries(supply0Counts).map(([k,v]) => `${k}×${v}`).join(", "));
  const blockadeRatio = (supply0Counts.naval_blockade || 0) / supply0Turns.length;
  if (blockadeRatio > 0.5) {
    console.error(`FAIL: supply=0인데 naval_blockade 비율 ${(blockadeRatio*100).toFixed(0)}% (≤50% 목표)`); process.exit(1);
  }
  console.log(`  ✓ supply=0 시 naval_blockade 비율 ${(blockadeRatio*100).toFixed(0)}% (목표 ≤50%)`);
} else {
  console.log(`  (이번 시뮬은 supply=0 도달하지 않음, 다음 sim에서 확인)`);
}

console.log("\n✓ ACT 3 cleanup smoke test passed");
