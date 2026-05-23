// v0.4.0-b day_cycle smoke test
import fs from "node:fs";
import { createInitialState, buildCardIndex, buildAxisIndex } from "./state.js";
import { initializeDecks } from "./deck_state.js";
import { runTurn } from "./turn_resolver.js";
import { GAME_RULES } from "./game_rules.js";
import {
  dayNumberForTurn, isDayEndTurn, turnRangeForDay,
  formatDayLabel, buildDayReport, TURNS_PER_DAY
} from "./day_cycle.js";

const dataDir = new URL("../data/", import.meta.url);
const provinces = JSON.parse(fs.readFileSync(new URL("provinces.json", dataDir), "utf8"));
const axes = JSON.parse(fs.readFileSync(new URL("axes.json", dataDir), "utf8"));
const cc = JSON.parse(fs.readFileSync(new URL("cards_china.json", dataDir), "utf8"));
const ct = JSON.parse(fs.readFileSync(new URL("cards_taiwan.json", dataDir), "utf8"));
const events = JSON.parse(fs.readFileSync(new URL("events_global.json", dataDir), "utf8"));

// 1. dayNumberForTurn 매핑 검증
const cases = [[1, 1], [2, 1], [3, 1], [4, 1], [5, 2], [8, 2], [9, 3], [28, 7], [29, 8], [30, 8]];
for (const [t, d] of cases) {
  if (dayNumberForTurn(t) !== d) {
    console.error(`FAIL: turn ${t} expected day ${d}, got ${dayNumberForTurn(t)}`);
    process.exit(1);
  }
}
console.log("✓ dayNumberForTurn 매핑 정상");

// 2. isDayEndTurn (T4, T8, ...)
const dayEnds = [];
for (let t = 1; t <= 30; t++) if (isDayEndTurn(t)) dayEnds.push(t);
const expected = [4, 8, 12, 16, 20, 24, 28];
if (JSON.stringify(dayEnds) !== JSON.stringify(expected)) {
  console.error(`FAIL: dayEnds expected ${expected}, got ${dayEnds}`);
  process.exit(1);
}
console.log(`✓ isDayEndTurn: ${dayEnds.join(", ")}`);

// 3. turnRangeForDay
if (JSON.stringify(turnRangeForDay(1)) !== JSON.stringify([1, 4])) { console.error("FAIL day 1 range"); process.exit(1); }
if (JSON.stringify(turnRangeForDay(3)) !== JSON.stringify([9, 12])) { console.error("FAIL day 3 range"); process.exit(1); }
console.log("✓ turnRangeForDay 정상");

// 4. formatDayLabel
if (formatDayLabel(1) !== "DAY 1 (D+0)") { console.error("FAIL day label 1"); process.exit(1); }
if (formatDayLabel(7) !== "DAY 7 (D+6)") { console.error("FAIL day label 7"); process.exit(1); }
console.log("✓ formatDayLabel: " + formatDayLabel(1) + " ... " + formatDayLabel(7));

// 5. 실제 게임에서 buildDayReport
const state = createInitialState({ provinces, gameRules: GAME_RULES, axes, cardsChina: cc, cardsTaiwan: ct, events });
initializeDecks(state, cc, ct);
const indices = { cardIndex: buildCardIndex(cc, ct), axisIndex: buildAxisIndex(axes), events };

// 4턴 (DAY 1) 진행
for (let i = 0; i < 4; i++) {
  runTurn(state, {
    chinaAxis: "south_landing",
    taiwanFocus: "kaohsiung",
    selectedProvince: "kaohsiung",
    chinaCards: [],
    taiwanCards: []
  }, indices);
}

console.log("\n=== DAY 1 빌드 후 turn:", state.turn, "===");

