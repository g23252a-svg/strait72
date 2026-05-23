// =====================================================================
// 상륙 작전 & 통제 단계 상태머신
// =====================================================================
// 핵심 원칙:
//   - 중국이 한 번의 공격으로 도시를 먹지 못한다.
//   - 한 지역을 두고 3~4턴 동안 단계가 밀고 당겨진다.
//   - landingStage와 controlStage는 병렬 인덱스로 매핑 가능하지만,
//     강제 결합은 아니다 (정보전·봉쇄로도 controlStage가 흔들릴 수 있음).
// =====================================================================

// 중국 상륙 작전 진행 단계
export const LANDING_STAGES = Object.freeze([
  "none",                // 진행 없음
  "sea_superiority",     // 1단계: 해상 우세 확보
  "landing_attempt",     // 2단계: 상륙 시도
  "beachhead",           // 3단계: 교두보 확보
  "inland_expansion"     // 4단계: 내륙 전개
]);

// 지역 통제 단계
export const CONTROL_STAGES = Object.freeze([
  "stable_defense",        // 안정 방어 (대만 완전 통제)
  "contested",             // 교전 중
  "coastal_breach",        // 해안 돌파
  "beachhead_established", // 교두보 형성
  "china_control"          // 중국 통제
]);

// ---- 상륙 단계 전이 ----

/**
 * 상륙 단계 1칸 진행. 이미 최종 단계면 그대로 유지.
 */
export function advanceLandingStage(currentStage) {
  const index = LANDING_STAGES.indexOf(currentStage);
  if (index < 0 || index >= LANDING_STAGES.length - 1) {
    return currentStage;
  }
  return LANDING_STAGES[index + 1];
}

/**
 * 상륙 단계 1칸 후퇴. 잘못된 입력은 "none"으로 강제 정규화.
 */
export function regressLandingStage(currentStage) {
  const index = LANDING_STAGES.indexOf(currentStage);
  if (index < 0) {
    return "none";
  }
  if (index === 0) {
    return "none";
  }
  return LANDING_STAGES[index - 1];
}

// ---- 통제 단계 전이 ----

export function advanceControlStage(currentStage) {
  const index = CONTROL_STAGES.indexOf(currentStage);
  if (index < 0 || index >= CONTROL_STAGES.length - 1) {
    return currentStage;
  }
  return CONTROL_STAGES[index + 1];
}

export function regressControlStage(currentStage) {
  const index = CONTROL_STAGES.indexOf(currentStage);
  if (index <= 0) {
    return "stable_defense";
  }
  return CONTROL_STAGES[index - 1];
}

// ---- 단계 간 매핑 (옵션) ----

/**
 * landingStage → 같은 인덱스의 controlStage 변환.
 * 강제 결합이 아니라, "중국 상륙이 X단계까지 갔다면 통제는 보통 여기"라는
 * 기본값 추론용. turn_resolver에서 골라 쓸 수 있음.
 */
export function landingStageToControlStage(landingStage) {
  const index = LANDING_STAGES.indexOf(landingStage);
  if (index < 0) return "stable_defense";
  return CONTROL_STAGES[index];
}

// ---- 가드 / 헬퍼 ----

/**
 * 해당 지역이 상륙 가능한 거점인지 (provinces.json의 tags 기반).
 * "coastal" 또는 "sea_zone" 타입만 상륙 대상.
 */
export function isLandableProvince(province) {
  if (!province) return false;
  if (province.type === "sea_zone") return false; // 해협은 봉쇄 대상이지 상륙 대상 아님
  return Array.isArray(province.tags) && province.tags.includes("coastal");
}

/**
 * 상륙 단계가 최종(inland_expansion)에 도달했는지 = 해당 지역 함락 직전.
 */
export function isLandingComplete(landingStage) {
  return landingStage === "inland_expansion";
}
