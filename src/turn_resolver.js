// =====================================================================
// 턴 리졸버 (turn_resolver.js)
// =====================================================================
// v0.2 7단계 턴 루프:
//   1. 정보 단계         - 게이지 스냅샷, 블러프 힌트
//   2. 전략 선언 단계    - 중국 주공축 / 대만 방어 중점 / 블러프 배치
//   3. 카드 배치 단계    - 양측 카드 비용 차감, 손에서 제거
//   4. 작전 해결 단계    - 주공축 효과, 카드 효과, 카운터플레이, 콤보
//   5. 피해/정치 효과    - 누적 임계 처리, 사기 붕괴 추가 패널티
//   6. 국제 개입 단계    - 이벤트 트리거 평가 및 적용
//   7. 턴 종료          - 승리 판정, 지속 효과 카운트다운, 턴 진행
// =====================================================================

import { addGauge, payCost, resetTurnState } from "./state.js";
import { turnStartDraw } from "./deck_state.js";
import {
  applyPerTurnPersistentEffects as applyPersistentPerTurnGain,
  computePersistentNightOpDefenseDebuff,
  computePersistentTaiwanSupplyDamageReduction,
  computePersistentUsJapanInterventionGainReduction
} from "./reward_system.js";
import {
  LANDING_STAGES,
  advanceLandingStage,
  regressLandingStage,
  landingStageToControlStage
} from "./landing_fsm.js";
import {
  GAME_RULES,
  CHINA_OBJECTIVE_TURN,
  chinaObjectivePhase
} from "./game_rules.js";
import {
  resolveCombatOperation,
  chooseAxisTarget,
  chooseBestTarget,
  splitCombatEffects,
  isCombatRelevantSource,
  formatCombatLog
} from "./combat_resolver.js";
import { selectTargets } from "./target_selector.js";

// ---------------------------------------------------------------------
// SECTION A. 효과 디스패처
// ---------------------------------------------------------------------
// 카드/축/이벤트의 effects 딕셔너리를 받아 state에 적용.
// 효과 키 → 핸들러 함수 매핑. 새 효과 추가 시 여기에 등록만 하면 됨.

