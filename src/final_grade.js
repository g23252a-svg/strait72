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

    // v0.4.0-d4: 수도권 압박 페널티 (타이베이 + 지룽 별도)
    const territorial = analyzeTerritorialState(state);
    let capitalPenalty = 0;
    let capitalLabel = null;
    if (territorial.taipeiRisk === "beachhead") {
      capitalPenalty = -18;
      capitalLabel = "타이베이 해안교두보 점령";
    } else if (territorial.taipeiRisk === "breach") {
      capitalPenalty = -12;
      capitalLabel = "타이베이 해안 돌파";
    } else if (territorial.taipeiRisk === "contested") {
      capitalPenalty = -8;
      capitalLabel = "타이베이 전투 중";
    }
    if (capitalPenalty !== 0) {
      score += capitalPenalty;
      components.push({ label: capitalLabel, delta: capitalPenalty });
    }
    // 지룽 (수도 인접 항만)
    if (territorial.keelungStage === "china_control") {
      score -= 8;
      components.push({ label: "지룽 상실", delta: -8 });
    } else if (territorial.keelungStage === "contested" ||
               (state.provinces?.keelung?.landingStage && state.provinces.keelung.landingStage !== "none")) {
      score -= 4;
      components.push({ label: "지룽 전투 중", delta: -4 });
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
// generateFinalInterpretation — outcome + grade + 영토 상태 따른 해설
// d4: state/grade 받아서 "방어선이 거의 흔들리지 않았다" 같은 잘못된 해설 차단
// =====================================================================
export function generateFinalInterpretation(outcome, score, side, state = null, gradeOverride = null) {
  const grade = gradeOverride || gradeFromScore(score);

  // d4: taiwan_survival_win에서 영토 상태에 따라 더 정확한 해설
  if (outcome === "taiwan_survival_win" && side === "taiwan" && state) {
    const t = analyzeTerritorialState(state);
    if (grade === "S") {
      // S 하드 조건 통과: 거의 무손실
      return "방어선이 거의 흔들리지 않은 채 72시간을 버텨냈습니다. 동맹 개입 유도가 거의 완벽했습니다.";
    }
    if (grade === "A") {
      if (t.lostCount === 0) {
        return "방어선은 흔들렸지만 영토 손실 없이 동맹 개입을 끌어내며 생존에 성공했습니다.";
      } else if (t.lostCount === 1) {
        return `${t.lostNames[0] || "1개 지역"} 상실이라는 대가를 치렀지만, 수도권을 지키고 동맹 개입을 끌어내며 생존에 성공했습니다.`;
      } else {
        return `${t.lostCount}곳의 영토를 상실했지만 정부 기능과 지휘 체계를 끝까지 유지하며 생존에 성공했습니다.`;
      }
    }
    if (grade === "B") {
      if (t.capitalAtRisk) {
        return `대만은 ${t.lostCount}곳의 영토를 상실하고 수도권까지 압박받았지만, 정부 기능을 유지하며 동맹 개입 직전까지 버텨냈습니다. 다음 국면은 매우 불안정합니다.`;
      }
      return `대만은 남부 거점들을 상실했지만, 타이베이 정부 기능과 지휘 체계를 끝까지 유지하며 동맹 개입 이후 생존에 성공했습니다.`;
    }
    if (grade === "C") {
      return `방어선 곳곳이 무너지고 수도권까지 압박받았지만 시간을 벌어 동맹 개입에 닿았습니다. 다음 국면은 매우 불안정합니다.`;
    }
    if (grade === "D") {
      return "방어선이 와해된 채 시간만 흘렀습니다. 동맹 개입 도착 전 사실상 전투력이 소진되었습니다.";
    }
  }

  // d4: china 승리에서도 영토 상태로 분기 가능 (간단히 grade 기반)
  const m = INTERPRETATION_MATRIX[outcome]?.[side] || {};
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
// d2.1: isOccupiable export — final report의 occupied/contested에도 같은 기준 적용
// =====================================================================
const OCCUPIABLE_TYPES = new Set(["capital", "port", "airport", "city", "major_port", "east_port"]);

export function isOccupiable(province) {
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
// v0.4.0-d4: 영토 상태 분석 — 등급 cap / 페널티 / 해설 조건의 공통 근거
// ---------------------------------------------------------------------
// 반환:
//   - lostCount: china_control 점령지 수
//   - taipei: { stage, landingStage } — 수도 상태
//   - capitalAtRisk: 타이베이가 contested/beachhead/coastal_breach
//   - capitalLost: 타이베이 china_control
// =====================================================================
export function analyzeTerritorialState(state) {
  const provs = state.provinces || {};
  const occupiable = Object.values(provs).filter(isOccupiable);

  const lost = occupiable.filter(p => p.controlStage === "china_control");
  const taipei = provs.taipei || {};
  const taipeiStage = taipei.controlStage || "stable_defense";
  const taipeiLanding = taipei.landingStage || "none";

  // 타이베이 위험도 단계
  let taipeiRisk = "stable"; // stable | contested | breach | beachhead | lost
  if (taipeiStage === "china_control") taipeiRisk = "lost";
  else if (taipeiLanding === "beachhead") taipeiRisk = "beachhead";
  else if (taipeiLanding === "coastal_breach") taipeiRisk = "breach";
  else if (taipeiStage === "contested" || (taipeiLanding && taipeiLanding !== "none")) taipeiRisk = "contested";

  return {
    lostCount: lost.length,
    lostNames: lost.map(p => p.name || p.id),
    capitalLost: taipeiRisk === "lost",
    capitalAtRisk: ["contested", "breach", "beachhead"].includes(taipeiRisk),
    taipeiRisk,
    keelungStage: (provs.keelung?.controlStage) || "stable_defense"
  };
}

// =====================================================================
// v0.4.0-d4: 등급 cap 결정
// ---------------------------------------------------------------------
// 사용자 명세:
//   - 점령지 0~1: S 가능
//   - 점령지 2: 최대 A
//   - 점령지 3+: 최대 B
//   - 타이베이 contested/breach/beachhead: 최대 "B+" (= 우리 등급 체계에선 B)
//   - 타이베이 china_control: 최대 D (사실상 패배)
//   - 추가 S 하드조건 (taiwan side, 생존 승리): 정부70+ / us100 / japan60+
// =====================================================================
const GRADE_ORDER = ["D", "C", "B", "A", "S"]; // 등급 강도 순

function maxGradeOf(a, b) {
  return GRADE_ORDER.indexOf(a) >= GRADE_ORDER.indexOf(b) ? b : a; // 더 낮은 쪽 (cap 적용)
}

export function determineGradeCap(state, side) {
  const t = analyzeTerritorialState(state);
  let cap = "S";

  if (side === "taiwan") {
    // 영토 상실 cap
    if (t.lostCount >= 3) cap = maxGradeOf(cap, "B");
    else if (t.lostCount === 2) cap = maxGradeOf(cap, "A");
    // 수도 상태 cap
    if (t.capitalAtRisk) cap = maxGradeOf(cap, "B");
    if (t.capitalLost) cap = maxGradeOf(cap, "D");

    // S 하드 조건 (생존 승리 + 위 조건들)
    const outcome = state.outcome;
    const g = state.gauges || {};
    if (outcome === "taiwan_survival_win") {
      const sQualified =
        t.lostCount <= 1 &&
        !t.capitalAtRisk && !t.capitalLost &&
        (g.taiwanGovernment ?? 0) >= 70 &&
        (g.usIntervention ?? 0) >= 100 &&
        (g.japanIntervention ?? 0) >= 60;
      if (!sQualified) cap = maxGradeOf(cap, "A");
    }
  } else {
    // 중국: 패배 시 D cap, 그 외엔 S 가능
    if (state.outcome?.startsWith("taiwan_")) cap = maxGradeOf(cap, "C");
  }

  return cap;
}

// 등급 cap을 적용해 등급 결정 — 점수 자체는 유지, 등급만 낮춤
export function gradeWithCap(score, cap) {
  const natural = gradeFromScore(score);
  // cap이 natural보다 낮으면 cap, 아니면 natural
  return GRADE_ORDER.indexOf(natural) <= GRADE_ORDER.indexOf(cap) ? natural : cap;
}

// =====================================================================
// v0.4.0-d4.1: cap 사유 리스트 생성 — UI에서 "왜 B 상한인지" 명확히 표시
// ---------------------------------------------------------------------
// 반환: [{label, detail}] 형태 (없으면 빈 배열)
//   label: 짧은 카테고리 (예: "점령지 상실")
//   detail: 구체 정보 (예: "지룽, 타이중, 가오슝")
// =====================================================================
export function buildCapReasons(state, side) {
  if (side !== "taiwan") return []; // 일단 대만 진영만
  const t = analyzeTerritorialState(state);
  const g = state.gauges || {};
  const outcome = state.outcome;
  const reasons = [];

  // 영토 상실 (≥2일 때만 명시)
  if (t.lostCount >= 3) {
    reasons.push({
      label: `점령지 ${t.lostCount}곳 상실`,
      detail: t.lostNames.join(", ")
    });
  } else if (t.lostCount === 2) {
    reasons.push({
      label: "점령지 2곳 상실",
      detail: t.lostNames.join(", ")
    });
  }

  // 수도권 상태
  if (t.capitalLost) {
    reasons.push({ label: "타이베이 함락", detail: "수도가 china_control" });
  } else if (t.taipeiRisk === "beachhead") {
    reasons.push({ label: "타이베이 해안교두보", detail: "수도권 beachhead 단계" });
  } else if (t.taipeiRisk === "breach") {
    reasons.push({ label: "타이베이 해안 돌파", detail: "수도권 coastal breach 단계" });
  } else if (t.taipeiRisk === "contested") {
    reasons.push({ label: "타이베이 교전 중", detail: "수도가 contested 상태" });
  }

  // 지룽 상태 (수도 인접)
  if (t.keelungStage === "china_control") {
    reasons.push({ label: "지룽 상실", detail: "수도 인접 항만 함락" });
  } else if (t.keelungStage === "contested" || (state.provinces?.keelung?.landingStage && state.provinces.keelung.landingStage !== "none")) {
    reasons.push({ label: "지룽 교전 중", detail: "수도 인접 항만 압박" });
  }

  // S 하드 조건 미충족 (생존 승리 시 + 다른 큰 cap 사유 없을 때)
  if (outcome === "taiwan_survival_win" && reasons.length === 0) {
    const missing = [];
    if ((g.taiwanGovernment ?? 0) < 70) missing.push(`정부 기능 ${g.taiwanGovernment ?? 0} (70+ 필요)`);
    if ((g.usIntervention ?? 0) < 100) missing.push(`미국 개입 ${g.usIntervention ?? 0} (100 필요)`);
    if ((g.japanIntervention ?? 0) < 60) missing.push(`일본 개입 ${g.japanIntervention ?? 0} (60+ 필요)`);
    if (missing.length) {
      reasons.push({ label: "S 하드 조건 미충족", detail: missing.join(", ") });
    }
  }

  return reasons;
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

  // v0.4.0-d4: 등급 cap 결정 — 영토 상실/수도권 압박 시 자연 등급보다 낮춤
  const taiwanCap = determineGradeCap(state, "taiwan");
  const chinaCap = determineGradeCap(state, "china");
  const taiwanGrade = gradeWithCap(taiwanResult.score, taiwanCap);
  const chinaGrade = gradeWithCap(chinaResult.score, chinaCap);
  const taiwanNaturalGrade = gradeFromScore(taiwanResult.score);
  const chinaNaturalGrade = gradeFromScore(chinaResult.score);
  // v0.4.0-d4.1: cap이 자연 등급보다 낮을 때 사유 리스트
  const taiwanCapReasons = (taiwanGrade !== taiwanNaturalGrade) ? buildCapReasons(state, "taiwan") : [];
  const chinaCapReasons = (chinaGrade !== chinaNaturalGrade) ? buildCapReasons(state, "china") : [];

  // 진영별 해설 (양쪽 모드면 양쪽) — d4: cap 적용된 등급으로 해설
  const interpretations = {
    taiwan: generateFinalInterpretation(outcome, taiwanResult.score, "taiwan", state, taiwanGrade),
    china: generateFinalInterpretation(outcome, chinaResult.score, "china", state, chinaGrade)
  };

  // 결과 제목
  const title = outcomeTitle(outcome);

  // 점령 변화 요약 (d2.1: isOccupiable 필터로 점수와 기준 통일 — sea_zone 제외)
  const occupiedNow = Object.values(state.provinces || {})
    .filter(isOccupiable)
    .filter(p => p.controlStage === "china_control")
    .map(p => p.name || p.id);
  const contestedNow = Object.values(state.provinces || {})
    .filter(isOccupiable)
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

  // v0.4.0-d3: 핵심 사건 + 디브리핑 생성
  const playerSide = campaign?.selectedSide === "both"
    ? (taiwanResult.score >= chinaResult.score ? "taiwan" : "china")
    : (campaign?.selectedSide || "taiwan");
  const keyMoments = selectKeyMoments(state, data.events);
  const debrief = generateDebrief(state, keyMoments, playerSide);

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
      naturalGrade: taiwanNaturalGrade,
      gradeCap: taiwanCap,
      capReasons: taiwanCapReasons,
      interpretation: interpretations.taiwan
    },
    china: {
      side: "china",
      score: chinaResult.score,
      base: chinaResult.base,
      components: chinaResult.components,
      grade: chinaGrade,
      naturalGrade: chinaNaturalGrade,
      gradeCap: chinaCap,
      capReasons: chinaCapReasons,
      interpretation: interpretations.china
    },
    summary: {
      occupiedProvinces: occupiedNow,
      contestedProvinces: contestedNow,
      majorBattles,
      triggeredEvents,
      ownedRewards,
      finalGauges: { ...state.gauges },
      keyMoments,  // v0.4.0-d3
      debrief      // v0.4.0-d3
    },
    campaignSide: campaign?.selectedSide || "both"
  };
}

// =====================================================================
// v0.4.0-d3: 핵심 사건 선택 로직 + 디브리핑 생성
// ---------------------------------------------------------------------
// 사용자 명세:
//   - 결정적 전투: 게임 종료 직전 (마지막 5턴 안)에서 큰 margin 1개
//   - 가장 큰 margin 전투: 전체 게임 통틀어 절대 margin 최대 1개
//   - 마지막 점령/방어 전투: 가장 최근의 결정적 결과 1개
//   - 주요 국제 이벤트 1~2개 (점수 영향 큰 것)
//   - 영향 큰 영구 보상 1~2개
// =====================================================================

// 이벤트 ID → 표시명 매핑 (data.events 없을 때 fallback)
const EVENT_NAME_FALLBACK = {
  global_us_carrier_movement: "미국 항모 이동 발표",
  global_japan_security_council: "일본 안보회의 소집",
  global_korea_nsc_rear_support: "한국 긴급 NSC",
  global_un_emergency_session: "유엔 긴급회의",
  global_market_crash: "세계 증시 폭락",
  global_civilian_casualty_report: "민간 피해 보도",
  global_bad_weather: "해협 기상 악화",
  global_backchannel_ceasefire_offer: "비공개 휴전 타진"
};

function eventDisplayName(eventId, eventsData) {
  if (Array.isArray(eventsData)) {
    const e = eventsData.find(x => x.id === eventId);
    if (e?.name) return e.name;
  }
  return EVENT_NAME_FALLBACK[eventId] || eventId;
}

// 한국어 조사 자동 처리 — 마지막 글자에 받침 있으면 첫 형태, 없으면 둘째
//   josa(name, "이", "가") → "발표가" / "회의가" (자동 선택)
//   josa(name, "과", "와") → "발표와" / "회의와"
function hasJongseong(str) {
  if (!str) return false;
  const last = str.charCodeAt(str.length - 1);
  if (last < 0xAC00 || last > 0xD7A3) return false; // 한글 음절 범위 밖
  return (last - 0xAC00) % 28 !== 0; // 종성 코드가 0이 아니면 받침 있음
}

function josa(name, withJong, withoutJong) {
  return name + (hasJongseong(name) ? withJong : withoutJong);
}

export function selectKeyMoments(state, eventsData = null) {
  // 1) 모든 전투 추출 — log entry의 turn 보존
  const allBattles = (state.log || [])
    .filter(l => l.combatResults?.length)
    .flatMap(l => l.combatResults.map(r => ({ ...r, turn: l.turn })));

  const significantBattles = allBattles.filter(b => Math.abs(b.margin) >= 3);

  // 결정적 전투: 게임 종료 직전 5턴 안에서 큰 margin
  const lastTurn = state.turn;
  const endgameWindow = significantBattles
    .filter(b => b.turn != null && (lastTurn - b.turn) <= 5)
    .sort((a, b) => Math.abs(b.margin) - Math.abs(a.margin));
  const decisive = endgameWindow[0] || null;

  // 가장 큰 margin 전투 (전체)
  const biggest = significantBattles.length
    ? [...significantBattles].sort((a, b) => Math.abs(b.margin) - Math.abs(a.margin))[0]
    : null;
  // decisive와 같으면 다음으로
  const biggestUnique = (biggest && decisive && biggest.turn === decisive.turn && biggest.sourceName === decisive.sourceName)
    ? (significantBattles.length > 1
        ? [...significantBattles].sort((a, b) => Math.abs(b.margin) - Math.abs(a.margin))[1]
        : null)
    : biggest;

  // 마지막 결정적 전투 — biggest/decisive와 다른 것
  const sortedByTurnDesc = [...significantBattles].sort((a, b) => (b.turn || 0) - (a.turn || 0));
  const usedTurns = new Set([decisive?.turn, biggestUnique?.turn].filter(t => t != null));
  const lastDecisive = sortedByTurnDesc.find(b => !usedTurns.has(b.turn)) || null;

  // 2) 주요 국제 이벤트 (트리거된 것들에서 상위 2개)
  // 점수 영향 큰 순: us_carrier_movement, japan_security_council, korea_nsc, un_emergency 우선
  const priority = [
    "global_us_carrier_movement", "global_japan_security_council",
    "global_korea_nsc_rear_support", "global_un_emergency_session",
    "global_civilian_casualty_report", "global_market_crash",
    "global_backchannel_ceasefire_offer", "global_bad_weather"
  ];
  const triggered = state.persistent?.triggeredOnce || [];
  const significantEvents = priority
    .filter(id => triggered.includes(id))
    .slice(0, 2)
    .map(id => ({ id, name: eventDisplayName(id, eventsData) }));

  // 3) 영향 큰 영구 보상 — owned persistent rewards 중 b3 계열 또는 perTurnGain 위주
  const persistRewards = (state.persistent?.rewards || [])
    .filter(r => r.applyTiming === "persistent");
  // 강도 추정: rangedAttackBonus / nightOpDefenseDebuff / reduction 계열 또는 perTurnGain
  const impactfulRewards = persistRewards
    .filter(r => {
      const e = r.effects || {};
      return e.rangedAttackBonus || e.nightOpDefenseDebuff
        || e.taiwanSupplyDamageReduction || e.usJapanInterventionGainReduction
        || e.perTurnGain || e.defenseValueBonus;
    })
    .slice(0, 2);

  return {
    decisive,
    biggest: biggestUnique,
    lastDecisive,
    significantEvents,
    impactfulRewards
  };
}

// 디브리핑 텍스트 — 3 섹션 (결정적 순간 / 국제 전환점 / 캠페인 평가)
export function generateDebrief(state, keyMoments, playerSide = "taiwan") {
  const sections = {
    decisiveMoment: null,
    internationalTurning: null,
    campaignAssessment: null
  };

  // ----- 결정적 순간 -----
  const d = keyMoments.decisive;
  const b = keyMoments.biggest;
  const l = keyMoments.lastDecisive;
  const decisiveParts = [];

  if (d) {
    const sign = d.margin >= 0 ? "+" : "";
    const mark = d.success ? "성공" : "실패";
    decisiveParts.push(`T${d.turn} ${d.sourceName} ${mark}: ${d.targetName} (차이 ${sign}${d.margin})`);
  }
  if (b && (!d || b.turn !== d.turn)) {
    const sign = b.margin >= 0 ? "+" : "";
    decisiveParts.push(`전체 게임 최대 격차는 T${b.turn} ${b.sourceName}: ${b.targetName} (차이 ${sign}${b.margin}).`);
  }
  if (l && (!d || l.turn !== d.turn) && (!b || l.turn !== b.turn)) {
    const sign = l.margin >= 0 ? "+" : "";
    decisiveParts.push(`이후 T${l.turn} ${l.sourceName} ${l.success ? "성공" : "실패"} (차이 ${sign}${l.margin}).`);
  }
  if (decisiveParts.length) {
    sections.decisiveMoment = decisiveParts.join(" ");
  } else {
    sections.decisiveMoment = "결정적 전투 없이 양 진영의 자원 소모전이 이어졌습니다.";
  }

  // ----- 국제 전환점 -----
  const ev = keyMoments.significantEvents;
  if (ev.length === 0) {
    sections.internationalTurning = "주요 국제 이벤트 없이 군사적 결착에 도달했습니다.";
  } else if (ev.length === 1) {
    sections.internationalTurning = `${josa(ev[0].name, "이", "가")} 캠페인 전개의 분수령이 되었습니다.`;
  } else {
    sections.internationalTurning = `${josa(ev[0].name, "과", "와")} ${josa(ev[1].name, "이", "가")} 동맹 개입 흐름을 결정했습니다.`;
  }

  // ----- 캠페인 평가 -----
  const outcome = state.outcome;
  const g = state.gauges || {};
  const finalTurn = state.turn;
  // 1턴 = 6시간 가정. finalTurn 6시간 단위.
  // 예: turn 14 → 14×6 = 84시간 = 3.5일
  const totalHours = finalTurn * 6;
  const days = Math.floor(totalHours / 24);
  const remHours = totalHours % 24;
  const timeStr = remHours === 0 ? `${days}일` : `${days}.${Math.round(remHours / 24 * 10)}일`;

  const rewards = keyMoments.impactfulRewards;
  let rewardPhrase = "";
  if (rewards.length === 1) {
    rewardPhrase = ` 이번 캠페인에서 ${josa(rewards[0].name, "이", "가")} 핵심 영구 효과로 작용했습니다.`;
  } else if (rewards.length >= 2) {
    const lastName = rewards[rewards.length - 1].name;
    const firstNames = rewards.slice(0, -1).map(r => r.name).join(", ");
    rewardPhrase = ` 이번 캠페인에서 ${firstNames}, ${josa(lastName, "이", "가")} 핵심 영구 효과로 작용했습니다.`;
  }

  if (outcome === "taiwan_survival_win") {
    sections.campaignAssessment = `대만은 ${describeTaiwanResilience(g, state)} ${timeStr} 생존에 성공했습니다.${rewardPhrase}`;
  } else if (outcome === "taiwan_political_collapse_win") {
    sections.campaignAssessment = `대만은 ${describeChinaCollapse(g)} 외교적 승리를 거두었습니다.${rewardPhrase}`;
  } else if (outcome === "china_capital_win") {
    sections.campaignAssessment = `중국은 ${timeStr} 만에 타이베이 점령에 성공했지만, ${describeChinaCost(g)}.${rewardPhrase}`;
  } else if (outcome === "china_capital_pressure_win") {
    sections.campaignAssessment = `중국은 수도권을 점진적으로 압박해 ${timeStr} 만에 승리를 굳혔지만, ${describeChinaCost(g)}.${rewardPhrase}`;
  } else if (outcome === "china_blockade_win") {
    sections.campaignAssessment = `중국은 대만의 보급과 사기를 동시에 무너뜨려 봉쇄 승리에 도달했습니다.${rewardPhrase}`;
  } else if (outcome === "china_surrender_win") {
    sections.campaignAssessment = `대만 정부가 무너지며 ${timeStr} 만에 항복 절차로 종결되었습니다.${rewardPhrase}`;
  } else {
    sections.campaignAssessment = `${timeStr} 동안 양측 결착 없이 캠페인이 종료되었습니다.${rewardPhrase}`;
  }

  return sections;
}

function describeTaiwanResilience(g, state = null) {
  const parts = [];
  if ((g.taiwanGovernment ?? 0) >= 70) parts.push("정부 기능을 유지하고");
  if ((g.taiwanCommand ?? 0) >= 70) parts.push("지휘 체계를 안정시키면서");
  if ((g.taiwanSupply ?? 0) >= 60) parts.push("보급선도 사수해");

  // d4: 영토 상실/수도권 압박 사실 반영
  if (state) {
    const t = analyzeTerritorialState(state);
    if (t.capitalAtRisk) {
      // 수도권 압박 받았으면 무조건 그 사실 먼저
      const prefix = t.lostCount > 0
        ? `${t.lostCount}곳의 영토를 잃고 수도권까지 압박받았지만,`
        : `수도권이 압박받는 상황에서도`;
      if (parts.length === 0) return prefix + " 방어선을 끝까지 유지해";
      return prefix + " " + parts.join(" ") + ",";
    }
    if (t.lostCount >= 2) {
      const prefix = `남부 ${t.lostCount}곳을 상실했지만,`;
      if (parts.length === 0) return prefix + " 수도권 방어선을 유지해";
      return prefix + " " + parts.join(" ") + ",";
    }
    if (t.lostCount === 1) {
      const prefix = `${t.lostNames[0] || "1개 거점"} 상실이라는 대가를 치렀지만,`;
      if (parts.length === 0) return prefix + " 나머지 방어선을 유지해";
      return prefix + " " + parts.join(" ") + ",";
    }
  }

  if (parts.length === 0) return "방어선이 무너지는 와중에도";
  return parts.join(" ") + ",";
}

function describeChinaCollapse(g) {
  const parts = [];
  if ((g.chinaPoliticalPressure ?? 0) >= 80) parts.push("중국 내부 정치 압박을 한계까지 누적시켜");
  if ((g.internationalOpinion ?? 0) >= 70) parts.push("국제 여론을 전방위 동원해");
  if (parts.length === 0) return "외교 전선에서 누적 압박을 통해";
  return parts.join(" ");
}

function describeChinaCost(g) {
  const issues = [];
  if ((g.chinaPoliticalPressure ?? 0) >= 60) issues.push("자국 정치 압박이 누적되었습니다");
  if ((g.chinaTempo ?? 0) < 40) issues.push("작전 템포가 소진되었습니다");
  if ((g.chinaSupply ?? 0) < 40) issues.push("보급선이 한계점에 달했습니다");
  if ((g.usIntervention ?? 0) >= 70) issues.push("미국 개입이 임박했습니다");
  if (issues.length === 0) return "다음 국면의 부담은 적습니다";
  return issues.join("; ");
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

// =====================================================================
// v0.4.0-d2.1: compressBreakdown — UI에서 점수 요인 압축 표시
// ---------------------------------------------------------------------
// 정책 (사용자 명세):
//   - 긍정 top 3
//   - 부정 top 2
//   - 나머지는 "기타 +N개 ±M" 합산
// 별도 export → smoke가 실제 함수 검증 가능 (d2 smoke의 복사본 구멍 fix)
// =====================================================================
export function compressBreakdown(components) {
  const positives = (components || []).filter(c => c.delta > 0).sort((a, b) => b.delta - a.delta);
  const negatives = (components || []).filter(c => c.delta < 0).sort((a, b) => a.delta - b.delta);
  const topPos = positives.slice(0, 3);
  const topNeg = negatives.slice(0, 2);
  const restPos = positives.slice(3);
  const restNeg = negatives.slice(2);
  return {
    positives: topPos,
    negatives: topNeg,
    othersPositive: {
      count: restPos.length,
      delta: restPos.reduce((s, c) => s + c.delta, 0)
    },
    othersNegative: {
      count: restNeg.length,
      delta: restNeg.reduce((s, c) => s + c.delta, 0)
    }
  };
}
