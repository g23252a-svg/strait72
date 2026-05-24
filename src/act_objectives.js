// =====================================================================
// act_objectives.js (v0.4.2-c)
// ---------------------------------------------------------------------
// 모든 ACT의 DAY 모달용 동적 목표 생성.
//
// b3 (v0.4.2)에서 ACT 3 전용으로 시작했고, c에서 ACT 1/2까지 일반화.
//
// 양 진영에 각각 2-4개의 단기 목표를 제시한다.
// 모든 목표는 현재 게임 상태 기반으로 동적으로 선택된다.
//
// 사용:
//   import { generateActObjectives } from "./act_objectives.js";
//   const { taiwan, china, actId, actName } = generateActObjectives(state, campaign);
//
// 목표 형식: { id, text, priority }
// priority: "high" | "medium" | "low" (UI 색상 가이드)
//
// b3 호환: generateAct3Objectives / shouldShowAct3Objectives는 기존 이름 유지하며
// 새 함수로 위임 (deprecation 없음).
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

function currentAct(state, campaign) {
  const lastActId = state.persistent?.lastActId;
  if (lastActId) return lastActId;
  // fallback: turn 기반
  if (campaign?.scenarioId === "short_72h") return "ACT_1";
  const t = state.turn || 0;
  if (t <= 12) return "ACT_1";
  if (t <= 44) return "ACT_2";
  return "ACT_3";
}

const ACT_NAMES = {
  ACT_1: "전 조짐",
  ACT_2: "위기 고조",
  ACT_3: "동맹 개입 선설기"
};

// =====================================================================
// ACT 1: 전 조짐 (T1-12)
//   초기 상륙 / 동맹 게이지 / 정부·지휘 안정
// =====================================================================
function taiwanObjectivesAct1(state) {
  const g = state.gauges || {};
  const provs = state.provinces || {};
  const out = [];

  // 1. 초기 상륙 저지 — 지룽/가오슝/타오위안 중 위협되는 곳
  const portsAtRisk = ["keelung", "kaohsiung", "taoyuan", "tainan"]
    .map(id => provs[id])
    .filter(p => p && landingIdx(p) >= 1);
  if (portsAtRisk.length > 0) {
    const names = portsAtRisk.map(p => p.name || p.id).slice(0, 3);
    out.push({
      id: "initial_landing_block",
      text: `${names.join("/")} 상륙 저지 — 1단계 이상 진입 차단`,
      priority: "high"
    });
  } else {
    out.push({
      id: "early_recon",
      text: "주요 항만/공항 경계 강화 — 상륙 사전 차단",
      priority: "medium"
    });
  }

  // 2. 정부/지휘 안정 — 80 이상 유지
  if ((g.taiwanGovernment || 0) < 80) {
    out.push({
      id: "govt_stable",
      text: `정부 기능 80 이상 유지 (현재 ${g.taiwanGovernment})`,
      priority: g.taiwanGovernment < 60 ? "high" : "medium"
    });
  }
  if ((g.taiwanCommand || 0) < 80) {
    out.push({
      id: "command_stable",
      text: `지휘 체계 80 이상 유지 (현재 ${g.taiwanCommand})`,
      priority: "medium"
    });
  }

  // 3. 미국 개입 게이지 상승 유도
  if ((g.usIntervention || 0) < 40) {
    out.push({
      id: "us_buildup_early",
      text: `미국 개입도 40 이상 — 외교/국제 호소 (현재 ${g.usIntervention})`,
      priority: "medium"
    });
  }

  // 4. 72시간 동안 점령지 손실 없이
  const lostCount = Object.values(provs).filter(p => isChinaHeld(p)).length;
  if (lostCount === 0) {
    out.push({
      id: "no_loss_72h",
      text: "72시간 내 점령지 손실 0건 유지",
      priority: "low"
    });
  }

  const order = { high: 0, medium: 1, low: 2 };
  out.sort((a, b) => order[a.priority] - order[b.priority]);
  return out.slice(0, 4);
}