const EFFECT_HANDLERS = {
  // ---- 직접 게이지 증감 (단순 더하기) ----
  chinaPoliticalPressure: (s, v) => addGauge(s, "chinaPoliticalPressure", v),
  internationalOpinion: (s, v) => addGauge(s, "internationalOpinion", v),
  taiwanMorale: (s, v) => addGauge(s, "taiwanMorale", v),
  chinaTempo: (s, v) => addGauge(s, "chinaTempo", v),
  chinaSupply: (s, v) => addGauge(s, "chinaSupply", v),
  taiwanCommand: (s, v) => addGauge(s, "taiwanCommand", v),
  taiwanGovernment: (s, v) => addGauge(s, "taiwanGovernment", v),
  taiwanSupply: (s, v) => addGauge(s, "taiwanSupply", v),

  // ---- 개입 게이지 증가 ----
  usInterventionGain: (s, v) => {
    // v0.4.0-c2-b3-3b: persistent usJapanInterventionGainReduction (양수 상승만 감쇄)
    if (v > 0) {
      const reduction = computePersistentUsJapanInterventionGainReduction(s);
      const finalGain = reduction > 0 ? Math.ceil(v * (1 - reduction)) : v;
      addGauge(s, "usIntervention", finalGain);
      if (reduction > 0 && finalGain < v) {
        s.thisTurn.operationLog.push(`정보 통제: 미국 개입 상승 +${v} → +${finalGain}`);
      }
    } else {
      addGauge(s, "usIntervention", v);
    }
  },
  japanInterventionGain: (s, v) => {
    if (v > 0) {
      const reduction = computePersistentUsJapanInterventionGainReduction(s);
      const finalGain = reduction > 0 ? Math.ceil(v * (1 - reduction)) : v;
      addGauge(s, "japanIntervention", finalGain);
      if (reduction > 0 && finalGain < v) {
        s.thisTurn.operationLog.push(`정보 통제: 일본 개입 상승 +${v} → +${finalGain}`);
      }
    } else {
      addGauge(s, "japanIntervention", v);
    }
  },
  koreaRearSupportGain: (s, v) => addGauge(s, "koreaRearSupport", v),

  // ---- 개입 게이지 감소 (중국 디나이얼) ----
  usInterventionGainReduction: (s, v) => addGauge(s, "usIntervention", -v),
  japanInterventionGainReduction: (s, v) => addGauge(s, "japanIntervention", -v),
  interventionGainReduction: (s, v) => {
    addGauge(s, "usIntervention", -v);
    addGauge(s, "japanIntervention", -v);
  },
  internationalOpinionReduction: (s, v) => addGauge(s, "internationalOpinion", -v),

  // ---- 대만 피해 (음수 방향) ----
  taiwanCommandDamage: (s, v) => addGauge(s, "taiwanCommand", -v),
  taiwanGovernmentDamage: (s, v) => addGauge(s, "taiwanGovernment", -v),
  taiwanSupplyDamage: (s, v) => {
    // v0.4.0-c2-b3-3a: persistent taiwanSupplyDamageReduction 적용
    const rawDamage = v;
    const reduction = computePersistentTaiwanSupplyDamageReduction(s);
    const finalDamage = reduction > 0 ? Math.ceil(rawDamage * (1 - reduction)) : rawDamage;
    addGauge(s, "taiwanSupply", -finalDamage);
    // 실제로 피해가 줄었을 때만 로그
    if (reduction > 0 && finalDamage < rawDamage) {
      s.thisTurn.operationLog.push(`보급선 우회: 대만 보급 피해 ${rawDamage} → ${finalDamage}`);
    }
  },

  // ---- 카운터플레이성 감소 (피해 완화) ----
  taiwanCommandDamageReduction: (s, v) => addGauge(s, "taiwanCommand", v),

  // ---- 턴 내 일시 보정 ----
  attackBonus: (s, v, ctx) => {
    s.thisTurn.attackBonus[ctx.side] += v;
  },
  taiwanDefenseValueDebuff: (s, v, ctx) => {
    s.thisTurn.defenseDebuff += v;
    // v0.4.0-c2-b3-2: 야간 작전 카드일 때만 persistent nightOpDefenseDebuff 추가 (좁은 적용)
    if (ctx?.source?.id === "china_night_operation") {
      const bonus = computePersistentNightOpDefenseDebuff(s);
      if (bonus > 0) {
        s.thisTurn.defenseDebuff += bonus;
        s.thisTurn.operationLog.push(`야간 작전 효율화 영구 보상 적용: 방어 -${bonus} 추가`);
      }
    }
  },

  // ---- 상륙 진척 (target이 필요) ----
  landingProgressBonus: (s, v, ctx) => {
    const targets = ctx.resolvedTargets || [];
    for (const provId of targets) {
      const prov = s.provinces[provId];
      if (!prov || prov.controlStage === "china_control") continue;
      for (let i = 0; i < v; i++) {
        prov.landingStage = advanceLandingStage(prov.landingStage);
      }
      // controlStage는 landingStage와 동기화 (단순 매핑)
      const expectedControl = landingStageToControlStage(prov.landingStage);
      // 후퇴는 안 시키고 진척만
      const curIdx = LANDING_STAGES.indexOf(prov.landingStage);
      prov.controlStage = expectedControl;
      const progressLabel = provId === "taipei" ? "수도권 압박 진척" : "상륙 진척";
      s.thisTurn.operationLog.push(
        `${progressLabel}: ${prov.name} → ${prov.landingStage} / ${prov.controlStage}`
      );
    }
  },

  landingProgressRegressChance: (s, p, ctx) => {
    const targets = ctx.resolvedTargets || [];
    for (const provId of targets) {
      const prov = s.provinces[provId];
      if (!prov || prov.landingStage === "none") continue;
      if (Math.random() < p) {
        prov.landingStage = regressLandingStage(prov.landingStage);
        prov.controlStage = landingStageToControlStage(prov.landingStage);
        const regressLabel = provId === "taipei" ? "수도권 압박 완화" : "상륙 후퇴 성공";
        s.thisTurn.operationLog.push(
          `${regressLabel}: ${prov.name} → ${prov.landingStage}`
        );
      }
    }
  },

  // ---- 지속 효과 / 다음 턴 보정 ----
  nextTurnTempoBonus: (s, v, ctx) => {
    s.persistent.activeBuffs.push({
      id: `nextTurnTempo_${s.turn}`,
      side: ctx.side,
      remainingTurns: 1,
      effects: { chinaTempo: v }
    });
  },
  nextTurnDefenseValueBonus: (s, v, ctx) => {
    s.persistent.activeBuffs.push({
      id: `nextTurnDefense_${s.turn}`,
      side: ctx.side,
      remainingTurns: 1,
      effects: { defenseValueBonus: v }
    });
  },
  chinaInformationWarfareReduction: (s, multiplier, ctx) => {
    s.persistent.activeBuffs.push({
      id: `infoWarReduction_${s.turn}`,
      side: "taiwan",
      remainingTurns: ctx.duration || 3,
      effects: { chinaInformationWarfareReduction: multiplier }
    });
  },

  // ---- 날씨 / 외교 영구 모디파이어 ----
  weatherPenalty: (s, v, ctx) => {
    s.persistent.weatherEffect = {
      remainingTurns: ctx.duration || 1,
      effects: { weatherPenalty: v, landingProgressModifier: ctx.landingProgressModifier || 0 }
    };
  },
  landingProgressModifier: (s, v) => {
    if (s.persistent.weatherEffect) {
      s.persistent.weatherEffect.effects.landingProgressModifier = v;
    }
  },
  diplomaticPressureModifier: () => { /* 추후 외교 카드 비용에 반영 */ },

  // ---- 정보전 / 블러프 ----
  revealOpponentBluff: (s, n, ctx) => {
    const opponent = ctx.side === "china" ? "taiwan" : "china";
    const hidden = opponent === "china" ? s.thisTurn.chinaFacedown : s.thisTurn.taiwanFacedown;
    const revealCount = Math.min(n, hidden.length);
    s.thisTurn.operationLog.push(`${opponent} 블러프 ${revealCount}장 공개`);
  },

  // ---- 전투/지역 효과 ----
  defenseValueDamage: (s, v, ctx) => {
    const targets = ctx.resolvedTargets || [];
    for (const provId of targets) {
      const prov = s.provinces[provId];
      if (!prov) continue;
      prov.defenseValueModifier = (prov.defenseValueModifier || 0) - v;
      s.thisTurn.operationLog.push(`방어력 손상: ${prov.name} ${prov.defenseValueModifier}`);
    }
  },
  defenseValueBonus: (s, v, ctx) => {
    const targets = ctx.resolvedTargets || [];
    for (const provId of targets) {
      const prov = s.provinces[provId];
      if (!prov) continue;
      // 방어 버프는 1턴성 임시 보너스로 처리한다.
      // 이전 버전은 defenseValueModifier에 영구 누적되어 가오슝 방어 30~40대가 되는 문제가 있었다.
      prov.defenseValueModifier = (prov.defenseValueModifier || 0) + v;
      prov.temporaryDefenseBonus = (prov.temporaryDefenseBonus || 0) + v;
      s.thisTurn.operationLog.push(`방어력 보강: ${prov.name} +${v}`);
    }
  },
  landingProgressBonusOnSuccess: (s, v, ctx) => {
    EFFECT_HANDLERS.landingProgressBonus(s, v, ctx);
  },
  supplyGainOnSuccess: (s, v) => addGauge(s, "chinaSupply", v),
  taiwanReserveLockout: (s, v) => {
    addGauge(s, "taiwanReserveTroops", -v);
  },
  nextTurnAttackBonus: (s, v, ctx) => {
    s.persistent.activeBuffs.push({
      id: `nextTurnAttack_${s.turn}`,
      side: ctx.side,
      remainingTurns: 1,
      effects: { attackBonus: v }
    });
  },
  nextTurnCounterAttackBonus: (s, v, ctx) => {
    s.persistent.activeBuffs.push({
      id: `nextTurnCounter_${s.turn}`,
      side: ctx.side,
      remainingTurns: 1,
      effects: { counterAttackBonus: v }
    });
  }
};

