// v0.4.0-c1 reward_system smoke test
import fs from "node:fs";
import { createInitialState, buildCardIndex, buildAxisIndex } from "./state.js";
import { initializeDecks } from "./deck_state.js";
import { runTurn } from "./turn_resolver.js";
import { GAME_RULES } from "./game_rules.js";
import { buildDayReport } from "./day_cycle.js";
import {
  rewardPoolForSide,
  drawRewards,
  applyReward,
  describeRewardApplication
} from "./reward_system.js";

const dataDir = new URL("../data/", import.meta.url);
const provinces = JSON.parse(fs.readFileSync(new URL("provinces.json", dataDir), "utf8"));
const axes = JSON.parse(fs.readFileSync(new URL("axes.json", dataDir), "utf8"));
const cc = JSON.parse(fs.readFileSync(new URL("cards_china.json", dataDir), "utf8"));
const ct = JSON.parse(fs.readFileSync(new URL("cards_taiwan.json", dataDir), "utf8"));
const events = JSON.parse(fs.readFileSync(new URL("events_global.json", dataDir), "utf8"));
const rewardsFile = JSON.parse(fs.readFileSync(new URL("rewards.json", dataDir), "utf8"));
const rewards = rewardsFile.rewards;

// 1. 데이터 구조 검증
console.log(`총 보상 수: ${rewards.length}`);
if (rewards.length !== 24) { console.error("FAIL: expected 24 rewards"); process.exit(1); }
const taiwanAll = rewards.filter(r => r.side === "taiwan");
const chinaAll = rewards.filter(r => r.side === "china");
if (taiwanAll.length !== 12 || chinaAll.length !== 12) {
  console.error("FAIL: expected 12 each side"); process.exit(1);
}
console.log(`  대만 ${taiwanAll.length}개, 중국 ${chinaAll.length}개 ✓`);

// 2. c1 풀 검증 (각 진영 instant 6개) + c2-a 풀 확장
const tw_c1 = rewardPoolForSide(rewards, "taiwan", { onlyC1: true });
const cn_c1 = rewardPoolForSide(rewards, "china", { onlyC1: true });
console.log(`c1 only 풀: 대만 ${tw_c1.length}개, 중국 ${cn_c1.length}개`);
if (tw_c1.length !== 6 || cn_c1.length !== 6) {
  console.error("FAIL: c1 풀이 6개씩 아님"); process.exit(1);
}
for (const r of [...tw_c1, ...cn_c1]) {
  if (r.applyTiming !== "instant") {
    console.error(`FAIL: c1 풀에 non-instant: ${r.id}`); process.exit(1);
  }
}
console.log("  c1 풀 전부 instant ✓");

// v0.4.0-c2-a: c2-a 풀 = c1 6개 + add_card 2개씩 = 8개 (c2-b1/b2 미포함)
const tw_c2a = rewardPoolForSide(rewards, "taiwan", { includeC2b1: false, includeC2b2: false });
const cn_c2a = rewardPoolForSide(rewards, "china", { includeC2b1: false, includeC2b2: false });
console.log(`c2-a 풀 (c2-b1/b2 미포함): 대만 ${tw_c2a.length}개, 중국 ${cn_c2a.length}개`);
if (tw_c2a.length !== 8 || cn_c2a.length !== 8) {
  console.error("FAIL: c2-a 풀이 8개씩 아님"); process.exit(1);
}
const addCardCount = [...tw_c2a, ...cn_c2a].filter(r => r.applyTiming === "add_card").length;
if (addCardCount !== 4) {
  console.error(`FAIL: add_card 4개 아님, got ${addCardCount}`); process.exit(1);
}
console.log("  c2-a 풀에 add_card 4개 포함 ✓");

