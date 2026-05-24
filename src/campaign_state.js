// =====================================================================
// campaign_state.js  (v0.4.0-a introduced)
// ---------------------------------------------------------------------
// 진영 선택, 난이도, "이전 설정" localStorage 관리.
// v0.4.0-a 범위: 진영/난이도 UI + 저장.
// 난이도 실제 보정은 v0.4.0-e에서 분리 적용 예정.
// =====================================================================

const STORAGE_KEY = "strait72_campaign_v1";

export const SIDES = {
  taiwan: {
    id: "taiwan",
    name: "대만 방어 캠페인",
    description: "동맹 개입까지 버티고, 이후 장기전에서 정부 기능을 유지하십시오."
  },
  china: {
    id: "china",
    name: "중국 속전속결 캠페인",
    description: "72시간 내 결정적 우위를 만들고, 동맹 개입 후에도 협상 주도권을 확보하십시오."
  },
  both: {
    id: "both",
    name: "양쪽 보기 / 개발자 모드",
    description: "현재처럼 양측 카드와 상태를 모두 보며 테스트합니다."
  }
};

export const DIFFICULTIES = {
  easy:   { id: "easy",   name: "Easy",   description: "입문용. 상대 AI 실수 잦음." },
  normal: { id: "normal", name: "Normal", description: "현재 균형 기준." },
  hard:   { id: "hard",   name: "Hard",   description: "S급 도전용. AI 효율 강화." }
};

export function loadLastChoice() {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!SIDES[data?.side] || !DIFFICULTIES[data?.difficulty]) return null;
    return { side: data.side, difficulty: data.difficulty, savedAt: data.savedAt };
  } catch {
    return null;
  }
}

export function saveLastChoice(side, difficulty) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      side, difficulty, savedAt: Date.now()
    }));
  } catch { /* ignore */ }
}

// =====================================================================
// v0.4.1: 시나리오 — 캠페인 길이 결정
// ---------------------------------------------------------------------
//   short_72h: 30턴 / 7.5일 — 기존 위기 모드 (ACT 1만)
//   full_21d:  84턴 / 21일 — 전체 캠페인 (ACT 1+2+3)
// 기본은 short_72h (호환). UI에서 선택 가능.
// =====================================================================
export const SCENARIOS = {
  short_72h: { id: "short_72h", name: "72시간 위기", totalTurns: 30, description: "초기 상륙 저지 단편 (~30분)" },
  full_21d:  { id: "full_21d",  name: "21일 캠페인", totalTurns: 84, description: "ACT 1~3 전체 (~2시간)" }
};

export function createCampaignState(side = "both", difficulty = "normal", scenarioId = "short_72h") {
  const scenario = SCENARIOS[scenarioId] || SCENARIOS.short_72h;
  return {
    selectedSide: side,
    difficulty,
    scenarioId: scenario.id,
    totalTurns: scenario.totalTurns,
    developerMode: side === "both",
    startedAt: Date.now()
  };
}

export function isPlayerSide(campaign, side) {
  if (!campaign || campaign.selectedSide === "both") return true;
  return campaign.selectedSide === side;
}

export function isAISide(campaign, side) {
  if (!campaign || campaign.selectedSide === "both") return false;
  return campaign.selectedSide !== side;
}
