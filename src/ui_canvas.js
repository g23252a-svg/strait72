// =====================================================================
// ui_canvas.js
// ---------------------------------------------------------------------
// v0.3 HTML/Canvas MVP용 시각화 레이어.
// 엔진 상태(state)를 받아 중앙 대만 지도, 통제 단계, 상륙 단계, 선택 지역을 그린다.
// =====================================================================

// v0.5-a: 전략맵 이미지 (taiwan_strategic_map.png) 기준 정규화 좌표
// v0.5-a.1: 좌표를 지도의 실제 라벨 위치에 맞춰 미세조정 + r 축소 (라벨 가림 방지)
// v0.5-a.2: 가오슝 좌표 미세 fit (라벨이 토큰 안에 들어오도록)
// 이미지에 한글 라벨이 인쇄돼 있으므로 토큰은 라벨 옆 *작은 상태 인디케이터* 역할.
export const PROVINCE_LAYOUT = Object.freeze({
  taipei:    { x: 0.600, y: 0.205, r: 22, label: "타이베이" },
  keelung:   { x: 0.670, y: 0.240, r: 20, label: "지룽" },
  taoyuan:   { x: 0.540, y: 0.270, r: 20, label: "타오위안" },
  taichung:  { x: 0.485, y: 0.405, r: 22, label: "타이중" },
  tainan:    { x: 0.435, y: 0.565, r: 20, label: "타이난" },
  kaohsiung: { x: 0.475, y: 0.730, r: 24, label: "가오슝" },
  hualien:   { x: 0.595, y: 0.560, r: 21, label: "화롄" },
  strait:    { x: 0.230, y: 0.460, r: 32, label: "대만 해협" }
});

// v0.5-a.2: 해상 우회 anchor — 북부 거점(지룽/타이베이)은 본토를 가로지르지 않고
// 대만 북쪽 바다를 돌아서 진입해야 자연스럽다. 화살표/이동 경로용 mid-point.
const SEA_ANCHORS = Object.freeze({
  // 대만 북부 해상 — 지룽/타이베이로 진입할 때 경유
  north: { x: 0.560, y: 0.090 },
  // 대만 남부 해상 — strait → 남부 거점 사이 (베지에 control point 보조)
  south: { x: 0.330, y: 0.700 },
  // 대만 동부 해상 — 화롄 진입용 (보통 우회 불가)
  east:  { x: 0.780, y: 0.450 }
});

// v0.5-a.2: 거점별 해상 진입 anchor 매핑. 정의되지 않은 거점은 strait 직접 사용.
const PROVINCE_SEA_APPROACH = Object.freeze({
  taipei:  "north",   // 대만 북쪽 바다 돌아서
  keelung: "north",   // 동북 항구 — 북쪽 바다에서
  hualien: "east"     // 동해안 — 동쪽 바다 (보통 도달 불가)
  // 그 외 거점(타오위안/타이중/타이난/가오슝): 서해안에서 직접 — anchor 없음
});

const STAGE_LABELS = Object.freeze({
  none: "상륙 없음",
  sea_superiority: "해상 우세",
  landing_attempt: "상륙 시도",
  beachhead: "교두보",
  inland_expansion: "내륙 전개"
});

const CONTROL_LABELS = Object.freeze({
  stable_defense: "대만 안정 방어",
  contested: "교전 중",
  coastal_breach: "해안 돌파",
  beachhead_established: "교두보 형성",
  china_control: "중국 통제"
});

export function hitTestProvince(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  const sx = canvas.width / rect.width;
  const sy = canvas.height / rect.height;
  const x = (event.clientX - rect.left) * sx;
  const y = (event.clientY - rect.top) * sy;

  for (const [id, pos] of Object.entries(PROVINCE_LAYOUT)) {
    const px = pos.x * canvas.width;
    const py = pos.y * canvas.height;
    const dx = x - px;
    const dy = y - py;
    if (Math.sqrt(dx * dx + dy * dy) <= pos.r + 12) return id;
  }
  return null;
}