function chinaObjectivesAct1(state) {
  const g = state.gauges || {};
  const provs = state.provinces || {};
  const out = [];

  // 1. 72시간 내 교두보 확보 — 지룽/가오슝
  const beachheadProvs = ["keelung", "kaohsiung", "taichung", "tainan"]
    .map(id => provs[id])
    .filter(p => p);
  const maxStage = Math.max(0, ...beachheadProvs.map(landingIdx));
  if (maxStage < 3) {
    out.push({
      id: "secure_beachhead",
      text: `지룽/가오슝 중 한 곳 이상 교두보 확보 (현재 최고 ${STAGES[maxStage] || "none"})`,
      priority: "high"
    });
  } else {
    out.push({
      id: "expand_beachhead",
      text: `확보된 교두보 확장 — 진척 2단계 이상`,
      priority: "medium"
    });
  }

  // 2. 작전 템포 유지 — 60 이상
  if ((g.chinaTempo || 0) < 60) {
    out.push({
      id: "tempo_maintain",
      text: `작전 템포 60 이상 유지 — 속전속결 (현재 ${g.chinaTempo})`,
      priority: "medium"
    });
  }

  // 3. 미국 개입 60 미만 유지
  if ((g.usIntervention || 0) >= 60) {
    out.push({
      id: "us_suppress_early",
      text: `미국 개입도 60 미만 유지 — 동맹 개입 지연 (현재 ${g.usIntervention})`,
      priority: "high"
    });
  } else {
    out.push({
      id: "us_keep_low",
      text: `미국 개입 상승 견제 (현재 ${g.usIntervention})`,
      priority: "low"
    });
  }

  // 4. 정치 압박 70 미만
  if ((g.chinaPoliticalPressure || 0) >= 70) {
    out.push({
      id: "pp_keep_low_early",
      text: `정치 압박 70 미만 유지 (현재 ${g.chinaPoliticalPressure})`,
      priority: "medium"
    });
  }

  const order = { high: 0, medium: 1, low: 2 };
  out.sort((a, b) => order[a.priority] - order[b.priority]);
  return out.slice(0, 4);
}

// =====================================================================
// ACT 2: 위기 고조 (T13-44)
//   봉쇄 / 정치압박 / 수도권 압박 / 미국 개입 도달
// =====================================================================
function taiwanObjectivesAct2(state) {
  const g = state.gauges || {};
  const provs = state.provinces || {};
  const out = [];

  // 1. 수도권 위기 — 지룽/타이베이/타오위안
  const taipei = provs.taipei;
  const keelung = provs.keelung;
  if (taipei && (landingIdx(taipei) >= 2 || isChinaHeld(taipei))) {
    out.push({
      id: "capital_defense",
      text: `타이베이 ${isChinaHeld(taipei) ? "탈환" : "방어"} — 수도권 위기 차단`,
      priority: "high"
    });
  }
  if (keelung && (landingIdx(keelung) >= 2 || isChinaHeld(keelung))) {
    out.push({
      id: "keelung_defense",
      text: `지룽 항만 방어 — 수도권 접근로 차단`,
      priority: "high"
    });
  }

  // 2. 미국 개입 100 도달
  if ((g.usIntervention || 0) < 100) {
    out.push({
      id: "us_full_intervention",
      text: `미국 개입도 100 도달 — 동맹 개입 발동 (현재 ${g.usIntervention})`,
      priority: g.usIntervention >= 80 ? "high" : "medium"
    });
  }

  // 3. 보급 50 이상 유지
  if ((g.taiwanSupply || 0) < 50) {
    out.push({
      id: "supply_maintain_act2",
      text: `보급 50 이상 유지 — 장기전 대비 (현재 ${g.taiwanSupply})`,
      priority: g.taiwanSupply < 30 ? "high" : "medium"
    });
  }

  // 4. 일본 개입도 상승
  if ((g.japanIntervention || 0) < 60) {
    out.push({
      id: "japan_buildup",
      text: `일본 개입도 60 이상 — 해상 호위 확보 (현재 ${g.japanIntervention})`,
      priority: "medium"
    });
  }

  // 5. 가오슝/타이중 거점 방어
  const kao = provs.kaohsiung;
  if (kao && (landingIdx(kao) >= 2 || isContested(kao))) {
    out.push({
      id: "kaohsiung_defense_act2",
      text: `가오슝 거점 방어 — 남부 전선 안정화`,
      priority: "medium"
    });
  }

  const order = { high: 0, medium: 1, low: 2 };
  out.sort((a, b) => order[a.priority] - order[b.priority]);
  return out.slice(0, 4);
}

