// =====================================================================
// 전투/작전 판정 스모크 테스트
// =====================================================================
// 목적:
//   - combat_resolver가 turn_resolver에 연결됐는지 확인
//   - 성공/실패 판정이 모두 발생하는지 확인
//   - riskOnFailure가 실제로 chinaPoliticalPressure에 반영되는지 확인
// =====================================================================

import fs from "node:fs";
import { createInitialState, buildCardIndex, buildAxisIndex } from "./state.js";
import { initializeDecks } from "./deck_state.js";
import { runTurn } from "./turn_resolver.js";
import { GAME_RULES } from "./game_rules.js";

const dataDir = new URL("../data/", import.meta.url);
const provinces = JSON.parse(fs.readFileSync(new URL("provinces.json", dataDir), "utf8"));
const axes = JSON.parse(fs.readFileSync(new URL("axes.json", dataDir), "utf8"));
const cardsChina = JSON.parse(fs.readFileSync(new URL("cards_china.json", dataDir), "utf8"));
const cardsTaiwan = JSON.parse(fs.readFileSync(new URL("cards_taiwan.json", dataDir), "utf8"));
const events = JSON.parse(fs.readFileSync(new URL("events_global.json", dataDir), "utf8"));

const cardIndex = buildCardIndex(cardsChina, cardsTaiwan);
const axisIndex = buildAxisIndex(axes);
const indices = { cardIndex, axisIndex, events };

const state = createInitialState({
  provinces, gameRules: GAME_RULES, axes, cardsChina, cardsTaiwan, events
});
initializeDecks(state, cardsChina, cardsTaiwan);

// 재현 가능한 2d6 판정
let seed = 42;
const originalRandom = Math.random;
Math.random = () => {
  seed = (seed * 9301 + 49297) % 233280;
  return seed / 233280;
};

const scenario = [
  {
    chinaAxis: "north_pressure",
    chinaCards: ["china_north_assault", "china_naval_blockade_intensify"],
    taiwanCards: ["taiwan_north_defense_buildup", "taiwan_international_appeal"],
    taiwanFocus: "north"
  },
  {
    chinaAxis: "information_warfare",
    chinaCards: ["china_cyber_attack", "china_missile_pressure"],
    taiwanCards: ["taiwan_backup_network", "taiwan_president_speech"]
  },
  {
    chinaAxis: "south_landing",
    chinaCards: ["china_blitz_order", "china_south_landing_prep"],
    taiwanCards: ["taiwan_port_defense_buildup", "taiwan_emergency_restoration"],
    taiwanFocus: "port"
  },
  {
    chinaAxis: "diplomatic_pressure",
    chinaCards: ["china_diplomatic_pivot", "china_supply_line_extension"],
    taiwanCards: ["taiwan_distributed_command", "taiwan_mobile_reserve_deploy"],
    selectedProvince: "kaohsiung"
  },
  {
    chinaAxis: "naval_blockade",
    chinaCards: ["china_night_operation"],
    taiwanCards: ["taiwan_coastal_surveillance"],
    selectedProvince: "keelung"
  }
];

let combatCount = 0;
let successCount = 0;
let failureCount = 0;

for (const decisions of scenario) {
  runTurn(state, decisions, indices);
  const op = state.log.findLast((entry) => entry.name === "operation_resolution");
  const results = op?.combatResults || [];
  combatCount += results.length;
  successCount += results.filter((r) => r.success).length;
  failureCount += results.filter((r) => !r.success).length;
}

// balance_patch_05 이후 기본 시나리오는 전부 성공할 수도 있으므로,
// 실패/riskOnFailure 경로는 별도 고방어·저자원 probe로 강제 검증한다.
if (failureCount < 1) {
  const failureProbe = createInitialState({
    provinces, gameRules: GAME_RULES, axes, cardsChina, cardsTaiwan, events
  });
  initializeDecks(failureProbe, cardsChina, cardsTaiwan);
  failureProbe.gauges.chinaTempo = 20;
  failureProbe.gauges.chinaSupply = 20;
  failureProbe.provinces.keelung.defenseValueModifier = 12;
  runTurn(failureProbe, {
    chinaAxis: "north_pressure",
    chinaCards: ["china_north_assault"],
    taiwanCards: ["taiwan_north_defense_buildup"],
    taiwanFocus: "north",
    selectedProvince: "keelung"
  }, indices);
  const op = failureProbe.log.findLast((entry) => entry.name === "operation_resolution");
  const results = op?.combatResults || [];
  combatCount += results.length;
  successCount += results.filter((r) => r.success).length;
  failureCount += results.filter((r) => !r.success).length;
}

