// =====================================================================
// 스모크 테스트: target_selector
// =====================================================================
// 시나리오:
//   1. 초기 상태에서 중국 공격 카드의 선호 타깃 출력
//   2. 가오슝에 sea_superiority 진척시킨 후 다시 선호 타깃 출력 (진척된 곳 선호 확인)
//   3. 대만 방어 카드의 광역 적용 vs 단일 선택 비교
//   4. selectedProvince 명시 시 그것이 우선되는지 확인
//   5. suggestChinaAxis / suggestTaiwanFocus 추천 동작
// =====================================================================

import fs from "node:fs";
import { createInitialState, buildCardIndex, buildAxisIndex } from "./state.js";
import { initializeDecks } from "./deck_state.js";
import {
  selectChinaAttackTarget,
  selectTaiwanDefenseTargets,
  selectTargets,
  suggestChinaAxis,
  suggestTaiwanFocus,
  scoreChinaAttackTarget,
  scoreTaiwanDefenseTarget
} from "./target_selector.js";
import { GAME_RULES } from "./game_rules.js";

const dataDir = new URL("../data/", import.meta.url);
const provinces = JSON.parse(fs.readFileSync(new URL("provinces.json", dataDir), "utf8"));
const axes = JSON.parse(fs.readFileSync(new URL("axes.json", dataDir), "utf8"));
const cardsChina = JSON.parse(fs.readFileSync(new URL("cards_china.json", dataDir), "utf8"));
const cardsTaiwan = JSON.parse(fs.readFileSync(new URL("cards_taiwan.json", dataDir), "utf8"));
const events = JSON.parse(fs.readFileSync(new URL("events_global.json", dataDir), "utf8"));

const state = createInitialState({
  provinces, gameRules: GAME_RULES, axes, cardsChina, cardsTaiwan, events
});
initializeDecks(state, cardsChina, cardsTaiwan);
const cardIndex = buildCardIndex(cardsChina, cardsTaiwan);
const axisIndex = buildAxisIndex(axes);

// 카드 찾기 헬퍼
const card = (id) => cardIndex.get(id);
const axis = (id) => axisIndex.get(id);

console.log("=== Case 1: 중국 북부 압박 카드 초기 타깃 선호 ===");
const northAssault = card("china_north_assault");
const northAxis = axis("north_pressure");
{
  const picked = selectChinaAttackTarget(state, northAssault, northAxis);
  console.log(`  선택: ${picked}`);
  for (const candId of northAssault.target) {
    const p = state.provinces[candId];
    const s = scoreChinaAttackTarget(state, p, northAssault, northAxis);
    console.log(`    [${candId.padEnd(8)}] 정치=${p.politicalValue} 보급=${p.supplyValue} 방어=${p.defenseValue} 점수=${s.toFixed(2)}`);
  }
}

console.log("\n=== Case 2: 지룽 sea_superiority 진척 후 재선택 ===");
state.provinces.keelung.landingStage = "sea_superiority";
state.provinces.keelung.controlStage = "contested";
{
  const picked = selectChinaAttackTarget(state, northAssault, northAxis);
  console.log(`  선택: ${picked} (예상: keelung — 진척된 곳 선호)`);
  for (const candId of northAssault.target) {
    const p = state.provinces[candId];
    const s = scoreChinaAttackTarget(state, p, northAssault, northAxis);
    console.log(`    [${candId.padEnd(8)}] landingStage=${p.landingStage} 점수=${s.toFixed(2)}`);
  }
}

console.log("\n=== Case 3: 대만 북부 방어 강화 (defense_buff) — 광역 적용 ===");
const northDefense = card("taiwan_north_defense_buildup");
{
  const targets = selectTaiwanDefenseTargets(state, northDefense);
  console.log(`  선택: [${targets.join(", ")}] (예상: 3개 전체)`);
}

console.log("\n=== Case 4: 대만 항만 방어 강화 (defense_buff) — 광역 적용 ===");
const portDefense = card("taiwan_port_defense_buildup");
{
  const targets = selectTaiwanDefenseTargets(state, portDefense);
  console.log(`  선택: [${targets.join(", ")}] (예상: keelung, kaohsiung)`);
}

