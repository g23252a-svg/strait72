// =====================================================================
// run_save_system_smoke_test.mjs (v0.4.4)
// ---------------------------------------------------------------------
// localStorage stub로 저장/이어하기 검증:
//
//   #1 saveGame → ok + localStorage 기록
//   #2 loadGame → 복원, schemaVersion / buildTag / state 일치
//   #3 getSaveMetadata: 메타데이터만 (저장 데이터 미노출)
//   #4 hasSavedGame boolean
//   #5 BUILD_TAG 불일치 → invalid: build_mismatch
//   #6 schemaVersion 불일치 → invalid: schema_mismatch
//   #7 outcome 있는 (끝난) 게임은 저장 거부 / 로드 시 invalid
//   #8 clearSavedGame → 이후 loadGame null
//   #9 state.mission / persistent / decks 등 깊은 객체 round-trip
//   #10 schema/build/state 어느 하나라도 누락 시 invalid
// =====================================================================

let stored = {};
globalThis.localStorage = {
  getItem: (k) => stored[k] || null,
  setItem: (k, v) => { stored[k] = v; },
  removeItem: (k) => { delete stored[k]; }
};

const {
  saveGame, loadGame, getSaveMetadata, hasSavedGame, clearSavedGame,
  SAVE_CONSTANTS
} = await import("./save_system.js");

console.log("[save system smoke test v0.4.4]");

const CURRENT_BUILD = "v0.4.4";

function mkState({ turn = 5, outcome = null, withMission = false } = {}) {
  const s = {
    turn, totalTurns: 84, outcome,
    gauges: {
      chinaTempo: 80, chinaSupply: 75, chinaPoliticalPressure: 30,
      taiwanGovernment: 90, taiwanCommand: 85, taiwanSupply: 70, taiwanMorale: 80,
      usIntervention: 35, japanIntervention: 20, internationalOpinion: 55
    },
    provinces: {
      taipei: { id:"taipei", controlStage:"stable_defense", landingStage:"none", defenseValue: 30 },
      kaohsiung: { id:"kaohsiung", controlStage:"contested", landingStage:"landing_attempt", defenseValue: 18 }
    },
    decks: {
      china: { hand: ["china_blitz_order"], deck: ["china_night_operation"], discard: [] },
      taiwan: { hand: ["taiwan_backup_network"], deck: [], discard: ["taiwan_emergency_restoration"] }
    },
    thisTurn: { operationLog: [], visualEvents: [], chinaPlayed: [], taiwanPlayed: [] },
    persistent: {
      milestones: { capitalRelocationAppliedAt: 8 },
      alliedIntervention: { active: false },
      lastActId: "ACT_1"
    },
    log: [{ turn: 1, level: "info", msg: "게임 시작" }]
  };
  if (withMission) {
    s.mission = { id: "kaohsiung_defense", name: "가오슝 방어", objectives: [], failures: [], startedAt: 1 };
  }
  return s;
}

function mkCampaign({ side = "taiwan", scenarioId = "short_72h", missionId = null, tutorialMode = false } = {}) {
  return {
    selectedSide: side, difficulty: "normal",
    scenarioId, totalTurns: scenarioId === "short_72h" ? 30 : 84,
    missionId, tutorialMode,
    developerMode: false
  };
}

// =====================================================================
// #1+2: save/load round trip
// =====================================================================
console.log("\n1+2. saveGame + loadGame round trip");
stored = {};
const s1 = mkState({ turn: 12 });
const c1 = mkCampaign({ side: "taiwan", scenarioId: "full_21d" });
const r1 = saveGame(s1, c1, CURRENT_BUILD, "manual");
if (!r1.ok) {
  console.error(`FAIL: saveGame ok=false: ${r1.error}`); process.exit(1);
}
if (!stored[SAVE_CONSTANTS.STORAGE_KEY]) {
  console.error(`FAIL: localStorage 기록 안 됨`); process.exit(1);
}
const loaded = loadGame(CURRENT_BUILD);
if (!loaded || loaded.invalid) {
  console.error(`FAIL: loadGame invalid: ${loaded?.reason}`); process.exit(1);
}
if (loaded.state.turn !== 12) {
  console.error(`FAIL: turn 복원 X, ${loaded.state.turn}`); process.exit(1);
}
if (loaded.campaign.selectedSide !== "taiwan") {
  console.error(`FAIL: campaign 복원 X`); process.exit(1);
}
if (loaded.buildTag !== CURRENT_BUILD) {
  console.error(`FAIL: buildTag 복원 X`); process.exit(1);
}
console.log(`  ✓ round trip OK (turn ${loaded.state.turn}, size ${r1.size}B)`);

