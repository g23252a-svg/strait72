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
  const { onlyC1 = false, includeC2a = true, includeC2b1 = true, includeC2b2 = true, includeC2b3 = false } = opts;
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
// v0.4.0-c2-b2.1: state에서 provinces 한글명 조회 (없으면 ID 사용)
export function describeRewardApplication(reward, result, state = null) {
  const parts = [result?.applied === "persistent" ? `보상 활성화: ${reward.name}` : `보상 적용: ${reward.name}`];
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
    } else if (reward.effects?.defenseValueBonus) {
      const def = reward.effects.defenseValueBonus;
      const amount = Math.min(1, Math.max(0, def.amount || 0));
      // v0.4.0-c2-b2.1: 지역명을 한글로
      const regionNames = Array.isArray(def.regions)
        ? def.regions.map(id => provinceNameFromState(state, id)).join(", ")
        : "지정 지역";
      parts.push(`(영구: ${regionNames} 방어력 +${amount})`);
    } else {
      parts.push("(영구 효과 등록 — c2-b3에서 활성)");
    }
  } else if (result?.applied === "card_added") {
    parts.push(`(${result.cardId} 카드 추가됨)`);
  }
  return parts.join(" ");
}

// v0.4.0-c2-b2.1: state.provinces에서 한글명 조회 (실패 시 ID)
function provinceNameFromState(state, provinceId) {
  if (!state?.provinces) return provinceId;
  const p = state.provinces[provinceId];
  return p?.name || provinceId;
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

// =====================================================================
// v0.4.0-c2-b2: persistent defenseValueBonus 보상의 효과 계산
// ---------------------------------------------------------------------
// 제한:
//   - effects.defenseValueBonus.amount는 1로 캡 (보상 데이터 무관 안전망)
//   - effects.defenseValueBonus.regions에 명시된 지역에만 적용
//   - 한 지역에 누적 적용되는 총 보너스는 최대 +2 (캡)
// combat_resolver의 effectiveProvinceDefense에서 호출.
// =====================================================================
export function computePersistentDefenseBonus(state, provinceId) {
  if (!provinceId) return 0;
  const rewards = state.persistent?.rewards || [];
  if (!rewards.length) return 0;

  let total = 0;
  for (const reward of rewards) {
    if (reward.applyTiming !== "persistent") continue;
    const defBonus = reward.effects?.defenseValueBonus;
    if (!defBonus) continue;
    const regions = defBonus.regions;
    if (!Array.isArray(regions) || !regions.includes(provinceId)) continue;
    // 안전망: amount는 무조건 1로 캡
    const amount = Math.min(1, Math.max(0, defBonus.amount || 0));
    total += amount;
  }
  // 같은 지역 누적 캡: 최대 +2
  return Math.min(2, total);
}

// =====================================================================
// v0.4.0-c2-z-lite: 시뮬용 보상 효용 점수
// ---------------------------------------------------------------------
// 정책 (사용자 명세 그대로):
//   - base 10
//   - instant: 회복량 × 부족도. clamp로 날아가면 거의 0.
//   - add_card: +12 + 약간의 손패 상황 보정
//   - perTurnGain: + 남은 DAY 수 × 턴당 총효과 × 1.5
//   - defenseValueBonus: 위협받는 지역이면 큰 점수, 평온하면 작음. +2 캡 초과분 0.
//
// 동점이면 candidate 순서 유지 → drawRewards 출력 순서가 결정성을 줌.
// =====================================================================

const TOTAL_TURNS_DEFAULT = 30;
const TURNS_PER_DAY_DEFAULT = 4;

export function scoreRewardUtility(reward, state, dayReport, side, dayNumber, opts = {}) {
  const totalTurns = opts.totalTurns || TOTAL_TURNS_DEFAULT;
  const turnsPerDay = opts.turnsPerDay || TURNS_PER_DAY_DEFAULT;
  const currentTurn = state.turn || (dayNumber * turnsPerDay);
  const turnsLeft = Math.max(0, totalTurns - currentTurn);
  const daysLeft = Math.max(0, Math.ceil(turnsLeft / turnsPerDay));

  let score = 10;

  if (reward.applyTiming === "instant") {
    score += scoreInstant(reward, state);
  } else if (reward.applyTiming === "add_card") {
    score += scoreAddCard(reward, state, side);
  } else if (reward.applyTiming === "persistent") {
    if (reward.effects?.perTurnGain) {
      score += scorePerTurnGain(reward, state, turnsLeft);
    } else if (reward.effects?.defenseValueBonus) {
      score += scoreDefenseValueBonus(reward, state, dayReport);
    }
  }

  return score;
}

// instant: 회복량 × 부족도. 100인 게이지에 회복 주면 0점.
function scoreInstant(reward, state) {
  let s = 0;
  const gauges = state.gauges || {};
  for (const [key, value] of Object.entries(reward.effects || {})) {
    if (typeof value !== "number") continue;
    const cur = gauges[key] ?? 50;
    // 부족도: 100에서 멀수록 효용 ↑ (양수 회복 기준)
    if (value > 0) {
      // 회복 보상: 현재 게이지 낮을수록 가치 ↑
      const deficiency = Math.max(0, (100 - cur) / 100); // 0~1
      // 실제 회복 가능량 = min(value, 100-cur)
      const effectiveGain = Math.min(value, 100 - cur);
      s += effectiveGain * (0.5 + deficiency * 1.5);
    } else if (value < 0) {
      // 감소 보상 (예: 중국 정치압박 -8): 현재 값 높을수록 가치 ↑
      const excess = Math.max(0, cur / 100); // 0~1
      const effectiveReduction = Math.min(-value, cur);
      s += effectiveReduction * (0.5 + excess * 1.5);
    }
  }
  return s;
}

// add_card: 항상 좋음. 손패 가득 차 있으면 약간 감점 (덱 맨 위 삽입 후 손패 한도 충돌 가능)
function scoreAddCard(reward, state, side) {
  let s = 12;
  const hand = state.decks?.[side]?.hand?.length ?? 0;
  if (hand >= 5) s -= 2;
  return s;
}

// perTurnGain: 남은 턴 수 × 턴당 총효과 × 1.5
function scorePerTurnGain(reward, state, turnsLeft) {
  const perTurn = reward.effects?.perTurnGain || {};
  let totalPerTurn = 0;
  for (const [key, value] of Object.entries(perTurn)) {
    if (typeof value !== "number") continue;
    // 게이지가 이미 100에 가까우면 clamp로 잘릴 거 감안
    const cur = state.gauges?.[key] ?? 50;
    const cap = 100;
    const headroom = Math.max(0, cap - cur);
    // headroom / turnsLeft 비교: 어차피 캡 발동되면 효용 감소
    const effectivePerTurn = Math.min(value, headroom / Math.max(1, turnsLeft));
    totalPerTurn += effectivePerTurn;
  }
  return turnsLeft * totalPerTurn * 1.5;
}

// defenseValueBonus: 해당 지역들이 위협받는 정도
//   - 이번 DAY 손실/압박: +25
//   - 수도권 또는 상륙 진척 지역: +10
//   - 평온: +3 (안전 투자)
// + 2 캡 초과분 0 (이미 다른 보상이 같은 지역에 있으면 추가 효용 작음)
function scoreDefenseValueBonus(reward, state, dayReport) {
  const def = reward.effects?.defenseValueBonus;
  if (!def) return 0;
  const regions = def.regions || [];
  const amount = Math.min(1, Math.max(0, def.amount || 0));
  if (amount === 0) return 0;

  let s = 0;
  for (const provId of regions) {
    // 이미 받은 보상의 영향 — +2 캡 초과분이면 효용 0
    const existing = computePersistentDefenseBonus(state, provId);
    if (existing >= 2) continue; // 캡 초과
    // 캡 가까울수록 적게 인정
    const headroom = 2 - existing;
    const factor = Math.min(1, headroom);

    // 위협도 평가
    //   - 손실: 25 (이번 DAY에 실제로 점령된 지역)
    //   - 상륙 진행 중: 18
    //   - 수도권 압박 상황 + 수도권 지역: 20  (분기 순서 주의 — 수도권 일반 분기 앞에 와야 도달함)
    //   - 단순 수도권 지역: 10
    //   - 평온: 3
    const province = state.provinces?.[provId];
    const isCapitalRegion = ["taipei", "keelung", "taoyuan"].includes(provId);
    let threat = 3; // 평온 기본
    if (dayReport?.occupationChanges?.some(o => o.provinceId === provId && o.isLoss)) {
      threat = 25;
    } else if (province?.landingStage && province.landingStage !== "none") {
      threat = 18; // 이미 상륙 진행 중
    } else if ((state.persistent?.capitalPressureTurns || 0) >= 1 && isCapitalRegion) {
      threat = 20; // 수도권 압박 상황 — 단순 수도권 분기보다 먼저 와야 함
    } else if (isCapitalRegion) {
      threat = 10; // 수도권 평시
    }
    s += threat * factor;
  }
  return s;
}

// 시뮬용 자동 선택: 효용 점수 최고인 1개 (동점이면 candidates 순서 유지)
export function chooseRewardForSim(candidates, state, dayReport, side, dayNumber, opts = {}) {
  if (!candidates?.length) return null;
  let best = null;
  let bestScore = -Infinity;
  let bestIdx = Infinity;
  candidates.forEach((reward, idx) => {
    const score = scoreRewardUtility(reward, state, dayReport, side, dayNumber, opts);
    if (score > bestScore || (score === bestScore && idx < bestIdx)) {
      best = reward;
      bestScore = score;
      bestIdx = idx;
    }
  });
  return { reward: best, score: bestScore };
}
