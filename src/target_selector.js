// =====================================================================
// 타깃 선택기 (target_selector.js)
// =====================================================================
// 책임:
//   - 카드/축의 target 배열 → 실제 적용 지역 결정
//   - 양측 AI 휴리스틱 (점수 기반)
//   - decisions.selectedProvince (플레이어 지정) 최우선 처리
//
// 비책임:
//   - 실제 효과 적용 (turn_resolver 담당)
//   - 작전 성공/실패 판정 (combat_resolver 담당)
// =====================================================================

import { LANDING_STAGES } from "./landing_fsm.js";

// ---------------------------------------------------------------------
// SECTION A. 점수 함수
// ---------------------------------------------------------------------

/**
 * 중국이 어떤 지역을 공격할지 결정하는 점수.
 * 높을수록 매력적.
 *
 * 가중치:
 *   - 이미 상륙 진척된 지역: stageIdx * 4
 *   - 정치 가치: +0.7 (수도권 가산점)
 *   - 보급 가치: +0.4
 *   - 유효 방어력: -0.8 (약한 곳 선호)
 *   - 주공축 매칭: +3
 *   - 이미 china_control: 점수 0 (스킵)
 */
export function scoreChinaAttackTarget(state, province, card = null, axis = null) {
  if (!province) return -Infinity;
  if (province.controlStage === "china_control") return -Infinity;

  const stageIdx = LANDING_STAGES.indexOf(province.landingStage || "none");
  const defense = effectiveDefense(state, province);

  let score =
    stageIdx * 4 +
    (province.politicalValue || 0) * 0.7 +
    (province.supplyValue || 0) * 0.4 -
    defense * 0.8;

  // 주공축 / 카드 선호도
  if (axis?.id === "north_pressure" && province.tags?.includes("north")) score += 3;
  if (axis?.id === "south_landing" && province.tags?.includes("south")) score += 3;
  if (card?.preferredAxis === axis?.id) score += 1;

  // 상륙 가능 거점이 아니면 큰 페널티 (해상 직접 진척 안 됨)
  if (province.type !== "sea_zone" && !province.tags?.includes("coastal")) {
    // 내륙 지역은 인접 교두보를 통해서만 접근 가능
    score -= 5;
  }

  return score;
}

/**
 * 대만이 어떤 지역을 방어 강화할지 결정하는 점수.
 * = 해당 지역이 얼마나 "위협받고 있는가" + "가치가 높은가"
 */
export function scoreTaiwanDefenseTarget(state, province, card = null) {
  if (!province) return -Infinity;

  const stageIdx = LANDING_STAGES.indexOf(province.landingStage || "none");

  let score =
    (province.politicalValue || 0) * 0.6 +
    (province.supplyValue || 0) * 0.3 +
    stageIdx * 3.5;                                  // 진척 임박할수록 우선

  // 수도/공항/항만 가중치
  if (province.tags?.includes("capital")) score += 5;
  if (province.tags?.includes("port")) score += 2;
  if (province.tags?.includes("airport")) score += 2;

  // 국가 자원 위기 상황 가중치
  if (state.gauges.taiwanGovernment < 60 && province.tags?.includes("capital")) score += 4;
  if (state.gauges.taiwanSupply < 50 && province.tags?.includes("port")) score += 2;

  // 카드 자체에 target 후보가 있으면 그 안에서만 선호 (외부 컨텍스트는 selectTaiwanDefenseTargets가 처리)
  return score;
}

function effectiveDefense(state, province) {
  let defense = 8 + (province.defenseValue || 0) + (province.defenseValueModifier || 0);
  // 사기/지휘 보정 (간략)
  const morale = state.gauges.taiwanMorale ?? 50;
  if (morale >= 85) defense += 2;
  else if (morale >= 70) defense += 1;
  else if (morale < 40) defense -= 2;
  else if (morale < 55) defense -= 1;
  return defense;
}

// ---------------------------------------------------------------------
// SECTION B. 카드 타깃 선택
// ---------------------------------------------------------------------

/**
 * 중국 공격 카드의 타깃 1곳 선택.
 * decisions.selectedProvince가 후보에 있으면 그것을 우선.
 */
export function selectChinaAttackTarget(state, card, axis = null) {
  const candidates = candidateProvinceIds(card);
  if (!candidates.length) return null;

  // 1. 플레이어 명시 우선.
  // 단, 이미 중국 통제 지역이면 같은 지역을 반복 타격하지 않도록 무시한다.
  const explicit = state.thisTurn?.selectedProvince;
  if (
    explicit &&
    candidates.includes(explicit) &&
    state.provinces[explicit] &&
    state.provinces[explicit].controlStage !== "china_control"
  ) {
    return explicit;
  }

  // 2. 점수 기반 선택
  const scored = candidates
    .map((id) => ({ id, prov: state.provinces[id] }))
    .filter((x) => x.prov)
    .map((x) => ({ id: x.id, score: scoreChinaAttackTarget(state, x.prov, card, axis) }))
    .filter((x) => x.score > -Infinity);

  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score);
  return scored[0].id;
}