// =====================================================================
// #3+4: getSaveMetadata + hasSavedGame
// =====================================================================
console.log("\n3+4. getSaveMetadata + hasSavedGame");
const meta = getSaveMetadata(CURRENT_BUILD);
if (!meta) { console.error(`FAIL: meta null`); process.exit(1); }
if (meta.turn !== 12 || meta.side !== "taiwan" || meta.scenarioId !== "full_21d") {
  console.error(`FAIL: meta 필드 누락 ${JSON.stringify(meta)}`); process.exit(1);
}
// state 자체는 포함 안 됨
if (meta.state || meta.gauges) {
  console.error(`FAIL: meta에 state 노출`); process.exit(1);
}
if (!hasSavedGame(CURRENT_BUILD)) {
  console.error(`FAIL: hasSavedGame false`); process.exit(1);
}
console.log(`  ✓ meta: turn=${meta.turn}, side=${meta.side}, scen=${meta.scenarioId}`);

// =====================================================================
// #5: BUILD 불일치
// =====================================================================
console.log("\n5. BUILD_TAG 불일치 → invalid");
const r5 = loadGame("v0.5.0");
if (!r5 || !r5.invalid || r5.reason !== "build_mismatch") {
  console.error(`FAIL: build_mismatch 처리 X, ${JSON.stringify(r5)}`); process.exit(1);
}
console.log(`  ✓ build_mismatch (saved=${r5.saved}, expected=${r5.expected})`);

// =====================================================================
// #6: schemaVersion 불일치
// =====================================================================
console.log("\n6. schemaVersion 불일치 → invalid");
stored[SAVE_CONSTANTS.STORAGE_KEY] = JSON.stringify({
  schemaVersion: 999,
  buildTag: CURRENT_BUILD,
  savedAt: Date.now(),
  campaign: c1,
  state: s1
});
const r6 = loadGame(CURRENT_BUILD);
if (!r6 || !r6.invalid || r6.reason !== "schema_mismatch") {
  console.error(`FAIL: schema_mismatch 처리 X, ${JSON.stringify(r6)}`); process.exit(1);
}
console.log(`  ✓ schema_mismatch (saved=${r6.saved}, expected=${r6.expected})`);

// =====================================================================
// #7: outcome 있는 게임 저장 거부 + 로드 시 invalid
// =====================================================================
console.log("\n7. outcome 있는 게임 저장 거부");
stored = {};
const sFinished = mkState({ turn: 50, outcome: "taiwan_survival_win" });
const r7a = saveGame(sFinished, c1, CURRENT_BUILD);
if (r7a.ok) {
  console.error(`FAIL: outcome 있는 게임 저장됨`); process.exit(1);
}
// 그러나 직접 stored에 outcome 포함 데이터 넣으면 load 시 invalid
stored[SAVE_CONSTANTS.STORAGE_KEY] = JSON.stringify({
  schemaVersion: 1,
  buildTag: CURRENT_BUILD,
  savedAt: Date.now(),
  campaign: c1,
  state: sFinished
});
const r7b = loadGame(CURRENT_BUILD);
if (!r7b || !r7b.invalid || r7b.reason !== "already_finished") {
  console.error(`FAIL: 끝난 게임 로드 시 invalid X, ${JSON.stringify(r7b)}`); process.exit(1);
}
console.log(`  ✓ outcome 있으면 save 거부 + load 시 already_finished`);