function chinaObjectivesAct2(state) {
  const g = state.gauges || {};
  const provs = state.provinces || {};
  const out = [];

  // 1. 수도권 압박 진입 — 타이베이 beachhead+
  const taipei = provs.taipei;
  if (taipei && landingIdx(taipei) < 3 && !isChinaHeld(taipei)) {
    out.push({
      id: "capital_pressure_advance",
      text: `타이베이 상륙 진척 — beachhead 이상 진입`,
      priority: "high"
    });
  } else if (taipei && isChinaHeld(taipei)) {
    out.push({
      id: "capital_hold_act2",
      text: `타이베이 장악 유지 + 북부 접근로 확보`,
      priority: "high"
    });
  }

  // 2. 봉쇄로 대만 보급 50 이하
  if ((g.taiwanSupply || 0) > 50) {
    out.push({
      id: "blockade_squeeze",
      text: `대만 보급 50 이하 — 해상 봉쇄 강화 (현재 ${g.taiwanSupply})`,
      priority: "medium"
    });
  }

  // 3. 정치압박 관리 — 80 미만
  if ((g.chinaPoliticalPressure || 0) >= 75) {
    out.push({
      id: "pp_pressure_act2",
      text: `정치 압박 80 미만 유지 (현재 ${g.chinaPoliticalPressure})`,
      priority: g.chinaPoliticalPressure >= 90 ? "high" : "medium"
    });
  }

  // 4. 미국 개입 완전 발동 지연
  if ((g.usIntervention || 0) >= 80 && (g.usIntervention || 0) < 100) {
    out.push({
      id: "us_delay_act2",
      text: `미국 개입 100 도달 지연 — 정보전·외교 압박 (현재 ${g.usIntervention})`,
      priority: "high"
    });
  }

  // 5. 자원 유지 — tempo/supply 30 이상
  if ((g.chinaTempo || 0) < 30) {
    out.push({
      id: "tempo_keep_act2",
      text: `작전 템포 30 이상 — 후반 대비 (현재 ${g.chinaTempo})`,
      priority: "medium"
    });
  }
  if ((g.chinaSupply || 0) < 30) {
    out.push({
      id: "supply_keep_act2",
      text: `보급 30 이상 — 봉쇄 작전 지속 (현재 ${g.chinaSupply})`,
      priority: "medium"
    });
  }

  const order = { high: 0, medium: 1, low: 2 };
  out.sort((a, b) => order[a.priority] - order[b.priority]);
  return out.slice(0, 4);
}

// =====================================================================
// ACT 3: 동맹 개입 선설기 (T45+) — b3 그대로
// =====================================================================
function taiwanObjectivesAct3(state) {
  const g = state.gauges || {};
  const provs = state.provinces || {};
  const out = [];

  const taipei = provs.taipei;
  if (taipei && (landingIdx(taipei) >= 2 || isChinaHeld(taipei))) {
    out.push({
      id: "taipei_recapture",
      text: `타이베이 ${isChinaHeld(taipei) ? "탈환" : "방어"} — 수도권 위기 차단`,
      priority: "high"
    });
  }

  if ((g.taiwanGovernment || 0) < 70) {
    out.push({
      id: "govt_recovery",
      text: `정부 기능 70 이상 회복 (현재 ${g.taiwanGovernment})`,
      priority: g.taiwanGovernment < 40 ? "high" : "medium"
    });
  }

  if ((g.taiwanSupply || 0) < 50) {
    out.push({
      id: "supply_recovery",
      text: `보급 50 이상 회복 — "해상 보급로 확보" 카드 활용 (현재 ${g.taiwanSupply})`,
      priority: g.taiwanSupply < 25 ? "high" : "medium"
    });
  }

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

  if ((g.usIntervention || 0) < 90) {
    out.push({
      id: "us_intervention",
      text: `미국 개입도 90 이상 — "동맹 합동 정보망" 카드 (현재 ${g.usIntervention})`,
      priority: "low"
    });
  }

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

  const order = { high: 0, medium: 1, low: 2 };
  out.sort((a, b) => order[a.priority] - order[b.priority]);
  return out.slice(0, 4);
}