/**
 * 대만 방어 카드의 타깃 배열 선택.
 *   - defense_buff 타입: 후보 배열 전체 적용
 *   - selected_province: 명시된 지역 1곳
 *   - 그 외 단일 타깃: 점수 최고 1곳
 */
export function selectTaiwanDefenseTargets(state, card) {
  if (!card) return [];

  // selected_province 명시 처리
  if (card.target === "selected_province") {
    return state.thisTurn?.selectedProvince ? [state.thisTurn.selectedProvince] : [];
  }

  // strait 등 단일 문자열
  if (typeof card.target === "string" && card.target !== "any") {
    return [card.target];
  }

  // 배열 타깃
  if (Array.isArray(card.target)) {
    // defense_buff는 전체 적용 (광역 강화)
    if (card.type === "defense_buff") return [...card.target];

    // 그 외는 위협도 최고 1곳
    const scored = card.target
      .map((id) => ({ id, prov: state.provinces[id] }))
      .filter((x) => x.prov)
      .map((x) => ({ id: x.id, score: scoreTaiwanDefenseTarget(state, x.prov, card) }));
    if (!scored.length) return [];
    scored.sort((a, b) => b.score - a.score);
    return [scored[0].id];
  }

  return [];
}

/**
 * 통합 진입점. turn_resolver에서 호출.
 *   - card.side 기준으로 적절한 선택기 호출
 *   - 단일 타깃은 배열로 정규화
 */
export function selectTargets(state, card, axis = null) {
  if (!card) return [];

  // "any"는 빈 배열 (효과가 알아서 처리)
  if (card.target === "any") return [];
  if (!card.target) return [];

  if (card.side === "china") {
    // 공격성 카드만 점수 선택. 그 외는 후보 배열 그대로 또는 단일.
    if (card.type === "attack" || card.type === "ranged") {
      const id = selectChinaAttackTarget(state, card, axis);
      return id ? [id] : [];
    }
    // 봉쇄/지원 카드는 명시된 타깃 그대로
    if (typeof card.target === "string") return [card.target];
    if (Array.isArray(card.target)) return [...card.target];
    return [];
  }

  if (card.side === "taiwan") {
    return selectTaiwanDefenseTargets(state, card);
  }

  return [];
}

function candidateProvinceIds(card) {
  if (!card.target) return [];
  if (typeof card.target === "string") {
    if (card.target === "any" || card.target === "selected_province") return [];
    return [card.target];
  }
  if (Array.isArray(card.target)) return card.target;
  return [];
}

// ---------------------------------------------------------------------
// SECTION C. AI 추천 — 주공축 / 방어 중점
// ---------------------------------------------------------------------

/**
 * 중국 AI: 현재 상태에서 가장 유리한 주공축 추천.
 * 게이지 상태와 진척 정도를 종합 점수화.
 */
