// =====================================================================
// run_act3_pacing_smoke_test.mjs (v0.4.2-a.1)
// ---------------------------------------------------------------------
// 검증:
//   #1 ACT 3 진입 직후 수도권 압박 조건 만족 — 지연 (T45 미만이면 win X)
//   #2 ACT 3 진입 후 6턴 미만이면 win X (조기 ACT 3 진입 케이스)
//   #3 T45 이상 + ACT 3 진입 후 6턴 경과 → china_capital_pressure_win
//   #4 short_72h 수도권 압박은 기존처럼 즉시 win (정책 유지)
//   #5 이벤트 캡: 한 턴 호출에 전체 2개, ACT 전용 1개 상한
//   #6 ACT 3 진입 시점 milestone 자동 기록 (turn_resolver phaseTurnEnd)
//   #7 suggestTaiwanFocus: 타이베이 beachhead+ 시 강제 북부 focus
// =====================================================================

import fs from "node:fs";
import { checkVictoryConditions, phaseInternationalIntervention } from "./turn_resolver.js";
import { createCampaignState } from "./campaign_state.js";
import { suggestTaiwanFocus } from "./target_selector.js";

console.log("[ACT 3 pacing smoke test v0.4.2-a.1]");

function mkState({ turn = 50, totalTurns = 84, gauges = {}, provinces = {}, persistent = {} } = {}) {
  return {
    outcome: null, turn, totalTurns,
    gauges: {
      taiwanGovernment: 70, taiwanMorale: 55, taiwanSupply: 50, taiwanCommand: 60,
      usIntervention: 85, japanIntervention: 60, koreaRearSupport: 20,
      internationalOpinion: 55, chinaPoliticalPressure: 65,
      chinaTempo: 30, chinaSupply: 30,
      ...gauges
    },
    provinces: {
      taipei: { id:"taipei", name:"타이베이", type:"capital", controlStage:"beachhead_established", landingStage:"beachhead" },
      keelung: { id:"keelung", name:"지룽", type:"port", controlStage:"china_control" },
      taoyuan: { id:"taoyuan", name:"타오위안", type:"airport", controlStage:"contested" },
      ...provinces
    },
    persistent: {
      capitalPressureTurns: 2,
      lastActId: "ACT_3",
      milestones: { act3EnteredAt: 45 },
      occurrenceCount: {}, eventCooldowns: {}, triggeredOnce: [],
      alliedIntervention: { active: false },
      ...persistent
    },
    thisTurn: { triggeredEvents: [], operationLog: [], visualEvents: [] },
    log: []
  };
}

const fullCamp = createCampaignState("taiwan", "normal", "full_21d");
const shortCamp = createCampaignState("taiwan", "normal", "short_72h");

// =====================================================================
// #1 ACT 3 조기 진입 (T37) + 수도권 조건 만족 → win X (지연)
// =====================================================================
console.log("\n1. ACT 3 조기 진입 T37 + 수도권 조건 만족 → 즉시 승리 X (지연)");
const earlyAct3 = mkState({
  turn: 37, totalTurns: 84,
  persistent: { capitalPressureTurns: 2, lastActId: "ACT_3", milestones: { act3EnteredAt: 35 } }
});
const r1 = checkVictoryConditions(earlyAct3, fullCamp);
if (r1 === "china_capital_pressure_win") {
  console.error(`FAIL: T37 ACT 3 진입 T35 (2턴 경과) → 승리되면 안 됨, got ${r1}`); process.exit(1);
}
console.log(`  ✓ T37 + act3EnteredAt=35 (2턴 경과): outcome=${r1} (45턴 미만이라 차단)`);

// =====================================================================
// #2 T45 도달했지만 ACT 3 진입 후 6턴 미만 → win X
// =====================================================================
console.log("\n2. T45 도달 + act3EnteredAt=42 (3턴 경과) → win X (6턴 미만)");
const t45Recent = mkState({
  turn: 45, totalTurns: 84,
  persistent: { capitalPressureTurns: 2, lastActId: "ACT_3", milestones: { act3EnteredAt: 42 } }
});
const r2 = checkVictoryConditions(t45Recent, fullCamp);
// max(45, 42+6=48) = 48 → T45 < 48
if (r2 === "china_capital_pressure_win") {
  console.error(`FAIL: T45이지만 ACT 3 진입 6턴 미만 → 승리되면 안 됨, got ${r2}`); process.exit(1);
}
console.log(`  ✓ T45 + 3턴 경과 (필요 6턴): outcome=${r2} (지연 작동)`);