// =====================================================================
// #8: clearSavedGame
// =====================================================================
console.log("\n8. clearSavedGame → 이후 load null");
stored = {};
saveGame(s1, c1, CURRENT_BUILD);
clearSavedGame();
if (loadGame(CURRENT_BUILD) !== null) {
  console.error(`FAIL: clear 후 load 비null`); process.exit(1);
}
if (hasSavedGame(CURRENT_BUILD)) {
  console.error(`FAIL: clear 후 hasSavedGame true`); process.exit(1);
}
console.log(`  ✓ clearSavedGame 후 hasSavedGame=false`);

// =====================================================================
// #9: 깊은 객체 round-trip
// =====================================================================
console.log("\n9. 깊은 객체 (mission, persistent, decks) round-trip");
stored = {};
const sDeep = mkState({ turn: 20, withMission: true });
const cDeep = mkCampaign({
  side: "china", scenarioId: "full_21d",
  missionId: "kaohsiung_defense", tutorialMode: true
});
const r9 = saveGame(sDeep, cDeep, CURRENT_BUILD);
if (!r9.ok) { console.error(`FAIL: deep save: ${r9.error}`); process.exit(1); }

const loadedDeep = loadGame(CURRENT_BUILD);
if (loadedDeep.state.mission?.id !== "kaohsiung_defense") {
  console.error(`FAIL: mission 복원 X`); process.exit(1);
}
if (loadedDeep.state.persistent.milestones?.capitalRelocationAppliedAt !== 8) {
  console.error(`FAIL: persistent milestone 복원 X`); process.exit(1);
}
if (loadedDeep.state.decks.china.hand[0] !== "china_blitz_order") {
  console.error(`FAIL: deck 복원 X`); process.exit(1);
}
if (!loadedDeep.campaign.tutorialMode) {
  console.error(`FAIL: tutorialMode 복원 X`); process.exit(1);
}
if (loadedDeep.campaign.missionId !== "kaohsiung_defense") {
  console.error(`FAIL: missionId 복원 X`); process.exit(1);
}
console.log(`  ✓ mission + persistent + decks + tutorialMode 모두 round-trip`);

// =====================================================================
// #10: 누락 필드 invalid
// =====================================================================
console.log("\n10. 누락 필드 → invalid");
stored[SAVE_CONSTANTS.STORAGE_KEY] = JSON.stringify({
  schemaVersion: 1,
  buildTag: CURRENT_BUILD,
  savedAt: Date.now()
  // campaign + state 누락
});
const r10 = loadGame(CURRENT_BUILD);
if (!r10 || !r10.invalid || r10.reason !== "missing_fields") {
  console.error(`FAIL: missing_fields 처리 X, ${JSON.stringify(r10)}`); process.exit(1);
}
console.log(`  ✓ missing_fields invalid 정상`);

// =====================================================================
// #11: playable_app.js 통합 확인
// =====================================================================
console.log("\n11. playable_app.js 통합");
const fs = await import("node:fs");
const source = fs.readFileSync(new URL("./playable_app.js", import.meta.url), "utf8");
for (const sym of ["saveGame", "loadGame", "getSaveMetadata", "clearSavedGame", "resumeGame"]) {
  if (!source.includes(sym)) {
    console.error(`FAIL: ${sym} 없음`); process.exit(1);
  }
}
// 후크
if (!source.includes("saveGame(state, campaign, BUILD_TAG, \"auto\")")) {
  console.error(`FAIL: DAY 자동 저장 후크 없음`); process.exit(1);
}
if (!source.includes("saveGame(state, campaign, BUILD_TAG, \"manual\")")) {
  console.error(`FAIL: 수동 저장 후크 없음`); process.exit(1);
}
if (!source.includes("clearSavedGame()")) {
  console.error(`FAIL: outcome 시 clear 후크 없음`); process.exit(1);
}
if (!source.includes("resume-block") || !source.includes("resumeBtn")) {
  console.error(`FAIL: 이어하기 UI 없음`); process.exit(1);
}
console.log(`  ✓ import + auto/manual/clear 후크 + 이어하기 UI 모두 present`);

console.log("\n✓ save system smoke test passed");
