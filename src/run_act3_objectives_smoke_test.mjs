// =====================================================================
// run_act3_objectives_smoke_test.mjs (v0.4.2-b3)
// ---------------------------------------------------------------------
// 검증: ACT 3 DAY 목표 생성기
//
// #1 generateAct3Objectives는 taiwan/china 두 배열 반환
// #2 모든 목표는 { id, text, priority } 형식
// #3 priority는 high/medium/low 중 하나
// #4 high 목표가 항상 먼저 정렬됨
// #5 최대 4개 제한
// #6 게임 상태별 동적 변화:
//    - 타이베이 위기 시 대만 측 high 목표에 'taipei' 관련 등장
//    - 정부 낮으면 'govt_recovery'
//    - 중국 정치압박 ≥80이면 'pp_relief' high
//    - 중국 템포≤5면 'tempo_recovery' high
// #7 shouldShowAct3Objectives: full_21d + ACT 3에서만 true
// #8 short_72h이거나 ACT 1/2면 false
// =====================================================================

import { generateAct3Objectives, shouldShowAct3Objectives } from "./act3_objectives.js";
import { createCampaignState } from "./campaign_state.js";

console.log("[ACT 3 objectives smoke test v0.4.2-b3]");

function mkState({ turn = 50, lastActId = "ACT_3", gauges = {}, provinces = {}, persistent = {} } = {}) {
  return {
    turn, totalTurns: 84, outcome: null,
    gauges: {
      taiwanGovernment: 70, taiwanMorale: 60, taiwanSupply: 50, taiwanCommand: 65,
      usIntervention: 75, japanIntervention: 55, koreaRearSupport: 20,
      internationalOpinion: 50,
      chinaPoliticalPressure: 60, chinaTempo: 40, chinaSupply: 40,
      ...gauges
    },
    provinces: {
      taipei: { id:"taipei", controlStage:"stable_defense", landingStage:"none" },
      kaohsiung: { id:"kaohsiung", controlStage:"stable_defense", landingStage:"none" },
      tainan: { id:"tainan", controlStage:"stable_defense", landingStage:"none" },
      ...provinces
    },
    persistent: { lastActId, milestones: {}, ...persistent }
  };
}

// =====================================================================
// #1, #2, #3, #5: 기본 schema
// =====================================================================
console.log("\n1+2+3+5. 기본 schema 검증");
const s = mkState();
const obj = generateAct3Objectives(s);
if (!Array.isArray(obj.taiwan) || !Array.isArray(obj.china)) {
  console.error(`FAIL: taiwan/china 배열 아님`); process.exit(1);
}
for (const side of ["taiwan", "china"]) {
  for (const o of obj[side]) {
    if (typeof o.id !== "string" || typeof o.text !== "string") {
      console.error(`FAIL: ${side} 목표에 id/text 없음: ${JSON.stringify(o)}`); process.exit(1);
    }
    if (!["high", "medium", "low"].includes(o.priority)) {
      console.error(`FAIL: ${side} priority 비표준: ${o.priority}`); process.exit(1);
    }
  }
  if (obj[side].length > 4) {
    console.error(`FAIL: ${side} 목표 ${obj[side].length}개 (≤4)`); process.exit(1);
  }
}
console.log(`  ✓ 기본 schema OK (taiwan ${obj.taiwan.length}, china ${obj.china.length})`);

// =====================================================================
// #4: priority 정렬
// =====================================================================
console.log("\n4. priority high → medium → low 정렬");
const sortedTest = mkState({
  gauges: {
    taiwanGovernment: 30,  // → govt_recovery high
    taiwanSupply: 40,      // → supply_recovery medium
    usIntervention: 70     // → us_intervention low
  }
});
const r4 = generateAct3Objectives(sortedTest);
const order = { high: 0, medium: 1, low: 2 };
for (let i = 1; i < r4.taiwan.length; i++) {
  if (order[r4.taiwan[i].priority] < order[r4.taiwan[i-1].priority]) {
    console.error(`FAIL: 정렬 깨짐 at index ${i}`); process.exit(1);
  }
}
console.log(`  ✓ 대만 정렬: ${r4.taiwan.map(o => `${o.priority}`).join(" > ")}`);

// =====================================================================
// #6: 동적 변화
// =====================================================================
console.log("\n6. 게임 상태별 동적 변화");

