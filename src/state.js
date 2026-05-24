// =====================================================================
// 게임 상태 (state.js)
// =====================================================================
// 책임:
//   - 초기 상태 생성 (provinces/cards 데이터 기반)
//   - 게이지 클램핑 (0~100 범위 강제)
//   - 자원 풀 차감 / 회수
// =====================================================================

// 0~100 범위의 게이지 키 (퍼센트형)
export const PERCENT_GAUGES = Object.freeze([
  "usIntervention",
  "japanIntervention",
  "koreaRearSupport",
  "internationalOpinion",
  "chinaPoliticalPressure",
  "chinaTempo",
  "chinaSupply",
  "taiwanMorale",
  "taiwanGovernment",
  "taiwanCommand",
  "taiwanSupply"
]);

// 정수 카운터 자원 (카드 비용 자원 등)
export const INT_RESOURCES = Object.freeze([
  "chinaReserveTroops",
  "taiwanReserveTroops",
  "taiwanInternationalRequest"
]);

// 카드 비용 키 → 게이지 키 매핑
export const COST_TO_GAUGE = Object.freeze({
  tempo: "chinaTempo",
  supply: "chinaSupply",
  command: null,                          // command는 측에 따라 갈림 (아래 함수에서 처리)
  reserveTroops: null,                    // 측에 따라 갈림
  internationalRequest: "taiwanInternationalRequest"
});

export function clampPercent(v) {
  if (v < 0) return 0;
  if (v > 100) return 100;
  return v;
}

export function clampNonNegative(v) {
  return v < 0 ? 0 : v;
}

/**
 * 게이지에 delta를 더하고 클램핑.
 * 퍼센트 게이지는 0~100, 정수 자원은 0~∞.
 */
export function addGauge(state, key, delta) {
  if (PERCENT_GAUGES.includes(key)) {
    state.gauges[key] = clampPercent((state.gauges[key] || 0) + delta);
  } else if (INT_RESOURCES.includes(key)) {
    state.gauges[key] = clampNonNegative((state.gauges[key] || 0) + delta);
  } else {
    // 알 수 없는 키는 로그만
    state.log.push({ turn: state.turn, level: "warn", msg: `unknown gauge key: ${key}` });
  }
}

/**
 * 카드 비용 차감. 부족하면 false 반환 (호출자가 거부 처리).
 */
export function payCost(state, side, cost) {
  if (!cost) return true;
  const debits = [];

  for (const [key, amount] of Object.entries(cost)) {
    let gaugeKey;
    if (key === "command") {
      gaugeKey = side === "china" ? "chinaTempo" : "taiwanCommand";
    } else if (key === "reserveTroops") {
      gaugeKey = side === "china" ? "chinaReserveTroops" : "taiwanReserveTroops";
    } else {
      gaugeKey = COST_TO_GAUGE[key];
    }
    if (!gaugeKey) {
      state.log.push({ turn: state.turn, level: "warn", msg: `unknown cost key: ${key}` });
      continue;
    }
    if ((state.gauges[gaugeKey] || 0) < amount) {
      // 자원 부족
      return false;
    }
    debits.push([gaugeKey, amount]);
  }

  for (const [gaugeKey, amount] of debits) {
    addGauge(state, gaugeKey, -amount);
  }
  return true;
}

/**
 * 초기 게임 상태 생성.
 *   - provinces.json 그대로 복사 (수정 가능한 사본)
 *   - 게이지는 시나리오 초기값으로 (D-day 직전 긴장 상태)
 */
export function createInitialState({ provinces, gameRules, axes, cardsChina, cardsTaiwan, events, totalTurnsOverride = null }) {
  const provincesById = {};
  for (const p of provinces) {
    provincesById[p.id] = {
      ...p,
      defenseValueModifier: 0,
      buffs: []                            // 지역별 지속 버프 (다음 턴 +X 등)
    };
  }

  // v0.4.1: campaign.totalTurns override (84턴 등). 기본은 gameRules.totalTurns.
  const effectiveTotalTurns = totalTurnsOverride || gameRules.totalTurns;

  return {
    turn: 1,
    rulesVersion: gameRules.version,
    totalTurns: effectiveTotalTurns,  // v0.4.1: state에 기록 → checkVictoryConditions가 이걸 우선 사용

    // ---- 게이지 (시작 상태) ----
    gauges: {
      // 국제 개입 (대만이 채우면 유리)
      usIntervention: 20,
      japanIntervention: 15,
      koreaRearSupport: 10,
      internationalOpinion: 35,

      // 중국 압박 (대만이 채우면 중국 패배)
      chinaPoliticalPressure: 0,

      // 중국 작전 자원
      chinaTempo: 80,
      chinaSupply: 80,

      // 대만 자원
      taiwanMorale: 80,
      taiwanGovernment: 100,
      taiwanCommand: 100,
      taiwanSupply: 80,

      // 카드 비용 정수 자원
      chinaReserveTroops: 8,
      taiwanReserveTroops: 8,
      taiwanInternationalRequest: 3
    },

    provinces: provincesById,

    // decks 구조는 initializeDecks(state, ...)로 별도 초기화한다 (v0.3.6+)
    // 호환을 위해 hands 필드는 비워둠 (deprecated, 모든 참조는 state.decks로 옮김)
    decks: null,

    // ---- 이번 턴 임시 상태 ----
    thisTurn: {
      chinaAxis: null,
      taiwanFocus: null,
      chinaPlayed: [],
      taiwanPlayed: [],
      chinaFacedown: [],
      taiwanFacedown: [],
      attackBonus: { china: 0, taiwan: 0 },
      defenseDebuff: 0,                    // 야간 작전 등
      operationLog: [],
      triggeredEvents: [],
      visualEvents: []
    },

    // ---- 지속 효과 ----
    persistent: {
      activeBuffs: [],                      // { id, side, remainingTurns, effects }
      weatherEffect: null,                  // { remainingTurns, effects }
      eventCooldowns: {},                   // { eventId: turnsRemaining }
      triggeredOnce: [],                    // 일회성 발동 이벤트 id 목록
      occurrenceCount: {},                  // { eventId: 발동 횟수 }
      recentChinaAxes: [],                 // 최근 주공축 기록, AI 반복 패널티용
      alliedIntervention: {
        active: false,
        activatedTurn: null,
        usCombatSupport: false,
        japanNavalSupport: false,
        koreaRearSupportActive: false
      }
    },

    outcome: null,                          // null | "china_*" | "taiwan_*"
    log: []
  };
}

/**
 * 이번 턴 임시 상태 리셋 (턴 종료 시 호출).
 */
export function resetTurnState(state) {
  state.thisTurn = {
    chinaAxis: null,
    taiwanFocus: null,
    chinaPlayed: [],
    taiwanPlayed: [],
    chinaFacedown: [],
    taiwanFacedown: [],
    attackBonus: { china: 0, taiwan: 0 },
    defenseDebuff: 0,
    operationLog: [],
    triggeredEvents: [],
    visualEvents: []
  };
}

// 인덱스 빌더 (Map 조회용)
export function buildCardIndex(cardsChina, cardsTaiwan) {
  const map = new Map();
  for (const c of cardsChina) map.set(c.id, c);
  for (const c of cardsTaiwan) map.set(c.id, c);
  return map;
}

export function buildAxisIndex(axes) {
  return new Map(axes.map((a) => [a.id, a]));
}
