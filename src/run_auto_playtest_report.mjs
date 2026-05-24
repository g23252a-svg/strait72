// =====================================================================
// run_auto_playtest_report.mjs (v0.4.2-b1.3)
// ---------------------------------------------------------------------
// 자동 플레이테스트 리포터.
//
// 목적:
//   수동 플레이 대신 N판 자동 시뮬을 돌려서 핵심 지표를 한 번에 본다.
//   사용자가 매번 84턴을 손으로 누르지 않아도, 패치 후 자동으로 검증.
//
// 사용:
//   node src/run_auto_playtest_report.mjs
//   node src/run_auto_playtest_report.mjs --runs=100 --seed=42 --scenario=full_21d --side=taiwan
//
// 리포트 섹션:
//   [Outcome]     승률 분포
//   [Campaign Length] 평균 종료 턴, T84 완주율, ACT 3 도달률/평균 진입
//   [ACT 3 Axis after T55] 후반 축 선택 분포 (남부/북부 반복 감지)
//   [ACT 3 Events] T45+ 이벤트 발생 수, repeatable hits
//   [Bug Watch]   sea_zone defense / duplicate card / supply=0 blockade
//   [Result]      PASS / WARN / FAIL
// =====================================================================

import fs from "node:fs";

// ---------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------
function parseArgs(argv) {
  const out = {};
  for (const raw of argv) {
    if (!raw.startsWith("--")) continue;
    const body = raw.slice(2);
    if (body.includes("=")) {
      const [k, v] = body.split("=", 2);
      out[k] = v;
    } else {
      out[body] = true;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const RUNS = parseInt(args.runs || "100", 10);
const BASE_SEED = parseInt(args.seed || "42", 10);
const SCENARIO = args.scenario || "full_21d";
const SIDE = args.side || "taiwan";
const VERBOSE = args.verbose === true;

// ---------------------------------------------------------------------
// Seeded RNG
// ---------------------------------------------------------------------
const origRandom = Math.random;
function makeRng(seedInput) {
  let seed = seedInput % 2147483647;
  if (seed <= 0) seed += 2147483646;
  return function rng() {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

// ---------------------------------------------------------------------
// 데이터 + 모듈 로드
// ---------------------------------------------------------------------
const here = new URL(".", import.meta.url);
const dataDir = new URL("../data/", here);
const provinces = JSON.parse(fs.readFileSync(new URL("provinces.json", dataDir), "utf8"));
const axes = JSON.parse(fs.readFileSync(new URL("axes.json", dataDir), "utf8"));
const cardsChina = JSON.parse(fs.readFileSync(new URL("cards_china.json", dataDir), "utf8"));
const cardsTaiwan = JSON.parse(fs.readFileSync(new URL("cards_taiwan.json", dataDir), "utf8"));
const events = JSON.parse(fs.readFileSync(new URL("events_global.json", dataDir), "utf8"));

const { GAME_RULES } = await import("./game_rules.js");
const { createInitialState, buildCardIndex, buildAxisIndex } = await import("./state.js");
const { runTurn } = await import("./turn_resolver.js");
const { initializeDecks } = await import("./deck_state.js");
const aiMod = await import("./ai_decisions.js");
const { createCampaignState } = await import("./campaign_state.js");

const REPEATABLE_ACT3_IDS = new Set([
  "global_us_carrier_recon_pressure",
  "global_china_limited_blockade_maintained",
  "global_taiwan_resupply_attempt",
  "global_ceasefire_opinion_spread",
  "global_china_hardliner_reignite",
  "global_japan_naval_surveillance_rotation"
]);
const ONCE_ACT3_IDS = new Set([
  "global_backchannel_ceasefire_mediation",
  "global_china_hardliner_pushback",
  "global_us_carrier_pressure_maneuver",
  "global_japan_maritime_surveillance",
  "global_taiwan_counterattack_prep",
  "global_supply_lines_reopened",
  "global_china_supply_chain_fracture"
]);

// ---------------------------------------------------------------------
// 한 판 시뮬
// ---------------------------------------------------------------------
function simulateOne(runSeed) {
  Math.random = makeRng(runSeed);

  const campaign = createCampaignState(SIDE, "normal", SCENARIO);
  const state = createInitialState({
    provinces, gameRules: GAME_RULES, axes, cardsChina, cardsTaiwan, events,
    totalTurnsOverride: campaign.totalTurns
  });
  initializeDecks(state, cardsChina, cardsTaiwan);
  const indices = {
    cardIndex: buildCardIndex(cardsChina, cardsTaiwan),
    axisIndex: buildAxisIndex(axes), events
  };

  // 트래킹용 데이터
  const meta = {
    axisHistory: [],         // {turn, axis, supply, tempo, lastActId}
    eventHistory: [],        // {turn, id}
    seaZoneDefenseHits: 0,
    duplicateCardHits: 0,
    supply0BlockadePicks: 0,
    act3EnteredAt: null
  };
  const seenEvents = new Set();

  let safety = 100;
  while (!state.outcome && state.turn <= state.totalTurns && safety-- > 0) {
    const decisions = {
      chinaAxis: aiMod.decideChinaAxis(state, axes),
      taiwanFocus: aiMod.decideTaiwanFocus(state, axes),
      chinaCards: [], taiwanCards: [],
      chinaFacedown: [], taiwanFacedown: []
    };
    decisions.chinaCards = aiMod.chooseChinaCards(state, decisions.chinaAxis, indices.cardIndex);
    decisions.taiwanCards = aiMod.chooseTaiwanCards(state, decisions.chinaAxis, decisions.taiwanFocus, indices.cardIndex);

    const turnBefore = state.turn;
    const supplyBefore = state.gauges.chinaSupply;
    const tempoBefore = state.gauges.chinaTempo;

    // supply=0 + blockade pick 감지
    if (supplyBefore <= 0 && decisions.chinaAxis === "naval_blockade") {
      meta.supply0BlockadePicks++;
    }

    meta.axisHistory.push({
      turn: turnBefore, axis: decisions.chinaAxis,
      supply: supplyBefore, tempo: tempoBefore,
      lastActId: state.persistent?.lastActId || null
    });

    runTurn(state, decisions, indices, campaign);

    // ACT 3 진입 시점
    if (!meta.act3EnteredAt && state.persistent?.milestones?.act3EnteredAt) {
      meta.act3EnteredAt = state.persistent.milestones.act3EnteredAt;
    }

    // 새 이벤트
    for (const id of state.persistent?.triggeredOnce || []) {
      if (!seenEvents.has(id)) {
        seenEvents.add(id);
        meta.eventHistory.push({ turn: turnBefore, id });
      }
    }
    // repeatable 이벤트는 triggeredOnce에 누적되지 않을 수도 있음 — log에서 추출
    const recent = state.log.filter(l => l.turn === turnBefore && l.triggeredEvents);
    for (const entry of recent) {
      for (const eid of entry.triggeredEvents || []) {
        if (REPEATABLE_ACT3_IDS.has(eid)) {
          meta.eventHistory.push({ turn: turnBefore, id: eid, repeatable: true });
        }
      }
    }

    // Bug watch: 로그 스캔
    for (const logLine of (state.thisTurn?.operationLog || [])) {
      if (logLine.includes("방어 보강 미적용")) meta.seaZoneDefenseHits++;
    }
    for (const lg of state.log || []) {
      if (lg.turn === turnBefore && lg.msg && lg.msg.includes("duplicate card blocked")) {
        meta.duplicateCardHits++;
      }
    }
  }

  return {
    seed: runSeed,
    finalTurn: state.turn,
    outcome: state.outcome || "timeout",
    totalTurns: state.totalTurns,
    meta
  };
}

// ---------------------------------------------------------------------
// 메인 — N판 시뮬
// ---------------------------------------------------------------------
console.log(`=== Auto Playtest Report v0.4.2-b1.3 ===`);
console.log(`runs=${RUNS} baseSeed=${BASE_SEED} scenario=${SCENARIO} side=${SIDE}`);
console.log();

const results = [];
for (let i = 0; i < RUNS; i++) {
  results.push(simulateOne(BASE_SEED + i));
}
Math.random = origRandom;

// ---------------------------------------------------------------------
// 집계
// ---------------------------------------------------------------------
const outcomeCounts = {};
for (const r of results) outcomeCounts[r.outcome] = (outcomeCounts[r.outcome] || 0) + 1;

const totalFinalTurn = results.reduce((s, r) => s + r.finalTurn, 0);
const avgFinalTurn = (totalFinalTurn / RUNS).toFixed(1);
const t84Count = results.filter(r => r.finalTurn >= r.totalTurns).length;
const t84Ratio = (t84Count / RUNS * 100).toFixed(0);

// ACT 3 reach
const act3Reached = results.filter(r => r.meta.act3EnteredAt).length;
const act3ReachRatio = (act3Reached / RUNS * 100).toFixed(0);
const avgAct3Entry = act3Reached > 0
  ? (results.filter(r => r.meta.act3EnteredAt).reduce((s, r) => s + r.meta.act3EnteredAt, 0) / act3Reached).toFixed(1)
  : "N/A";

// T55+ axis 분포
const lateAxisCounts = {};
let lateAxisTotal = 0;
for (const r of results) {
  for (const a of r.meta.axisHistory) {
    if (a.turn >= 55) {
      lateAxisCounts[a.axis] = (lateAxisCounts[a.axis] || 0) + 1;
      lateAxisTotal++;
    }
  }
}

// supply=0 axis 분포
const supply0AxisCounts = {};
let supply0Total = 0;
for (const r of results) {
  for (const a of r.meta.axisHistory) {
    if (a.supply <= 0) {
      supply0AxisCounts[a.axis] = (supply0AxisCounts[a.axis] || 0) + 1;
      supply0Total++;
    }
  }
}

// ACT 3 이벤트 카운트
let act3EventTotal = 0;
let repeatableHits = 0;
let lateActivityTurns = 0; // T55+ 이벤트 발생한 turn 수
for (const r of results) {
  const lateTurnsWithEvents = new Set();
  for (const e of r.meta.eventHistory) {
    if (e.turn >= 45) act3EventTotal++;
    if (e.repeatable) repeatableHits++;
    if (e.turn >= 55) lateTurnsWithEvents.add(e.turn);
  }
  lateActivityTurns += lateTurnsWithEvents.size;
}
const avgAct3Events = (act3EventTotal / RUNS).toFixed(1);
const avgRepeatableHits = (repeatableHits / RUNS).toFixed(1);
const avgLateActivity = (lateActivityTurns / RUNS).toFixed(1);

// Bug watch totals
const totalSeaZoneHits = results.reduce((s, r) => s + r.meta.seaZoneDefenseHits, 0);
const totalDuplicateHits = results.reduce((s, r) => s + r.meta.duplicateCardHits, 0);
const totalSupply0Blockade = results.reduce((s, r) => s + r.meta.supply0BlockadePicks, 0);

// ---------------------------------------------------------------------
// 리포트 출력
// ---------------------------------------------------------------------
function pct(n, total) {
  return total > 0 ? `${(n / total * 100).toFixed(1)}%` : "0%";
}

console.log(`[Outcome]`);
const outcomesSorted = Object.entries(outcomeCounts).sort((a,b) => b[1] - a[1]);
for (const [oc, count] of outcomesSorted) {
  console.log(`  ${oc.padEnd(32)} ${pct(count, RUNS).padStart(7)} (${count})`);
}
console.log();

console.log(`[Campaign Length]`);
console.log(`  avgFinalTurn        ${avgFinalTurn}`);
console.log(`  T${results[0]?.totalTurns || 84} completion    ${t84Ratio}% (${t84Count}/${RUNS})`);
console.log(`  ACT3 reached        ${act3ReachRatio}% (${act3Reached}/${RUNS})`);
console.log(`  avgAct3Entry        T${avgAct3Entry}`);
console.log();

console.log(`[ACT 3 Axis after T55] total=${lateAxisTotal} axis-turns`);
const lateAxesSorted = Object.entries(lateAxisCounts).sort((a,b) => b[1] - a[1]);
for (const [ax, count] of lateAxesSorted) {
  console.log(`  ${ax.padEnd(20)} ${pct(count, lateAxisTotal).padStart(7)} (${count})`);
}
console.log();

if (supply0Total > 0) {
  console.log(`[Axis when chinaSupply=0] total=${supply0Total} axis-turns`);
  const sa = Object.entries(supply0AxisCounts).sort((a,b) => b[1] - a[1]);
  for (const [ax, count] of sa) {
    console.log(`  ${ax.padEnd(20)} ${pct(count, supply0Total).padStart(7)} (${count})`);
  }
  console.log();
}

console.log(`[ACT 3 Events]`);
console.log(`  T45+ event fires (avg/run)        ${avgAct3Events}`);
console.log(`  Repeatable event hits (avg/run)   ${avgRepeatableHits}`);
console.log(`  T55+ turns with events (avg/run)  ${avgLateActivity}`);
console.log();

// ---------------------------------------------------------------------
// Bug watch + PASS/WARN/FAIL
// ---------------------------------------------------------------------
console.log(`[Bug Watch]`);
const issues = [];

function check(label, value, threshold, severity = "WARN") {
  const failed = value > threshold;
  const status = failed ? (severity === "FAIL" ? "❌" : "⚠️") : "✅";
  console.log(`  ${status} ${label.padEnd(48)} ${value}`);
  if (failed) issues.push({ label, value, threshold, severity });
}

check("sea_zone defense buff hits (total)", totalSeaZoneHits, 0, "WARN");
check("duplicate card use (total)", totalDuplicateHits, 0, "WARN");
check("supply=0 blockade picks (total)", totalSupply0Blockade, 0, "FAIL");

// 후반 군사 axis 비율 — ACT 3 후반에 south/north_pressure가 30% 이상이면 회귀
const lateMilitary = (lateAxisCounts.south_landing || 0) + (lateAxisCounts.north_pressure || 0);
const lateMilitaryRatio = lateAxisTotal > 0 ? lateMilitary / lateAxisTotal : 0;
const lateMilFailed = lateMilitaryRatio > 0.30;
console.log(`  ${lateMilFailed ? "❌" : "✅"} T55+ military axis ratio                   ${(lateMilitaryRatio*100).toFixed(1)}% (≤30% target)`);
if (lateMilFailed) issues.push({ label: "T55+ military ratio", value: lateMilitaryRatio, threshold: 0.30, severity: "FAIL" });

// ACT 3 도달률 — 30% 미만이면 후반 콘텐츠 거의 검증 안 됨
const act3LowReach = act3Reached / RUNS < 0.30;
console.log(`  ${act3LowReach ? "⚠️" : "✅"} ACT3 reach ratio                            ${act3ReachRatio}% (≥30% target)`);
if (act3LowReach) issues.push({ label: "ACT3 reach low", value: act3Reached/RUNS, threshold: 0.30, severity: "WARN" });

console.log();

// ---------------------------------------------------------------------
// Final verdict
// ---------------------------------------------------------------------
const hasFail = issues.some(i => i.severity === "FAIL");
const hasWarn = issues.some(i => i.severity === "WARN");

let verdict;
if (hasFail) verdict = "FAIL ❌";
else if (hasWarn) verdict = "WARN ⚠️";
else verdict = "PASS ✅";

console.log(`RESULT: ${verdict}`);
if (issues.length > 0) {
  console.log();
  console.log("Issues:");
  for (const iss of issues) {
    console.log(`  [${iss.severity}] ${iss.label}: ${typeof iss.value === "number" ? iss.value : iss.value} (threshold ${iss.threshold})`);
  }
}

// Exit code 따라서 CI 가능
process.exit(hasFail ? 1 : 0);
