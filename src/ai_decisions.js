// =====================================================================
// ai_decisions.js  (v0.4.0-a introduced)
// ---------------------------------------------------------------------
// 상대 AI 의사결정을 한 곳에서 관리.
// run_balance_sim.mjs와 playable_app.js 양쪽에서 사용.
// 휴리스틱은 v0.3.8c 기준으로 동결되어 있고, 분리 실험이 끝난 안정판.
// =====================================================================

import { suggestChinaAxis, suggestTaiwanFocus, scoreChinaAttackTarget } from "./target_selector.js";

export function getHandCards(state, side, cardIndex) {
  const ids = state.decks?.[side]?.hand || [];
  return ids.map((id) => cardIndex.get(id)).filter(Boolean);
}

export function canAfford(state, side, c) {
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

export function pickUnique(ids, max) {
  const out = [];
  for (const id of ids) {
    if (!id) continue;
    if (out.includes(id)) continue;
    out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

// 중국 AI 카드 선택 (v0.3.7 기준, 동결됨)
export function chooseChinaCards(state, axisId, cardIndex) {
  const hand = getHandCards(state, "china", cardIndex).filter((c) => canAfford(state, "china", c));
  const has = (id) => hand.some((c) => c.id === id);
  const wanted = [];

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

  if (state.gauges.chinaSupply < 55 && has("china_supply_line_extension")) wanted.push("china_supply_line_extension");
  if (state.gauges.chinaTempo > 35 && has("china_night_operation")) wanted.push("china_night_operation");

  const preferred = hand.filter((c) => c.preferredAxis === axisId).map((c) => c.id);
  wanted.push(...preferred);
  wanted.push(...hand
    .filter((c) => ["attack", "ranged", "support", "modifier", "standard"].includes(c.type))
    .map((c) => c.id));

  return pickUnique(wanted, 2);
}

// 대만 AI 카드 선택 (v0.3.8c 기준 = 수도권 위기 우선순위, 동결됨)
export function chooseTaiwanCards(state, axisId, focus, cardIndex) {
  const hand = getHandCards(state, "taiwan", cardIndex).filter((c) => canAfford(state, "taiwan", c));
  const has = (id) => hand.some((c) => c.id === id);
  const wanted = [];
  const g = state.gauges;

  // v0.3.8c: 수도권 위기 감지
  const stages = ["none", "sea_superiority", "landing_attempt", "beachhead", "inland_expansion"];
  const sIdx = (p) => p ? stages.indexOf(p.landingStage || "none") : 0;
  const capitalCrisis = (
    sIdx(state.provinces.taipei) >= 1 ||
    sIdx(state.provinces.keelung) >= 3 ||
    sIdx(state.provinces.taoyuan) >= 3 ||
    (state.persistent?.capitalPressureTurns || 0) >= 1
  );

  if (capitalCrisis) {
    if (has("taiwan_north_defense_buildup")) wanted.push("taiwan_north_defense_buildup");
    if (has("taiwan_mobile_reserve_deploy")) wanted.push("taiwan_mobile_reserve_deploy");
    if (has("taiwan_backup_network")) wanted.push("taiwan_backup_network");
    if (has("taiwan_emergency_restoration")) wanted.push("taiwan_emergency_restoration");
    if (has("taiwan_president_speech")) wanted.push("taiwan_president_speech");
    if (has("taiwan_international_appeal")) wanted.push("taiwan_international_appeal");
  }

  if ((g.taiwanCommand <= 75 || g.taiwanGovernment <= 80) && has("taiwan_emergency_restoration")) {
    wanted.push("taiwan_emergency_restoration");
  }

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

  if (g.usIntervention < 70 && has("taiwan_international_appeal")) wanted.push("taiwan_international_appeal");
  if (g.taiwanMorale < 75 && has("taiwan_president_speech")) wanted.push("taiwan_president_speech");

  if (has("taiwan_coastal_surveillance")) wanted.push("taiwan_coastal_surveillance");

  return pickUnique(wanted, 2);
}

// 중국 AI가 공격할 지역 선택 (focus는 대만 방어 중점)
export function pickSelectedProvince(state, axisId, focus, axisIndex) {
  if (focus?.mode === "province" && state.provinces[focus.focus]) return focus.focus;
  const axis = axisIndex.get(axisId);
  const candidates = Object.values(state.provinces)
    .filter((p) => p.id !== "strait" && p.controlStage !== "china_control")
    .map((p) => ({ id: p.id, score: scoreChinaAttackTarget(state, p, null, axis) }))
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.id || null;
}

// 중국 AI: 축만 결정
export function decideChinaAxis(state, axes) {
  const axisSuggestion = suggestChinaAxis(state, axes);
  return axisSuggestion.axisId || axisSuggestion.id || axisSuggestion;
}

// 대만 AI: focus만 결정
export function decideTaiwanFocus(state) {
  const focus = suggestTaiwanFocus(state);
  return { focus, focusId: focus?.focus || null };
}
