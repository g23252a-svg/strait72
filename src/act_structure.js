// =====================================================================
// act_structure.js (v0.4.1)
// ---------------------------------------------------------------------
// 21일 캠페인을 3개 ACT로 나눠 *의미 있는 진행 단계*를 만든다.
//
// 핵심 아이디어:
//   - 30턴 → 84턴 단순 확장은 "지루한 30번 딸깍 → 지루한 84번 딸깍"
//   - ACT 구조는 각 단계마다 목표/위협/긴장도가 달라야 의미 있음
//
// ACT 1 — 72시간 위기 (T1-12, D+0~D+3)
//   중국: 초기 교두보 확보, 미국 개입 100 도달 전 결판 시도
//   대만: 초기 방어선 유지, 동맹 게이지 끌어올리기
//   short_72h 시나리오는 여기서 끝남
//
// ACT 2 — 동맹 개입 전환기 (T13-44, D+3~D+11)
//   중국: 봉쇄/정치압박/수도권 압박으로 군사적 결정타 시도
//   대만: 동맹 개입 게이지 100 달성, 보급선 유지
//   미국 개입 100 도달 시 ACT 3 진입 (early transition 가능)
//
// ACT 3 — 동맹 개입 후 장기전 (T45-84, D+11~D+21)
//   중국: 협상 우위 / 제한전 유지 / 정치 압박 회피
//   대만: 교두보 축소 / 보급선 회복 / 정부 기능 유지
//   새 메커닉: 동맹 압력으로 중국 봉쇄/공격 페널티
// =====================================================================

import { isPlayerSide } from "./campaign_state.js";

export const ACT_DEFINITIONS = {
  ACT_1: {
    id: "ACT_1",
    name: "72시간 위기",
    description: "초기 상륙 저지",
    startTurn: 1,
    endTurn: 12,
    chinaGoal: "교두보 확보 + 빠른 결판",
    taiwanGoal: "초기 방어선 + 동맹 게이지 끌어올리기",
    intensityTone: "위기 (긴급)"
  },
  ACT_2: {
    id: "ACT_2",
    name: "동맹 개입 전환기",
    description: "봉쇄와 정치 압박의 시간",
    startTurn: 13,
    endTurn: 44,
    chinaGoal: "봉쇄/정치압박/수도권 압박",
    taiwanGoal: "동맹 개입 도달 + 보급 유지",
    intensityTone: "전환 (격화)"
  },
  ACT_3: {
    id: "ACT_3",
    name: "동맹 개입 후 장기전",
    description: "제한전과 협상 우위 경쟁",
    startTurn: 45,
    endTurn: 84,
    chinaGoal: "협상 우위 + 정치 압박 회피",
    taiwanGoal: "교두보 축소 + 보급 회복",
    intensityTone: "장기전 (소모전)"
  }
};

const ACT_ORDER = ["ACT_1", "ACT_2", "ACT_3"];

// =====================================================================
// currentActFor — 현재 턴 기준 ACT 식별
// ---------------------------------------------------------------------
// short_72h 시나리오는 ACT_1만. full_21d는 turn에 따라.
// 또한 미국 개입 100 도달 시 ACT_2 → ACT_3 *조기 전환* 가능 (정책 결정).
//   현재 정책: 자연 ACT 경계 + 조기 전환은 ACT 2 후반에만.
// =====================================================================
export function currentActFor(state, campaign) {
  // short_72h: 무조건 ACT_1
  if (campaign?.scenarioId === "short_72h") return ACT_DEFINITIONS.ACT_1;

  const turn = state.turn || 1;
  const usReady = (state.gauges?.usIntervention || 0) >= 100;

  // v0.4.1 lock: 한번 ACT_3 진입했으면 되돌아가지 않음 (조기 전환이든 자연이든)
  // ACT 진행은 단방향 1→2→3.
  const lastActId = state.persistent?.lastActId;
  if (lastActId === "ACT_3") return ACT_DEFINITIONS.ACT_3;

  // 조기 ACT_3 전환: ACT_2 후반 (T35+)에서 미국 100 도달 시
  if (turn >= 35 && turn <= 44 && usReady) {
    return ACT_DEFINITIONS.ACT_3;
  }

  if (turn <= ACT_DEFINITIONS.ACT_1.endTurn) {
    // ACT 1 자연 진행. 단 lastAct가 이미 ACT_2/3이면 거기 유지 (state 복구 안전)
    if (lastActId === "ACT_2") return ACT_DEFINITIONS.ACT_2;
    return ACT_DEFINITIONS.ACT_1;
  }
  if (turn <= ACT_DEFINITIONS.ACT_2.endTurn) return ACT_DEFINITIONS.ACT_2;
  return ACT_DEFINITIONS.ACT_3;
}

// ACT 전환이 *이번 턴*에 발생했는지 (직전 턴과 비교)
export function actJustChanged(state, campaign) {
  const lastAct = state.persistent?.lastActId;
  const nowAct = currentActFor(state, campaign).id;
  return lastAct !== nowAct;
}

// state.persistent.lastActId 갱신 — turn_resolver에서 phaseTurnEnd 시 호출
export function updateLastActId(state, campaign) {
  if (!state.persistent) state.persistent = {};
  state.persistent.lastActId = currentActFor(state, campaign).id;
}

// =====================================================================
// v0.4.1: ACT 3 동맹 압력 (allied pressure)
// ---------------------------------------------------------------------
// ACT 3 진입 시 동맹 압력이 중국 행동에 페널티 적용:
//   - 미국 개입도 ≥ 80: 중국 공격력 -1
//   - 일본 개입도 ≥ 50: 중국 보급력 -2/turn
//   - 한국 후방지원 ≥ 20: 미국 보급 안정성 +1
// 이건 turn_resolver의 phaseTurnEnd에서 적용.
// =====================================================================
export function computeAlliedPressure(state, campaign) {
  // ACT 3에서만 작동
  const act = currentActFor(state, campaign);
  if (act.id !== "ACT_3") return null;

  const g = state.gauges || {};
  return {
    usAttackPenalty: (g.usIntervention || 0) >= 80 ? 1 : 0,
    japanSupplyDrain: (g.japanIntervention || 0) >= 50 ? 2 : 0,
    koreaLogisticsBonus: (g.koreaRearSupport || 0) >= 20 ? 1 : 0
  };
}

// ACT별 진행률 (0~1) — UI 진행 바용
export function actProgress(state, campaign) {
  const act = currentActFor(state, campaign);
  const turn = state.turn || 1;
  const span = act.endTurn - act.startTurn + 1;
  const elapsed = Math.min(span, turn - act.startTurn + 1);
  return {
    actId: act.id,
    actName: act.name,
    actDescription: act.description,
    currentTurn: turn,
    actStartTurn: act.startTurn,
    actEndTurn: act.endTurn,
    progress: Math.max(0, Math.min(1, elapsed / span)),
    chinaGoal: act.chinaGoal,
    taiwanGoal: act.taiwanGoal
  };
}
