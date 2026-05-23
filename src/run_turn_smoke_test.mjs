// =====================================================================
// 스모크 테스트: 5턴 시뮬레이션
// =====================================================================
// 목적:
//   - turn_resolver가 7단계를 끝까지 돌리는지 확인
//   - 게이지가 정상 갱신되는지
//   - 이벤트가 임계값에서 트리거되는지
//   - 카운터플레이가 발동하는지
// =====================================================================

import fs from "node:fs";
import { createInitialState, buildCardIndex, buildAxisIndex } from "./state.js";
import { initializeDecks } from "./deck_state.js";
import { runTurn, checkVictoryConditions } from "./turn_resolver.js";
import { GAME_RULES, formatGameTime, formatTurnCounter, chinaHoursRemaining } from "./game_rules.js";

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

// 시드 (확률 이벤트 재현용 - 매번 다른 결과 보고 싶으면 주석 처리)
let seed = 42;
const origRandom = Math.random;
Math.random = () => {
  seed = (seed * 9301 + 49297) % 233280;
  return seed / 233280;
};

// 시나리오: 중국이 북부 압박으로 시작, 대만이 방어/외교로 버티는 5턴
const scenario = [
  // T1: 중국 북부 압박, 대만 방어 강화
  {
    chinaAxis: "north_pressure",
    chinaCards: ["china_north_assault", "china_naval_blockade_intensify"],
    taiwanCards: ["taiwan_north_defense_buildup", "taiwan_international_appeal"]
  },
  // T2: 중국 정보전, 대만 백업망 (카운터플레이 발동 예상)
  {
    chinaAxis: "information_warfare",
    chinaCards: ["china_cyber_attack", "china_missile_pressure"],
    taiwanCards: ["taiwan_backup_network", "taiwan_president_speech"]
  },
  // T3: 중국 속전속결 + 남부 상륙
  {
    chinaAxis: "south_landing",
    chinaCards: ["china_blitz_order", "china_south_landing_prep"],
    taiwanCards: ["taiwan_port_defense_buildup", "taiwan_emergency_restoration"]
  },
  // T4: 중국 외교 압박, 대만 분산 지휘
  {
    chinaAxis: "diplomatic_pressure",
    chinaCards: ["china_diplomatic_pivot", "china_supply_line_extension"],
    taiwanCards: ["taiwan_distributed_command", "taiwan_mobile_reserve_deploy"]
  },
  // T5: 중국 해상 봉쇄, 대만 정보전
  {
    chinaAxis: "naval_blockade",
    chinaCards: ["china_night_operation"],
    taiwanCards: ["taiwan_coastal_surveillance", "taiwan_false_defense_setup"]
  }
];

function printSnapshot(state, label) {
  const g = state.gauges;
  console.log(`\n=== ${label} | ${formatTurnCounter(state.turn)} | ${formatGameTime(state.turn)} | 중국 남은 ${chinaHoursRemaining(state.turn)}h ===`);
  console.log(
    `  국제: 미국 ${g.usIntervention.toString().padStart(3)} | 일본 ${g.japanIntervention.toString().padStart(3)} | 한국 ${g.koreaRearSupport.toString().padStart(3)} | 여론 ${g.internationalOpinion.toString().padStart(3)}`
  );
  console.log(
    `  중국: 정치압박 ${g.chinaPoliticalPressure.toString().padStart(3)} | 작전템포 ${g.chinaTempo.toString().padStart(3)} | 보급 ${g.chinaSupply.toString().padStart(3)}`
  );
  console.log(
    `  대만: 사기 ${g.taiwanMorale.toString().padStart(3)} | 정부 ${g.taiwanGovernment.toString().padStart(3)} | 지휘 ${g.taiwanCommand.toString().padStart(3)} | 보급 ${g.taiwanSupply.toString().padStart(3)}`
  );
  const provinceStates = Object.values(state.provinces)
    .filter((p) => p.landingStage !== "none")
    .map((p) => `${p.name}=${p.landingStage}/${p.controlStage}`);
  if (provinceStates.length) {
    console.log(`  지역: ${provinceStates.join(", ")}`);
  }
}

printSnapshot(state, "초기 상태");

for (let i = 0; i < scenario.length; i++) {
  const decisions = scenario[i];
  console.log(`\n>>> T${state.turn} 결정: 중국 축=${decisions.chinaAxis} | 카드 ${decisions.chinaCards.length}+${decisions.taiwanCards.length}장`);
  runTurn(state, decisions, indices);

  // 마지막 턴에 발동된 이벤트 표시
  const lastOps = state.log[state.log.length - 2]?.operations || [];
  if (lastOps.length) {
    for (const op of lastOps) console.log(`     ${op}`);
  }
  const triggered = state.log.filter((l) => l.triggeredEvents?.length).flatMap((l) => l.triggeredEvents);
  if (triggered.length) {
    const recentTriggered = triggered.slice(-3);
    if (recentTriggered.length) console.log(`     >> 이벤트: ${recentTriggered.join(", ")}`);
  }

  printSnapshot(state, `T${state.turn - 1} 종료 후`);

  if (state.outcome) {
    console.log(`\n!!! 게임 종료: ${state.outcome} !!!`);
    break;
  }
}

