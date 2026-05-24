// =====================================================================
// mission_scenarios.js (v0.4.2-d)
// ---------------------------------------------------------------------
// 5개 시나리오 미션 정의.
//
// 각 미션은:
//   - baseScenario (short_72h / full_21d) 위에 빌드
//   - initialState: 게이지/점령 오버라이드 (시작 상태 변경)
//   - missionObjectives: 성공 조건 (모두 만족 → 미션 클리어)
//   - failureConditions: 자동 실패 조건
//   - missionTurns: 미션 최대 턴 수 (baseScenario.totalTurns 오버라이드 가능)
//   - recommendedSide: 권장 진영
//
// 사용:
//   import { MISSIONS, applyMissionToState, evaluateMission } from "./mission_scenarios.js";
//
//   // 미션 시작
//   const mission = MISSIONS["first_72h"];
//   const state = createInitialState(...);
//   applyMissionToState(state, mission);
//
//   // 매 턴 평가
//   const result = evaluateMission(state, mission);
//   if (result.complete) → mission_complete
//   if (result.failed)   → mission_failed
// =====================================================================

// =====================================================================
// 시나리오 정의
// =====================================================================
export const MISSIONS = {
  // ---------------------------------------------------------------
  // 1. 첫 72시간 — ACT 1 초기 상륙 저지 튜토리얼
  // ---------------------------------------------------------------
  first_72h: {
    id: "first_72h",
    name: "첫 72시간",
    description: "중국 인민해방군이 대만 해협 전역에 상륙을 시도한다. 72시간 안에 어떤 거점도 빼앗기지 마라.",
    baseScenario: "short_72h",
    recommendedSide: "taiwan",
    difficulty: "normal",
    missionTurns: 12,  // 12턴 (3일)
    initialState: {
      // 기본 시작 상태 그대로 — 진짜 첫 72시간
    },
    missionObjectives: [
      { id: "no_china_held", type: "no_provinces_china_held", text: "어떤 거점도 중국군에게 점령당하지 않기" },
      { id: "govt_80", type: "gauge_min", metric: "taiwanGovernment", value: 80, text: "정부 기능 80 이상 유지" },
      { id: "command_75", type: "gauge_min", metric: "taiwanCommand", value: 75, text: "지휘 체계 75 이상 유지" }
    ],
    failureConditions: [
      { id: "any_capital_fall", type: "any_province_china_held", provinces: ["taipei"], text: "타이베이 함락" },
      { id: "two_ports_lost", type: "province_count_china_held", min: 2, text: "주요 항만 2곳 이상 함락" }
    ]
  },

  // ---------------------------------------------------------------
  // 2. 가오슝 방어 — 남부 거점 사수
  // ---------------------------------------------------------------
  kaohsiung_defense: {
    id: "kaohsiung_defense",
    name: "가오슝 방어",
    description: "남부의 가장 큰 항만 가오슝이 위협받고 있다. 중국 상륙은 이미 진행 중 — 가오슝을 사수하라.",
    baseScenario: "short_72h",
    recommendedSide: "taiwan",
    difficulty: "normal",
    missionTurns: 16,
    initialState: {
      gauges: {
        chinaTempo: 80,
        chinaSupply: 75,
        taiwanGovernment: 80,
        taiwanCommand: 75,
        taiwanSupply: 65,
        usIntervention: 30,
        japanIntervention: 20
      },
      provinces: {
        kaohsiung: { landingStage: "landing_attempt", controlStage: "contested" },
        tainan: { landingStage: "sea_superiority", controlStage: "stable_defense" }
      }
    },
    missionObjectives: [
      { id: "kaohsiung_held", type: "province_not_china_held", province: "kaohsiung", text: "가오슝을 끝까지 사수" },
      { id: "us_50", type: "gauge_min", metric: "usIntervention", value: 50, text: "미국 개입도 50 이상 확보" }
    ],
    failureConditions: [
      { id: "kaohsiung_fall", type: "province_china_held", province: "kaohsiung", text: "가오슝 함락" },
      { id: "govt_collapse", type: "gauge_max", metric: "taiwanGovernment", value: 30, text: "정부 기능 30 이하 붕괴" }
    ]
  },

  // ---------------------------------------------------------------
  // 3. 수도권 압박 — 중국 진영, 타이베이 압박
  // ---------------------------------------------------------------
  capital_pressure: {
    id: "capital_pressure",
    name: "수도권 압박",
    description: "중국군은 남부를 굳혔다. 이제 타이베이로 진격해 대만 정부를 굴복시켜라. 단, 국제 여론은 임계에 다가가고 있다.",
    baseScenario: "full_21d",
    recommendedSide: "china",
    difficulty: "normal",
    missionTurns: 30,
    initialState: {
      gauges: {
        chinaTempo: 70,
        chinaSupply: 65,
        chinaPoliticalPressure: 60,
        taiwanGovernment: 75,
        taiwanCommand: 70,
        taiwanSupply: 50,
        usIntervention: 55,
        japanIntervention: 40,
        internationalOpinion: 45
      },
      provinces: {
        kaohsiung: { landingStage: "consolidated", controlStage: "china_control" },
        tainan: { landingStage: "consolidated", controlStage: "china_control" },
        taichung: { landingStage: "beachhead", controlStage: "beachhead_established" },
        taipei: { landingStage: "sea_superiority", controlStage: "stable_defense" }
      }
    },
    missionObjectives: [
      { id: "taipei_press", type: "province_china_held", province: "taipei", text: "타이베이 china_control 도달" },
      { id: "northern_access", type: "any_province_china_held", provinces: ["keelung", "taoyuan"], text: "북부 접근로 (지룽 또는 타오위안) 확보" }
    ],
    failureConditions: [
      { id: "pp_collapse", type: "gauge_min", metric: "chinaPoliticalPressure", value: 100, text: "정치 압박 100 도달 (국제 비난)" },
      { id: "supply_dry", type: "gauge_max", metric: "chinaSupply", value: 0, text: "보급 0 (작전 정지)" }
    ]
  },

  // ---------------------------------------------------------------
  // 4. 봉쇄전 — 장기 봉쇄 시나리오
  // ---------------------------------------------------------------
  blockade_war: {
    id: "blockade_war",
    name: "봉쇄전",
    description: "중국군은 상륙 대신 해상 봉쇄로 대만을 굴복시키려 한다. 보급선을 지켜라.",
    baseScenario: "full_21d",
    recommendedSide: "taiwan",
    difficulty: "normal",
    missionTurns: 40,
    initialState: {
      gauges: {
        chinaTempo: 55,
        chinaSupply: 70,
        chinaPoliticalPressure: 50,
        taiwanGovernment: 80,
        taiwanCommand: 80,
        taiwanSupply: 45,  // 이미 봉쇄로 낮음
        taiwanMorale: 65,
        usIntervention: 50,
        japanIntervention: 45
      },
      provinces: {
        // 상륙은 미미, 봉쇄가 핵심
        kaohsiung: { landingStage: "sea_superiority", controlStage: "stable_defense" }
      }
    },
    missionObjectives: [
      { id: "supply_60", type: "gauge_min", metric: "taiwanSupply", value: 60, text: "보급 60 이상으로 회복" },
      { id: "morale_70", type: "gauge_min", metric: "taiwanMorale", value: 70, text: "국민 사기 70 이상 유지" },
      { id: "japan_70", type: "gauge_min", metric: "japanIntervention", value: 70, text: "일본 개입도 70 이상 — 해상 호위" }
    ],
    failureConditions: [
      { id: "supply_zero", type: "gauge_max", metric: "taiwanSupply", value: 5, text: "보급 5 이하 (봉쇄 성공)" },
      { id: "morale_collapse", type: "gauge_max", metric: "taiwanMorale", value: 25, text: "국민 사기 25 이하 (항복 분위기)" }
    ]
  },

  // ---------------------------------------------------------------
  // 5. 동맹 개입 후 반격 — ACT 3 본격 반격
  // ---------------------------------------------------------------
  allied_counter: {
    id: "allied_counter",
    name: "동맹 개입 후 반격",
    description: "미국과 일본의 개입이 본격화됐다. 중국은 자원이 소진되고 있다. 빼앗긴 영토를 탈환하라.",
    baseScenario: "full_21d",
    recommendedSide: "taiwan",
    difficulty: "normal",
    missionTurns: 30,
    initialState: {
      gauges: {
        chinaTempo: 15,
        chinaSupply: 20,
        chinaPoliticalPressure: 75,
        taiwanGovernment: 65,
        taiwanCommand: 70,
        taiwanSupply: 55,
        taiwanMorale: 60,
        usIntervention: 100,  // 동맹 개입 발동
        japanIntervention: 80,
        koreaRearSupport: 35
      },
      provinces: {
        // 남부 빼앗긴 상태
        kaohsiung: { landingStage: "consolidated", controlStage: "china_control" },
        tainan: { landingStage: "consolidated", controlStage: "china_control" },
        taichung: { landingStage: "beachhead", controlStage: "beachhead_established" }
      },
      // 동맹 개입 활성 마킹
      persistent: {
        alliedIntervention: { active: true, activatedTurn: 0, usCombatSupport: true, japanNavalSupport: true },
        lastActId: "ACT_3",
        milestones: { act3EnteredAt: 1 }
      }
    },
    missionObjectives: [
      { id: "recapture_one", type: "any_province_taiwan_recovered", provinces: ["kaohsiung", "tainan", "taichung"], text: "남부 거점 한 곳 이상 탈환 (china_control 해제)" },
      { id: "china_pp_max", type: "gauge_min", metric: "chinaPoliticalPressure", value: 95, text: "중국 정치 압박 95+ (항복 압박)" }
    ],
    failureConditions: [
      { id: "lose_taipei", type: "province_china_held", province: "taipei", text: "타이베이 함락 (반격 실패)" },
      { id: "us_pullout", type: "gauge_max", metric: "usIntervention", value: 60, text: "미국 개입도 60 이하 (동맹 철수)" }
    ]
  }
};

