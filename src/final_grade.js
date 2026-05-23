// =====================================================================
// final_grade.js (v0.4.0-d1)
// ---------------------------------------------------------------------
// 게임 종료 시 진영별 최종 점수 + 등급 + 해설 생성.
//
// 핵심 함수:
//   - calculateFinalScore(state, side): 0-100 점수 (clamped)
//   - gradeFromScore(score): "S"|"A"|"B"|"C"|"D"
//   - buildFinalReport(state, campaign, data): 통합 보고서
//   - generateFinalInterpretation(report, side): 사람 친화 해설
//
// 점수 구조:
//   - baseResult: outcome × side 매트릭스 (기본 30~80)
//   - components: 게이지/턴/점령 등 modifier (±20)
//   - clamp 0~100
// =====================================================================

// outcome × side 기본 점수 매트릭스
// (대만 입장에서 좋은 outcome은 대만한테 높음, 중국한테 낮음)
const BASE_RESULT_SCORES = {
  // 대만이 정부 붕괴로 항복 — 중국 압도적 승리
  china_surrender_win: { taiwan: 5, china: 70 },
  // 대만이 보급/사기 동시 붕괴 — 중국 봉쇄 승
  china_blockade_win: { taiwan: 5, china: 60 },
  // 타이베이 점령 — 중국 군사적 결정타
  china_capital_win: { taiwan: 0, china: 80 },
  // 수도 압박 turns 누적 — 중국 점진적 승리
  china_capital_pressure_win: { taiwan: 20, china: 60 },
  // 정치 압박 100 누적 — 대만의 외교/정치적 승리
  taiwan_political_collapse_win: { taiwan: 70, china: 0 },
  // 30턴 생존 — 대만 표준 승리
  taiwan_survival_win: { taiwan: 60, china: 20 },
  // 결과 미정 (시뮬 fallback)
  no_outcome: { taiwan: 30, china: 30 }
};