// v0.4.0-c2-b1: c2-b1 풀 = c1 6 + c2a 2 + perTurnGain 1씩 = 9개 (c2-b2 미포함)
const tw_c2b1 = rewardPoolForSide(rewards, "taiwan", { includeC2b2: false });
const cn_c2b1 = rewardPoolForSide(rewards, "china", { includeC2b2: false });
console.log(`c2-b1 풀 (c2-b2 미포함): 대만 ${tw_c2b1.length}개, 중국 ${cn_c2b1.length}개`);
if (tw_c2b1.length !== 9 || cn_c2b1.length !== 9) {
  console.error(`FAIL: c2-b1 풀 9개씩 아님 (대만 ${tw_c2b1.length}, 중국 ${cn_c2b1.length})`); process.exit(1);
}
const perTurnCount = [...tw_c2b1, ...cn_c2b1].filter(r => r.effects?.perTurnGain).length;
if (perTurnCount !== 2) {
  console.error(`FAIL: perTurnGain 2개 아님, got ${perTurnCount}`); process.exit(1);
}
console.log("  c2-b1 풀에 perTurnGain 2개 포함 ✓");

// 3. 가중치 추첨 - 시드별 RNG 주입
let rngSeed = 12345;
function seededRng() {
  rngSeed = (rngSeed * 1664525 + 1013904223) >>> 0;
  return (rngSeed >>> 0) / 0x100000000;
}

const state = createInitialState({ provinces, gameRules: GAME_RULES, axes, cardsChina: cc, cardsTaiwan: ct, events });
initializeDecks(state, cc, ct);
const indices = { cardIndex: buildCardIndex(cc, ct), axisIndex: buildAxisIndex(axes), events };

// 4턴 진행 (DAY 1)
for (let i = 0; i < 4; i++) {
  runTurn(state, {
    chinaAxis: "south_landing",
    taiwanFocus: "kaohsiung",
    selectedProvince: "kaohsiung",
    chinaCards: [], taiwanCards: []
  }, indices);
}
const dayReport = buildDayReport(state, 1, events);

// 4. 대만 보상 3개 추첨
const drawnTw = drawRewards(rewards, "taiwan", state, dayReport, 3, seededRng);
console.log(`\n[대만 추첨 결과]`);
for (const r of drawnTw) console.log(`  - ${r.name} (${r.category})`);
if (drawnTw.length !== 3) { console.error("FAIL: not 3"); process.exit(1); }
// 중복 없음 확인
const ids = drawnTw.map(r => r.id);
if (new Set(ids).size !== 3) { console.error("FAIL: 중복 발생"); process.exit(1); }
console.log("  ✓ 3개 중복 없이 추첨");

// 5. 가중치 영향 검증 - 보급 매우 낮은 가상 상황 → 보급 보상 자주 뽑혀야
const lowSupplyState = JSON.parse(JSON.stringify(state));
lowSupplyState.gauges.taiwanSupply = 30; // very low
const supplyCounts = { tw_emergency_supply: 0, total: 0 };
for (let trial = 0; trial < 200; trial++) {
  const draws = drawRewards(rewards, "taiwan", lowSupplyState, dayReport, 3, seededRng);
  for (const r of draws) {
    if (r.id === "tw_emergency_supply") supplyCounts.tw_emergency_supply++;
  }
  supplyCounts.total += draws.length;
}
const supplyPickRate = supplyCounts.tw_emergency_supply / 200; // 0~1 (3장 중 1장이 supply인 비율)
console.log(`\n저보급 상황 (supply=30) → 긴급 보급 투입 보상 추첨 빈도: ${(supplyPickRate * 100).toFixed(1)}% / 200판`);
if (supplyPickRate < 0.4) {
  console.warn(`  ⚠ 가중치 영향 약함 (40% 이하): ${(supplyPickRate * 100).toFixed(1)}%`);
} else {
  console.log("  ✓ 가중치 영향 정상 (40% 이상 추첨)");
}