// =====================================================================
// 미션 적용
// =====================================================================
export function applyMissionToState(state, mission) {
  if (!mission) return;
  const init = mission.initialState || {};

  // 게이지 오버라이드
  if (init.gauges) {
    for (const [k, v] of Object.entries(init.gauges)) {
      state.gauges[k] = v;
    }
  }

  // 점령 오버라이드
  if (init.provinces) {
    for (const [provId, override] of Object.entries(init.provinces)) {
      const prov = state.provinces[provId];
      if (!prov) continue;
      for (const [k, v] of Object.entries(override)) {
        prov[k] = v;
      }
    }
  }

  // persistent 오버라이드 (동맹 개입 등)
  if (init.persistent) {
    for (const [k, v] of Object.entries(init.persistent)) {
      if (typeof v === "object" && v !== null && !Array.isArray(v)) {
        state.persistent[k] = { ...(state.persistent[k] || {}), ...v };
      } else {
        state.persistent[k] = v;
      }
    }
  }

  // 미션 메타데이터 기록
  state.mission = {
    id: mission.id,
    name: mission.name,
    objectives: mission.missionObjectives || [],
    failures: mission.failureConditions || [],
    completedObjectives: [],
    startedAt: state.turn,
    _def: mission  // turn_resolver에서 evaluateMissionState용
  };

  // missionTurns로 totalTurns 오버라이드
  if (mission.missionTurns) {
    state.totalTurns = mission.missionTurns;
  }
}

