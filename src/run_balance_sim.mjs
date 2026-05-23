// =====================================================================
// 밸런스 시뮬레이션: 20턴 풀게임 / 다회차 Monte Carlo
// =====================================================================
// 목적:
//   - 5턴 스모크 테스트를 넘어 20턴 전체 길이에서 승리 조건이 작동하는지 확인
//   - 이벤트 발동 시점, 중국 정치 압박, 미국/일본/한국 게이지 곡선 확인
//   - 카드 OP 후보(china_blitz_order, china_diplomatic_pivot)를 데이터로 감시
//
// 사용:
//   node src/run_balance_sim.mjs
//   node src/run_balance_sim.mjs --runs=100 --seed=42 --detail
// =====================================================================

import fs from "node:fs";
import { createInitialState, buildCardIndex, buildAxisIndex } from "./state.js";
import { runTurn } from "./turn_resolver.js";
import { GAME_RULES, BUILD_FULL, formatGameTime, formatTurnCounter, chinaHoursRemaining } from "./game_rules.js";
import { initializeDecks } from "./deck_state.js";
import {
  chooseChinaCards as aiChooseChinaCards,
  chooseTaiwanCards as aiChooseTaiwanCards,
  pickSelectedProvince as aiPickSelectedProvince,
  decideChinaAxis,
  decideTaiwanFocus
} from "./ai_decisions.js";
import { TURNS_PER_DAY, dayNumberForTurn, isDayEndTurn, buildDayReport } from "./day_cycle.js";
import { drawRewards, applyReward, chooseRewardForSim } from "./reward_system.js";

const dataDir = new URL("../data/", import.meta.url);
const provinces = JSON.parse(fs.readFileSync(new URL("provinces.json", dataDir), "utf8"));
const axes = JSON.parse(fs.readFileSync(new URL("axes.json", dataDir), "utf8"));
const cardsChina = JSON.parse(fs.readFileSync(new URL("cards_china.json", dataDir), "utf8"));
const cardsTaiwan = JSON.parse(fs.readFileSync(new URL("cards_taiwan.json", dataDir), "utf8"));
const events = JSON.parse(fs.readFileSync(new URL("events_global.json", dataDir), "utf8"));

const cardIndex = buildCardIndex(cardsChina, cardsTaiwan);
const axisIndex = buildAxisIndex(axes);
const indices = { cardIndex, axisIndex, events };

const args = parseArgs(process.argv.slice(2));
const RUNS = Number(args.runs || 50);
const BASE_SEED = Number(args.seed || 42);
const DETAIL = Boolean(args.detail);
const PRINT_CURVES = Boolean(args.curves);

// v0.4.0-c2-z-lite: 보상 자동 선택 옵션
//   --rewardSide=none (기본): 보상 미적용, 기존 회귀 보존
//   --rewardSide=taiwan: 대만만 매 DAY 보상 선택
//   --rewardSide=china: 중국만 매 DAY 보상 선택
//   --rewardSide=both: 양쪽 다 매 DAY 각각 1개씩 선택
const REWARD_SIDE = String(args.rewardSide || "none");
if (!["none", "taiwan", "china", "both"].includes(REWARD_SIDE)) {
  console.error(`Invalid --rewardSide=${REWARD_SIDE}. Use none|taiwan|china|both`);
  process.exit(1);
}

const rewardsFile = JSON.parse(fs.readFileSync(new URL("rewards.json", dataDir), "utf8"));
const rewardsAll = rewardsFile.rewards;

const origRandom = Math.random;

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