export function suggestChinaAxis(state, axes) {
  const g = state.gauges;
  const scores = {};
  const recent = state.persistent?.recentChinaAxes || [];
  const lastAxis = recent[recent.length - 1] || null;
  const lastTwoSame = recent.length >= 2 && recent[recent.length - 1] === recent[recent.length - 2]
    ? recent[recent.length - 1]
    : null;

  // 최근 같은 축 반복을 줄여서 외교/봉쇄 한 축에 갇히는 문제를 방지한다.
  const repetitionPenalty = (axisId) => {
    let penalty = 0;
    if (axisId === lastAxis) penalty -= 3.5;
    if (axisId === lastTwoSame) penalty -= 5.0;
    // 외교 축은 보조축이므로 연속 사용 시 더 강하게 막는다.
    if (axisId === "diplomatic_pressure" && axisId === lastAxis) penalty -= 2.0;
    return penalty;
  };

  // 상륙 진척이 이미 생긴 축은 끝까지 밀어붙일 유인이 있어야 한다.
  const northProgress = landingProgressTotal(state, ["keelung", "taoyuan"]);
  const southProgress = landingProgressTotal(state, ["kaohsiung", "tainan"]);

  // v0.3.6: 유효 타깃 없는 축 감점.
  // 남부 후보가 전부 china_control이면 남부 상륙 점수 대폭 감점,
  // 북부 후보가 전부 china_control이면 북부 압박도 감점.
  const isControlled = (id) => state.provinces?.[id]?.controlStage === "china_control";
  const allControlled = (ids) => ids.length > 0 && ids.every(isControlled);
  const southAllDone = allControlled(["kaohsiung", "tainan"]);
  const northAllDone = allControlled(["keelung", "taoyuan"]);

  for (const axis of axes) {
    let s;
    if (axis.id === "north_pressure") {
      s = 6.6;
      s += northProgress * 2.6;
      s += Math.max(0, 100 - (g.taiwanGovernment || 100)) * 0.04;
      s -= (g.usIntervention || 0) * 0.025;
      if (northAllDone) s -= 10;  // 모든 북부 후보 점령됨 → 무의미
    } else if (axis.id === "south_landing") {
      s = 6.4;
      s += southProgress * 2.5;
      s += (g.chinaSupply || 0) * 0.018;
      s += Math.max(0, (g.taiwanSupply || 80) - 45) * 0.025;
      if (southAllDone) s -= 10;  // 모든 남부 후보 점령됨 → 무의미
    } else if (axis.id === "naval_blockade") {
      // 기존 로직은 대만 보급이 낮을 때만 봉쇄를 고평가했다.
      // 그러나 봉쇄는 보급을 낮추기 위해 쓰는 축이므로 보급이 높을 때도 가치가 있어야 한다.
      s = 6.1;
      s += Math.max(0, (g.taiwanSupply || 80) - 35) * 0.055;
      s -= (g.japanIntervention || 0) * 0.02;
    } else if (axis.id === "information_warfare") {
      // 지휘망이 이미 낮을 때보다, 아직 멀쩡할 때 선제적으로 흔드는 가치 부여.
      s = 5.9;
      s += Math.max(0, (g.taiwanCommand || 100) - 55) * 0.045;
      s += Math.max(0, (g.taiwanGovernment || 100) - 70) * 0.025;
      s -= (g.chinaPoliticalPressure || 0) * 0.015;
    } else if (axis.id === "diplomatic_pressure") {
      s = 2.2;
      const allianceMax = Math.max(g.usIntervention || 0, g.japanIntervention || 0);
      // 외교 압박은 동맹 게이지가 실제로 임박했을 때만 주공축이 된다.
      s += Math.max(0, allianceMax - 55) * 0.09;
      s += Math.max(0, (g.chinaPoliticalPressure || 0) - 75) * 0.025;
    } else {
      s = 5;
    }
    scores[axis.id] = s + repetitionPenalty(axis.id);
  }

  // v0.4.1.4: ACT 3 + 중국 자원 소진 → 자살 돌격 방지
  // 사용자 명세: tempo ≤ 10 + supply ≤ 10 시 상륙/북부 가중치 대폭 감소,
  // 봉쇄/외교/정치 쪽으로 전환
  const isAct3 = (state.persistent?.lastActId === "ACT_3") || (state.turn >= 45);
  const exhausted = (g.chinaTempo || 0) <= 10 && (g.chinaSupply || 0) <= 10;
  if (isAct3 && exhausted) {
    // 군사 행동 가중치 감소
    if (scores.south_landing !== undefined) scores.south_landing -= 8;
    if (scores.north_pressure !== undefined) scores.north_pressure -= 8;
    // 비군사적 압박 가중치 증가
    if (scores.naval_blockade !== undefined) scores.naval_blockade += 3;
    if (scores.information_warfare !== undefined) scores.information_warfare += 4;
    if (scores.diplomatic_pressure !== undefined) scores.diplomatic_pressure += 6;
    // 1회 로그 (state.persistent.milestones에 기록)
    if (!state.persistent.milestones) state.persistent.milestones = {};
    if (!state.persistent.milestones.chinaExhaustedAt) {
      state.persistent.milestones.chinaExhaustedAt = state.turn;
      state.thisTurn?.operationLog?.push(
        "▶ 중국군 공세 둔화 — 보급 고갈로 상륙 작전 축소. 제한전·협상 우위로 전환."
      );
    }
  }

  let best = null, bestScore = -Infinity;
  for (const [id, sc] of Object.entries(scores)) {
    if (sc > bestScore) { best = id; bestScore = sc; }
  }
  return { axisId: best, scores };
}

/**
 * 대만 AI: 현재 어느 지역에 방어 중점을 둘지 추천.
 * = 가장 위협받는 지역의 태그 또는 id 반환
 */
export function suggestTaiwanFocus(state) {
  // v0.4.2-a.1: 타이베이 beachhead+ 시 북부 강제 focus (수도권 위기 대응 강화)
  const taipei = state.provinces?.taipei;
  const taipeiAtRisk = taipei && (
    taipei.landingStage === "beachhead" ||
    taipei.landingStage === "inland_expansion" ||
    taipei.controlStage === "beachhead_established" ||
    taipei.controlStage === "china_control"
  );
  if (taipeiAtRisk) {
    return { focus: "taipei", mode: "province", scores: [{ id: "taipei", score: 99, tags: ["north", "capital"] }], forcedReason: "capital_crisis" };
  }

  const provs = Object.values(state.provinces).filter((p) => p.type !== "sea_zone");
  if (!provs.length) return null;

  const scored = provs
    .map((p) => ({ id: p.id, tags: p.tags || [], score: scoreTaiwanDefenseTarget(state, p) }))
    .sort((a, b) => b.score - a.score);

  const top = scored[0];
  if (!top) return null;

  // 위협 임박이면 지역 id, 평시면 태그 (north/south/central 등)
  if (top.score >= 12) return { focus: top.id, mode: "province", scores: scored.slice(0, 3) };
  const regionTag = top.tags.find((t) => ["north", "central", "south", "east"].includes(t));
  return { focus: regionTag || top.id, mode: "region", scores: scored.slice(0, 3) };
}

function landingProgressTotal(state, ids) {
  let total = 0;
  for (const id of ids) {
    const prov = state.provinces[id];
    if (!prov) continue;
    const idx = LANDING_STAGES.indexOf(prov.landingStage || "none");
    if (idx > 0) total += idx;
  }
  return total;
}