const issues = [];
if (combatCount < 5) issues.push(`expected combatCount >= 5, got ${combatCount}`);
if (successCount < 1) issues.push(`expected at least one success, got ${successCount}`);
if (failureCount < 1) issues.push(`expected at least one failure, got ${failureCount}`);
if (state.gauges.chinaPoliticalPressure <= 0) {
  issues.push(`expected chinaPoliticalPressure > 0, got ${state.gauges.chinaPoliticalPressure}`);
}

const activeLanding = Object.values(state.provinces)
  .filter((p) => p.landingStage !== "none")
  .map((p) => `${p.id}:${p.landingStage}`);

if (activeLanding.length < 1) {
  issues.push("expected at least one active landing province");
}

console.log("combat smoke summary");
console.log(`combat=${combatCount} success=${successCount} failure=${failureCount}`);
console.log(`chinaPoliticalPressure=${state.gauges.chinaPoliticalPressure}`);
console.log(`activeLanding=${activeLanding.join(", ") || "none"}`);

if (issues.length) {
  console.error("combat smoke failed");
  for (const issue of issues) console.error(`- ${issue}`);
  Math.random = originalRandom;
  process.exit(1);
}

console.log("combat_resolver smoke test passed");
Math.random = originalRandom;

// =====================================================================
// v0.4.0-c2-b2.1: 전투 로그 breakdown 검증
// 영구 방어 보상이 있는 상태에서 resolveCombatOperation 결과의
// defenseRewardBonus 및 formatCombatLog 출력이 정확한지
// =====================================================================
import { resolveCombatOperation, formatCombatLog } from "./combat_resolver.js";

console.log("\n[c2-b2.1 전투 로그 breakdown 검증]");
const bdState = createInitialState({ provinces, gameRules: GAME_RULES, axes, cardsChina, cardsTaiwan, events });
// 항만 방어 공사: 지룽/가오슝 +1
bdState.persistent.rewards = [{
  id: "tw_port_fortification",
  name: "항만 방어 공사",
  applyTiming: "persistent",
  effects: { defenseValueBonus: { regions: ["keelung", "kaohsiung"], amount: 1 } }
}];

// 가오슝 공격 (deterministic)
let _seed = 99;
const fixedRng = () => { _seed = (_seed * 1664525 + 1013904223) >>> 0; return (_seed >>> 0) / 0x100000000; };
const result = resolveCombatOperation(bdState, {
  source: { id: "south_landing_prep", name: "남부 상륙 준비", type: "attack", preferredAxis: "south_landing" },
  axis: { id: "south_landing", name: "남부 상륙" },
  targetId: "kaohsiung",
  randomFn: fixedRng
});

if (!result.defenseRewardBonus) {
  console.error(`FAIL: result.defenseRewardBonus null`); process.exit(1);
}
if (result.defenseRewardBonus.total !== 1) {
  console.error(`FAIL: 가오슝 영구 방어 보너스 total ${result.defenseRewardBonus.total}, expected 1`); process.exit(1);
}
if (result.defenseRewardBonus.contributors[0].rewardName !== "항만 방어 공사") {
  console.error(`FAIL: contributor 이름 부정확`); process.exit(1);
}
console.log(`  ✓ resolveCombatOperation result.defenseRewardBonus: total=1, contributors=[항만 방어 공사]`);

const log = formatCombatLog(result);
if (!log.includes("영구 방어 +1: 항만 방어 공사")) {
  console.error(`FAIL: formatCombatLog에 breakdown 없음. 출력: ${log}`); process.exit(1);
}
console.log(`  ✓ formatCombatLog: ${log}`);

// 보상 없는 지역 (타이베이)에서는 defenseRewardBonus null
const result2 = resolveCombatOperation(bdState, {
  source: { id: "north_pressure", name: "북부 압박", type: "attack" },
  targetId: "taipei",
  randomFn: fixedRng
});
if (result2.defenseRewardBonus !== null) {
  console.error(`FAIL: 보상 영향 없는 지역에서 defenseRewardBonus null이어야`); process.exit(1);
}
const log2 = formatCombatLog(result2);
if (log2.includes("영구 방어")) {
  console.error(`FAIL: 영향 없는 지역 로그에 breakdown 노출됨: ${log2}`); process.exit(1);
}
console.log(`  ✓ 타이베이 (영향 없음): breakdown 미표시`);

