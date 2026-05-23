// =====================================================================
// reward_system.js  (v0.4.0-c1 introduced, c1.1 clamp fix)
// ---------------------------------------------------------------------
// DAY 종료 보상 추첨/적용.
// c1: instant 보상만 노출 (enabledInC1=true). 가중치 추첨 + 즉시 적용.
// c1.1: instant 보상 적용 시 addGauge로 즉시 clamp (0~100 / 0~∞).
// c2 예정: persistent 효과 트래커 + add_card.
// =====================================================================

import { addGauge } from "./state.js";

// 추첨 후보 — 각 단계별 enabled 플래그 누적 OR
// c1: enabledInC1 (instant 6개씩)
// c2-a: enabledInC2a 추가 (add_card 4개)
// c2-b1: enabledInC2b1 추가 (persistent perTurnGain 2개)
// c2-b2/b3 예정: 나머지 persistent
// v0.4.0-c2-b1.1: 이미 받은 persistent 보상은 풀에서 제외 (instant/add_card는 중복 가능)
export function rewardPoolForSide(rewardsAll, side, opts = {}, state = null) {
  const { onlyC1 = false, includeC2a = true, includeC2b1 = true, includeC2b2 = false, includeC2b3 = false } = opts;
  const alreadyOwnedPersistent = new Set();
  if (state?.persistent?.rewards?.length) {
    for (const r of state.persistent.rewards) {
      if (r.applyTiming === "persistent") alreadyOwnedPersistent.add(r.id);
    }
  }
  return rewardsAll.filter(r => {
    if (r.side !== side) return false;
    // v0.4.0-c2-b1.1: persistent만 중복 금지. instant/add_card는 재선택 허용.
    if (r.applyTiming === "persistent" && alreadyOwnedPersistent.has(r.id)) return false;
    if (onlyC1) return !!r.enabledInC1;
    if (r.enabledInC1) return true;
    if (includeC2a && r.enabledInC2a) return true;
    if (includeC2b1 && r.enabledInC2b1) return true;
    if (includeC2b2 && r.enabledInC2b2) return true;
    if (includeC2b3 && r.enabledInC2b3) return true;
    return false;
  });
}

// 가중치 평가: weightConditions 만족 시 기본 1 + 보너스 합산.
function evaluateConditions(conds, state, dayReport, side) {
  if (!conds?.length) return 0;
  let bonus = 0;
  const g = state.gauges || {};
  for (const c of conds) {
    if (matchesCondition(c, state, dayReport, side, g)) bonus += (c.weight || 0);
  }
  return bonus;
}

function matchesCondition(c, state, dayReport, side, g) {
  switch (c.if) {
    // 게이지 임계
    case "taiwanReserveTroopsBelow":   return (g.taiwanReserveTroops || 0) < c.value;
    case "taiwanSupplyBelow":          return (g.taiwanSupply || 0) < c.value;
    case "taiwanGovernmentBelow":      return (g.taiwanGovernment || 0) < c.value;
    case "taiwanCommandBelow":         return (g.taiwanCommand || 0) < c.value;
    case "taiwanMoraleBelow":          return (g.taiwanMorale || 0) < c.value;
    case "usInterventionBelow":        return (g.usIntervention || 0) < c.value;
    case "usInterventionAbove":        return (g.usIntervention || 0) > c.value;
    case "chinaTempoBelow":            return (g.chinaTempo || 0) < c.value;
    case "chinaSupplyBelow":           return (g.chinaSupply || 0) < c.value;
    case "chinaReserveTroopsBelow":    return (g.chinaReserveTroops || 0) < c.value;
    case "chinaPoliticalPressureAbove":return (g.chinaPoliticalPressure || 0) > c.value;
    // 이번 DAY 사건
    case "majorBattleHappened":        return (dayReport?.majorBattles?.length || 0) > 0;
    case "provinceLost":                return dayReport?.occupationChanges?.some(o => o.provinceId === c.value && o.isLoss);
    case "capitalUnderPressure":        return (state.persistent?.capitalPressureTurns || 0) >= 1
                                            || dayReport?.occupationChanges?.some(o => ["taipei", "keelung", "taoyuan"].includes(o.provinceId) && o.isLoss);
    default: return false;
  }
}

// 가중치 기반 3개 추첨 (중복 없음). RNG 주입 가능 (테스트용).
export function drawRewards(rewardsAll, side, state, dayReport, count = 3, rng = Math.random) {
  // v0.4.0-c2-b1.1: state 전달 → 이미 받은 persistent 보상 자동 제외
  const pool = rewardPoolForSide(rewardsAll, side, {}, state);
  if (pool.length === 0) return [];

  // 1단계: 각 보상에 가중치 계산
  const scored = pool.map(r => {
    const conditional = evaluateConditions(r.weightConditions, state, dayReport, side);
    const weight = 1 + conditional; // 기본 1, 조건 보너스 가산
    return { reward: r, weight };
  });

  // 2단계: 가중치 추첨 (중복 없음)
  const picks = [];
  const remaining = [...scored];
  for (let i = 0; i < Math.min(count, remaining.length); i++) {
    const total = remaining.reduce((s, x) => s + x.weight, 0);
    let r = rng() * total;
    let pickedIdx = 0;
    for (let j = 0; j < remaining.length; j++) {
      r -= remaining[j].weight;
      if (r <= 0) { pickedIdx = j; break; }
    }
    picks.push(remaining[pickedIdx].reward);
    remaining.splice(pickedIdx, 1);
  }
  return picks;
}