/**
 * effects 딕셔너리를 state에 적용.
 * ctx에 side / resolvedTargets / duration / 등 컨텍스트를 담아 전달.
 */
export function applyEffects(state, effects, ctx = {}) {
  if (!effects) return;
  for (const [key, value] of Object.entries(effects)) {
    const handler = EFFECT_HANDLERS[key];
    if (handler) {
      handler(state, value, ctx);
    } else {
      // 미등록 키는 로그 (조용한 실패 방지)
      state.log.push({
        turn: state.turn,
        level: "info",
        msg: `unhandled effect: ${key}=${JSON.stringify(value)}`
      });
    }
  }
}

// ---------------------------------------------------------------------
// SECTION B. 이벤트 트리거 평가
// ---------------------------------------------------------------------

function checkPredicate(pred, state) {
  if ("metric" in pred) {
    const v = state.gauges[pred.metric] ?? 0;
    if ("gte" in pred && !(v >= pred.gte)) return false;
    if ("lte" in pred && !(v <= pred.lte)) return false;
    if ("lt" in pred && !(v < pred.lt)) return false;
    if ("gt" in pred && !(v > pred.gt)) return false;
    return true;
  }
  if ("turnGte" in pred) return state.turn >= pred.turnGte;
  if ("probability" in pred) return Math.random() < pred.probability;
  if ("once" in pred) return true; // once는 별도 처리 (occurrenceCount 확인)
  return true;
}

export function shouldTriggerEvent(state, event) {
  // 일회성 이벤트는 이미 발동했으면 스킵
  const count = state.persistent.occurrenceCount[event.id] || 0;
  const isOnceType = event.triggerWhen.once === true
    || (event.triggerWhen.all || []).some((p) => p.once === true);
  if (isOnceType && count >= 1) return false;

  // maxOccurrences 체크
  if (event.triggerWhen.maxOccurrences && count >= event.triggerWhen.maxOccurrences) return false;

  // cooldown 체크
  if (state.persistent.eventCooldowns[event.id] > 0) return false;

  // all / any 평가
  const allPreds = event.triggerWhen.all || [];
  const anyPreds = event.triggerWhen.any || [];

  if (allPreds.length > 0) {
    for (const p of allPreds) {
      if ("once" in p) continue;
      if (!checkPredicate(p, state)) return false;
    }
  }
  if (anyPreds.length > 0) {
    const anyOk = anyPreds.some((p) => checkPredicate(p, state));
    if (!anyOk) return false;
  }
  return true;
}

function markEventTriggered(state, event) {
  state.persistent.occurrenceCount[event.id] = (state.persistent.occurrenceCount[event.id] || 0) + 1;
  state.persistent.triggeredOnce.push(event.id);
  if (event.triggerWhen.cooldownTurns) {
    state.persistent.eventCooldowns[event.id] = event.triggerWhen.cooldownTurns;
  }
}

// ---------------------------------------------------------------------
// SECTION C. 카운터플레이 매칭
// ---------------------------------------------------------------------