// 6a. 타이베이 위기
const taipeiCrisis = mkState({
  provinces: { taipei: { id:"taipei", controlStage:"beachhead_established", landingStage:"beachhead" } }
});
const r6a = generateAct3Objectives(taipeiCrisis);
const hasTaipei = r6a.taiwan.some(o => o.id === "taipei_recapture" && o.priority === "high");
if (!hasTaipei) {
  console.error(`FAIL: 타이베이 위기인데 taipei_recapture high 없음`); process.exit(1);
}
console.log(`  ✓ 타이베이 beachhead+ → 대만 측 high 'taipei_recapture'`);

// 6b. 정부 낮음
const lowGov = mkState({ gauges: { taiwanGovernment: 35 } });
const r6b = generateAct3Objectives(lowGov);
const govObj = r6b.taiwan.find(o => o.id === "govt_recovery");
if (!govObj || govObj.priority !== "high") {
  console.error(`FAIL: 정부 35인데 govt_recovery high 없음`); process.exit(1);
}
console.log(`  ✓ 정부 35 → 대만 측 high 'govt_recovery'`);

// 6c. 중국 정치압박 높음
const highPP = mkState({ gauges: { chinaPoliticalPressure: 85 } });
const r6c = generateAct3Objectives(highPP);
const ppObj = r6c.china.find(o => o.id === "pp_relief");
if (!ppObj || ppObj.priority !== "high") {
  console.error(`FAIL: 정치압박 85인데 pp_relief high 없음`); process.exit(1);
}
console.log(`  ✓ 정치압박 85 → 중국 측 high 'pp_relief'`);

// 6d. 중국 템포 소진
const lowTempo = mkState({ gauges: { chinaTempo: 0 } });
const r6d = generateAct3Objectives(lowTempo);
const tempoObj = r6d.china.find(o => o.id === "tempo_recovery");
if (!tempoObj || tempoObj.priority !== "high") {
  console.error(`FAIL: 템포 0인데 tempo_recovery high 없음`); process.exit(1);
}
console.log(`  ✓ 템포 0 → 중국 측 high 'tempo_recovery'`);

// 6e. 가오슝 contested → 교두보 후퇴 목표
const kaohsiungCrisis = mkState({
  provinces: { kaohsiung: { id:"kaohsiung", controlStage:"contested", landingStage:"beachhead" } }
});
const r6e = generateAct3Objectives(kaohsiungCrisis);
const hasKaohsiung = r6e.taiwan.some(o => o.id === "kaohsiung_pushback");
if (!hasKaohsiung) {
  console.error(`FAIL: 가오슝 beachhead인데 kaohsiung_pushback 없음`); process.exit(1);
}
console.log(`  ✓ 가오슝 beachhead → 대만 측 'kaohsiung_pushback'`);

// =====================================================================
// #7, #8: shouldShowAct3Objectives
// =====================================================================
console.log("\n7+8. shouldShowAct3Objectives 게이팅");
const fullCamp = createCampaignState("taiwan", "normal", "full_21d");
const shortCamp = createCampaignState("taiwan", "normal", "short_72h");

const s7a = mkState({ turn: 50, lastActId: "ACT_3" });
if (!shouldShowAct3Objectives(s7a, fullCamp)) {
  console.error(`FAIL: full_21d + ACT 3 → true이어야`); process.exit(1);
}
const s7b = mkState({ turn: 10, lastActId: "ACT_1" });
if (shouldShowAct3Objectives(s7b, fullCamp)) {
  console.error(`FAIL: full_21d + ACT 1 → false이어야`); process.exit(1);
}
const s7c = mkState({ turn: 25, lastActId: "ACT_2" });
if (shouldShowAct3Objectives(s7c, fullCamp)) {
  console.error(`FAIL: full_21d + ACT 2 → false이어야`); process.exit(1);
}
const s7d = mkState({ turn: 25, lastActId: "ACT_1" });
if (shouldShowAct3Objectives(s7d, shortCamp)) {
  console.error(`FAIL: short_72h → 항상 false이어야`); process.exit(1);
}
// fallback: turn>=45 + lastActId 없음
const s7e = mkState({ turn: 50, lastActId: null });
if (!shouldShowAct3Objectives(s7e, fullCamp)) {
  console.error(`FAIL: full_21d + T50 fallback → true이어야`); process.exit(1);
}
console.log(`  ✓ full_21d + ACT3: true, ACT1/2: false, short_72h: false, turn>=45 fallback: true`);

console.log("\n✓ ACT 3 objectives smoke test passed");
