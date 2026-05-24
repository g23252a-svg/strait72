// =====================================================================
// act3_objectives.js (v0.4.2-b3)
// ---------------------------------------------------------------------
// ACT 3 DAY 모달용 동적 목표 생성.
//
// 양 진영에 각각 2-4개의 단기 목표를 제시한다.
// 모든 목표는 현재 게임 상태 기반으로 동적으로 선택된다.
// 즉 게이지 / 점령 상황 / 동맹 상태에 따라 매 DAY 다른 목표가 표시된다.
//
// 사용:
//   import { generateAct3Objectives } from "./act3_objectives.js";
//   const { taiwan, china } = generateAct3Objectives(state);
//   taiwan: [{ id, text, priority }]
//   china:  [{ id, text, priority }]
//
// priority: "high" | "medium" | "low" (UI 색상 가이드)
// =====================================================================

const STAGES = ["none", "sea_superiority", "landing_attempt", "beachhead", "inland_expansion"];

function landingIdx(p) {
  if (!p) return 0;
  return STAGES.indexOf(p.landingStage || "none");
}

function isContested(p) {
  return p?.controlStage === "contested";
}

function isChinaHeld(p) {
  return p?.controlStage === "beachhead_established" || p?.controlStage === "china_control";
}

// =====================================================================
// 대만 측 목표 후보
// =====================================================================
function taiwanObjectives(state) {
  const g = state.gauges || {};
  const provs = state.provinces || {};
  const out = [];

  // 1. 수도권 위기 — 최우선
  const taipei = provs.taipei;
  if (taipei && (landingIdx(taipei) >= 2 || isChinaHeld(taipei))) {
    out.push({
      id: "taipei_recapture",
      text: `타이베이 ${isChinaHeld(taipei) ? "탈환" : "방어"} — 수도권 위기 차단`,
      priority: "high"
    });
  }

  // 2. 정부 기능 회복
  if ((g.taiwanGovernment || 0) < 70) {
    out.push({
      id: "govt_recovery",
      text: `정부 기능 70 이상 회복 (현재 ${g.taiwanGovernment})`,
      priority: g.taiwanGovernment < 40 ? "high" : "medium"
    });
  }

  // 3. 보급 회복
  if ((g.taiwanSupply || 0) < 50) {
    out.push({
      id: "supply_recovery",
      text: `보급 50 이상 회복 — "해상 보급로 확보" 카드 활용 (현재 ${g.taiwanSupply})`,
      priority: g.taiwanSupply < 25 ? "high" : "medium"
    });
  }

  // 4. 남부 거점 — 가오슝/타이난 contested면 후퇴 작전
  const kaohsiung = provs.kaohsiung;
  if (kaohsiung && (landingIdx(kaohsiung) >= 3 || isContested(kaohsiung))) {
    out.push({
      id: "kaohsiung_pushback",
      text: `가오슝 교두보 1단계 후퇴 — "교두보 축소 작전" 카드`,
      priority: "medium"
    });
  }
  const tainan = provs.tainan;
  if (tainan && (landingIdx(tainan) >= 3 || isContested(tainan))) {
    out.push({
      id: "tainan_pushback",
      text: `타이난 거점 회복 시도`,
      priority: "medium"
    });
  }

  // 5. 동맹 게이지 — 미국 90 미만이면 강화
  if ((g.usIntervention || 0) < 90) {
    out.push({
      id: "us_intervention",
      text: `미국 개입도 90 이상 — "동맹 합동 정보망" 카드 (현재 ${g.usIntervention})`,
      priority: "low"
    });
  }

  // 6. 장기 생존 — 항상 표시되는 베이스라인
  const turn = state.turn || 0;
  const totalTurns = state.totalTurns || 84;
  const remaining = totalTurns - turn;
  if (remaining > 0) {
    out.push({
      id: "survival",
      text: `${remaining}턴 남은 21일까지 생존 (현재 T${turn}/${totalTurns})`,
      priority: "low"
    });
  }

  // priority 순 정렬, 최대 4개
  const order = { high: 0, medium: 1, low: 2 };
  out.sort((a, b) => order[a.priority] - order[b.priority]);
  return out.slice(0, 4);
}