// =====================================================================
// calculateFinalScore — 진영별 0~100 점수
// =====================================================================
export function calculateFinalScore(state, side) {
  const outcome = state.outcome || "no_outcome";
  const base = BASE_RESULT_SCORES[outcome]?.[side] ?? 30;
  const rawG = state.gauges || {};
  // 안전망: 누락된 게이지는 0으로 (NaN 방지)
  const g = {
    usIntervention: rawG.usIntervention ?? 0,
    japanIntervention: rawG.japanIntervention ?? 0,
    koreaRearSupport: rawG.koreaRearSupport ?? 0,
    internationalOpinion: rawG.internationalOpinion ?? 0,
    chinaPoliticalPressure: rawG.chinaPoliticalPressure ?? 0,
    chinaTempo: rawG.chinaTempo ?? 0,
    chinaSupply: rawG.chinaSupply ?? 0,
    taiwanMorale: rawG.taiwanMorale ?? 0,
    taiwanGovernment: rawG.taiwanGovernment ?? 0,
    taiwanCommand: rawG.taiwanCommand ?? 0,
    taiwanSupply: rawG.taiwanSupply ?? 0
  };

  let score = base;
  let components = []; // {label, delta}

  if (side === "taiwan") {
    // 대만 자체 게이지 잔존 (각 0~100 × 가중치)
    const govC = Math.round(g.taiwanGovernment * 0.10);
    const morC = Math.round(g.taiwanMorale * 0.06);
    const supC = Math.round(g.taiwanSupply * 0.06);
    const cmdC = Math.round(g.taiwanCommand * 0.04);
    score += govC + morC + supC + cmdC;
    components.push({ label: "정부 기능 잔존", delta: govC });
    components.push({ label: "국민 사기 유지", delta: morC });
    components.push({ label: "보급 상태", delta: supC });
    components.push({ label: "지휘 체계", delta: cmdC });

    // 동맹 개입 수준 — gauge × 계수, 그 다음 cap
    // (cap을 곱하기 전에 걸면 미국 100×0.2=20이 아니라 min(20,100)*0.2=4가 됨 — d1.1 fix)
    const usC = Math.min(20, Math.round(g.usIntervention * 0.2));
    const jpC = Math.min(15, Math.round(g.japanIntervention * 0.15));
    const krC = Math.min(10, Math.round(g.koreaRearSupport * 0.3));
    score += usC + jpC + krC;
    components.push({ label: "미국 개입 유도", delta: usC });
    components.push({ label: "일본 개입 유도", delta: jpC });
    components.push({ label: "한국 후방 지원", delta: krC });

    // 점령지 손실 페널티
    const lost = countLostProvinces(state);
    const lossP = -lost * 5;
    if (lost > 0) {
      score += lossP;
      components.push({ label: `점령지 손실 (${lost}곳)`, delta: lossP });
    }

    // 종료 시점 보너스 (오래 버틴 만큼)
    if (outcome === "taiwan_survival_win") {
      components.push({ label: "30턴 완주", delta: 5 });
      score += 5;
    } else if (outcome === "taiwan_political_collapse_win") {
      const ppC = Math.round((g.chinaPoliticalPressure / 100) * 8);
      components.push({ label: "중국 정치 압박 달성", delta: ppC });
      score += ppC;
    }

    // 빠른 패배 페널티 (대만이 일찍 무너졌으면)
    if (outcome.startsWith("china_") && state.turn < 20) {
      const earlyP = -10;
      components.push({ label: "조기 붕괴", delta: earlyP });
      score += earlyP;
    }
  } else if (side === "china") {
    // 빠른 승리 보너스
    if (outcome.startsWith("china_")) {
      if (state.turn <= 16) { score += 15; components.push({ label: "조기 승리 (4 DAY 이내)", delta: 15 }); }
      else if (state.turn <= 24) { score += 8; components.push({ label: "빠른 승리 (6 DAY 이내)", delta: 8 }); }
    }

    // 점령 진척
    const occupied = countOccupiedProvinces(state);
    const occC = occupied * 4;
    if (occupied > 0) {
      score += occC;
      components.push({ label: `점령 지역 (${occupied}곳)`, delta: occC });
    }
    // 타이베이 진척 가중
    const taipei = state.provinces?.taipei;
    if (taipei?.controlStage === "china_control") {
      score += 8;
      components.push({ label: "타이베이 점령", delta: 8 });
    } else if (taipei?.landingStage && taipei.landingStage !== "none") {
      score += 4;
      components.push({ label: "타이베이 압박", delta: 4 });
    }

    // 대만 게이지 타격 (낮을수록 ↑)
    const govD = Math.round((100 - g.taiwanGovernment) * 0.12);
    const morD = Math.round((100 - g.taiwanMorale) * 0.06);
    const supD = Math.round((100 - g.taiwanSupply) * 0.06);
    score += govD + morD + supD;
    components.push({ label: "대만 정부 약화", delta: govD });
    components.push({ label: "대만 사기 약화", delta: morD });
    components.push({ label: "대만 보급 타격", delta: supD });

    // 동맹 개입 억제 (낮을수록 ↑)
    const usSupp = Math.round(Math.max(0, 60 - g.usIntervention) * 0.25);
    const jpSupp = Math.round(Math.max(0, 50 - g.japanIntervention) * 0.2);
    score += usSupp + jpSupp;
    components.push({ label: "미국 개입 억제", delta: usSupp });
    components.push({ label: "일본 개입 억제", delta: jpSupp });

    // 정치압박 페널티
    const ppP = -Math.round(g.chinaPoliticalPressure * 0.25);
    if (g.chinaPoliticalPressure > 0) {
      score += ppP;
      components.push({ label: "자국 정치 압박 누적", delta: ppP });
    }
    // 작전 자원 고갈 페널티
    if (g.chinaTempo < 40) {
      const tempoP = -Math.round((40 - g.chinaTempo) * 0.2);
      score += tempoP;
      components.push({ label: "작전 템포 고갈", delta: tempoP });
    }
    if (g.chinaSupply < 40) {
      const supP = -Math.round((40 - g.chinaSupply) * 0.15);
      score += supP;
      components.push({ label: "보급 고갈", delta: supP });
    }

    // 72시간 (30턴) 목표 실패
    if (outcome === "taiwan_survival_win" || outcome === "taiwan_political_collapse_win") {
      score -= 10;
      components.push({ label: "72시간 목표 실패", delta: -10 });
    }
  }

  // clamp 0~100
  const clamped = Math.max(0, Math.min(100, score));
  return {
    score: clamped,
    rawScore: score, // 디버깅용 (clamp 전)
    base,
    components
  };
}

// =====================================================================
// gradeFromScore
// =====================================================================
export function gradeFromScore(score) {
  if (score >= 90) return "S";
  if (score >= 75) return "A";
  if (score >= 60) return "B";
  if (score >= 40) return "C";
  return "D";
}