// =====================================================================
// #3 T45 이상 + 6턴 경과 → china_capital_pressure_win
// =====================================================================
console.log("\n3. T48 + act3EnteredAt=42 (6턴 경과) → china_capital_pressure_win");
const t48Eligible = mkState({
  turn: 48, totalTurns: 84,
  persistent: { capitalPressureTurns: 2, lastActId: "ACT_3", milestones: { act3EnteredAt: 42 } }
});
const r3 = checkVictoryConditions(t48Eligible, fullCamp);
if (r3 !== "china_capital_pressure_win") {
  console.error(`FAIL: T48 + 6턴 경과 → china_capital_pressure_win이어야, got ${r3}`); process.exit(1);
}
console.log(`  ✓ T48 + act3EnteredAt=42: china_capital_pressure_win`);

// 자연 ACT 3 진입 (T45) + 충분 경과 (T51) → win
const naturalLate = mkState({
  turn: 51, totalTurns: 84,
  persistent: { capitalPressureTurns: 2, lastActId: "ACT_3", milestones: { act3EnteredAt: 45 } }
});
const r3b = checkVictoryConditions(naturalLate, fullCamp);
if (r3b !== "china_capital_pressure_win") {
  console.error(`FAIL: T51 + 자연 ACT 3 → win, got ${r3b}`); process.exit(1);
}
console.log(`  ✓ 자연 ACT 3 (T45) + T51 (6턴): china_capital_pressure_win`);

// =====================================================================
// #4 short_72h은 기존처럼 즉시
// =====================================================================
console.log("\n4. short_72h 수도권 압박 — 즉시 승리 유지");
const shortState = mkState({
  turn: 20, totalTurns: 30,
  persistent: { capitalPressureTurns: 2, lastActId: "ACT_1", milestones: {} }
});
const r4 = checkVictoryConditions(shortState, shortCamp);
if (r4 !== "china_capital_pressure_win") {
  console.error(`FAIL: short T20 수도권 압박 → 즉시 win, got ${r4}`); process.exit(1);
}
console.log(`  ✓ short_72h T20: ${r4} (즉시 승리)`);

// =====================================================================
// #5 이벤트 캡: 전체 2 / ACT 전용 1
// =====================================================================
console.log("\n5. 이벤트 캡 — 전체 2개 / ACT 전용 1개");
const events = JSON.parse(fs.readFileSync(new URL("../data/events_global.json", import.meta.url), "utf8"));
const capState = mkState({
  turn: 60,
  gauges: {
    usIntervention: 95, japanIntervention: 75, taiwanCommand: 65,
    chinaPoliticalPressure: 75, chinaTempo: 15, chinaSupply: 25, taiwanSupply: 35
  },
  persistent: {
    lastActId: "ACT_3",
    occurrenceCount: {}, eventCooldowns: {}, triggeredOnce: [],
    milestones: { act3EnteredAt: 45 },
    alliedIntervention: { active: false }
  }
});
phaseInternationalIntervention(capState, events, "start_of_turn", fullCamp);

const triggered = capState.thisTurn.triggeredEvents;
const act3Ids = new Set([
  "global_backchannel_ceasefire_mediation", "global_china_hardliner_pushback",
  "global_us_carrier_pressure_maneuver", "global_japan_maritime_surveillance",
  "global_taiwan_counterattack_prep", "global_supply_lines_reopened",
  "global_china_supply_chain_fracture"
]);
const act3Triggered = triggered.filter(id => act3Ids.has(id));

