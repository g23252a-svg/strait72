// =====================================================================
// run_long_campaign_polish_smoke_test.mjs (v0.4.1.4)
// ---------------------------------------------------------------------
// hotfix 회귀 방지:
//   #1 final interpretation의 "72시간" → "21일 장기전" 분기 (full_21d)
//   #2 components "30턴 완주" → "84턴 완주" (full_21d)
//   #3 suggestChinaAxis: ACT 3 + 자원 소진 시 가중치 전환
// =====================================================================

import { generateFinalInterpretation, calculateFinalScore } from "./final_grade.js";
import { suggestChinaAxis } from "./target_selector.js";

console.log("[long-campaign polish smoke test v0.4.1.4]");

function mkState({ outcome = "taiwan_survival_win", totalTurns = 30, turn = null, gauges = {}, provinces = {}, persistent = {} } = {}) {
  return {
    outcome, turn: turn ?? totalTurns, totalTurns,
    gauges: {
      usIntervention: 80, japanIntervention: 60, koreaRearSupport: 20,
      internationalOpinion: 60, chinaPoliticalPressure: 50,
      chinaTempo: 50, chinaSupply: 50,
      taiwanMorale: 70, taiwanGovernment: 80, taiwanCommand: 80, taiwanSupply: 60,
      ...gauges
    },
    provinces: {
      taipei: { id:"taipei", name:"타이베이", type:"capital", controlStage:"stable_defense" },
      ...provinces
    },
    persistent: { capitalPressureTurns: 0, milestones: {}, ...persistent },
    thisTurn: { operationLog: [] }, log: []
  };
}

// =====================================================================
// #1 interpretation 분기 — short는 "72시간", full은 "21일 장기전"
// =====================================================================
console.log("\n1. interpretation '72시간' vs '21일 장기전' 분기");
const shortS = generateFinalInterpretation("taiwan_survival_win", 100, "taiwan", mkState({ totalTurns: 30 }), "S");
const fullS = generateFinalInterpretation("taiwan_survival_win", 100, "taiwan", mkState({ totalTurns: 84 }), "S");
if (!shortS.includes("72시간")) {
  console.error(`FAIL: short_72h S 해설에 '72시간' 없음: "${shortS}"`); process.exit(1);
}
if (fullS.includes("72시간")) {
  console.error(`FAIL: full_21d S 해설에 '72시간' 잔재: "${fullS}"`); process.exit(1);
}
if (!fullS.includes("21일 장기전")) {
  console.error(`FAIL: full_21d S 해설에 '21일 장기전' 없음: "${fullS}"`); process.exit(1);
}
console.log(`  ✓ short S: "${shortS.slice(0, 40)}…"`);
console.log(`  ✓ full S:  "${fullS.slice(0, 40)}…"`);

// B 등급에서도 분기
const shortB = generateFinalInterpretation("taiwan_survival_win", 70, "taiwan", mkState({
  totalTurns: 30,
  provinces: {
    taipei: { id:"taipei", name:"타이베이", type:"capital", controlStage:"contested", landingStage:"beachhead" },
    taichung: { id:"taichung", name:"타이중", type:"city", controlStage:"china_control" },
    tainan: { id:"tainan", name:"타이난", type:"city", controlStage:"china_control" },
    kaohsiung: { id:"kaohsiung", name:"가오슝", type:"major_port", controlStage:"china_control" }
  }
}), "B");
const fullB = generateFinalInterpretation("taiwan_survival_win", 70, "taiwan", mkState({
  totalTurns: 84,
  provinces: {
    taipei: { id:"taipei", name:"타이베이", type:"capital", controlStage:"contested", landingStage:"beachhead" },
    taichung: { id:"taichung", name:"타이중", type:"city", controlStage:"china_control" },
    tainan: { id:"tainan", name:"타이난", type:"city", controlStage:"china_control" },
    kaohsiung: { id:"kaohsiung", name:"가오슝", type:"major_port", controlStage:"china_control" }
  }
}), "B");
if (fullB.includes("72시간")) {
  console.error(`FAIL: full B에 '72시간' 잔재: "${fullB}"`); process.exit(1);
}
if (!fullB.includes("21일 장기전")) {
  console.error(`FAIL: full B에 '21일 장기전' 없음: "${fullB}"`); process.exit(1);
}
console.log(`  ✓ short B: ${shortB.slice(0, 50)}…`);
console.log(`  ✓ full B:  ${fullB.slice(0, 50)}…`);