// 6. 보상 적용 (instant) — c1.1: clamp 즉시 적용
const beforeGov = state.gauges.taiwanGovernment;
const govReward = rewards.find(r => r.id === "tw_government_emergency_restore");
const result = applyReward(state, govReward);
const afterGov = state.gauges.taiwanGovernment;
console.log(`\n[정부 비상복구 적용]`);
console.log(`  taiwanGovernment: ${beforeGov} → ${afterGov} (delta ${afterGov - beforeGov})`);
console.log(`  describe: ${describeRewardApplication(govReward, result)}`);
if (afterGov > 100) {
  console.error(`FAIL: c1.1 clamp 안 됨, 정부 ${afterGov} (100 초과)`); process.exit(1);
}
if (beforeGov === 100 && afterGov !== 100) {
  console.error(`FAIL: 정부 100에서 +8인데 ${afterGov}`); process.exit(1);
}
if (beforeGov < 92 && (afterGov - beforeGov !== 8)) {
  console.error(`FAIL: 정부 ${beforeGov}에서 +8인데 delta=${afterGov - beforeGov}`); process.exit(1);
}
console.log("  ✓ instant 적용 + clamp 정확");

// 6.5. 명시적 100 clamp 검증
const clampTestState = { gauges: { taiwanGovernment: 95, taiwanMorale: 100 }, persistent: {}, log: [], turn: 1 };
const tw_unity = rewards.find(r => r.id === "tw_national_unity_campaign"); // morale +10
applyReward(clampTestState, tw_unity);
if (clampTestState.gauges.taiwanMorale !== 100) {
  console.error(`FAIL: morale 100에서 +10인데 ${clampTestState.gauges.taiwanMorale}`); process.exit(1);
}
console.log(`  ✓ morale 100 → +10 → ${clampTestState.gauges.taiwanMorale} (clamp 즉시 적용)`);

// 음수 clamp 검증 (정치압박 -8, 현재 5에서 -8 = -3 → 0)
const cn_polTestState = { gauges: { chinaPoliticalPressure: 5 }, persistent: {}, log: [], turn: 1 };
const cn_pol = rewards.find(r => r.id === "cn_political_control"); // chinaPoliticalPressure -8
applyReward(cn_polTestState, cn_pol);
if (cn_polTestState.gauges.chinaPoliticalPressure !== 0) {
  console.error(`FAIL: 정치압박 5 - 8 인데 ${cn_polTestState.gauges.chinaPoliticalPressure} (0이어야)`); process.exit(1);
}
console.log(`  ✓ chinaPoliticalPressure 5 → -8 → ${cn_polTestState.gauges.chinaPoliticalPressure} (음수 clamp)`);

// 7. persistent 등록 동작 (c2 처리는 미적용이지만 등록은 되어야)
const persistentReward = rewards.find(r => r.id === "tw_port_fortification");
const r2 = applyReward(state, persistentReward);
const registered = state.persistent.rewards.find(r => r.id === "tw_port_fortification");
if (!registered) { console.error("FAIL: persistent 등록 안됨"); process.exit(1); }
console.log("\n  ✓ persistent 보상은 state.persistent.rewards에 등록만 (c2에서 실제 효과)");

// 8. add_card는 덱 맨 위 삽입 확인
const cardReward = rewards.find(r => r.id === "tw_card_emergency_restoration");
const deckTopBefore = state.decks.taiwan.deck[0];
applyReward(state, cardReward);
const deckTopAfter = state.decks.taiwan.deck[0];
if (deckTopAfter !== "taiwan_emergency_restoration") {
  console.error(`FAIL: 덱 맨 위 카드 아님. got ${deckTopAfter}`); process.exit(1);
}
console.log(`  ✓ add_card 덱 맨 위 삽입: ${deckTopBefore} → ${deckTopAfter}`);