export function drawGameCanvas(canvas, state, meta = {}) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  drawBackground(ctx, w, h);
  drawStraitGrid(ctx, w, h);
  drawTaiwanMapImage(ctx, w, h);  // v0.5-a: 실제 전략맵 이미지 (로드 실패 시 fallback)
  drawRoutes(ctx, w, h);
  drawOperationalMotion(ctx, w, h, state, meta);
  drawAlliedIntervention(ctx, w, h, state, meta);
  drawProvinces(ctx, w, h, state, meta);
  drawTopHud(ctx, w, h, state, meta);
}

function drawBackground(ctx, w, h) {
  // v0.5-a: 이미지가 cover로 들어오면 거의 가려지지만, 이미지 로딩 전 또는
  // 비율 차이로 노출되는 영역을 위한 fallback 배경.
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#071726");
  g.addColorStop(0.48, "#0b2238");
  g.addColorStop(1, "#030811");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function drawStraitGrid(ctx, w, h) {
  ctx.save();
  // v0.5-a: 이미지 위에 격자가 너무 진하면 가독성 떨어지므로 alpha 절반
  ctx.strokeStyle = "rgba(114, 178, 255, 0.05)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 9; i++) {
    const x = w * (0.18 + i * 0.08);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + w * 0.04, h);
    ctx.stroke();
  }
  for (let i = 0; i < 8; i++) {
    const y = h * (0.12 + i * 0.11);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y - h * 0.08);
    ctx.stroke();
  }

  ctx.setLineDash([10, 9]);
  ctx.strokeStyle = "rgba(255, 80, 96, 0.34)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(w * 0.25, h * 0.22);
  ctx.bezierCurveTo(w * 0.34, h * 0.28, w * 0.39, h * 0.42, w * 0.48, h * 0.58);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(w * 0.24, h * 0.63);
  ctx.bezierCurveTo(w * 0.34, h * 0.62, w * 0.39, h * 0.72, w * 0.49, h * 0.78);
  ctx.stroke();
  ctx.restore();
}

// v0.5-a: 전략맵 이미지 로드 (한 번만, 모듈 캐시)
// document 없는 환경(테스트)에선 null로 두고 fallback 실루엣을 그린다.
let _mapImage = null;
let _mapImageLoading = false;
let _mapImageFailed = false;

function ensureMapImageLoaded() {
  if (_mapImage || _mapImageLoading || _mapImageFailed) return;
  if (typeof Image === "undefined") return;  // Node 환경
  _mapImageLoading = true;
  const img = new Image();
  img.onload = () => {
    _mapImage = img;
    _mapImageLoading = false;
  };
  img.onerror = () => {
    _mapImageFailed = true;
    _mapImageLoading = false;
    console.warn("[v0.5-a] taiwan_strategic_map.png 로드 실패 — fallback 실루엣 사용");
  };
  img.src = "./assets/maps/taiwan_strategic_map.png";
}

// v0.5-a: 전략맵 이미지 그리기. 로드 안 됐으면 fallback 실루엣.
function drawTaiwanMapImage(ctx, w, h) {
  ensureMapImageLoaded();
  if (_mapImage) {
    // 이미지가 캔버스 가득 차도록 cover 방식 (object-fit: cover)
    const imgRatio = _mapImage.width / _mapImage.height;
    const canvasRatio = w / h;
    let dw, dh, dx, dy;
    if (imgRatio > canvasRatio) {
      // 이미지가 더 넓음 — 높이 맞추고 좌우 crop
      dh = h;
      dw = h * imgRatio;
      dx = (w - dw) / 2;
      dy = 0;
    } else {
      // 이미지가 더 좁음 — 너비 맞추고 상하 crop
      dw = w;
      dh = w / imgRatio;
      dx = 0;
      dy = (h - dh) / 2;
    }
    ctx.drawImage(_mapImage, dx, dy, dw, dh);
  } else {
    // fallback: 기존 추상 실루엣 (이미지 로딩 중 또는 실패 시)
    drawTaiwanSilhouetteFallback(ctx, w, h);
  }
}