function chinaObjectivesAct3(state) {
  const g = state.gauges || {};
  const provs = state.provinces || {};
  const out = [];

  if ((g.chinaPoliticalPressure || 0) >= 80) {
    out.push({
      id: "pp_relief",
      text: `정치 압박 완화 — "제한전 유지" 카드 (현재 ${g.chinaPoliticalPressure})`,
      priority: "high"
    });
  }

  if ((g.chinaTempo || 0) <= 20) {
    out.push({
      id: "tempo_recovery",
      text: `작전 템포 회복 — "강경파 동원" 카드 (현재 ${g.chinaTempo})`,
      priority: g.chinaTempo <= 5 ? "high" : "medium"
    });
  }

  if ((g.chinaSupply || 0) <= 30) {
    out.push({
      id: "supply_refit",
      text: `보급 재정비 — "해상 봉쇄 재정비" 카드 (현재 ${g.chinaSupply})`,
      priority: g.chinaSupply <= 10 ? "high" : "medium"
    });
  }

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

  const allyMax = Math.max(g.usIntervention || 0, g.japanIntervention || 0);
  if (allyMax >= 70) {
    out.push({
      id: "diplo_pressure",
      text: `동맹 개입 약화 — "협상 우위 압박" 카드 (미 ${g.usIntervention}/일 ${g.japanIntervention})`,
      priority: "medium"
    });
  }

  if ((g.taiwanSupply || 0) > 50 && (g.chinaSupply || 0) > 0) {
    out.push({
      id: "blockade_taiwan",
      text: `대만 보급 봉쇄 — 50 이하로 압박 (현재 대만 보급 ${g.taiwanSupply})`,
      priority: "low"
    });
  }

  const order = { high: 0, medium: 1, low: 2 };
  out.sort((a, b) => order[a.priority] - order[b.priority]);
  return out.slice(0, 4);
}

// =====================================================================
// Dispatch
// =====================================================================
const ACT_GENERATORS = {
  ACT_1: { taiwan: taiwanObjectivesAct1, china: chinaObjectivesAct1 },
  ACT_2: { taiwan: taiwanObjectivesAct2, china: chinaObjectivesAct2 },
  ACT_3: { taiwan: taiwanObjectivesAct3, china: chinaObjectivesAct3 }
};

export function generateActObjectives(state, campaign = null) {
  const actId = currentAct(state, campaign);
  const gens = ACT_GENERATORS[actId];
  if (!gens) return { taiwan: [], china: [], actId, actName: ACT_NAMES[actId] || actId };
  return {
    taiwan: gens.taiwan(state),
    china: gens.china(state),
    actId,
    actName: ACT_NAMES[actId] || actId
  };
}

// full_21d 캠페인에서는 모든 ACT 표시
// short_72h은 ACT 1만 (b3과 동일하게 짧은 모드는 기본 X였지만,
// c에서는 short_72h ACT 1도 표시 가능 — 데모 첫인상용)
export function shouldShowActObjectives(state, campaign) {
  // ACT 1/2/3 모두에서 표시
  const actId = currentAct(state, campaign);
  if (!ACT_GENERATORS[actId]) return false;
  return true;
}

// b3 호환 alias
export function generateAct3Objectives(state) {
  return generateActObjectives(state, null);
}

export function shouldShowAct3Objectives(state, campaign) {
  // b3 동작 유지: full_21d + ACT 3에서만 true
  if (campaign?.scenarioId !== "full_21d") return false;
  const lastActId = state.persistent?.lastActId;
  if (lastActId === "ACT_3") return true;
  return (state.turn || 0) >= 45;
}