// =====================================================================
// #2 components 라벨 "X턴 완주" 시나리오별
// =====================================================================
console.log("\n2. components 라벨: 30턴 완주 vs 84턴 완주");
const r30 = calculateFinalScore(mkState({ totalTurns: 30 }), "taiwan");
const r84 = calculateFinalScore(mkState({ totalTurns: 84 }), "taiwan");
const label30 = r30.components.find(c => c.label.includes("완주"))?.label;
const label84 = r84.components.find(c => c.label.includes("완주"))?.label;
if (label30 !== "30턴 완주") {
  console.error(`FAIL: 30턴 완주 라벨 부정확, got "${label30}"`); process.exit(1);
}
if (label84 !== "84턴 완주") {
  console.error(`FAIL: 84턴 완주 라벨 부정확, got "${label84}"`); process.exit(1);
}
console.log(`  ✓ 30턴 라벨: "${label30}", 84턴 라벨: "${label84}"`);

// =====================================================================
// #3 suggestChinaAxis: ACT 3 + 자원 소진 시 군사 axis 가중치 감소
// =====================================================================
console.log("\n3. ACT 3 + 자원 소진 → 군사 axis 가중치 감소");
const axes = [
  { id: "north_pressure" }, { id: "south_landing" },
  { id: "naval_blockade" }, { id: "information_warfare" },
  { id: "diplomatic_pressure" }
];

// 정상 상태 (자원 충분)
const normalState = mkState({
  totalTurns: 84, turn: 60,
  gauges: { chinaTempo: 50, chinaSupply: 50 },
  persistent: { lastActId: "ACT_3", recentChinaAxes: [], milestones: {} }
});
const normalScores = suggestChinaAxis(normalState, axes).scores;

// 소진 상태 (tempo=0, supply=0)
const exhaustedState = mkState({
  totalTurns: 84, turn: 60,
  gauges: { chinaTempo: 0, chinaSupply: 0 },
  persistent: { lastActId: "ACT_3", recentChinaAxes: [], milestones: {} }
});
const exhaustedScores = suggestChinaAxis(exhaustedState, axes).scores;

// 군사 axis (south/north)는 소진 시 더 낮은 점수여야
if (exhaustedScores.south_landing >= normalScores.south_landing) {
  console.error(`FAIL: 소진 시 south_landing 더 낮아야, normal=${normalScores.south_landing.toFixed(2)}, exhausted=${exhaustedScores.south_landing.toFixed(2)}`);
  process.exit(1);
}
if (exhaustedScores.north_pressure >= normalScores.north_pressure) {
  console.error(`FAIL: 소진 시 north_pressure 더 낮아야`); process.exit(1);
}
// 비군사 axis (diplomatic, information)는 소진 시 더 높은 점수
if (exhaustedScores.diplomatic_pressure <= normalScores.diplomatic_pressure) {
  console.error(`FAIL: 소진 시 diplomatic_pressure 더 높아야, normal=${normalScores.diplomatic_pressure.toFixed(2)}, exhausted=${exhaustedScores.diplomatic_pressure.toFixed(2)}`);
  process.exit(1);
}
console.log(`  ✓ 정상: south=${normalScores.south_landing.toFixed(1)}, north=${normalScores.north_pressure.toFixed(1)}, dipl=${normalScores.diplomatic_pressure.toFixed(1)}`);
console.log(`  ✓ 소진: south=${exhaustedScores.south_landing.toFixed(1)}, north=${exhaustedScores.north_pressure.toFixed(1)}, dipl=${exhaustedScores.diplomatic_pressure.toFixed(1)}`);