// =====================================================================
// 중국 측 목표 후보
// =====================================================================
function chinaObjectives(state) {
  const g = state.gauges || {};
  const provs = state.provinces || {};
  const out = [];

  // 1. 정치 압박 관리 — 100 가까우면 최우선
  if ((g.chinaPoliticalPressure || 0) >= 80) {
    out.push({
      id: "pp_relief",
      text: `정치 압박 완화 — "제한전 유지" 카드 (현재 ${g.chinaPoliticalPressure})`,
      priority: "high"
    });
  }

  // 2. 작전 템포 회복
  if ((g.chinaTempo || 0) <= 20) {
    out.push({
      id: "tempo_recovery",
      text: `작전 템포 회복 — "강경파 동원" 카드 (현재 ${g.chinaTempo})`,
      priority: g.chinaTempo <= 5 ? "high" : "medium"
    });
  }

  // 3. 보급 회복
  if ((g.chinaSupply || 0) <= 30) {
    out.push({
      id: "supply_refit",
      text: `보급 재정비 — "해상 봉쇄 재정비" 카드 (현재 ${g.chinaSupply})`,
      priority: g.chinaSupply <= 10 ? "high" : "medium"
    });
  }

  // 4. 수도권 압박 — 타이베이 beachhead+ 도달이면 장기 점령 카운터
  const taipei = provs.taipei;
  if (taipei && (landingIdx(taipei) >= 3 || isChinaHeld(taipei))) {
    const fellAt = state.persistent?.milestones?.taipeiFallsAt;
    if (fellAt) {
      const turnsSinceFall = (state.turn || 0) - fellAt;
      const need = Math.max(0, 8 - turnsSinceFall);
      if (need > 0) {
        out.push({
          id: "capital_long_hold",
          text: `타이베이 ${need}턴 더 유지 + 북부 접근로 확보 → 수도 장악 승리`,
          priority: "high"
        });
      }
    } else {
      out.push({
        id: "capital_assault",
        text: `타이베이 china_control 도달 → 수도권 압박 승리 진입`,
        priority: "high"
      });
    }
  }

  // 5. 외교전 — 동맹 게이지 깎기
  const allyMax = Math.max(g.usIntervention || 0, g.japanIntervention || 0);
  if (allyMax >= 70) {
    out.push({
      id: "diplo_pressure",
      text: `동맹 개입 약화 — "협상 우위 압박" 카드 (미 ${g.usIntervention}/일 ${g.japanIntervention})`,
      priority: "medium"
    });
  }

  // 6. 대만 보급 봉쇄
  if ((g.taiwanSupply || 0) > 50 && (g.chinaSupply || 0) > 0) {
    out.push({
      id: "blockade_taiwan",
      text: `대만 보급 봉쇄 — 50 이하로 압박 (현재 대만 보급 ${g.taiwanSupply})`,
      priority: "low"
    });
  }

  // priority 순 정렬, 최대 4개
  const order = { high: 0, medium: 1, low: 2 };
  out.sort((a, b) => order[a.priority] - order[b.priority]);
  return out.slice(0, 4);
}

// =====================================================================
// 외부 API
// =====================================================================
export function generateAct3Objectives(state) {
  return {
    taiwan: taiwanObjectives(state),
    china: chinaObjectives(state)
  };
}

// 표시 조건: ACT 3 진입했고, full_21d 시나리오
export function shouldShowAct3Objectives(state, campaign) {
  if (campaign?.scenarioId !== "full_21d") return false;
  const lastActId = state.persistent?.lastActId;
  if (lastActId === "ACT_3") return true;
  // fallback: turn 기반
  return (state.turn || 0) >= 45;
}
