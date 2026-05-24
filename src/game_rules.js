// =====================================================================
// 해협의 72시간 (Strait 72) - v0.3.5 플레이테스트 규칙
// =====================================================================
// 핵심 의미:
//   - 총 게임 길이: 30턴 × 6시간 = 180시간 (7.5일)
//   - "72시간"은 중국이 목표한 초기 속전속결 시간 (= 12턴 시점)
//   - UI 표기는 항상 이 모듈의 헬퍼를 통과시킨다 (목업 통일)
// =====================================================================

// 빌드 식별 (브라우저 캐시/오래된 파일 감지용)
export const BUILD_TAG = "v0.4.1.2";
export const BUILD_DATE = "2026-05-23";
export const BUILD_FULL = `${BUILD_TAG}-${BUILD_DATE}`;

export const GAME_RULES = Object.freeze({
  version: "v0.4.1.2",
  totalTurns: 30,
  hoursPerTurn: 6,
  chinaInitialObjectiveHours: 72,  // 중국 속전속결 목표 시한
  scenarioStartHour: 2              // D+0 02:00 시작
});

// ---- 파생 상수 ----
export const TOTAL_GAME_HOURS = GAME_RULES.totalTurns * GAME_RULES.hoursPerTurn;        // 180
export const CHINA_OBJECTIVE_TURN = GAME_RULES.chinaInitialObjectiveHours / GAME_RULES.hoursPerTurn; // 12

// ---- UI 표시 헬퍼 ----

/**
 * 현재 턴 → "D+1 02:00" 형식 게임 내 시계 표기
 * 예: formatGameTime(1) → "D+0 02:00"
 *     formatGameTime(5) → "D+1 02:00"  (목업 2번 일치)
 */
export function formatGameTime(currentTurn) {
  const totalHours = (currentTurn - 1) * GAME_RULES.hoursPerTurn + GAME_RULES.scenarioStartHour;
  const dayNumber = Math.floor(totalHours / 24);
  const hour = totalHours % 24;
  return `D+${dayNumber} ${String(hour).padStart(2, "0")}:00`;
}

/**
 * 중국 72시간 목표까지 남은 시간 (시간 단위)
 * 예: chinaHoursRemaining(5) → 48  (4턴 경과 = 24시간, 72-24=48)
 *     chinaHoursRemaining(13) → 0  (목표 시한 경과)
 */
export function chinaHoursRemaining(currentTurn) {
  const hoursElapsed = (currentTurn - 1) * GAME_RULES.hoursPerTurn;
  return Math.max(0, GAME_RULES.chinaInitialObjectiveHours - hoursElapsed);
}

/**
 * 턴 진행도 표기 "TURN 5 / 20"
 * v0.4.1: totalTurns 인자로 override 가능 (campaign 84턴 등)
 */
export function formatTurnCounter(currentTurn, totalTurns = null) {
  return `TURN ${currentTurn} / ${totalTurns || GAME_RULES.totalTurns}`;
}

/**
 * 중국 속전속결 목표 단계 판정
 *   - "within"  : 목표 시한 내 (1~12턴)
 *   - "overdue" : 시한 경과 (13턴 이후) - 중국 정치 압박 가중 시작
 */
export function chinaObjectivePhase(currentTurn) {
  return currentTurn <= CHINA_OBJECTIVE_TURN ? "within" : "overdue";
}