// 소진 상태에서 best axis는 일반적으로 비군사 (외교/봉쇄/정보전)
const bestExhausted = suggestChinaAxis(exhaustedState, axes).axisId;
if (bestExhausted === "south_landing" || bestExhausted === "north_pressure") {
  console.error(`FAIL: 소진 상태인데 best axis가 군사 axis (${bestExhausted}). 자살 돌격 방지 안 됨`);
  process.exit(1);
}
console.log(`  ✓ 소진 best axis: "${bestExhausted}" (비군사 전환)`);

// 1회 로그 + milestone
if (!exhaustedState.persistent.milestones.chinaExhaustedAt) {
  console.error(`FAIL: chinaExhaustedAt milestone 없음`); process.exit(1);
}
const exhaustedLog = exhaustedState.thisTurn.operationLog.some(s => s.includes("공세 둔화"));
if (!exhaustedLog) {
  console.error(`FAIL: '공세 둔화' 로그 없음`); process.exit(1);
}
console.log(`  ✓ milestone T${exhaustedState.persistent.milestones.chinaExhaustedAt}, 로그 출력`);

// =====================================================================
// #4 ACT 1/2 또는 자원 충분이면 이 보정 적용 안 됨 (멱등성)
// =====================================================================
console.log("\n4. 보정 적용 조건 — ACT 1/2 또는 자원 충분이면 변화 없음");
// ACT 1, 자원 0 → 보정 X (ACT 3가 아니라)
const act1Exhausted = mkState({
  totalTurns: 84, turn: 8,
  gauges: { chinaTempo: 0, chinaSupply: 0 },
  persistent: { lastActId: "ACT_1", recentChinaAxes: [], milestones: {} }
});
const act1Scores = suggestChinaAxis(act1Exhausted, axes).scores;
if (act1Exhausted.persistent.milestones.chinaExhaustedAt) {
  console.error(`FAIL: ACT 1인데 chinaExhaustedAt milestone 기록됨`); process.exit(1);
}
console.log(`  ✓ ACT 1 + 자원 0: 보정 미적용 (south=${act1Scores.south_landing.toFixed(1)})`);

// ACT 3, 자원 충분 → 보정 X
const act3Full = mkState({
  totalTurns: 84, turn: 60,
  gauges: { chinaTempo: 40, chinaSupply: 40 },
  persistent: { lastActId: "ACT_3", recentChinaAxes: [], milestones: {} }
});
suggestChinaAxis(act3Full, axes);
if (act3Full.persistent.milestones.chinaExhaustedAt) {
  console.error(`FAIL: 자원 40인데 chinaExhaustedAt milestone 기록됨`); process.exit(1);
}
console.log(`  ✓ ACT 3 + 자원 40: 보정 미적용 (소진 임계 미만)`);

// =====================================================================
// #5 milestone 멱등성 — 한 번 기록되면 두 번째 호출엔 로그 X
// =====================================================================
console.log("\n5. chinaExhaustedAt milestone 멱등성");
const firstTurn = exhaustedState.persistent.milestones.chinaExhaustedAt;
exhaustedState.turn = 65;
exhaustedState.thisTurn.operationLog = [];
suggestChinaAxis(exhaustedState, axes);
if (exhaustedState.persistent.milestones.chinaExhaustedAt !== firstTurn) {
  console.error(`FAIL: milestone 갱신됨 (멱등성 깨짐), ${firstTurn} → ${exhaustedState.persistent.milestones.chinaExhaustedAt}`);
  process.exit(1);
}
const dupLog = exhaustedState.thisTurn.operationLog.some(s => s.includes("공세 둔화"));
if (dupLog) {
  console.error(`FAIL: 공세 둔화 로그 두 번째 호출에도 출력됨`); process.exit(1);
}
console.log(`  ✓ milestone T${firstTurn} 유지, 중복 로그 없음`);

console.log("\n✓ long-campaign polish smoke test passed");