// v0.5-a: 기존 실루엣 함수 (이미지 로드 실패 시 fallback). 좌표 영향 X.
function drawTaiwanSilhouetteFallback(ctx, w, h) {
  ctx.save();
  const cx = w * 0.56;
  const cy = h * 0.47;
  ctx.translate(cx, cy);
  ctx.rotate(-0.06);

  const g = ctx.createLinearGradient(-120, -260, 150, 250);
  g.addColorStop(0, "rgba(62, 109, 91, .68)");
  g.addColorStop(1, "rgba(28, 69, 79, .78)");
  ctx.fillStyle = g;
  ctx.strokeStyle = "rgba(166, 219, 255, .28)";
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.moveTo(60, -265);
  ctx.bezierCurveTo(145, -190, 120, -30, 92, 100);
  ctx.bezierCurveTo(74, 184, 37, 270, -25, 260);
  ctx.bezierCurveTo(-100, 248, -118, 108, -88, -20);
  ctx.bezierCurveTo(-56, -150, -28, -246, 60, -265);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

function drawRoutes(ctx, w, h) {
  // v0.5-a.2: 본토 가로지르는 라인 방지 — 북부 거점은 해상 anchor 경유
  // 직선 라인 (서해안 직접 진입)
  const directPairs = [
    ["strait", "taoyuan"], ["strait", "taichung"], ["strait", "tainan"], ["strait", "kaohsiung"],
    ["taoyuan", "taipei"], ["taoyuan", "taichung"], ["tainan", "taichung"], ["kaohsiung", "tainan"]
  ];
  // 해상 anchor 경유 라인 (베지에) — 본토 우회
  const anchorPairs = [
    { from: "strait", to: "keelung", via: "north" },
    { from: "strait", to: "taipei",  via: "north" }
  ];

  ctx.save();
  ctx.strokeStyle = "rgba(190, 220, 255, .16)";
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 8]);

  // 직선
  for (const [a, b] of directPairs) {
    const pa = PROVINCE_LAYOUT[a];
    const pb = PROVINCE_LAYOUT[b];
    if (!pa || !pb) continue;
    ctx.beginPath();
    ctx.moveTo(pa.x * w, pa.y * h);
    ctx.lineTo(pb.x * w, pb.y * h);
    ctx.stroke();
  }

  // 베지에 우회
  for (const { from, to, via } of anchorPairs) {
    const pa = PROVINCE_LAYOUT[from];
    const pb = PROVINCE_LAYOUT[to];
    const anchor = SEA_ANCHORS[via];
    if (!pa || !pb || !anchor) continue;
    ctx.beginPath();
    ctx.moveTo(pa.x * w, pa.y * h);
    ctx.quadraticCurveTo(anchor.x * w, anchor.y * h, pb.x * w, pb.y * h);
    ctx.stroke();
  }
  ctx.restore();
}