// 9. v0.4.0-c2-b1: perTurnGain 실제 동작
import { applyPerTurnPersistentEffects } from "./reward_system.js";
const pturnState = {
  gauges: { chinaSupply: 50, usIntervention: 30, japanIntervention: 20 },
  persistent: { rewards: [] },
  log: [], turn: 1
};
// 두 가지 perTurnGain 등록
const tw_humanitarian = rewards.find(r => r.id === "tw_humanitarian_campaign");
const cn_supply_hub = rewards.find(r => r.id === "cn_supply_hub_expand");
applyReward(pturnState, tw_humanitarian);
applyReward(pturnState, cn_supply_hub);
if (pturnState.persistent.rewards.length !== 2) {
  console.error(`FAIL: 등록 안 됨, ${pturnState.persistent.rewards.length}`); process.exit(1);
}
console.log(`\n[c2-b1 perTurnGain 매턴 동작 검증]`);
console.log(`등록된 보상: ${pturnState.persistent.rewards.length}개`);
// 첫 턴 적용
let applied = applyPerTurnPersistentEffects(pturnState);
console.log(`  턴 1 적용:`);
for (const a of applied) console.log(`    - ${a.rewardName}: ${JSON.stringify(a.details)}`);
const usAfter1 = pturnState.gauges.usIntervention;
const cnSupAfter1 = pturnState.gauges.chinaSupply;
if (usAfter1 !== 32 || pturnState.gauges.japanIntervention !== 21) {
  console.error(`FAIL: 대만 perTurnGain 잘못 적용. us=${usAfter1}, japan=${pturnState.gauges.japanIntervention}`); process.exit(1);
}
if (cnSupAfter1 !== 52) {
  console.error(`FAIL: 중국 perTurnGain 잘못 적용. supply=${cnSupAfter1}`); process.exit(1);
}
console.log(`    us 30→${usAfter1}, japan 20→${pturnState.gauges.japanIntervention}, chinaSupply 50→${cnSupAfter1} ✓`);
// 두 번째 턴 적용 (누적)
applied = applyPerTurnPersistentEffects(pturnState);
if (pturnState.gauges.usIntervention !== 34) {
  console.error(`FAIL: 누적 적용 안 됨, us=${pturnState.gauges.usIntervention}`); process.exit(1);
}
console.log(`  턴 2 적용 후: us=${pturnState.gauges.usIntervention} (누적 ✓)`);

// 10. clamp - usIntervention 99인데 +2면 100 clamp
pturnState.gauges.usIntervention = 99;
applyPerTurnPersistentEffects(pturnState);
if (pturnState.gauges.usIntervention !== 100) {
  console.error(`FAIL: clamp 안 됨, us=${pturnState.gauges.usIntervention}`); process.exit(1);
}
console.log(`  ✓ usIntervention 99 + 2 → 100 (clamp)`);

// 11. v0.4.0-c2-b2: defenseValueBonus 계산 + 캡 검증
console.log(`\n[c2-b2 defenseValueBonus 검증]`);
import { computePersistentDefenseBonus } from "./reward_system.js";

// 풀 확장 확인 (대만 c2-b2 = c1 6 + c2a 2 + c2b1 1 + c2b2 2 = 11)
const tw_c2b2 = rewardPoolForSide(rewards, "taiwan");
const cn_c2b2 = rewardPoolForSide(rewards, "china");
console.log(`c2-b2 풀: 대만 ${tw_c2b2.length}개, 중국 ${cn_c2b2.length}개`);
if (tw_c2b2.length !== 11) {
  console.error(`FAIL: 대만 c2-b2 풀 11개 아님, got ${tw_c2b2.length}`); process.exit(1);
}
if (cn_c2b2.length !== 9) {
  console.error(`FAIL: 중국 c2-b2 풀 9개 아님 (중국은 b2 활성화 X), got ${cn_c2b2.length}`); process.exit(1);
}
console.log(`  ✓ 대만 11개 (defenseValueBonus 2개 추가), 중국 9개 (b2 미활성)`);

// v0.4.0-c2-b2.1: 항만 방어 공사는 지룽/가오슝 (타이난 X)
const defTestState = { gauges: {}, persistent: { rewards: [], provinces: {} }, log: [], turn: 1 };
defTestState.provinces = { kaohsiung: { name: "가오슝" }, keelung: { name: "지룽" }, tainan: { name: "타이난" }, taipei: { name: "타이베이" }, taoyuan: { name: "타오위안" } };
const port = rewards.find(r => r.id === "tw_port_fortification");
// 데이터 정합성: 지역이 keelung, kaohsiung인지
const portRegions = port.effects?.defenseValueBonus?.regions || [];
if (!portRegions.includes("keelung") || !portRegions.includes("kaohsiung")) {
  console.error(`FAIL: c2-b2.1 항만 방어 대상이 keelung,kaohsiung 아님: ${portRegions.join(",")}`); process.exit(1);
}
if (portRegions.includes("tainan")) {
  console.error(`FAIL: c2-b2.1 항만 방어에서 tainan 제거 안 됨`); process.exit(1);
}
console.log(`  ✓ 항만 방어 대상 지역: ${portRegions.join(", ")} (지룽/가오슝)`);