console.log("\n=== Case 5: 기동 예비대 (selected_province) ===");
const mobileReserve = card("taiwan_mobile_reserve_deploy");
{
  // selectedProvince 미지정
  state.thisTurn.selectedProvince = null;
  const targets1 = selectTaiwanDefenseTargets(state, mobileReserve);
  console.log(`  미지정 시: [${targets1.join(", ")}] (예상: 빈 배열)`);

  // selectedProvince 지정
  state.thisTurn.selectedProvince = "kaohsiung";
  const targets2 = selectTaiwanDefenseTargets(state, mobileReserve);
  console.log(`  selectedProvince=kaohsiung: [${targets2.join(", ")}]`);
  state.thisTurn.selectedProvince = null;
}

console.log("\n=== Case 6: 중국 공격 카드 + selectedProvince 우선 적용 ===");
{
  // 평상시: 점수 기반
  const normalPick = selectChinaAttackTarget(state, northAssault, northAxis);
  console.log(`  평상시: ${normalPick}`);

  // selectedProvince를 후보에 있는 다른 곳으로 강제
  state.thisTurn.selectedProvince = "taoyuan";
  const forcedPick = selectChinaAttackTarget(state, northAssault, northAxis);
  console.log(`  selectedProvince=taoyuan: ${forcedPick} (예상: taoyuan)`);

  // selectedProvince를 후보에 없는 곳으로
  state.thisTurn.selectedProvince = "taipei";
  const fallbackPick = selectChinaAttackTarget(state, northAssault, northAxis);
  console.log(`  selectedProvince=taipei(후보 아님): ${fallbackPick} (예상: 점수 기반 폴백)`);
  state.thisTurn.selectedProvince = null;
}

console.log("\n=== Case 7: AI 추천 — 중국 주공축 ===");
{
  const rec = suggestChinaAxis(state, axes);
  console.log(`  추천: ${rec.axisId}`);
  const sorted = Object.entries(rec.scores).sort((a, b) => b[1] - a[1]);
  for (const [id, sc] of sorted) {
    console.log(`    ${id.padEnd(22)} = ${sc.toFixed(2)}`);
  }
}

console.log("\n=== Case 8: AI 추천 — 대만 방어 중점 ===");
{
  const rec = suggestTaiwanFocus(state);
  console.log(`  추천: focus=${rec.focus} mode=${rec.mode}`);
  for (const s of rec.scores) {
    console.log(`    ${s.id.padEnd(8)} score=${s.score.toFixed(2)}`);
  }
}

console.log("\n=== Case 9: 위기 상황 — 정부 60 미만 + 가오슝 교두보 ===");
{
  // 상황 조작: 위기 상태 시뮬레이션
  state.gauges.taiwanGovernment = 50;
  state.gauges.taiwanSupply = 40;
  state.provinces.kaohsiung.landingStage = "beachhead";
  state.provinces.kaohsiung.controlStage = "beachhead_established";

  const rec = suggestTaiwanFocus(state);
  console.log(`  위기 추천: focus=${rec.focus} mode=${rec.mode}`);
  for (const s of rec.scores) {
    console.log(`    ${s.id.padEnd(8)} score=${s.score.toFixed(2)}`);
  }
}

console.log("\n=== Case 10: 통합 진입점 selectTargets ===");
{
  // 상태 복구
  state.gauges.taiwanGovernment = 100;
  state.gauges.taiwanSupply = 80;
  state.provinces.kaohsiung.landingStage = "none";
  state.provinces.kaohsiung.controlStage = "stable_defense";

  console.log(`  중국 공격카드: ${JSON.stringify(selectTargets(state, northAssault, northAxis))}`);
  console.log(`  중국 봉쇄카드: ${JSON.stringify(selectTargets(state, card("china_naval_blockade_intensify"), axis("naval_blockade")))}`);
  console.log(`  중국 정보전: ${JSON.stringify(selectTargets(state, card("china_cyber_attack"), axis("information_warfare")))}`);
  console.log(`  대만 방어버프: ${JSON.stringify(selectTargets(state, card("taiwan_north_defense_buildup"), null))}`);
  console.log(`  대만 외교: ${JSON.stringify(selectTargets(state, card("taiwan_international_appeal"), null))}`);
}

console.log("\ntarget_selector smoke test passed");