function makeRng(seedInput) {
  let seed = seedInput % 2147483647;
  if (seed <= 0) seed += 2147483646;
  return function rng() {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

function setSeed(seed) {
  Math.random = makeRng(seed);
}

function card(id) {
  return cardIndex.get(id);
}

// v0.4.0-a: AI 의사결정 함수들은 src/ai_decisions.js로 이동.
// 시뮬 내부에서는 어댑터로 호출만.
function chooseChinaCards(state, axisId) {
  return aiChooseChinaCards(state, axisId, cardIndex);
}
function chooseTaiwanCards(state, axisId, focus) {
  return aiChooseTaiwanCards(state, axisId, focus, cardIndex);
}
function pickSelectedProvince(state, axisId, focus) {
  return aiPickSelectedProvince(state, axisId, focus, axisIndex);
}

function buildDecision(state) {
  const axisId = decideChinaAxis(state, axes);
  const { focus, focusId } = decideTaiwanFocus(state);
  const selectedProvince = pickSelectedProvince(state, axisId, focus);
  return {
    chinaAxis: axisId,
    taiwanFocus: focusId,
    selectedProvince,
    chinaCards: chooseChinaCards(state, axisId),
    taiwanCards: chooseTaiwanCards(state, axisId, focus)
  };
}

function summarizeState(state) {
  const activeLanding = Object.values(state.provinces)
    .filter((p) => p.landingStage !== "none" || p.controlStage !== "stable_defense")
    .map((p) => `${p.id}:${p.landingStage}/${p.controlStage}`);
  return {
    turn: state.turn,
    outcome: state.outcome,
    gauges: { ...state.gauges },
    activeLanding,
    triggeredEvents: [...state.persistent.triggeredOnce]
  };
}

function runSingle(seed, { collectCurve = false } = {}) {
  setSeed(seed);
  const state = createInitialState({
    provinces, gameRules: GAME_RULES, axes, cardsChina, cardsTaiwan, events
  });
  initializeDecks(state, cardsChina, cardsTaiwan);

  const rewardLog = []; // v0.4.0-c2-z-lite: 보상 선택 기록
  const curve = [];
  while (!state.outcome && state.turn <= GAME_RULES.totalTurns) {
    const turnBefore = state.turn;
    const decision = buildDecision(state);
    runTurn(state, decision, indices);

    // v0.4.0-c2-z-lite: DAY 종료 턴 직후 보상 적용
    // turnBefore가 DAY 끝(4,8,12,...)이었고, outcome 없이 계속 진행 중일 때
    if (REWARD_SIDE !== "none" && !state.outcome && isDayEndTurn(turnBefore)) {
      const dayNumber = dayNumberForTurn(turnBefore);
      const dayReport = buildDayReport(state, dayNumber, events);
      const sides = REWARD_SIDE === "both" ? ["taiwan", "china"] : [REWARD_SIDE];
      for (const side of sides) {
        const candidates = drawRewards(rewardsAll, side, state, dayReport, 3);
        if (!candidates.length) continue;
        const choice = chooseRewardForSim(candidates, state, dayReport, side, dayNumber, {
          totalTurns: GAME_RULES.totalTurns, turnsPerDay: TURNS_PER_DAY
        });
        if (!choice) continue;
        const applyResult = applyReward(state, choice.reward);
        rewardLog.push({
          dayNumber,
          turn: turnBefore,
          side,
          rewardId: choice.reward.id,
          rewardName: choice.reward.name,
          applyTiming: choice.reward.applyTiming,
          score: Number(choice.score.toFixed(2)),
          candidates: candidates.map(c => c.id),
          applied: applyResult?.applied || "unknown"
        });
      }
    }

    if (collectCurve) {
      curve.push({
        turnEnded: state.outcome ? state.turn : state.turn - 1,
        outcome: state.outcome,
        us: state.gauges.usIntervention,
        japan: state.gauges.japanIntervention,
        korea: state.gauges.koreaRearSupport,
        chinaPressure: state.gauges.chinaPoliticalPressure,
        taiwanGov: state.gauges.taiwanGovernment,
        taiwanMorale: state.gauges.taiwanMorale,
        taiwanSupply: state.gauges.taiwanSupply,
        chinaTempo: state.gauges.chinaTempo,
        chinaSupply: state.gauges.chinaSupply,
        events: [...state.thisTurn.triggeredEvents],
        combat: [...(state.thisTurn.combatResults || [])].map((r) => ({
          sourceId: r.sourceId,
          targetId: r.targetId,
          success: r.success,
          margin: r.margin
        }))
      });
    }
  }

  const combatResults = state.log
    .flatMap((l) => l.combatResults || []);
  const triggeredEvents = state.persistent.triggeredOnce;

  return {
    seed,
    outcome: state.outcome || "no_outcome",
    finalTurn: state.turn,
    final: summarizeState(state),
    combatTotal: combatResults.length,
    combatSuccess: combatResults.filter((r) => r.success).length,
    combatFailure: combatResults.filter((r) => !r.success).length,
    triggeredEvents,
    curve,
    rewardLog,
    persistentRewardCount: (state.persistent?.rewards || []).length
  };
}

function avg(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function pct(n, d) {
  return d ? (n / d) * 100 : 0;
}

function aggregate(results) {
  const outcomeCounts = {};
  const eventCounts = {};
  const eventPresence = {};
  for (const r of results) {
    outcomeCounts[r.outcome] = (outcomeCounts[r.outcome] || 0) + 1;
    const seenThisRun = new Set();
    for (const e of r.triggeredEvents) {
      eventCounts[e] = (eventCounts[e] || 0) + 1;
      seenThisRun.add(e);
    }
    for (const e of seenThisRun) {
      eventPresence[e] = (eventPresence[e] || 0) + 1;
    }
  }

  const finalG = (key) => results.map((r) => r.final.gauges[key]);
  const combatTotal = results.reduce((a, r) => a + r.combatTotal, 0);
  const combatSuccess = results.reduce((a, r) => a + r.combatSuccess, 0);

  return {
    runs: results.length,
    outcomeCounts,
    outcomeRates: Object.fromEntries(Object.entries(outcomeCounts).map(([k, v]) => [k, Number(pct(v, results.length).toFixed(1))])),
    avgFinalTurn: Number(avg(results.map((r) => r.finalTurn)).toFixed(2)),
    avgFinalGauges: {
      usIntervention: Number(avg(finalG("usIntervention")).toFixed(2)),
      japanIntervention: Number(avg(finalG("japanIntervention")).toFixed(2)),
      koreaRearSupport: Number(avg(finalG("koreaRearSupport")).toFixed(2)),
      internationalOpinion: Number(avg(finalG("internationalOpinion")).toFixed(2)),
      chinaPoliticalPressure: Number(avg(finalG("chinaPoliticalPressure")).toFixed(2)),
      chinaTempo: Number(avg(finalG("chinaTempo")).toFixed(2)),
      chinaSupply: Number(avg(finalG("chinaSupply")).toFixed(2)),
      taiwanMorale: Number(avg(finalG("taiwanMorale")).toFixed(2)),
      taiwanGovernment: Number(avg(finalG("taiwanGovernment")).toFixed(2)),
      taiwanCommand: Number(avg(finalG("taiwanCommand")).toFixed(2)),
      taiwanSupply: Number(avg(finalG("taiwanSupply")).toFixed(2))
    },
    combatTotal,
    combatSuccess,
    combatSuccessRate: Number(pct(combatSuccess, combatTotal).toFixed(1)),
    eventCounts,
    eventAvgPerRun: Object.fromEntries(Object.entries(eventCounts).map(([k, v]) => [k, Number((v / results.length).toFixed(2))])),
    eventPresence,
    eventPresenceRates: Object.fromEntries(Object.entries(eventPresence).map(([k, v]) => [k, Number(pct(v, results.length).toFixed(1))]))
  };
}

const results = [];
for (let i = 0; i < RUNS; i++) {
  results.push(runSingle(BASE_SEED + i, { collectCurve: PRINT_CURVES || (DETAIL && i === 0) }));
}

const summary = aggregate(results);

console.log(`\n=== Strait 72 ${BUILD_FULL} balance simulation ===`);
console.log(`runs=${RUNS} seed=${BASE_SEED} totalTurns=${GAME_RULES.totalTurns} hoursPerTurn=${GAME_RULES.hoursPerTurn}`);
console.log("\n[Outcome]");
for (const [outcome, count] of Object.entries(summary.outcomeCounts)) {
  console.log(`  ${outcome.padEnd(34)} ${String(count).padStart(4)} (${summary.outcomeRates[outcome].toFixed(1)}%)`);
}
console.log(`  avgFinalTurn=${summary.avgFinalTurn}`);

console.log("\n[Final gauge averages]");
for (const [k, v] of Object.entries(summary.avgFinalGauges)) {
  console.log(`  ${k.padEnd(24)} ${String(v).padStart(6)}`);
}

console.log("\n[Combat]");
console.log(`  total=${summary.combatTotal} success=${summary.combatSuccess} successRate=${summary.combatSuccessRate}%`);

console.log("\n[Events]");
if (!Object.keys(summary.eventCounts).length) {
  console.log("  none");
} else {
  for (const [eventId, count] of Object.entries(summary.eventCounts)) {
    const avgPerRun = summary.eventAvgPerRun[eventId].toFixed(2);
    const presence = summary.eventPresenceRates[eventId].toFixed(1);
    console.log(`  ${eventId.padEnd(36)} ${String(count).padStart(4)} avg/run=${avgPerRun} seen=${presence}%`);
  }
}

// v0.4.0-c2-z-lite: [Rewards] 섹션
if (REWARD_SIDE !== "none") {
  const allRewards = results.flatMap(r => r.rewardLog);
  const totalSelected = allRewards.length;
  const taiwanSelected = allRewards.filter(r => r.side === "taiwan").length;
  const chinaSelected = allRewards.filter(r => r.side === "china").length;
  const rewardCounts = {};
  for (const r of allRewards) {
    const key = `${r.side}:${r.rewardName}`;
    rewardCounts[key] = (rewardCounts[key] || 0) + 1;
  }
  const topRewards = Object.entries(rewardCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const avgPersistTaiwan = avg(results.map(r => {
    const tw = (r.rewardLog || []).filter(x => x.side === "taiwan" && x.applyTiming === "persistent").length;
    return tw;
  }));
  const avgPersistChina = avg(results.map(r => {
    const cn = (r.rewardLog || []).filter(x => x.side === "china" && x.applyTiming === "persistent").length;
    return cn;
  }));

  console.log(`\n[Rewards] rewardSide=${REWARD_SIDE}`);
  console.log(`  selected total=${totalSelected}  taiwan=${taiwanSelected}  china=${chinaSelected}`);
  console.log(`  persistent owned avg:  taiwan ${avgPersistTaiwan.toFixed(2)}  china ${avgPersistChina.toFixed(2)}`);
  console.log(`  top rewards:`);
  for (const [name, count] of topRewards) {
    console.log(`    ${name.padEnd(42)} ${String(count).padStart(4)}`);
  }
}

if (DETAIL) {
  const sample = results[0];
  console.log(`\n[Sample run seed=${sample.seed}] outcome=${sample.outcome} finalTurn=${sample.finalTurn}`);
  // v0.4.0-c2-z-lite: detail 모드에서 DAY 보상 선택 표시
  if (sample.rewardLog?.length) {
    console.log(`  [Reward selections]`);
    for (const r of sample.rewardLog) {
      console.log(`    DAY ${r.dayNumber} (T${r.turn}) reward=${r.side}:${r.rewardName} score=${r.score} applied=${r.applied}`);
    }
  }
  for (const row of sample.curve) {
    const eventText = row.events.length ? ` events=${row.events.join(",")}` : "";
    const combatText = row.combat.length ? ` combat=${row.combat.map((c) => `${c.sourceId}:${c.success ? "S" : "F"}@${c.targetId}`).join("|")}` : "";
    console.log(
      `  T${String(row.turnEnded).padStart(2)} us=${String(row.us).padStart(3)} jp=${String(row.japan).padStart(3)} ` +
      `kr=${String(row.korea).padStart(3)} pr=${String(row.chinaPressure).padStart(3)} ` +
      `gov=${String(row.taiwanGov).padStart(3)} morale=${String(row.taiwanMorale).padStart(3)} supply=${String(row.taiwanSupply).padStart(3)}` +
      `${eventText}${combatText}`
    );
  }
}

const issues = [];
for (const r of results) {
  for (const [k, v] of Object.entries(r.final.gauges)) {
    if (typeof v !== "number" || Number.isNaN(v)) issues.push(`seed ${r.seed}: ${k} invalid ${v}`);
    if (v < 0 || v > 100 && !["chinaReserveTroops", "taiwanReserveTroops", "taiwanInternationalRequest"].includes(k)) {
      issues.push(`seed ${r.seed}: ${k} out of expected range ${v}`);
    }
  }
}
if (issues.length) {
  console.error("\nISSUES:");
  for (const issue of issues.slice(0, 20)) console.error(`  ${issue}`);
  process.exit(1);
}

console.log("\nbalance simulation passed");
Math.random = origRandom;
