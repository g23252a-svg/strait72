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

// =====================================================================
// v0.4.0-c2-b3-3a: taiwanSupplyDamage가 reduction 적용되는지
// =====================================================================
console.log("\n[c2-b3-3a taiwanSupplyDamage reduction]");

// case A: 보상 없는 상태 — 피해 그대로
const supA = { gauges: { taiwanSupply: 80 }, thisTurn: { defenseDebuff: 0, operationLog: [] }, persistent: { rewards: [] }, log: [], turn: 1 };
applyEffects(supA, { taiwanSupplyDamage: 10 }, { side: "china" });
if (supA.gauges.taiwanSupply !== 70) {
  console.error(`FAIL: 보상 없음 supply 70 아님, got ${supA.gauges.taiwanSupply}`); process.exit(1);
}
if (supA.thisTurn.operationLog.some(l => l.includes("보급선 우회"))) {
  console.error(`FAIL: 보상 없는데 보급선 우회 로그 발생`); process.exit(1);
}
console.log(`  ✓ 보상 없음: supply 80 → 70 (피해 10 그대로), 로그 없음`);

// case B: reduction 0.3 보상 — 피해 10 → ceil(10*0.7) = 7
const supB = { gauges: { taiwanSupply: 80 }, thisTurn: { defenseDebuff: 0, operationLog: [] }, persistent: { rewards: [
  { id: "tw_supply_rerouting", name: "보급선 우회", applyTiming: "persistent", effects: { taiwanSupplyDamageReduction: 0.3 } }
] }, log: [], turn: 1 };
applyEffects(supB, { taiwanSupplyDamage: 10 }, { side: "china" });
if (supB.gauges.taiwanSupply !== 73) {
  console.error(`FAIL: reduction 0.3에서 supply 73 아님, got ${supB.gauges.taiwanSupply}`); process.exit(1);
}
if (!supB.thisTurn.operationLog.some(l => l.includes("보급선 우회: 대만 보급 피해 10 → 7"))) {
  console.error(`FAIL: 보급선 우회 로그 형식 부정확. log: ${supB.thisTurn.operationLog.join("|")}`); process.exit(1);
}
console.log(`  ✓ reduction 0.3: supply 80 → 73 (10 → 7, ceil), 로그: ${supB.thisTurn.operationLog.find(l => l.includes("보급선 우회"))}`);

// case C: cap 0.3 — amount 0.9 보상도 7로 감쇄 (cap)
const supC = { gauges: { taiwanSupply: 80 }, thisTurn: { defenseDebuff: 0, operationLog: [] }, persistent: { rewards: [
  { id: "fake_huge", applyTiming: "persistent", effects: { taiwanSupplyDamageReduction: 0.9 } }
] }, log: [], turn: 1 };
applyEffects(supC, { taiwanSupplyDamage: 10 }, { side: "china" });
if (supC.gauges.taiwanSupply !== 73) {
  console.error(`FAIL: cap 0.3 안 됨. supply ${supC.gauges.taiwanSupply}, expected 73`); process.exit(1);
}
console.log(`  ✓ cap 0.3: amount=0.9도 73 (피해 7만 적용)`);

// case D: 작은 피해 1 → ceil(1*0.7) = 1 (감소 없음, 로그 없음)
const supD = { gauges: { taiwanSupply: 80 }, thisTurn: { defenseDebuff: 0, operationLog: [] }, persistent: { rewards: [
  { id: "tw_supply_rerouting", applyTiming: "persistent", effects: { taiwanSupplyDamageReduction: 0.3 } }
] }, log: [], turn: 1 };
applyEffects(supD, { taiwanSupplyDamage: 1 }, { side: "china" });
if (supD.gauges.taiwanSupply !== 79) {
  console.error(`FAIL: 작은 피해 1 적용 안 됨, got ${supD.gauges.taiwanSupply}`); process.exit(1);
}
if (supD.thisTurn.operationLog.some(l => l.includes("보급선 우회"))) {
  console.error(`FAIL: 피해 실제로 안 줄었는데 로그 발생`); process.exit(1);
}
console.log(`  ✓ 피해 1 → ceil(0.7) = 1 (감소 없음 → 로그 없음, ceil 정책 정상)`);

// case E: 다른 게이지 (taiwanGovernment)에는 영향 없음
const supE = { gauges: { taiwanGovernment: 80, taiwanSupply: 80 }, thisTurn: { defenseDebuff: 0, operationLog: [] }, persistent: { rewards: [
  { id: "tw_supply_rerouting", applyTiming: "persistent", effects: { taiwanSupplyDamageReduction: 0.3 } }
] }, log: [], turn: 1 };
applyEffects(supE, { taiwanGovernmentDamage: 10 }, { side: "china" });
if (supE.gauges.taiwanGovernment !== 70) {
  console.error(`FAIL: taiwanGovernmentDamage 영향 받음`); process.exit(1);
}
console.log(`  ✓ taiwanGovernmentDamage는 영향 없음 (보급에만 적용)`);

console.log("✓ c2-b3-3a taiwanSupplyDamageReduction 검증 통과");

// =====================================================================
// v0.4.0-c2-b3-3b: usJapanInterventionGainReduction 적용 범위
// (사용자 명세 7가지: 보상없음/0.25/일본/+1유지/음수보존/internationalOpinion미영향/korea미영향)
// =====================================================================
console.log("\n[c2-b3-3b usJapanInterventionGainReduction 적용 범위]");

