// =====================================================================
// deck_state.js  (v0.3.6 introduced)
// ---------------------------------------------------------------------
// 손패/덱/버림 메커니즘.
//
// 구조:
//   state.decks.china  = { deck, hand, discard }
//   state.decks.taiwan = { deck, hand, discard }
//
// 규칙 (v0.3.7 tuned):
//   - 시작 손패: 6장 (HAND_INIT)
//   - 매턴 드로우: 3장 (DRAW_PER_TURN)
//   - 최대 손패: 7장 (HAND_MAX) — 초과 시 가장 오래된 카드부터 discard
//   - 덱 소진 시: discard를 섞어 새 deck으로 복귀
//   - 카드 사용 후: 자동으로 discard로 이동 (turn_resolver에서 호출)
// =====================================================================

export const HAND_INIT = 6;
export const DRAW_PER_TURN = 3;
export const HAND_MAX = 7;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 게임 시작 시 양측 덱을 초기화한다.
 * - 전체 카드를 섞어 deck에 넣고
 * - 초기 4장을 hand로 뽑는다.
 */
export function initializeDecks(state, cardsChina, cardsTaiwan) {
  state.decks = {
    china: { deck: shuffle(cardsChina.map((c) => c.id)), hand: [], discard: [] },
    taiwan: { deck: shuffle(cardsTaiwan.map((c) => c.id)), hand: [], discard: [] }
  };
  drawCards(state, "china", HAND_INIT);
  drawCards(state, "taiwan", HAND_INIT);
}

/**
 * 지정 측에서 N장을 deck → hand로 이동.
 * deck 부족 시 discard를 섞어 deck으로 복귀시킨다.
 */
export function drawCards(state, side, count) {
  const d = state.decks?.[side];
  if (!d) return 0;
  let drawn = 0;
  for (let i = 0; i < count; i++) {
    if (d.deck.length === 0) {
      if (d.discard.length === 0) break; // 완전 소진 → 더 못 뽑음
      d.deck = shuffle(d.discard);
      d.discard = [];
    }
    d.hand.push(d.deck.shift());
    drawn++;
  }
  return drawn;
}

/**
 * 손패가 max를 넘으면 가장 오래된(앞쪽) 카드부터 discard로 보낸다.
 */
export function enforceHandLimit(state, side, max = HAND_MAX) {
  const d = state.decks?.[side];
  if (!d) return [];
  const removed = [];
  while (d.hand.length > max) {
    const id = d.hand.shift();
    d.discard.push(id);
    removed.push(id);
  }
  return removed;
}

/**
 * 카드 한 장을 손패에서 discard로 이동.
 * (turn_resolver에서 카드 사용 후 호출)
 */
export function discardCard(state, side, cardId) {
  const d = state.decks?.[side];
  if (!d) return false;
  const idx = d.hand.indexOf(cardId);
  if (idx < 0) return false;
  d.hand.splice(idx, 1);
  d.discard.push(cardId);
  return true;
}

/**
 * 다수 카드를 한 번에 discard로 이동.
 */
export function discardCards(state, side, cardIds) {
  for (const id of cardIds) discardCard(state, side, id);
}

/**
 * 매턴 시작 시 호출: 2장 드로우 + 한도 적용.
 * - 1턴에는 이미 시작 손패 4장이 있으므로 skipFirstTurn=true이면 1턴 skip
 */
export function turnStartDraw(state, opts = {}) {
  const { skipFirstTurn = true } = opts;
  if (skipFirstTurn && state.turn === 1) return { china: 0, taiwan: 0 };
  const chinaDrawn = drawCards(state, "china", DRAW_PER_TURN);
  const taiwanDrawn = drawCards(state, "taiwan", DRAW_PER_TURN);
  enforceHandLimit(state, "china", HAND_MAX);
  enforceHandLimit(state, "taiwan", HAND_MAX);
  return { china: chinaDrawn, taiwan: taiwanDrawn };
}

/**
 * 디버깅용 요약.
 */
export function deckSummary(state, side) {
  const d = state.decks?.[side];
  if (!d) return { hand: 0, deck: 0, discard: 0 };
  return { hand: d.hand.length, deck: d.deck.length, discard: d.discard.length };
}