const portApply = applyReward(defTestState, port);
const portDescribe = describeRewardApplication(port, portApply, defTestState);
if (!portDescribe.includes("보상 활성화") || !portDescribe.includes("방어력 +1")) {
  console.error(`FAIL: defenseValueBonus 활성화 로그 부정확: ${portDescribe}`); process.exit(1);
}
// v0.4.0-c2-b2.1: 한글 지역명 사용 검증
if (!portDescribe.includes("지룽") || !portDescribe.includes("가오슝")) {
  console.error(`FAIL: 보상 활성화 로그가 한글 지역명 사용 안 함: ${portDescribe}`); process.exit(1);
}
console.log(`  ✓ 보상 활성화 로그: ${portDescribe}`);

const kaohsiungBonus = computePersistentDefenseBonus(defTestState, "kaohsiung");
const keelungBonus = computePersistentDefenseBonus(defTestState, "keelung");
const tainanBonus = computePersistentDefenseBonus(defTestState, "tainan");
const taipeiBonus = computePersistentDefenseBonus(defTestState, "taipei");
if (kaohsiungBonus !== 1) { console.error(`FAIL: 가오슝 bonus ${kaohsiungBonus}, expected 1`); process.exit(1); }
if (keelungBonus !== 1) { console.error(`FAIL: 지룽 bonus ${keelungBonus}, expected 1`); process.exit(1); }
if (tainanBonus !== 0) { console.error(`FAIL: 타이난 bonus ${tainanBonus}, expected 0`); process.exit(1); }
if (taipeiBonus !== 0) { console.error(`FAIL: 타이베이 bonus ${taipeiBonus}, expected 0`); process.exit(1); }
console.log(`  ✓ 항만 방어: 가오슝 +1, 지룽 +1, 타이난 +0, 타이베이 +0 (지역 제한 ✓)`);

// 북부 진지 강화 추가: 타이베이 +1, 그리고 지룽은 +2 (항만+북부 둘 다 영향)
const north = rewards.find(r => r.id === "tw_north_defense_dig_in");
applyReward(defTestState, north);
const taipeiAfter = computePersistentDefenseBonus(defTestState, "taipei");
const keelungAfter = computePersistentDefenseBonus(defTestState, "keelung");
const kaohsiungAfter = computePersistentDefenseBonus(defTestState, "kaohsiung");
if (taipeiAfter !== 1) { console.error(`FAIL: 타이베이 +1 (북부 진지) 아님, got ${taipeiAfter}`); process.exit(1); }
if (keelungAfter !== 2) { console.error(`FAIL: 지룽 +2 (항만+북부 캡) 아님, got ${keelungAfter}`); process.exit(1); }
if (kaohsiungAfter !== 1) { console.error(`FAIL: 가오슝 변동되면 안 됨, got ${kaohsiungAfter}`); process.exit(1); }
console.log(`  ✓ 북부 진지: 타이베이 +1, 지룽 +2 (항만+북부 누적, 캡 발동), 가오슝 +1 변동 없음`);