function drawOperationalMotion(ctx, w, h, state, meta = {}) {
  const t = (Date.now() % 1200) / 1200;
  const strait = PROVINCE_LAYOUT.strait;
  if (!strait) return;

  for (const [id, province] of Object.entries(state.provinces || {})) {
    if (id === "strait") continue;
    const pos = PROVINCE_LAYOUT[id];
    if (!pos) continue;

    const stage = province.landingStage;
    const hasLanding = stage && stage !== "none";
    const controlled = province.controlStage === "china_control";
    if (!hasLanding && !controlled) continue;

    // v0.3.10: stage별 화살표 굵기/투명도 강화
    let lineWidth = 3;
    let alpha = 0.55;
    let dash = [10, 10];
    if (stage === "sea_superiority") { lineWidth = 3; alpha = 0.65; }
    else if (stage === "landing_attempt") { lineWidth = 4; alpha = 0.80; }
    else if (stage === "beachhead") { lineWidth = 5; alpha = 0.92; dash = [12, 6]; }
    else if (stage === "inland_expansion" || controlled) { lineWidth = 5.5; alpha = 1.0; dash = [14, 4]; }

    ctx.save();
    ctx.setLineDash(dash);
    ctx.lineDashOffset = -t * 32;
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = `rgba(255, 75, 86, ${alpha})`;

    const sx = strait.x * w;
    const sy = strait.y * h;
    const tx = pos.x * w;
    const ty = pos.y * h;

    // v0.5-a.2: 북부 거점(지룽/타이베이)은 본토 가로지르지 않고 북쪽 해상 anchor 경유
    const approachKey = PROVINCE_SEA_APPROACH[id];
    const anchor = approachKey ? SEA_ANCHORS[approachKey] : null;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    if (anchor) {
      // strait → north_sea_anchor → 거점 (이중 베지에)
      const ax = anchor.x * w;
      const ay = anchor.y * h;
      // strait → anchor 곡선 (북상)
      ctx.quadraticCurveTo((sx + ax) / 2 - 30, sy - 80, ax, ay);
      // anchor → 거점 곡선 (남하/동진)
      ctx.quadraticCurveTo((ax + tx) / 2, (ay + ty) / 2 - 20, tx, ty);
    } else {
      // 서해안 직접 진입 (기존 베지에)
      ctx.bezierCurveTo((sx + tx) / 2 - 70, (sy + ty) / 2, (sx + tx) / 2, (sy + ty) / 2 + 40, tx, ty);
    }
    ctx.stroke();

    // v0.3.10: stage별 상륙정 사이즈
    let craftSize = 0.85;
    if (stage === "landing_attempt") craftSize = 1.0;
    else if (stage === "beachhead") craftSize = 1.2;
    else if (stage === "inland_expansion" || controlled) craftSize = 1.35;

    // v0.5-a.2: 상륙정 위치 — anchor 경유면 anchor → 거점 사이에 배치
    let lx, ly;
    if (anchor) {
      const ax = anchor.x * w;
      const ay = anchor.y * h;
      lx = ax + (tx - ax) * (0.30 + 0.35 * t);
      ly = ay + (ty - ay) * (0.30 + 0.35 * t);
    } else {
      lx = sx + (tx - sx) * (0.35 + 0.35 * t);
      ly = sy + (ty - sy) * (0.35 + 0.35 * t);
    }
    drawShipIcon(ctx, lx, ly, "#ff6b76", controlled ? "통제" : "상륙", craftSize);
    ctx.restore();
  }
}

function drawAlliedIntervention(ctx, w, h, state, meta = {}) {
  const allied = state.persistent?.alliedIntervention;
  if (!allied?.active) return;

  const t = (Date.now() % 1500) / 1500;
  ctx.save();

  // 미국 항모전단: 대만 동쪽 해상에서 진입 (v0.3.10: 1.4배 사이즈 강화)
  const baseX = w * 0.84;
  const baseY = h * 0.30;
  drawFleetGroup(ctx, baseX, baseY, "🇺🇸 미 항모전단", "#5aa9ff", t, 1.4);

  drawMovingArrow(ctx, baseX - 18, baseY + 26, w * 0.67, h * 0.45, "#5aa9ff", t);

  if (allied.japanNavalSupport) {
    drawFleetGroup(ctx, w * 0.76, h * 0.14, "🇯🇵 일본 해상지원", "#8bd3ff", (t + 0.3) % 1, 1.15);
    drawMovingArrow(ctx, w * 0.75, h * 0.19, w * 0.61, h * 0.31, "#8bd3ff", t);
  }

  if (allied.koreaRearSupportActive) {
    ctx.setLineDash([8, 8]);
    ctx.lineDashOffset = -t * 24;
    ctx.strokeStyle = "rgba(120, 220, 180, .72)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(w * 0.82, h * 0.07);
    ctx.quadraticCurveTo(w * 0.90, h * 0.18, w * 0.79, h * 0.28);
    ctx.stroke();
    ctx.setLineDash([]);
    drawSupportNode(ctx, w * 0.84, h * 0.07, "🇰🇷 후방지원", "#4fd18b");
  }

  ctx.restore();
}