const report = buildDayReport(state, 1, events);
console.log(`\nDAY ${report.dayNumber} 요약: ${report.dayLabel} (T${report.turnRange[0]}-${report.turnRange[1]})`);
console.log(`게이지 델타 종류 수: ${Object.keys(report.gaugeDeltas).length}`);
for (const [k, v] of Object.entries(report.gaugeDeltas)) {
  console.log(`  - ${v.label}: ${v.delta > 0 ? "+" : ""}${v.delta} (${v.before} → ${v.after})`);
}
console.log(`점령 변화: ${report.occupationChanges.length}건`);
for (const c of report.occupationChanges) {
  console.log(`  - ${c.name}: ${c.before} → ${c.after}${c.isLoss ? " [상실]" : c.isRecover ? " [회복]" : ""}`);
}
console.log(`이벤트: ${report.events.length}건`);
for (const e of report.events) console.log(`  - ${e}`);
console.log(`대형 전투 (margin ≥ 5): ${report.majorBattles.length}건`);
for (const b of report.majorBattles) console.log(`  - T${b.turn} ${b.text}`);
console.log(`\n진영별 해석:`);
console.log(`  [대만] ${report.interpretation.taiwan}`);
console.log(`  [중국] ${report.interpretation.china}`);
console.log(`  [공통] ${report.interpretation.both}`);

// 6. 데이터 구조 검증
if (typeof report.dayNumber !== "number") { console.error("FAIL dayNumber type"); process.exit(1); }
if (!Array.isArray(report.turnRange) || report.turnRange.length !== 2) { console.error("FAIL turnRange"); process.exit(1); }
if (typeof report.gaugeDeltas !== "object") { console.error("FAIL gaugeDeltas"); process.exit(1); }
if (!Array.isArray(report.events)) { console.error("FAIL events"); process.exit(1); }
if (!Array.isArray(report.occupationChanges)) { console.error("FAIL occupations"); process.exit(1); }
if (!Array.isArray(report.majorBattles)) { console.error("FAIL battles"); process.exit(1); }
if (!report.dayProgress || typeof report.dayProgress !== "object") { console.error("FAIL dayProgress"); process.exit(1); }
if (!report.interpretation || !report.interpretation.taiwan) { console.error("FAIL interpretation"); process.exit(1); }

// 7. c2-b1.2: DAY 진행 통계 집계 검증
const progressState = createInitialState({ provinces, gameRules: GAME_RULES, axes, cardsChina: cc, cardsTaiwan: ct, events });
progressState.log.push({
  turn: 1,
  phase: 1,
  name: "information",
  snapshot: { ...progressState.gauges },
  provincesSnapshot: {}
});
progressState.log.push({
  turn: 1,
  phase: 4,
  name: "operation_resolution",
  operations: [
    "중국 덱 소진: 버림더미 9장 셔플 복귀",
    "남부 상륙 보류: 유효한 지역 타깃 없음"
  ],
  combatResults: []
});
progressState.log.push({
  turn: 2,
  phase: 1,
  name: "information",
  snapshot: { ...progressState.gauges },
  provincesSnapshot: {},
  perTurnApplied: [{
    rewardId: "tw_humanitarian_campaign",
    rewardName: "인도주의 캠페인",
    details: {
      usIntervention: { before: 10, after: 12, delta: 2, requested: 2 },
      japanIntervention: { before: 20, after: 21, delta: 1, requested: 1 }
    }
  }]
});
progressState.log.push({
  turn: 2,
  phase: 4,
  name: "operation_resolution",
  operations: ["남부 상륙 보류: 유효한 지역 타깃 없음"],
  combatResults: []
});
const progressReport = buildDayReport(progressState, 1, events);
const progress = progressReport.dayProgress;
if (progress.deckReshuffles.total !== 1) { console.error("FAIL dayProgress deck reshuffle total"); process.exit(1); }
if (progress.deckReshuffles.bySide[0]?.cards !== 9) { console.error("FAIL dayProgress deck reshuffle cards"); process.exit(1); }
if (progress.operationReplans.total !== 2) { console.error("FAIL dayProgress replan total"); process.exit(1); }
if (progress.operationReplans.byOperation[0]?.count !== 2) { console.error("FAIL dayProgress replan by operation"); process.exit(1); }
const rewardTotals = progress.persistentRewardTotals[0]?.totals || {};
if (rewardTotals.usIntervention !== 2 || rewardTotals.japanIntervention !== 1) {
  console.error("FAIL dayProgress persistent reward totals");
  process.exit(1);
}
console.log("✓ dayProgress 집계 정상");

console.log("\n✓ day_cycle smoke test passed");