/**
 * 중국 카드 X에 반응 가능한 대만 카운터플레이 카드 검색.
 * "axis:<id>" 표기도 지원.
 */
function findCounterplay(state, sourceCard, cardIndex) {
  const opponentSide = sourceCard.side === "china" ? "taiwan" : "china";
  const opponentHand = state.decks?.[opponentSide]?.hand || [];
  for (const cardId of opponentHand) {
    const card = cardIndex.get(cardId);
    if (!card || card.type !== "counterplay") continue;
    const responds = card.trigger?.respondsTo || [];
    for (const ref of responds) {
      if (ref === sourceCard.id) return card;
      if (ref.startsWith("axis:")) {
        const axisId = ref.slice(5);
        if (sourceCard.preferredAxis === axisId) return card;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------
// SECTION D. 7단계 페이즈 함수
// ---------------------------------------------------------------------

export function phaseInformation(state) {
  // v0.4.0-c2-b1: 매 턴 시작 시 persistent 보상의 perTurnGain 적용
  // (snapshot은 perTurnGain 적용 *후* 게이지로 찍음 — 사용자에게는 그게 "이번 턴 시작 게이지")
  const perTurnApplied = applyPersistentPerTurnGain(state);

  const snapshot = { ...state.gauges };
  // v0.4.0-b: DAY 요약용 province 스냅샷 (controlStage/landingStage만 가벼운 복사)
  const provincesSnapshot = Object.fromEntries(
    Object.entries(state.provinces || {}).map(([id, p]) => [id, {
      controlStage: p.controlStage,
      landingStage: p.landingStage,
      name: p.name
    }])
  );
  state.log.push({
    turn: state.turn,
    phase: 1,
    name: "information",
    snapshot,
    provincesSnapshot,
    perTurnApplied
  });

  // c2-b1.2: perTurnGain 원본은 phase 1 log의 perTurnApplied에 보존하고,
  // 사용자 턴 로그에는 매턴 반복 노출하지 않는다. DAY 요약에서 누적 표시한다.

  // ---- v0.3.6: 턴 시작 드로우 ----
  // 1턴은 시작 손패 4장이 이미 있으므로 skip, 2턴부터 매턴 2장 드로우 + 한도 5장 적용
  if (state.decks && state.turn > 1) {
    const before = {
      china: { hand: state.decks.china.hand.length, deck: state.decks.china.deck.length },
      taiwan: { hand: state.decks.taiwan.hand.length, deck: state.decks.taiwan.deck.length }
    };
    const drawn = turnStartDraw(state, { skipFirstTurn: false });
    const after = {
      china: { hand: state.decks.china.hand.length, deck: state.decks.china.deck.length, discard: state.decks.china.discard.length },
      taiwan: { hand: state.decks.taiwan.hand.length, deck: state.decks.taiwan.deck.length, discard: state.decks.taiwan.discard.length }
    };
    state.log.push({
      turn: state.turn, phase: 1, name: "deck_draw",
      drawn, before, after
    });
  }

  return state;
}

export function phaseStrategyDeclaration(state, decisions) {
  if (!decisions.chinaAxis) {
    throw new Error(`Turn ${state.turn}: china must declare an axis`);
  }
  state.thisTurn.chinaAxis = decisions.chinaAxis;
  state.thisTurn.taiwanFocus = decisions.taiwanFocus || null;
  state.thisTurn.selectedProvince = decisions.selectedProvince || (
    decisions.taiwanFocus && state.provinces?.[decisions.taiwanFocus] ? decisions.taiwanFocus : null
  );
  state.thisTurn.chinaFacedown = decisions.chinaFacedown || [];
  state.thisTurn.taiwanFacedown = decisions.taiwanFacedown || [];
  state.thisTurn.selectedProvince = (
    decisions.selectedProvince && state.provinces?.[decisions.selectedProvince]
      ? decisions.selectedProvince
      : null
  );
  state.persistent.recentChinaAxes = state.persistent.recentChinaAxes || [];
  state.persistent.recentChinaAxes.push(decisions.chinaAxis);
  if (state.persistent.recentChinaAxes.length > 4) {
    state.persistent.recentChinaAxes = state.persistent.recentChinaAxes.slice(-4);
  }
  state.log.push({
    turn: state.turn, phase: 2, name: "strategy_declaration",
    chinaAxis: decisions.chinaAxis,
    taiwanFocus: decisions.taiwanFocus,
    selectedProvince: state.thisTurn.selectedProvince
  });
  return state;
}

export function phaseCardPlacement(state, decisions, cardIndex) {
  const placed = { china: [], taiwan: [] };
  for (const side of ["china", "taiwan"]) {
    const wantPlay = decisions[`${side}Cards`] || [];
    for (const cardId of wantPlay) {
      const card = cardIndex.get(cardId);
      if (!card) {
        state.log.push({ turn: state.turn, level: "warn", msg: `unknown card: ${cardId}` });
        continue;
      }
      if (!payCost(state, side, card.cost)) {
        state.log.push({ turn: state.turn, level: "warn", msg: `cost failed: ${cardId}` });
        continue;
      }
      placed[side].push(cardId);
    }
  }
  state.thisTurn.chinaPlayed = placed.china;
  state.thisTurn.taiwanPlayed = placed.taiwan;
  state.log.push({ turn: state.turn, phase: 3, name: "card_placement", placed });
  return state;
}

export function phaseOperationResolution(state, cardIndex, axisIndex) {
  const axis = axisIndex.get(state.thisTurn.chinaAxis);

  // 1. 중국 주공축 효과.
  //    v0.2부터 landingProgressBonus / *_OnSuccess 계열은 판정을 거쳐야 한다.
  if (axis) {
    const axisTarget = chooseAxisTarget(state, axis);
    resolveOperationEffects(state, {
      source: { ...axis, type: "axis", effects: axis.primaryEffects },
      axis,
      effects: axis.primaryEffects,
      riskOnFailure: axis.riskOnFailure,
      targetIds: axisTarget ? [axisTarget] : []
    });
    state.thisTurn.operationLog.push(`주공축 발동: ${axis.name}`);
  }

  // 2. 중국 카드 (카운터플레이 검사 포함)
  for (const cardId of state.thisTurn.chinaPlayed) {
    const card = cardIndex.get(cardId);
    if (!card) continue;
    const counter = findCounterplay(state, card, cardIndex);
    const targets = resolveTargets(card, state, axis);
    let effects = { ...(card.effects || {}) };

    // 콤보 보너스는 작전 판정 전에 합산한다.
    if (card.combos?.withAxis?.includes(state.thisTurn.chinaAxis)) {
      effects = mergeEffects(effects, card.combos.bonusEffect);
      state.thisTurn.operationLog.push(`콤보 발동: ${card.name} × ${axis?.name}`);
    }
    if (card.combos?.withCardType?.length) {
      const playedTypes = state.thisTurn.chinaPlayed
        .map((id) => cardIndex.get(id)?.type)
        .filter(Boolean);
      if (card.combos.withCardType.some((t) => playedTypes.includes(t))) {
        effects = mergeEffects(effects, card.combos.bonusEffect);
        state.thisTurn.operationLog.push(`연계 발동: ${card.name} × ${card.combos.withCardType.join("/")}`);
      }
    }

    if (counter) {
      // 카운터플레이 발동: 원본 효과 50% 감소, 카운터 효과 적용
      const halvedEffects = halveDamageEffects(effects);
      resolveOperationEffects(state, {
        source: card,
        axis,
        effects: halvedEffects,
        riskOnFailure: card.riskOnFailure,
        targetIds: targets
      });
      applyEffects(state, counter.effects, { side: "taiwan", resolvedTargets: [] });
      // 카운터 카드도 대만 손에서 소비 → discard
      const dt = state.decks?.taiwan;
      if (dt) {
        dt.hand = dt.hand.filter((id) => id !== counter.id);
        dt.discard.push(counter.id);
      }
      state.thisTurn.operationLog.push(`카운터플레이: ${card.name} → ${counter.name}`);
    } else {
      resolveOperationEffects(state, {
        source: card,
        axis,
        effects,
        riskOnFailure: card.riskOnFailure,
        targetIds: targets
      });
      state.thisTurn.operationLog.push(`중국 카드: ${card.name}`);
    }
  }

  // 3. 대만 카드
  for (const cardId of state.thisTurn.taiwanPlayed) {
    const card = cardIndex.get(cardId);
    if (!card) continue;
    const targets = resolveTargets(card, state);
    applyEffects(state, card.effects, { side: "taiwan", resolvedTargets: targets, duration: card.duration });
    state.thisTurn.operationLog.push(`대만 카드: ${card.name}`);
  }

  // 4. 손에서 사용 카드 제거 → discard로 이동 (카운터플레이로 이미 빠진 카드 제외)
  const dc = state.decks?.china;
  const dt = state.decks?.taiwan;
  if (dc) {
    const played = state.thisTurn.chinaPlayed.filter((id) => dc.hand.includes(id));
    dc.hand = dc.hand.filter((id) => !played.includes(id));
    dc.discard.push(...played);
  }
  if (dt) {
    const played = state.thisTurn.taiwanPlayed.filter((id) => dt.hand.includes(id));
    dt.hand = dt.hand.filter((id) => !played.includes(id));
    dt.discard.push(...played);
  }

  state.log.push({
    turn: state.turn, phase: 4, name: "operation_resolution",
    operations: [...state.thisTurn.operationLog],
    combatResults: [...(state.thisTurn.combatResults || [])]
  });
  return state;
}


function updateAlliedInterventionState(state) {
  state.persistent.alliedIntervention = state.persistent.alliedIntervention || {
    active: false,
    activatedTurn: null,
    usCombatSupport: false,
    japanNavalSupport: false,
    koreaRearSupportActive: false
  };
  const allied = state.persistent.alliedIntervention;

  if (state.gauges.usIntervention >= 100 && !allied.active) {
    allied.active = true;
    allied.activatedTurn = state.turn;
    allied.usCombatSupport = true;
    state.thisTurn.operationLog.push("🇺🇸 미국 개입 개시: 게임은 종료되지 않고 동맹 개입 단계로 전환");
    state.thisTurn.visualEvents.push({ type: "us_fleet_arrival", turn: state.turn });
  }

  if (allied.active && state.gauges.japanIntervention >= 70 && !allied.japanNavalSupport) {
    allied.japanNavalSupport = true;
    state.thisTurn.operationLog.push("🇯🇵 일본 해상·기지 지원 활성화");
    state.thisTurn.visualEvents.push({ type: "japan_naval_support", turn: state.turn });
  }

  if (allied.active && (state.gauges.koreaRearSupport >= 20 || state.gauges.usIntervention >= 100) && !allied.koreaRearSupportActive) {
    allied.koreaRearSupportActive = true;
    state.thisTurn.operationLog.push("🇰🇷 한국 후방지원 활성화: 미군 전개·보급 지원");
    state.thisTurn.visualEvents.push({ type: "korea_rear_support", turn: state.turn });
  }
}

function applyAlliedInterventionEffects(state) {
  const allied = state.persistent.alliedIntervention;
  if (!allied?.active) return;

  // 미국 개입은 즉시 게임 종료가 아니라, 이후 교전을 바꾸는 지속 압력으로 작동한다.
  addGauge(state, "chinaTempo", -4);
  addGauge(state, "chinaSupply", -2);
  addGauge(state, "chinaPoliticalPressure", 2);
  addGauge(state, "taiwanCommand", 2);
  addGauge(state, "taiwanSupply", 2);
  state.thisTurn.operationLog.push("동맹 개입 지속: 중국 작전 템포 -4 / 보급 -2, 대만 지휘 +2 / 보급 +2");
  state.thisTurn.visualEvents.push({ type: "us_air_patrol", turn: state.turn });

  if (allied.japanNavalSupport) {
    addGauge(state, "chinaSupply", -2);
    addGauge(state, "taiwanCommand", 1);
    state.thisTurn.operationLog.push("일본 해상지원: 중국 보급 -2 / 대만 지휘 +1");
    state.thisTurn.visualEvents.push({ type: "japan_fleet_screen", turn: state.turn });
  }

  if (allied.koreaRearSupportActive) {
    addGauge(state, "taiwanSupply", 3);
    addGauge(state, "taiwanCommand", 1);
    state.thisTurn.operationLog.push("한국 후방지원: 대만 보급 +3 / 지휘 +1");
    state.thisTurn.visualEvents.push({ type: "korea_logistics", turn: state.turn });
  }
}

export function phaseDamagePolitical(state) {
  // 보급 붕괴 처리: 보급 0 상태가 방치되면 사기/정부 기능이 흔들린다.
  // 단, 즉시 패배가 아니라 장기 압박으로 누적되어야 한다.
  if (state.gauges.taiwanSupply <= 0) {
    addGauge(state, "taiwanMorale", -6);
    addGauge(state, "taiwanGovernment", -3);
    state.thisTurn.operationLog.push("보급 붕괴: 국민 사기 -6 / 정부 기능 -3");
  } else if (state.gauges.taiwanSupply < 25) {
    addGauge(state, "taiwanMorale", -2);
    state.thisTurn.operationLog.push("보급 부족: 국민 사기 -2");
  }

  // 사기 임계 처리: 사기 30 미만이면 정부 기능 -2 추가
  if (state.gauges.taiwanMorale < 30) {
    addGauge(state, "taiwanGovernment", -2);
    state.thisTurn.operationLog.push("사기 임계: 정부 기능 -2 추가");
  }
  // 중국 속전속결 시한: 경과 후 +1/턴 가중, 경과 전엔 -2/턴 외교적 회복
  if (chinaObjectivePhase(state.turn) === "overdue") {
    addGauge(state, "chinaPoliticalPressure", 1);
    state.thisTurn.operationLog.push("속전속결 시한 경과: 중국 정치 압박 +1");
  } else {
    addGauge(state, "chinaPoliticalPressure", -2);
  }

  updateAlliedInterventionState(state);
  applyAlliedInterventionEffects(state);

  state.log.push({ turn: state.turn, phase: 5, name: "damage_political" });
  return state;
}

export function phaseInternationalIntervention(state, events, timing) {
  for (const event of events) {
    if (event.timing !== timing) continue;
    if (state.thisTurn.triggeredEvents.includes(event.id)) continue;
    if (!shouldTriggerEvent(state, event)) continue;
    applyEffects(state, event.effects, { side: "global", resolvedTargets: [] });
    markEventTriggered(state, event);
    state.thisTurn.triggeredEvents.push(event.id);
    state.thisTurn.operationLog.push(`이벤트 발동: ${event.name}`);
  }
  updateAlliedInterventionState(state);
  state.log.push({
    turn: state.turn, phase: 6, name: `intervention_${timing}`,
    triggeredEvents: [...state.thisTurn.triggeredEvents]
  });
  return state;
}

export function phaseTurnEnd(state) {
  // v0.3.10: 최근 전투 발생 지역 추적 — 다음 턴 시각 pulse용
  // combatResults[].targetId가 province id면 pulse 대상으로 기록
  const battles = state.thisTurn?.combatResults || [];
  const provinceIds = new Set(Object.keys(state.provinces || {}));
  const ids = new Set();
  for (const r of battles) {
    if (r?.targetId && provinceIds.has(r.targetId)) ids.add(r.targetId);
  }
  // 전투 없는 턴이면 빈 배열로 pulse 해제
  state.persistent.recentBattles = [...ids];

  // v0.3.8b: 수도권 압박 지속 추적 (즉시 승리 → 2턴 유지 + 인접 점령 AND 조건)
  // 타이베이가 "교두보 단계 이상"이면 카운터 증가, 아니면 리셋.
  // beachhead landingStage도 포함 (controlStage가 아직 beachhead_established가 아니어도 진척 중).
  const taipei = state.provinces.taipei;
  const taipeiPressured = !!taipei && (
    taipei.landingStage === "beachhead" ||
    taipei.landingStage === "inland_expansion" ||
    taipei.controlStage === "beachhead_established" ||
    taipei.controlStage === "china_control"
  );
  if (taipeiPressured) {
    state.persistent.capitalPressureTurns = (state.persistent.capitalPressureTurns || 0) + 1;
    if (state.persistent.capitalPressureTurns === 1) {
      state.thisTurn?.operationLog?.push("수도권 압박 1턴째: 타이베이 교두보 형성");
    } else if (state.persistent.capitalPressureTurns === 2) {
      const keelungCtrl = state.provinces.keelung?.controlStage === "china_control";
      const taoyuanCtrl = state.provinces.taoyuan?.controlStage === "china_control";
      if (keelungCtrl || taoyuanCtrl) {
        state.thisTurn?.operationLog?.push("수도권 압박 2턴째: 북부 접근로 확보");
      } else {
        state.thisTurn?.operationLog?.push("수도권 압박 2턴째 유지 — 단, 북부 접근로 미확보로 결정타 X");
      }
    }
  } else {
    if ((state.persistent.capitalPressureTurns || 0) > 0) {
      state.thisTurn?.operationLog?.push("수도권 압박 완화: 타이베이 진척 해제");
    }
    state.persistent.capitalPressureTurns = 0;
  }

  // 1. 승리 조건 체크
  state.outcome = checkVictoryConditions(state);

  // 1.5. 이번 턴 한정 방어 보너스 회수
  // defenseValueDamage(영구 손상)는 유지하고, defense_buff 계열의 임시 보너스만 제거한다.
  const cleanupEntries = [];
  for (const prov of Object.values(state.provinces || {})) {
    const temp = prov.temporaryDefenseBonus || 0;
    if (temp) {
      prov.defenseValueModifier = (prov.defenseValueModifier || 0) - temp;
      prov.temporaryDefenseBonus = 0;
      cleanupEntries.push(`${prov.name} -${temp}`);
    }
  }
  if (cleanupEntries.length) {
    // 이 로그가 매턴 보여야 정상 작동. 안 보이면 누적 버그.
    state.log.push({
      turn: state.turn,
      phase: 7,
      name: "defense_cleanup",
      msg: `임시 방어 보너스 정리: ${cleanupEntries.join(", ")}`,
      level: "info"
    });
  }

  // 2. 지속 버프 카운트다운
  state.persistent.activeBuffs = state.persistent.activeBuffs
    .map((b) => ({ ...b, remainingTurns: b.remainingTurns - 1 }))
    .filter((b) => b.remainingTurns > 0);

  // 3. 날씨 효과 카운트다운
  if (state.persistent.weatherEffect) {
    state.persistent.weatherEffect.remainingTurns -= 1;
    if (state.persistent.weatherEffect.remainingTurns <= 0) {
      state.persistent.weatherEffect = null;
    }
  }

  // 4. 이벤트 쿨다운 감소
  for (const id of Object.keys(state.persistent.eventCooldowns)) {
    state.persistent.eventCooldowns[id] -= 1;
    if (state.persistent.eventCooldowns[id] <= 0) delete state.persistent.eventCooldowns[id];
  }

  // 5. 다음 턴 진행 (승리 안 났을 때만)
  state.log.push({
    turn: state.turn, phase: 7, name: "turn_end",
    outcome: state.outcome
  });
  if (!state.outcome) {
    state.turn += 1;
    resetTurnState(state);
  }
  return state;
}

// ---------------------------------------------------------------------
// SECTION E. 메인 오케스트레이터
// ---------------------------------------------------------------------

/**
 * 한 턴 통째로 실행.
 * decisions = { chinaAxis, taiwanFocus, chinaCards, taiwanCards, chinaFacedown, taiwanFacedown }
 */
export function runTurn(state, decisions, indices) {
  const { cardIndex, axisIndex, events } = indices;
  if (state.outcome) {
    state.log.push({ turn: state.turn, level: "warn", msg: "game already ended" });
    return state;
  }

  phaseInformation(state);
  phaseStrategyDeclaration(state, decisions);
  phaseCardPlacement(state, decisions, cardIndex);
  phaseOperationResolution(state, cardIndex, axisIndex);
  phaseDamagePolitical(state);
  phaseInternationalIntervention(state, events, "after_operation_resolution");
  phaseInternationalIntervention(state, events, "start_of_turn"); // 다음 턴 시작 전 평가
  phaseTurnEnd(state);
  return state;
}

// ---------------------------------------------------------------------
// SECTION F. 헬퍼
// ---------------------------------------------------------------------

function resolveTargets(card, state, axis = null) {
  // target_selector에 위임. selectedProvince 명시 처리도 그쪽에서.
  return selectTargets(state, card, axis);
}

function resolveOperationEffects(state, { source, axis, effects, riskOnFailure, targetIds }) {
  const ctxBase = {
    side: source?.side || "china",
    resolvedTargets: targetIds || [],
    source,
    axis
  };

  if (!isCombatRelevantSource(source)) {
    applyEffects(state, effects, ctxBase);
    return { resolvedByCombat: false };
  }

  const { successEffects, immediateEffects } = splitCombatEffects(effects);
  applyEffects(state, immediateEffects, ctxBase);

  // 상륙/진척 계열 효과는 실제 지역 타깃이 필요하다.
  // 유효 타깃이 없으면 "전역/비접촉 영역"으로 추상 전투를 굴리지 않는다.
  if (requiresProvinceTarget(successEffects) && !(targetIds && targetIds.length)) {
    state.thisTurn.operationLog.push(`${source?.name || "작전"} 보류: 유효한 지역 타깃 없음`);
    return { resolvedByCombat: false, skipped: true, reason: "no_valid_target" };
  }

  // 성공 의존 효과가 없고 실패 리스크도 없으면 판정 불필요
  if (!Object.keys(successEffects).length && !riskOnFailure) {
    return { resolvedByCombat: false };
  }

  const combatTargetId = (targetIds && targetIds.length) ? targetIds[0] : null;
  const result = resolveCombatOperation(state, {
    source,
    axis,
    targetId: combatTargetId
  });

  state.thisTurn.combatResults = state.thisTurn.combatResults || [];
  state.thisTurn.combatResults.push(result);
  state.thisTurn.operationLog.push(formatCombatLog(result));

  const ctx = {
    ...ctxBase,
    resolvedTargets: result.targetId ? [result.targetId] : [],
    combatResult: result
  };

  if (result.success) {
    applyEffects(state, successEffects, ctx);
  } else {
    applyEffects(state, riskOnFailure, ctx);
  }

  return result;
}

function requiresProvinceTarget(effects = {}) {
  return Object.prototype.hasOwnProperty.call(effects, "landingProgressBonus") ||
    Object.prototype.hasOwnProperty.call(effects, "landingProgressBonusOnSuccess");
}

function mergeEffects(base = {}, bonus = {}) {
  const out = { ...base };
  for (const [key, value] of Object.entries(bonus || {})) {
    if (typeof value === "number" && typeof out[key] === "number") {
      out[key] += value;
    } else {
      out[key] = value;
    }
  }
  return out;
}

function halveDamageEffects(effects) {
  const out = {};
  for (const [k, v] of Object.entries(effects)) {
    if (typeof v === "number") {
      out[k] = Math.round(v * 0.5);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ---------------------------------------------------------------------
// SECTION G. 승리 조건
// ---------------------------------------------------------------------

export function checkVictoryConditions(state) {
  // 중국 승리
  if (state.gauges.taiwanGovernment <= 0) return "china_surrender_win";
  if (state.gauges.taiwanSupply <= 0 && state.gauges.taiwanMorale <= 40) return "china_blockade_win";
  if (state.provinces.taipei?.controlStage === "china_control") return "china_capital_win";

  // v0.3.8b: 수도권 압박 승리 조건 강화 (즉시 승리 → 2턴 유지 AND 북부 접근로 점령)
  // 기존 (v0.3.7까지): 타이베이 beachhead_established + 정부 90 이하 → 즉시 승리
  // 변경 (v0.3.8b):  타이베이 압박 2턴 지속 AND (지룽 또는 타오위안) china_control 점령 필요
  //   - taiwanGovernment 조건은 제거 (지속/접근로가 더 직관적 조건)
  //   - capitalPressureTurns는 phaseTurnEnd에서 추적 (이미 갱신됨)
  const taipeiHeldByChina = ["beachhead_established", "china_control"].includes(state.provinces.taipei?.controlStage);
  const sustained = (state.persistent?.capitalPressureTurns || 0) >= 2;
  const northernAccess =
    state.provinces.keelung?.controlStage === "china_control" ||
    state.provinces.taoyuan?.controlStage === "china_control";
  if (taipeiHeldByChina && sustained && northernAccess) {
    return "china_capital_pressure_win";
  }

  // 대만 승리
  // 미국 개입도 100은 즉시 승리가 아니라 동맹 개입 단계 진입이다.
  // 전투는 계속 진행되며, 대만은 최종 턴까지 생존하거나 중국 정치 압박을 100까지 올려야 승리한다.
  if (state.gauges.chinaPoliticalPressure >= 100) return "taiwan_political_collapse_win";
  if (state.turn >= GAME_RULES.totalTurns) return "taiwan_survival_win";

  return null;
}