// case 1: 보상 없음 — 미국 +8 그대로
const infoA = { gauges: { usIntervention: 30 }, thisTurn: { defenseDebuff: 0, operationLog: [] }, persistent: { rewards: [] }, log: [], turn: 1 };
applyEffects(infoA, { usInterventionGain: 8 }, { side: "taiwan" });
if (infoA.gauges.usIntervention !== 38) {
  console.error(`FAIL: 보상 없음 us 38 아님, got ${infoA.gauges.usIntervention}`); process.exit(1);
}
if (infoA.thisTurn.operationLog.some(l => l.includes("정보 통제"))) {
  console.error(`FAIL: 보상 없는데 정보 통제 로그 발생`); process.exit(1);
}
console.log(`  ✓ 1. 보상 없음: us 30 → 38 (+8 그대로), 로그 없음`);

// case 2: 정보 통제 0.25 — 미국 +8 → +6 (ceil(8*0.75) = 6)
const infoB = { gauges: { usIntervention: 30, japanIntervention: 20 }, thisTurn: { defenseDebuff: 0, operationLog: [] }, persistent: { rewards: [
  { id: "cn_information_control", name: "정보 통제 강화", applyTiming: "persistent", effects: { usJapanInterventionGainReduction: 0.25 } }
] }, log: [], turn: 1 };
applyEffects(infoB, { usInterventionGain: 8 }, { side: "taiwan" });
if (infoB.gauges.usIntervention !== 36) {
  console.error(`FAIL: us 36 아님 (8 → 6), got ${infoB.gauges.usIntervention}`); process.exit(1);
}
if (!infoB.thisTurn.operationLog.some(l => l.includes("정보 통제: 미국 개입 상승 +8 → +6"))) {
  console.error(`FAIL: 정보 통제 로그 누락 또는 형식 부정확. log: ${infoB.thisTurn.operationLog.join("|")}`); process.exit(1);
}
console.log(`  ✓ 2. 정보 통제 0.25: us +8 → +6 (ceil), 로그 정상`);

// case 3: 일본 +5 → +4 (ceil(5*0.75) = 4)
applyEffects(infoB, { japanInterventionGain: 5 }, { side: "taiwan" });
if (infoB.gauges.japanIntervention !== 24) {
  console.error(`FAIL: japan 24 아님 (20 + 4), got ${infoB.gauges.japanIntervention}`); process.exit(1);
}
console.log(`  ✓ 3. 일본 +5 → +4 (ceil)`);

// case 4: 미국 +1 → +1 유지 (ceil(1*0.75) = ceil(0.75) = 1)
const infoC = { gauges: { usIntervention: 30 }, thisTurn: { defenseDebuff: 0, operationLog: [] }, persistent: { rewards: [
  { id: "cn_information_control", applyTiming: "persistent", effects: { usJapanInterventionGainReduction: 0.25 } }
] }, log: [], turn: 1 };
applyEffects(infoC, { usInterventionGain: 1 }, { side: "taiwan" });
if (infoC.gauges.usIntervention !== 31) {
  console.error(`FAIL: us +1 유지 안 됨, got ${infoC.gauges.usIntervention}`); process.exit(1);
}
if (infoC.thisTurn.operationLog.some(l => l.includes("정보 통제"))) {
  console.error(`FAIL: 감소 없는데 로그 발생`); process.exit(1);
}
console.log(`  ✓ 4. 미국 +1 → +1 유지 (ceil로 소량 변화 보존, 로그 없음)`);

// case 5: 음수 효과는 그대로 보존 — 미국 게이지를 빼는 효과는 reduction 적용 X
// 시뮬에서 음수 usInterventionGain은 거의 없지만 안전망. usInterventionGainReduction 효과 키 사용
const infoD = { gauges: { usIntervention: 50 }, thisTurn: { defenseDebuff: 0, operationLog: [] }, persistent: { rewards: [
  { id: "cn_information_control", applyTiming: "persistent", effects: { usJapanInterventionGainReduction: 0.25 } }
] }, log: [], turn: 1 };
applyEffects(infoD, { usInterventionGainReduction: 6 }, { side: "china" });
if (infoD.gauges.usIntervention !== 44) {
  console.error(`FAIL: usInterventionGainReduction 영향 받음, got ${infoD.gauges.usIntervention}`); process.exit(1);
}
console.log(`  ✓ 5. 음수 효과 (usInterventionGainReduction)는 그대로 -6`);

// case 6: internationalOpinion은 영향 없음 (범위 새지 않음)
const infoE = { gauges: { internationalOpinion: 50 }, thisTurn: { defenseDebuff: 0, operationLog: [] }, persistent: { rewards: [
  { id: "cn_information_control", applyTiming: "persistent", effects: { usJapanInterventionGainReduction: 0.25 } }
] }, log: [], turn: 1 };
applyEffects(infoE, { internationalOpinion: 8 }, { side: "taiwan" });
if (infoE.gauges.internationalOpinion !== 58) {
  console.error(`FAIL: internationalOpinion 영향 받음, got ${infoE.gauges.internationalOpinion}`); process.exit(1);
}
console.log(`  ✓ 6. internationalOpinion은 영향 없음 (+8 그대로)`);

// case 7: koreaRearSupportGain은 영향 없음
const infoF = { gauges: { koreaRearSupport: 20 }, thisTurn: { defenseDebuff: 0, operationLog: [] }, persistent: { rewards: [
  { id: "cn_information_control", applyTiming: "persistent", effects: { usJapanInterventionGainReduction: 0.25 } }
] }, log: [], turn: 1 };
applyEffects(infoF, { koreaRearSupportGain: 6 }, { side: "taiwan" });
if (infoF.gauges.koreaRearSupport !== 26) {
  console.error(`FAIL: koreaRearSupport 영향 받음, got ${infoF.gauges.koreaRearSupport}`); process.exit(1);
}
console.log(`  ✓ 7. koreaRearSupport는 영향 없음 (+6 그대로)`);

console.log("✓ c2-b3-3b usJapanInterventionGainReduction 검증 통과");

Math.random = origRandom;
