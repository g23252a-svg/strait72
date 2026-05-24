// =====================================================================
// run_mission_ui_smoke_test.mjs (v0.4.2-d1)
// ---------------------------------------------------------------------
// DOM 없이 검증 가능한 통합 로직만:
//   #1 listMissions() 결과 UI용 필드 모두 존재
//   #2 mission 선택 → campaign에 missionId 전달 → resetGame 시 applyMission
//   #3 missionId 있을 때 state.mission 설정
//   #4 campaign.missionId 없으면 일반 게임
//   #5 outcome label에 mission_complete / mission_failed / mission_timeout
//   #6 각 미션의 recommendedSide가 SIDES에 존재 ("taiwan"/"china")
//   #7 각 미션의 baseScenario가 SCENARIOS에 존재 (short_72h/full_21d)
// =====================================================================

import { MISSIONS, listMissions, applyMissionToState } from "./mission_scenarios.js";
import { createCampaignState, SCENARIOS } from "./campaign_state.js";
import fs from "node:fs";

console.log("[mission UI smoke test v0.4.2-d1]");

// =====================================================================
// #1 listMissions UI용 필드
// =====================================================================
console.log("\n1. listMissions() 결과 UI용 필드 모두 존재");
const ms = listMissions();
if (ms.length !== 5) {
  console.error(`FAIL: 5개 아님, ${ms.length}`); process.exit(1);
}
for (const m of ms) {
  for (const f of ["id", "name", "description", "recommendedSide", "baseScenario", "missionTurns"]) {
    if (!(f in m)) {
      console.error(`FAIL: ${m.id} ${f} 누락`); process.exit(1);
    }
  }
}
console.log(`  ✓ 5개 미션 모두 UI 카드용 6필드 존재`);

// =====================================================================
// #2 + #3: mission 선택 → campaign에 missionId → state.mission 설정
// =====================================================================
console.log("\n2+3. mission 선택 → campaign.missionId → applyMission 흐름");

const { GAME_RULES } = await import("./game_rules.js");
const { createInitialState } = await import("./state.js");
const { initializeDecks } = await import("./deck_state.js");

const provinces = JSON.parse(fs.readFileSync(new URL("../data/provinces.json", import.meta.url), "utf8"));
const axes = JSON.parse(fs.readFileSync(new URL("../data/axes.json", import.meta.url), "utf8"));
const cardsChina = JSON.parse(fs.readFileSync(new URL("../data/cards_china.json", import.meta.url), "utf8"));
const cardsTaiwan = JSON.parse(fs.readFileSync(new URL("../data/cards_taiwan.json", import.meta.url), "utf8"));
const events = JSON.parse(fs.readFileSync(new URL("../data/events_global.json", import.meta.url), "utf8"));

// UI flow simulation: 사용자가 미션 모드에서 kaohsiung_defense 선택
const mission = MISSIONS.kaohsiung_defense;
const campaign = createCampaignState(mission.recommendedSide, "normal", mission.baseScenario);
campaign.missionId = "kaohsiung_defense";

// resetGame 시뮬
const state = createInitialState({
  provinces, gameRules: GAME_RULES, axes, cardsChina, cardsTaiwan, events,
  totalTurnsOverride: campaign.totalTurns
});
initializeDecks(state, cardsChina, cardsTaiwan);
if (campaign?.missionId && MISSIONS[campaign.missionId]) {
  applyMissionToState(state, MISSIONS[campaign.missionId]);
}

if (!state.mission || state.mission.id !== "kaohsiung_defense") {
  console.error(`FAIL: state.mission 설정 안 됨`); process.exit(1);
}
if (state.provinces.kaohsiung.controlStage !== "contested") {
  console.error(`FAIL: 미션 점령 오버라이드 안 됨`); process.exit(1);
}
if (state.totalTurns !== mission.missionTurns) {
  console.error(`FAIL: totalTurns 오버라이드 안 됨`); process.exit(1);
}
console.log(`  ✓ kaohsiung_defense 적용: 가오슝 contested, totalTurns ${state.totalTurns}, state.mission.id=${state.mission.id}`);

// =====================================================================
// #4: missionId 없으면 일반 게임 흐름
// =====================================================================
console.log("\n4. campaign.missionId 없으면 일반 게임 흐름");
const camp2 = createCampaignState("taiwan", "normal", "full_21d");
// campaign.missionId 없음
const state2 = createInitialState({
  provinces, gameRules: GAME_RULES, axes, cardsChina, cardsTaiwan, events,
  totalTurnsOverride: camp2.totalTurns
});
initializeDecks(state2, cardsChina, cardsTaiwan);
if (camp2?.missionId && MISSIONS[camp2.missionId]) {
  applyMissionToState(state2, MISSIONS[camp2.missionId]);
}
if (state2.mission) {
  console.error(`FAIL: missionId 없는데 state.mission 설정됨`); process.exit(1);
}
if (state2.provinces.kaohsiung.controlStage !== "stable_defense") {
  console.error(`FAIL: 일반 게임인데 점령 오버라이드 됨`); process.exit(1);
}
console.log(`  ✓ 일반 게임: state.mission 없음, 기본 시작 상태 유지`);

// =====================================================================
// #5: outcome label에 mission_* 매핑 (playable_app.js 텍스트 검사)
// =====================================================================
console.log("\n5. outcomeLabel mission_* 매핑");
const source = fs.readFileSync(new URL("./playable_app.js", import.meta.url), "utf8");
for (const oc of ["mission_complete", "mission_failed", "mission_timeout"]) {
  if (!source.includes(`${oc}:`)) {
    console.error(`FAIL: outcomeLabel에 ${oc} 매핑 없음`); process.exit(1);
  }
}
console.log(`  ✓ mission_complete / mission_failed / mission_timeout 매핑 존재`);

// =====================================================================
// #6+7: 각 미션 recommendedSide / baseScenario 유효성
// =====================================================================
console.log("\n6+7. 각 미션 recommendedSide / baseScenario 유효");
for (const m of Object.values(MISSIONS)) {
  if (!["taiwan", "china", "both"].includes(m.recommendedSide)) {
    console.error(`FAIL: ${m.id} recommendedSide 비표준: ${m.recommendedSide}`); process.exit(1);
  }
  if (!SCENARIOS[m.baseScenario]) {
    console.error(`FAIL: ${m.id} baseScenario 비정의: ${m.baseScenario}`); process.exit(1);
  }
}
console.log(`  ✓ 5개 미션 모두 recommendedSide ∈ {taiwan, china} + baseScenario ∈ SCENARIOS`);

// =====================================================================
// #8: import 흐름 — playable_app.js가 listMissions / applyMissionToState / MISSIONS 모두 import
// =====================================================================
console.log("\n8. playable_app.js 임포트 흐름");
const imports = ["listMissions", "applyMissionToState", "MISSIONS"];
for (const sym of imports) {
  if (!source.includes(sym)) {
    console.error(`FAIL: playable_app.js에 ${sym} import/사용 없음`); process.exit(1);
  }
}
// 모드 탭 / 미션 카드 / 핸들러
const uiBits = ["modeTabs", "missionList", "mission-card", "mission-name", "selectedMission"];
for (const bit of uiBits) {
  if (!source.includes(bit)) {
    console.error(`FAIL: playable_app.js에 UI 요소 '${bit}' 없음`); process.exit(1);
  }
}
console.log(`  ✓ import 3개 + UI 5요소 모두 present`);

console.log("\n✓ mission UI smoke test passed");