// +2 캡 검증 — amount: 5인 가짜 보상으로도 1로 캡되는지
const capTestState = {
  gauges: {}, persistent: { rewards: [
    { id: "fake_huge", applyTiming: "persistent", effects: { defenseValueBonus: { regions: ["taipei"], amount: 5 } } },
    { id: "fake_huge2", applyTiming: "persistent", effects: { defenseValueBonus: { regions: ["taipei"], amount: 5 } } },
    { id: "fake_huge3", applyTiming: "persistent", effects: { defenseValueBonus: { regions: ["taipei"], amount: 5 } } }
  ] }, log: [], turn: 1
};
const capBonus = computePersistentDefenseBonus(capTestState, "taipei");
if (capBonus !== 2) {
  console.error(`FAIL: +2 캡 안 걸림, got ${capBonus}`); process.exit(1);
}
console.log(`  ✓ amount=5 보상 3개 동일 지역에 있어도 캡 +2 (실제 ${capBonus})`);

// 빈 state는 0
const emptyBonus = computePersistentDefenseBonus({ persistent: {} }, "taipei");
if (emptyBonus !== 0) { console.error(`FAIL: empty bonus ${emptyBonus}`); process.exit(1); }
console.log(`  ✓ persistent 보상 없을 때 0`);

// 11. v0.4.0-c2-b1.1: persistent 중복 방지
console.log(`\n[c2-b1.1 persistent 중복 방지]`);
// pturnState에 인도주의/보급거점이 이미 등록됨. 다시 추첨하면 인도주의 빠져야 함.
const taiwanDraws = drawRewards(rewards, "taiwan", pturnState, dayReport, 9, seededRng);
const hasDuplicateTw = taiwanDraws.some(r => r.id === "tw_humanitarian_campaign");
if (hasDuplicateTw) {
  console.error(`FAIL: 인도주의 캠페인이 이미 받았는데 다시 추첨됨`); process.exit(1);
}
console.log(`  ✓ 인도주의 캠페인 (이미 보유) → 추첨 풀에서 제외 (9개 중)`);

const chinaDraws = drawRewards(rewards, "china", pturnState, dayReport, 9, seededRng);
const hasDuplicateCn = chinaDraws.some(r => r.id === "cn_supply_hub_expand");
if (hasDuplicateCn) {
  console.error(`FAIL: 보급 거점 확대가 이미 받았는데 다시 추첨됨`); process.exit(1);
}
console.log(`  ✓ 보급 거점 확대 (이미 보유) → 추첨 풀에서 제외`);

// 12. instant는 중복 가능 검증
// 가오슝 손실 시뮬레이션해서 정부 비상복구 같은 instant를 받았다고 가정
const instantTestState = {
  gauges: { taiwanGovernment: 80 },
  persistent: { rewards: [
    { id: "tw_government_emergency_restore", applyTiming: "instant", side: "taiwan" }
  ] },
  log: [], turn: 1
};
const instantPool = rewardPoolForSide(rewards, "taiwan", {}, instantTestState);
const stillHasGovReward = instantPool.some(r => r.id === "tw_government_emergency_restore");
if (!stillHasGovReward) {
  console.error(`FAIL: instant 보상이 중복 차단됨 (instant는 중복 허용해야)`); process.exit(1);
}
console.log(`  ✓ instant 보상 (정부 비상복구)은 한 번 받아도 풀에 남음 (중복 가능)`);

// 13. add_card도 중복 가능
const cardTestState = {
  gauges: {},
  persistent: { rewards: [
    { id: "tw_card_emergency_restoration", applyTiming: "add_card", side: "taiwan" }
  ] },
  log: [], turn: 1
};
const cardPool = rewardPoolForSide(rewards, "taiwan", {}, cardTestState);
const stillHasCardReward = cardPool.some(r => r.id === "tw_card_emergency_restoration");
if (!stillHasCardReward) {
  console.error(`FAIL: add_card 보상이 중복 차단됨 (add_card는 중복 허용해야)`); process.exit(1);
}
console.log(`  ✓ add_card 보상 (긴급 복구 카드)은 한 번 받아도 풀에 남음 (중복 가능)`);

// =====================================================================
// v0.4.0-c2-z-lite.1: 효용 점수 / 시뮬 선택 자동 검증
// =====================================================================
console.log(`\n[c2-z-lite.1 효용 점수 검증]`);
import { scoreRewardUtility, chooseRewardForSim } from "./reward_system.js";

