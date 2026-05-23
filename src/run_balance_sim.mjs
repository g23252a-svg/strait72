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
import { GAME_RULES, formatGameTime, formatTurnCounter, chinaHoursRemaining } from "./game_rules.js";
import {
  suggestChinaAxis,
  suggestTaiwanFocus,
  scoreChinaAttackTarget
} from "./target_selector.js";

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

function getHandCards(state, side) {
  const ids = side === "china" ? state.hands.china : state.hands.taiwan;
  return ids.map((id) => card(id)).filter(Boolean);
}

function canAfford(state, side, c) {
  const cost = c.cost || {};
  for (const [key, amount] of Object.entries(cost)) {
    let gaugeKey = null;
    if (key === "tempo") gaugeKey = "chinaTempo";
    else if (key === "supply") gaugeKey = "chinaSupply";
    else if (key === "command") gaugeKey = side === "china" ? "chinaTempo" : "taiwanCommand";
    else if (key === "reserveTroops") gaugeKey = side === "china" ? "chinaReserveTroops" : "taiwanReserveTroops";
    else if (key === "internationalRequest") gaugeKey = "taiwanInternationalRequest";
    if (gaugeKey && (state.gauges[gaugeKey] || 0) < amount) return false;
  }
  return true;
}

function pickUnique(ids, max) {
  const out = [];
  for (const id of ids) {
    if (!id) continue;
    if (out.includes(id)) continue;
    out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

function chooseChinaCards(state, axisId) {
  const hand = getHandCards(state, "china").filter((c) => canAfford(state, "china", c));
  const has = (id) => hand.some((c) => c.id === id);
  const wanted = [];

  // 축별 핵심 카드 우선.
  if (axisId === "north_pressure") {
    if (has("china_blitz_order")) wanted.push("china_blitz_order");
    if (has("china_north_assault")) wanted.push("china_north_assault");
    if (has("china_missile_pressure")) wanted.push("china_missile_pressure");
  } else if (axisId === "south_landing") {
    if (has("china_blitz_order")) wanted.push("china_blitz_order");
    if (has("china_south_landing_prep")) wanted.push("china_south_landing_prep");
    if (state.gauges.chinaSupply < 70 && has("china_supply_line_extension")) wanted.push("china_supply_line_extension");
  } else if (axisId === "naval_blockade") {
    if (has("china_naval_blockade_intensify")) wanted.push("china_naval_blockade_intensify");
    if (has("china_night_operation")) wanted.push("china_night_operation");
  } else if (axisId === "information_warfare") {
    if (has("china_cyber_attack")) wanted.push("china_cyber_attack");
    if (has("china_missile_pressure")) wanted.push("china_missile_pressure");
  } else if (axisId === "diplomatic_pressure") {
    if (has("china_diplomatic_pivot")) wanted.push("china_diplomatic_pivot");
    if (has("china_supply_line_extension")) wanted.push("china_supply_line_extension");
  }

  // 보급/템포 보정 카드.
  if (state.gauges.chinaSupply < 55 && has("china_supply_line_extension")) wanted.push("china_supply_line_extension");
  if (state.gauges.chinaTempo > 35 && has("china_night_operation")) wanted.push("china_night_operation");

  // 손패가 남았는데 축 매칭 카드가 있으면 채움.
  const preferred = hand
    .filter((c) => c.preferredAxis === axisId)
    .map((c) => c.id);
  wanted.push(...preferred);

  // 그래도 부족하면 범용 공격/지원.
  wanted.push(...hand
    .filter((c) => ["attack", "ranged", "support", "modifier", "standard"].includes(c.type))
    .map((c) => c.id));

  return pickUnique(wanted, 2);
}

function chooseTaiwanCards(state, axisId, focus) {
  const hand = getHandCards(state, "taiwan").filter((c) => canAfford(state, "taiwan", c));
  const has = (id) => hand.some((c) => c.id === id);
  const wanted = [];
  const g = state.gauges;

  // 생존 복구 우선.
  if ((g.taiwanCommand <= 75 || g.taiwanGovernment <= 80) && has("taiwan_emergency_restoration")) {
    wanted.push("taiwan_emergency_restoration");
  }

  // 중국 축 대응.
  if (axisId === "information_warfare") {
    if (has("taiwan_backup_network")) wanted.push("taiwan_backup_network");
    if (has("taiwan_distributed_command")) wanted.push("taiwan_distributed_command");
  } else if (axisId === "north_pressure") {
    if (has("taiwan_north_defense_buildup")) wanted.push("taiwan_north_defense_buildup");
    if (has("taiwan_port_defense_buildup")) wanted.push("taiwan_port_defense_buildup");
  } else if (axisId === "south_landing" || axisId === "naval_blockade") {
    if (has("taiwan_port_defense_buildup")) wanted.push("taiwan_port_defense_buildup");
    if (has("taiwan_mobile_reserve_deploy") && focus?.focus) wanted.push("taiwan_mobile_reserve_deploy");
  } else if (axisId === "diplomatic_pressure") {
    if (has("taiwan_international_appeal")) wanted.push("taiwan_international_appeal");
    if (has("taiwan_president_speech")) wanted.push("taiwan_president_speech");
  }

  // 개입 게이지가 낮으면 외교 카드 보강.
  if (g.usIntervention < 70 && has("taiwan_international_appeal")) wanted.push("taiwan_international_appeal");
  if (g.taiwanMorale < 75 && has("taiwan_president_speech")) wanted.push("taiwan_president_speech");

  // 마지막으로 정보/감시 카드.
  if (has("taiwan_coastal_surveillance")) wanted.push("taiwan_coastal_surveillance");

  return pickUnique(wanted, 2);
}

function pickSelectedProvince(state, axisId, focus) {
  // 대만 방어 중점이 지역이면 그 지역을 selectedProvince로 둔다.
  if (focus?.mode === "province" && state.provinces[focus.focus]) return focus.focus;

  // 아니면 중국의 가장 유망한 상륙 가능 표적을 임시 선택.
  const axis = axisIndex.get(axisId);
  const candidates = Object.values(state.provinces)
    .filter((p) => p.id !== "strait" && p.controlStage !== "china_control")
    .map((p) => ({ id: p.id, score: scoreChinaAttackTarget(state, p, null, axis) }))
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.id || null;
}

function buildDecision(state) {
  const axisSuggestion = suggestChinaAxis(state, axes);
  const axisId = axisSuggestion.axisId || axisSuggestion.id || axisSuggestion;
  const focus = suggestTaiwanFocus(state);
  const selectedProvince = pickSelectedProvince(state, axisId, focus);
  return {
    chinaAxis: axisId,
    taiwanFocus: focus?.focus || null,
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

  const curve = [];
  while (!state.outcome && state.turn <= GAME_RULES.totalTurns) {
    const decision = buildDecision(state);
    runTurn(state, decision, indices);
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
    curve
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

console.log("\n=== Strait 72 v0.3.5 balance simulation ===");
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

if (DETAIL) {
  const sample = results[0];
  console.log(`\n[Sample run seed=${sample.seed}] outcome=${sample.outcome} finalTurn=${sample.finalTurn}`);
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