// 보상 적용 (c1: instant만)
//   instant: gauges에 직접 가산
//   persistent: state.persistent.rewards에 등록 (c2에서 실제 효과 처리)
//   add_card: state.decks[side].deck 맨 위에 카드 ID 삽입 (c2에서 활성)
export function applyReward(state, reward) {
  state.persistent.rewards = state.persistent.rewards || [];

  if (reward.applyTiming === "instant") {
    return applyInstantReward(state, reward);
  }
  if (reward.applyTiming === "persistent") {
    state.persistent.rewards.push({
      id: reward.id, name: reward.name, side: reward.side,
      applyTiming: "persistent", effects: reward.effects,
      acquiredTurn: state.turn
    });
    return { applied: "persistent", note: "c2에서 적용 예정" };
  }
  if (reward.applyTiming === "add_card") {
    const cardId = reward.effects?.addCard;
    const side = reward.side;
    if (cardId && state.decks?.[side]) {
      state.decks[side].deck.unshift(cardId); // 덱 맨 위
      return { applied: "card_added", cardId };
    }
    return { applied: "card_add_failed" };
  }
  return { applied: "noop" };
}

function applyInstantReward(state, reward) {
  // v0.4.0-c1.1: addGauge로 즉시 clamp 적용 (퍼센트 0~100, 정수 자원 0~∞)
  const applied = {};
  for (const [key, value] of Object.entries(reward.effects || {})) {
    if (typeof value !== "number") continue;
    const before = state.gauges[key] ?? 0;
    addGauge(state, key, value);  // 직접 가산 + clamp
    const after = state.gauges[key] ?? before;
    applied[key] = { before, after, delta: after - before, requested: value };
  }
  return { applied: "instant", details: applied };
}

// 보상 적용 후 로그 메시지 (사용자 노출용)
export function describeRewardApplication(reward, result) {
  const parts = [`보상 적용: ${reward.name}`];
  if (result?.applied === "instant" && result.details) {
    const lines = [];
    let cappedCount = 0;
    for (const [k, v] of Object.entries(result.details)) {
      if (v.delta === 0 && v.requested !== 0) {
        // clamp로 인해 효과 무효화됨 (이미 한도)
        cappedCount++;
        lines.push(`${k} 이미 한도`);
      } else if (v.delta !== 0) {
        lines.push(`${k} ${v.delta > 0 ? "+" : ""}${v.delta}`);
      }
    }
    if (lines.length) parts.push(`(${lines.join(", ")})`);
  } else if (result?.applied === "persistent") {
    // v0.4.0-c2-b1: perTurnGain 보상은 명시
    if (reward.effects?.perTurnGain) {
      const lines = Object.entries(reward.effects.perTurnGain)
        .map(([k, v]) => `${k} ${v > 0 ? "+" : ""}${v}/턴`);
      parts.push(`(영구: ${lines.join(", ")})`);
    } else {
      parts.push("(영구 효과 등록 — c2-b2/b3에서 활성)");
    }
  } else if (result?.applied === "card_added") {
    parts.push(`(${result.cardId} 카드 추가됨)`);
  }
  return parts.join(" ");
}

// =====================================================================
// v0.4.0-c2-b1: 매 턴 시작 시 perTurnGain 적용
// ---------------------------------------------------------------------
// state.persistent.rewards[]에 등록된 보상 중 perTurnGain 효과를 매 턴 적용.
// turn_resolver의 phaseInformation에서 호출.
// c2-b2/b3 효과는 여기서 처리하지 않음 (별도 위치).
// =====================================================================
export function applyPerTurnPersistentEffects(state) {
  const rewards = state.persistent?.rewards || [];
  if (!rewards.length) return [];

  const applied = [];
  for (const reward of rewards) {
    if (reward.applyTiming !== "persistent") continue;
    const perTurnGain = reward.effects?.perTurnGain;
    if (!perTurnGain) continue;
    const details = {};
    for (const [key, value] of Object.entries(perTurnGain)) {
      if (typeof value !== "number") continue;
      const before = state.gauges[key] ?? 0;
      addGauge(state, key, value);
      const after = state.gauges[key] ?? before;
      details[key] = { before, after, delta: after - before, requested: value };
    }
    applied.push({ rewardId: reward.id, rewardName: reward.name, details });
  }
  return applied;
}