// 1. scoreDefenseValueBonus: capitalPressureTurns 상황에서 북부 보상 threat가 평시보다 높음
const northReward = rewards.find(r => r.id === "tw_north_defense_dig_in"); // taipei/keelung/taoyuan
const peaceState = {
  gauges: {}, persistent: { rewards: [], capitalPressureTurns: 0 },
  provinces: { taipei: { name: "타이베이" }, keelung: { name: "지룽" }, taoyuan: { name: "타오위안" } },
  turn: 8, log: []
};
const pressureState = {
  gauges: {}, persistent: { rewards: [], capitalPressureTurns: 2 },
  provinces: { taipei: { name: "타이베이" }, keelung: { name: "지룽" }, taoyuan: { name: "타오위안" } },
  turn: 8, log: []
};
const emptyDayReport = { occupationChanges: [], majorBattles: [], events: [] };
const peaceScore = scoreRewardUtility(northReward, peaceState, emptyDayReport, "taiwan", 2);
const pressureScore = scoreRewardUtility(northReward, pressureState, emptyDayReport, "taiwan", 2);
console.log(`  평시 북부 진지 점수: ${peaceScore.toFixed(2)}`);
console.log(`  수도권 압박 시 점수: ${pressureScore.toFixed(2)}`);
if (pressureScore <= peaceScore) {
  console.error(`FAIL: capitalPressureTurns 상황 점수가 평시보다 높지 않음 (분기 순서 버그?)`); process.exit(1);
}
console.log(`  ✓ 수도권 압박 시 점수 ↑ (분기 순서 정상)`);

// 2. chooseRewardForSim: 동점이면 후보 순서 유지
const equalReward1 = { id: "fake_a", name: "A", applyTiming: "instant", effects: {} };
const equalReward2 = { id: "fake_b", name: "B", applyTiming: "instant", effects: {} };
const tieState = { gauges: {}, persistent: { rewards: [] }, turn: 1, log: [] };
const tieResult = chooseRewardForSim([equalReward1, equalReward2], tieState, emptyDayReport, "taiwan", 1);
if (tieResult.reward.id !== "fake_a") {
  console.error(`FAIL: 동점 시 첫 번째 후보 안 뽑음, got ${tieResult.reward.id}`); process.exit(1);
}
console.log(`  ✓ 동점 시 candidates 순서 유지 (fake_a 선택)`);

// 3. 같은 입력 두 번 호출 → 같은 결과 (deterministic)
const tieR1 = chooseRewardForSim([equalReward1, equalReward2], tieState, emptyDayReport, "taiwan", 1);
const tieR2 = chooseRewardForSim([equalReward1, equalReward2], tieState, emptyDayReport, "taiwan", 1);
if (tieR1.reward.id !== tieR2.reward.id || tieR1.score !== tieR2.score) {
  console.error(`FAIL: 같은 입력 두 번 결과 다름`); process.exit(1);
}
console.log(`  ✓ deterministic`);

// 4. 효용 점수 차별화 — instant 회복 점수가 부족도에 따라 달라짐
const supply = rewards.find(r => r.id === "tw_emergency_supply"); // taiwanSupply +12
const utilLowSupply = { gauges: { taiwanSupply: 20 }, persistent: { rewards: [] }, turn: 1, log: [] };
const utilHighSupply = { gauges: { taiwanSupply: 95 }, persistent: { rewards: [] }, turn: 1, log: [] };
const lowScore = scoreRewardUtility(supply, utilLowSupply, emptyDayReport, "taiwan", 1);
const highScore = scoreRewardUtility(supply, utilHighSupply, emptyDayReport, "taiwan", 1);
console.log(`  보급 20에서 점수: ${lowScore.toFixed(2)} / 보급 95에서 점수: ${highScore.toFixed(2)}`);
if (lowScore <= highScore) {
  console.error(`FAIL: 부족도 가중 안 됨 (low ≤ high)`); process.exit(1);
}
console.log(`  ✓ instant 부족도 가중 정상`);

console.log("\n✓ reward_system smoke test passed");