// =====================================================================
// generateFinalInterpretation — outcome + grade 따른 한 줄 해설
// =====================================================================
export function generateFinalInterpretation(outcome, score, side) {
  const grade = gradeFromScore(score);
  const m = INTERPRETATION_MATRIX[outcome]?.[side] || {};
  // 등급별 메시지 매칭 (없으면 가장 가까운 매칭)
  return m[grade] || m.B || `${outcome} / ${grade} (${score}점)`;
}

const INTERPRETATION_MATRIX = {
  taiwan_survival_win: {
    taiwan: {
      S: "방어선이 거의 흔들리지 않은 채 72시간을 버텨냈습니다. 동맹 개입 유도가 거의 완벽했습니다.",
      A: "방어선은 흔들렸지만, 동맹 개입을 끌어내며 장기 생존에 성공했습니다.",
      B: "곳곳이 무너졌으나 결정적 영토 손실 없이 시간을 벌어냈습니다.",
      C: "겨우 버텼습니다. 다음 국면은 매우 불안정할 것입니다.",
      D: "방어선이 와해된 채 시간만 흘렀습니다. 동맹 도착 전 사실상 전투력 소진."
    },
    china: {
      S: "72시간 안에 결판을 짓지 못했지만, 최대한의 손실을 강요했습니다.",
      A: "목표 달성은 실패했으나 대만 사회/군에 큰 타격을 입혔습니다.",
      B: "신속전 실패. 장기전 진입으로 외교적 부담이 커졌습니다.",
      C: "전선이 정체된 채 시간을 허비했습니다.",
      D: "전략 목표 미달성 + 자체 정치 압박 누적. 작전 실패."
    }
  },
  taiwan_political_collapse_win: {
    taiwan: {
      S: "외교와 여론을 완벽히 조율해 중국 내부 정치 압박으로 전쟁을 멈췄습니다.",
      A: "국제 여론과 동맹 개입으로 중국 정권에 결정적 압박을 가했습니다.",
      B: "정치 압박 누적이 중국의 한계점을 넘었습니다.",
      C: "간신히 정치적 승리에 도달했으나 자국 피해도 심각합니다.",
      D: "외부 요인에 의한 승리. 자국 상황은 매우 어렵습니다."
    },
    china: {
      D: "외교/여론 통제 실패. 정치 압박이 한계를 넘었습니다.",
      C: "정치적 패배. 군사적 진척과 무관한 외부 압력에 무너졌습니다."
    }
  },
  china_capital_pressure_win: {
    china: {
      S: "수도권 압박을 누적해 점진적 승리. 군사·외교 균형이 완벽했습니다.",
      A: "수도권을 굳건히 압박하며 결정타를 만들었습니다.",
      B: "압박 작전 성공. 그러나 자체 자원 손실도 적지 않습니다.",
      C: "승리는 거뒀으나 정치 압박과 보급 손실이 커 다음 국면이 불안정합니다.",
      D: "겨우 누적 승리. 사실상 한계 직전이었습니다."
    },
    taiwan: {
      C: "수도권 압박을 막지 못했습니다. 정치적·심리적 패배.",
      D: "방어선이 무너지며 수도권이 위협받았습니다."
    }
  },
  china_capital_win: {
    china: {
      S: "타이베이를 점령하며 군사적 결정타. 압도적 승리입니다.",
      A: "수도 점령 작전 성공. 빠른 결착으로 외교 부담도 최소화.",
      B: "수도 점령은 성공했지만 손실도 컸습니다."
    },
    taiwan: {
      D: "수도 함락. 방어선이 결정적으로 붕괴되었습니다."
    }
  },
  china_blockade_win: {
    china: {
      A: "봉쇄 작전 성공. 대만 사기와 보급을 동시에 무너뜨렸습니다.",
      B: "장기 봉쇄로 대만을 무너뜨렸지만 시간이 많이 걸렸습니다.",
      C: "봉쇄로 간신히 승리. 외교적 부담이 큽니다."
    },
    taiwan: {
      D: "보급선과 사기가 동시에 무너졌습니다."
    }
  },
  china_surrender_win: {
    china: {
      A: "대만 정부를 무너뜨렸습니다. 정치적·군사적 결정타.",
      B: "정부 기능 마비로 항복. 빠른 결착."
    },
    taiwan: {
      D: "정부 기능이 완전히 무너졌습니다."
    }
  },
  no_outcome: {
    taiwan: { C: "결판 없이 종료되었습니다." },
    china: { C: "결판 없이 종료되었습니다." }
  }
};

// =====================================================================
// 헬퍼: 점령 상태 계산
// ---------------------------------------------------------------------
// d1.1: strait 등 sea_zone은 점령 대상이 아님. type 필터로 제외.
// 점령 가능한 type: capital, port, airport, city, major_port, east_port
// =====================================================================
const OCCUPIABLE_TYPES = new Set(["capital", "port", "airport", "city", "major_port", "east_port"]);