console.log(`\n=== 최종 ===`);
console.log(`승부: ${state.outcome || "계속 진행 가능"}`);
console.log(`발동된 이벤트: ${state.persistent.triggeredOnce.join(", ") || "없음"}`);
console.log(`총 로그 엔트리: ${state.log.length}`);

// 무결성 확인
const issues = [];
for (const [k, v] of Object.entries(state.gauges)) {
  if (typeof v !== "number") issues.push(`gauge ${k} not number: ${v}`);
  if (v < 0) issues.push(`gauge ${k} negative: ${v}`);
}
if (issues.length) {
  console.error("\nISSUES:", issues.join("\n"));
  process.exit(1);
}
console.log("\nturn_resolver smoke test passed");

// =====================================================================
// v0.4.0-c2-b3-2: nightOpDefenseDebuff는 야간 작전 카드에만 적용
// =====================================================================
console.log("\n[c2-b3-2 nightOpDefenseDebuff 적용 범위]");

import { applyEffects } from "./turn_resolver.js";

// case A: 보상 없는 상태, 야간 작전 카드 효과 적용 → defenseDebuff = +2 (카드 기본)
const stA = { thisTurn: { defenseDebuff: 0, operationLog: [] }, persistent: { rewards: [] }, log: [], turn: 1 };
applyEffects(stA, { taiwanDefenseValueDebuff: 2 }, { side: "china", source: { id: "china_night_operation", name: "야간 작전" } });
if (stA.thisTurn.defenseDebuff !== 2) {
  console.error(`FAIL: 보상 없음 야간 작전 — debuff ${stA.thisTurn.defenseDebuff}, expected 2`); process.exit(1);
}
console.log(`  ✓ 보상 없음 + 야간 작전: defenseDebuff = ${stA.thisTurn.defenseDebuff} (카드 기본 +2만)`);

// case B: 보상 있는 상태, 야간 작전 카드 효과 → +2 카드 + +1 보상 = 3
const stB = { thisTurn: { defenseDebuff: 0, operationLog: [] }, persistent: { rewards: [
  { id: "cn_night_op_efficiency", name: "야간 작전 효율화", applyTiming: "persistent", effects: { nightOpDefenseDebuff: 1 } }
] }, log: [], turn: 1 };
applyEffects(stB, { taiwanDefenseValueDebuff: 2 }, { side: "china", source: { id: "china_night_operation", name: "야간 작전" } });
if (stB.thisTurn.defenseDebuff !== 3) {
  console.error(`FAIL: 보상 + 야간 작전 — debuff ${stB.thisTurn.defenseDebuff}, expected 3`); process.exit(1);
}
console.log(`  ✓ 보상 + 야간 작전: defenseDebuff = ${stB.thisTurn.defenseDebuff} (카드 +2 + 영구 +1)`);
// operation log에 영구 보상 적용 메시지
if (!stB.thisTurn.operationLog.some(l => l.includes("야간 작전 효율화"))) {
  console.error(`FAIL: 영구 보상 적용 로그 누락. log: ${stB.thisTurn.operationLog.join("|")}`); process.exit(1);
}
console.log(`  ✓ operationLog: ${stB.thisTurn.operationLog[0]}`);

// case C: 보상 있는 상태인데 *다른 카드*의 같은 효과 → 보상 미적용
const stC = { thisTurn: { defenseDebuff: 0, operationLog: [] }, persistent: { rewards: [
  { id: "cn_night_op_efficiency", name: "야간 작전 효율화", applyTiming: "persistent", effects: { nightOpDefenseDebuff: 1 } }
] }, log: [], turn: 1 };
// 다른 가상의 카드가 같은 키를 쓴다고 가정
applyEffects(stC, { taiwanDefenseValueDebuff: 2 }, { side: "china", source: { id: "china_other_card", name: "다른 카드" } });
if (stC.thisTurn.defenseDebuff !== 2) {
  console.error(`FAIL: 다른 카드는 영구 보상 미적용이어야. debuff ${stC.thisTurn.defenseDebuff}, expected 2`); process.exit(1);
}
console.log(`  ✓ 다른 카드 + 보상 있음: defenseDebuff = ${stC.thisTurn.defenseDebuff} (보상 미적용)`);

// case D: source 없는 효과 (예: 이벤트 직접 적용) → 보상 미적용
const stD = { thisTurn: { defenseDebuff: 0, operationLog: [] }, persistent: { rewards: [
  { id: "cn_night_op_efficiency", name: "야간 작전 효율화", applyTiming: "persistent", effects: { nightOpDefenseDebuff: 1 } }
] }, log: [], turn: 1 };
applyEffects(stD, { taiwanDefenseValueDebuff: 2 }, { side: "global" });
if (stD.thisTurn.defenseDebuff !== 2) {
  console.error(`FAIL: source 없으면 보상 미적용이어야. debuff ${stD.thisTurn.defenseDebuff}`); process.exit(1);
}
console.log(`  ✓ source 없음 + 보상 있음: defenseDebuff = ${stD.thisTurn.defenseDebuff} (보상 미적용)`);

console.log("✓ c2-b3-2 nightOpDefenseDebuff 검증 통과");

Math.random = origRandom;