function drawMovingArrow(ctx, x1, y1, x2, y2, color, t) {
  ctx.save();
  ctx.setLineDash([9, 8]);
  ctx.lineDashOffset = -t * 30;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.quadraticCurveTo((x1 + x2) / 2 + 35, (y1 + y2) / 2 - 20, x2, y2);
  ctx.stroke();

  const ax = x1 + (x2 - x1) * (0.65 + 0.20 * t);
  const ay = y1 + (y2 - y1) * (0.65 + 0.20 * t);
  drawAircraftIcon(ctx, ax, ay, color);
  ctx.restore();
}

function drawFleetGroup(ctx, x, y, label, color, t, sizeMul = 1) {
  ctx.save();
  ctx.globalAlpha = 0.92;
  drawShipIcon(ctx, x, y, color, "CV", sizeMul);
  drawShipIcon(ctx, x - 34 * sizeMul, y + 22 * sizeMul, color, "DD", sizeMul * 0.85);
  drawShipIcon(ctx, x + 30 * sizeMul, y + 24 * sizeMul, color, "DD", sizeMul * 0.85);
  // 라벨 박스
  const lblW = 116 * Math.max(1, sizeMul * 0.95);
  ctx.fillStyle = "rgba(3, 12, 24, .78)";
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  roundRect(ctx, x - lblW / 2, y - 48 * sizeMul, lblW, 22, 9);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#eaf3ff";
  ctx.font = `700 ${Math.round(11 * Math.max(1, sizeMul * 0.95))}px system-ui`;
  ctx.textAlign = "center";
  ctx.fillText(label, x, y - 33 * sizeMul);
  ctx.restore();
}

function drawShipIcon(ctx, x, y, color, label = "", sizeMul = 1) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = "rgba(255,255,255,.85)";
  ctx.lineWidth = 1.2 * Math.max(1, sizeMul * 0.9);
  const s = sizeMul;
  ctx.beginPath();
  ctx.moveTo(x - 15 * s, y + 5 * s);
  ctx.lineTo(x + 12 * s, y + 5 * s);
  ctx.lineTo(x + 18 * s, y);
  ctx.lineTo(x + 4 * s, y - 6 * s);
  ctx.lineTo(x - 12 * s, y - 5 * s);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  if (label) {
    ctx.fillStyle = "#fff";
    ctx.font = `700 ${Math.round(9 * Math.max(1, s * 0.85))}px system-ui`;
    ctx.textAlign = "center";
    ctx.fillText(label, x, y - 10 * s);
  }
  ctx.restore();
}