// =====================================================================
// 목표 평가 — 매 턴 호출
// =====================================================================
function evalCondition(cond, state) {
  const g = state.gauges || {};
  const provs = state.provinces || {};

  switch (cond.type) {
    case "gauge_min":
      return (g[cond.metric] || 0) >= cond.value;

    case "gauge_max":
      return (g[cond.metric] || 0) <= cond.value;

    case "province_not_china_held": {
      const p = provs[cond.province];
      return !p || (p.controlStage !== "beachhead_established" && p.controlStage !== "china_control");
    }

    case "province_china_held": {
      const p = provs[cond.province];
      return p && (p.controlStage === "beachhead_established" || p.controlStage === "china_control");
    }

    case "any_province_china_held": {
      const list = cond.provinces || [];
      return list.some(id => {
        const p = provs[id];
        return p && (p.controlStage === "beachhead_established" || p.controlStage === "china_control");
      });
    }

    case "no_provinces_china_held": {
      return !Object.values(provs).some(p => p.controlStage === "beachhead_established" || p.controlStage === "china_control");
    }

    case "province_count_china_held": {
      const count = Object.values(provs).filter(p =>
        p.controlStage === "beachhead_established" || p.controlStage === "china_control"
      ).length;
      return count >= (cond.min || 1);
    }

    case "any_province_taiwan_recovered": {
      // 시작 시 china_held였던 지역이 더 이상 china_held가 아니면 탈환
      const list = cond.provinces || [];
      const initial = state.mission?.initialState?.provinces || {};
      return list.some(id => {
        const p = provs[id];
        return p && p.controlStage !== "beachhead_established" && p.controlStage !== "china_control";
      });
    }

    default:
      return false;
  }
}

// 미션 결과 평가
//   { complete: bool, failed: bool, objectiveStatus: [...], failureStatus: [...] }
export function evaluateMission(state, mission) {
  if (!mission) return { complete: false, failed: false, objectiveStatus: [], failureStatus: [] };

  const objs = mission.missionObjectives || [];
  const fails = mission.failureConditions || [];

  const objectiveStatus = objs.map(o => ({
    id: o.id, text: o.text, met: evalCondition(o, state)
  }));
  const failureStatus = fails.map(f => ({
    id: f.id, text: f.text, triggered: evalCondition(f, state)
  }));

  // 실패: failure 조건 하나라도 triggered
  const failed = failureStatus.some(f => f.triggered);
  if (failed) return { complete: false, failed: true, objectiveStatus, failureStatus };

  // 완료: 모든 objective met
  const complete = objectiveStatus.length > 0 && objectiveStatus.every(o => o.met);
  return { complete, failed: false, objectiveStatus, failureStatus };
}

// 미션 ID 목록 (UI용)
export function listMissions() {
  return Object.values(MISSIONS).map(m => ({
    id: m.id,
    name: m.name,
    description: m.description,
    recommendedSide: m.recommendedSide,
    baseScenario: m.baseScenario,
    missionTurns: m.missionTurns
  }));
}
