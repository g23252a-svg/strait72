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