// =====================================================================
// v0.4.0-c2-b3-1: rangedAttackBonus는 source.type === "ranged"에만 적용
// =====================================================================
console.log("\n[c2-b3-1 rangedAttackBonus 적용 범위 검증]");
const rangedState = createInitialState({ provinces, gameRules: GAME_RULES, axes, cardsChina, cardsTaiwan, events });
rangedState.persistent.rewards = [{
  id: "cn_missile_range_extend",
  name: "미사일 사거리 연장",
  applyTiming: "persistent",
  effects: { rangedAttackBonus: 1 }
}];

let _seedR = 200;
const rangedRng = () => { _seedR = (_seedR * 1664525 + 1013904223) >>> 0; return (_seedR >>> 0) / 0x100000000; };

// (1) ranged 카드 — 보너스 +1 적용
const rangedResult = resolveCombatOperation(rangedState, {
  source: { id: "china_missile_pressure", name: "미사일 압박", type: "ranged" },
  targetId: null,
  randomFn: rangedRng
});
if (!rangedResult.attackRewardBonus || rangedResult.attackRewardBonus.total !== 1) {
  console.error(`FAIL: ranged source attackRewardBonus 미적용. got ${JSON.stringify(rangedResult.attackRewardBonus)}`);
  process.exit(1);
}
const rangedLog = formatCombatLog(rangedResult);
if (!rangedLog.includes("영구 공격 +1: 미사일 사거리 연장")) {
  console.error(`FAIL: ranged formatCombatLog에 breakdown 없음: ${rangedLog}`); process.exit(1);
}
console.log(`  ✓ ranged 카드 +1 적용 + 로그: ${rangedLog}`);

// (2) attack 카드 — 보너스 미적용
const attackResult = resolveCombatOperation(rangedState, {
  source: { id: "south_landing_prep", name: "남부 상륙 준비", type: "attack", preferredAxis: "south_landing" },
  axis: { id: "south_landing", name: "남부 상륙" },
  targetId: "kaohsiung",
  randomFn: rangedRng
});
if (attackResult.attackRewardBonus !== null) {
  console.error(`FAIL: attack source인데 attackRewardBonus 적용됨. got ${JSON.stringify(attackResult.attackRewardBonus)}`);
  process.exit(1);
}
const attackLog = formatCombatLog(attackResult);
if (attackLog.includes("영구 공격")) {
  console.error(`FAIL: attack source 로그에 공격 보상 노출됨: ${attackLog}`); process.exit(1);
}
console.log(`  ✓ attack 카드는 미적용 (breakdown 미표시)`);

// (3) 주공축 자체 판정 (source.type 없음) — 보너스 미적용
const axisResult = resolveCombatOperation(rangedState, {
  source: null,
  axis: { id: "naval_blockade", name: "해상 봉쇄" },
  targetId: null,
  randomFn: rangedRng
});
if (axisResult.attackRewardBonus !== null) {
  console.error(`FAIL: 주공축 자체 판정에 attackRewardBonus 적용됨`); process.exit(1);
}
console.log(`  ✓ 주공축 자체 판정은 미적용`);

// (4) 보상 없는 상태에서 ranged 카드 — null (정상 fallback)
const noRewardState = createInitialState({ provinces, gameRules: GAME_RULES, axes, cardsChina, cardsTaiwan, events });
const noRewardRanged = resolveCombatOperation(noRewardState, {
  source: { id: "china_missile_pressure", name: "미사일 압박", type: "ranged" },
  targetId: null,
  randomFn: rangedRng
});
if (noRewardRanged.attackRewardBonus !== null) {
  console.error(`FAIL: 보상 없는데 attackRewardBonus null 아님`); process.exit(1);
}
console.log(`  ✓ 보상 없는 상태에서 ranged 카드: breakdown null`);

console.log("✓ c2-b3-1 rangedAttackBonus 검증 통과");

console.log("✓ c2-b2.1 combat breakdown 검증 통과");