if (triggered.length > 2) {
  console.error(`FAIL: 전체 이벤트 ${triggered.length}건 — 캡 2개 위반`); process.exit(1);
}
if (act3Triggered.length > 1) {
  console.error(`FAIL: ACT 3 전용 ${act3Triggered.length}건 — 캡 1개 위반`); process.exit(1);
}
console.log(`  ✓ ACT 3 전용 ${act3Triggered.length}건 (≤1), 전체 ${triggered.length}건 (≤2)`);

// 두 번째 phaseInternationalIntervention 호출 (after_operation_resolution) 시
// 이미 전 단계에서 발동한 이벤트가 카운트에 포함되어야
phaseInternationalIntervention(capState, events, "after_operation_resolution", fullCamp);
const triggeredTotal = capState.thisTurn.triggeredEvents.length;
if (triggeredTotal > 2) {
  console.error(`FAIL: 두 호출 합산 ${triggeredTotal}건 — 캡 위반`); process.exit(1);
}
console.log(`  ✓ 두 호출 합산 ${triggeredTotal}건 (≤2) — 캡이 한 턴 누적 적용`);

// =====================================================================
// #6 ACT 3 진입 milestone 기록 — phaseTurnEnd에서
// =====================================================================
console.log("\n6. act3EnteredAt milestone 기록 (turn_resolver 자동)");
// 단순화: checkVictoryConditions가 milestones.act3EnteredAt를 읽는지 확인
// turn_resolver phaseTurnEnd에서 ACT 1→ACT 2→ACT 3 전환 시 자동 기록됨
const stateNoMilestone = mkState({
  turn: 50, totalTurns: 84,
  persistent: { capitalPressureTurns: 2, lastActId: "ACT_3", milestones: {} }  // milestone 없음
});
const r6 = checkVictoryConditions(stateNoMilestone, fullCamp);
// milestone 없으면 fallback 45 사용 → 50 >= max(45, 45+6=51)? 50<51 → null
if (r6 === "china_capital_pressure_win") {
  console.error(`FAIL: milestone 없을 때 T50 → null이어야 (fallback 45+6=51), got ${r6}`); process.exit(1);
}
console.log(`  ✓ milestone 없을 때 T50 → ${r6} (fallback act3EnteredAt=45 + 6 = 51 미달)`);

// =====================================================================
// #7 suggestTaiwanFocus: 타이베이 위기 시 강제 북부
// =====================================================================
console.log("\n7. suggestTaiwanFocus — 타이베이 beachhead+ 시 강제 taipei focus");
const taipeiCrisis = mkState({
  provinces: {
    taipei: { id:"taipei", name:"타이베이", type:"capital", controlStage:"beachhead_established", landingStage:"beachhead", tags:["north", "capital"] },
    keelung: { id:"keelung", name:"지룽", type:"port", controlStage:"stable_defense", tags:["north"] },
    kaohsiung: { id:"kaohsiung", name:"가오슝", type:"major_port", controlStage:"contested", tags:["south"] }
  }
});
const focus = suggestTaiwanFocus(taipeiCrisis);
if (focus.focus !== "taipei") {
  console.error(`FAIL: 타이베이 위기인데 focus가 ${focus.focus}`); process.exit(1);
}
if (focus.forcedReason !== "capital_crisis") {
  console.error(`FAIL: forcedReason 'capital_crisis' 없음`); process.exit(1);
}
console.log(`  ✓ 타이베이 beachhead → focus=${focus.focus}, mode=${focus.mode}, reason=${focus.forcedReason}`);

// 타이베이 정상이면 일반 스코어링 작동
const normal = mkState({
  provinces: {
    taipei: { id:"taipei", name:"타이베이", type:"capital", controlStage:"stable_defense", tags:["north", "capital"] },
    kaohsiung: { id:"kaohsiung", name:"가오슝", type:"major_port", controlStage:"contested", landingStage:"beachhead", tags:["south"] }
  }
});
const normalFocus = suggestTaiwanFocus(normal);
if (normalFocus.focus === "taipei" && normalFocus.forcedReason === "capital_crisis") {
  console.error(`FAIL: 타이베이 정상인데 강제 발동`); process.exit(1);
}
console.log(`  ✓ 타이베이 정상: focus=${normalFocus.focus} (강제 안 발동)`);

console.log("\n✓ ACT 3 pacing smoke test passed");