function isOccupiable(province) {
  // type이 명시되어 있으면 그 기준, 없으면 일단 포함 (방어적 fallback)
  if (province?.type) return OCCUPIABLE_TYPES.has(province.type);
  return province?.id !== "strait";
}

function countLostProvinces(state) {
  return Object.values(state.provinces || {})
    .filter(isOccupiable)
    .filter(p => p.controlStage === "china_control").length;
}

function countOccupiedProvinces(state) {
  return Object.values(state.provinces || {})
    .filter(isOccupiable)
    .filter(p => p.controlStage === "china_control" || p.controlStage === "beachhead").length;
}

// =====================================================================
// buildFinalReport — outcome 시 호출되는 통합 보고서
// ---------------------------------------------------------------------
//   - score/grade per side
//   - 점령 변화 요약
//   - 주요 사건 요약 (전투/이벤트/보상)
// =====================================================================
export function buildFinalReport(state, campaign, data = {}) {
  const outcome = state.outcome || "no_outcome";
  const finalTurn = state.turn;

  const taiwanResult = calculateFinalScore(state, "taiwan");
  const chinaResult = calculateFinalScore(state, "china");

  const taiwanGrade = gradeFromScore(taiwanResult.score);
  const chinaGrade = gradeFromScore(chinaResult.score);

  // 진영별 해설 (양쪽 모드면 양쪽)
  const interpretations = {
    taiwan: generateFinalInterpretation(outcome, taiwanResult.score, "taiwan"),
    china: generateFinalInterpretation(outcome, chinaResult.score, "china")
  };

  // 결과 제목
  const title = outcomeTitle(outcome);

  // 점령 변화 요약
  const occupiedNow = Object.values(state.provinces || {})
    .filter(p => p.controlStage === "china_control")
    .map(p => p.name || p.id);
  const contestedNow = Object.values(state.provinces || {})
    .filter(p => p.landingStage && p.landingStage !== "none" && p.controlStage !== "china_control")
    .map(p => p.name || p.id);

  // 주요 전투 (state.log에서) — d1.1: log entry의 turn을 보존
  const majorBattles = (state.log || [])
    .filter(l => l.combatResults?.length)
    .flatMap(l => l.combatResults.map(r => ({ ...r, turn: l.turn })))
    .filter(r => Math.abs(r.margin) >= 5)
    .slice(-5)
    .map(r => ({
      turn: r.turn,
      sourceName: r.sourceName,
      targetName: r.targetName,
      margin: r.margin,
      success: r.success
    }));

  // 트리거된 이벤트
  const triggeredEvents = [...(state.persistent?.triggeredOnce || [])];

  // 활성 영구 보상 (이번 게임에서 선택한)
  const ownedRewards = (state.persistent?.rewards || [])
    .filter(r => r.applyTiming === "persistent")
    .map(r => ({ id: r.id, name: r.name, side: r.side }));

  return {
    outcome,
    title,
    finalTurn,
    totalTurns: data.gameRules?.totalTurns || 30,
    taiwan: {
      side: "taiwan",
      score: taiwanResult.score,
      base: taiwanResult.base,
      components: taiwanResult.components,
      grade: taiwanGrade,
      interpretation: interpretations.taiwan
    },
    china: {
      side: "china",
      score: chinaResult.score,
      base: chinaResult.base,
      components: chinaResult.components,
      grade: chinaGrade,
      interpretation: interpretations.china
    },
    summary: {
      occupiedProvinces: occupiedNow,
      contestedProvinces: contestedNow,
      majorBattles,
      triggeredEvents,
      ownedRewards,
      finalGauges: { ...state.gauges }
    },
    campaignSide: campaign?.selectedSide || "both"
  };
}

function outcomeTitle(outcome) {
  switch (outcome) {
    case "taiwan_survival_win": return "대만 생존 승리";
    case "taiwan_political_collapse_win": return "중국 정치 붕괴 — 대만 외교 승리";
    case "china_capital_win": return "타이베이 함락 — 중국 군사 승리";
    case "china_capital_pressure_win": return "수도권 압박 누적 — 중국 점진 승리";
    case "china_blockade_win": return "봉쇄 성공 — 중국 봉쇄 승리";
    case "china_surrender_win": return "대만 정부 붕괴 — 중국 항복 승리";
    case "no_outcome": return "결판 없음";
    default: return outcome;
  }
}