function drawAircraftIcon(ctx, x, y, color, sizeMul = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.25);
  ctx.scale(sizeMul, sizeMul);
  ctx.fillStyle = color;
  ctx.strokeStyle = "rgba(255,255,255,.85)";
  ctx.lineWidth = 1 / sizeMul;
  ctx.beginPath();
  ctx.moveTo(16, 0);
  ctx.lineTo(-8, -5);
  ctx.lineTo(-2, 0);
  ctx.lineTo(-8, 5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawSupportNode(ctx, x, y, label, color) {
  ctx.save();
  ctx.fillStyle = "rgba(3, 12, 24, .76)";
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  roundRect(ctx, x - 50, y - 13, 100, 26, 12);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#eaf3ff";
  ctx.font = "700 11px system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x, y);
  ctx.textBaseline = "alphabetic";
  ctx.restore();
}


function drawProvinces(ctx, w, h, state, meta) {
  const pulseT = (Date.now() % 1400) / 1400; // 0~1 주기
  const recentBattles = new Set(state.persistent?.recentBattles || []);

  for (const [id, pos] of Object.entries(PROVINCE_LAYOUT)) {
    const province = state.provinces[id];
    const x = pos.x * w;
    const y = pos.y * h;
    const selected = meta.selectedProvince === id;
    const color = colorForProvince(province);

    // v0.3.10: 최근 전투 pulse — 외곽에 빨간 파동 링
    if (recentBattles.has(id)) {
      const p = Math.sin(pulseT * Math.PI * 2); // -1..1
      const ringR = pos.r + 14 + p * 6;
      const alpha = 0.42 + p * 0.20;
      ctx.save();
      ctx.strokeStyle = `rgba(255, 110, 110, ${Math.max(0.18, alpha)})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(x, y, ringR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.shadowBlur = selected ? 24 : 12;
    ctx.shadowColor = selected ? "rgba(255, 220, 110, .75)" : color.glow;
    ctx.fillStyle = color.fill;
    ctx.strokeStyle = selected ? "#ffd66b" : color.stroke;
    ctx.lineWidth = selected ? 4 : 2;

    ctx.beginPath();
    ctx.arc(x, y, pos.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (province?.landingStage && province.landingStage !== "none") {
      const idx = Math.max(0, Object.keys(STAGE_LABELS).indexOf(province.landingStage));
      ctx.strokeStyle = "rgba(255, 91, 104, .80)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(x, y, pos.r + 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (idx / 4));
      ctx.stroke();
    }

    // v0.3.10: 교두보 링 — beachhead 이상이면 외곽 빨간 링 추가
    const ctrl = province?.controlStage;
    if (ctrl === "beachhead_established" || ctrl === "china_control") {
      const ringR = pos.r + 5;
      const ringColor = ctrl === "china_control" ? "rgba(255, 65, 80, .95)" : "rgba(255, 105, 115, .82)";
      const ringWidth = ctrl === "china_control" ? 3.5 : 3;
      ctx.save();
      ctx.strokeStyle = ringColor;
      ctx.lineWidth = ringWidth;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(x, y, ringR, 0, Math.PI * 2);
      ctx.stroke();
      // 두 번째 더 안쪽 링으로 강조
      if (ctrl === "china_control") {
        ctx.strokeStyle = "rgba(255, 90, 105, .55)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, ringR + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.shadowBlur = 0;
    // v0.5-a.1: 지도 이미지에 한글 라벨이 이미 인쇄돼 있으므로 코드 라벨 생략.
    // 예외: strait(바다라 이미지 라벨이 옅음), hualien(이미지에 라벨 없음).
    const showCodeLabel = id === "strait" || id === "hualien";
    if (showCodeLabel) {
      ctx.fillStyle = "#f4f8ff";
      ctx.font = id === "strait" ? "800 18px system-ui" : "700 13px system-ui";
      ctx.textAlign = "center";
      ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
      ctx.shadowBlur = 4;
      ctx.fillText(pos.label, x, y + (id === "hualien" ? pos.r + 14 : 5));
      ctx.shadowBlur = 0;
    }

    // ── 상태 배지 ──
    // v0.5-a.1: 안정 방어 + 상륙 없음일 땐 배지 숨김 (지도 가독성).
    // 위협 상태 (contested / beachhead / landing 등)만 배지 표시.
    const isThreat = (province?.landingStage && province.landingStage !== "none")
                  || (province?.controlStage && province.controlStage !== "stable_defense");
    const stageLabel = isThreat
      ? (province?.landingStage && province.landingStage !== "none"
          ? STAGE_LABELS[province.landingStage]
          : CONTROL_LABELS[province?.controlStage] || "")
      : "";

    if (stageLabel) {
      const badge = badgeStyleFor(province);
      ctx.font = "700 11px system-ui";
      const tw = ctx.measureText(stageLabel).width;
      const bw = tw + 16;
      const bh = 20;
      const bx = x - bw / 2;
      const by = y + pos.r + 8;

      ctx.fillStyle = badge.bg;
      ctx.strokeStyle = badge.border;
      ctx.lineWidth = 1.5;
      roundRect(ctx, bx, by, bw, bh, 9);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = badge.text;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(stageLabel, x, by + bh / 2 + 0.5);
      ctx.textBaseline = "alphabetic";
    }
    ctx.restore();
  }
}

function badgeStyleFor(province) {
  if (!province) return { bg: "rgba(80,80,80,.7)", text: "#fff", border: "rgba(255,255,255,.3)" };
  if (province.type === "sea_zone") {
    return { bg: "rgba(74,143,220,.65)", text: "#eaf3ff", border: "rgba(150,200,255,.7)" };
  }

  // 상륙 진행 중이면 그게 더 시급한 정보
  const stage = province.landingStage;
  if (stage === "inland_expansion") return { bg: "rgba(255,75,88,.92)", text: "#fff", border: "rgba(255,180,190,.95)" };
  if (stage === "beachhead")        return { bg: "rgba(255,120,90,.88)", text: "#fff", border: "rgba(255,200,160,.95)" };
  if (stage === "landing_attempt")  return { bg: "rgba(255,160,75,.88)", text: "#1f1208", border: "rgba(255,210,150,.95)" };
  if (stage === "sea_superiority")  return { bg: "rgba(240,200,90,.85)", text: "#1f1208", border: "rgba(255,232,150,.95)" };

  // 상륙 미진행 → 통제 단계
  switch (province.controlStage) {
    case "china_control":          return { bg: "rgba(255,75,88,.92)", text: "#fff", border: "rgba(255,180,190,.95)" };
    case "beachhead_established":  return { bg: "rgba(255,120,90,.88)", text: "#fff", border: "rgba(255,200,160,.95)" };
    case "coastal_breach":         return { bg: "rgba(255,160,75,.85)", text: "#1f1208", border: "rgba(255,210,150,.95)" };
    case "contested":              return { bg: "rgba(240,200,90,.78)", text: "#1f1208", border: "rgba(255,232,150,.9)" };
    case "stable_defense":
    default:                       return { bg: "rgba(79,209,139,.82)", text: "#0c2218", border: "rgba(140,235,180,.95)" };
  }
}

function drawTopHud(ctx, w, h, state, meta) {
  ctx.save();
  ctx.fillStyle = "rgba(3, 9, 17, .54)";
  roundRect(ctx, 22, 20, w - 44, 58, 16);
  ctx.fill();

  ctx.fillStyle = "#eaf3ff";
  ctx.font = "800 20px system-ui";
  ctx.textAlign = "left";
  ctx.fillText(meta.turnText || `TURN ${state.turn}`, 44, 56);

  ctx.font = "13px system-ui";
  ctx.fillStyle = "rgba(232, 244, 255, .68)";
  ctx.fillText(`주공축: ${meta.axisName || "-"}   |   방어중점: ${meta.focusName || "-"}`, 190, 56);

  ctx.textAlign = "right";
  ctx.fillStyle = state.outcome ? "#ffd66b" : "rgba(232,244,255,.8)";
  ctx.fillText(state.outcome ? "작전 종료" : (state.persistent?.alliedIntervention?.active ? "동맹 개입 후 교전" : "작전 진행 중"), w - 44, 56);
  ctx.restore();
}

function colorForProvince(province) {
  if (!province) return { fill: "rgba(120,120,120,.5)", stroke: "#aaa", glow: "rgba(255,255,255,.2)" };
  if (province.id === "strait" || province.type === "sea_zone") {
    return { fill: "rgba(74, 143, 220, .18)", stroke: "rgba(122, 190, 255, .66)", glow: "rgba(90,169,255,.28)" };
  }
  if (province.controlStage === "china_control") {
    return { fill: "rgba(255, 75, 88, .55)", stroke: "rgba(255, 120, 132, .95)", glow: "rgba(255,75,88,.45)" };
  }
  if (province.controlStage === "beachhead_established" || province.landingStage === "beachhead") {
    return { fill: "rgba(245, 184, 75, .50)", stroke: "rgba(255, 217, 130, .95)", glow: "rgba(245,184,75,.4)" };
  }
  if (province.controlStage === "coastal_breach" || province.controlStage === "contested") {
    return { fill: "rgba(255, 145, 75, .42)", stroke: "rgba(255, 176, 100, .9)", glow: "rgba(255,145,75,.3)" };
  }
  // v0.5-a.1: 안정 방어 상태는 매우 옅게 — 지도 라벨이 잘 보이도록
  return { fill: "rgba(73, 180, 135, .14)", stroke: "rgba(111, 235, 176, .45)", glow: "rgba(79,209,139,.15)" };
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}
