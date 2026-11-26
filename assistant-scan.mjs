import { createStableCardGate, meanPixelDifference } from './assistant-scan-logic.mjs';

const $ = id => document.getElementById(id);
const rankCrop = document.createElement('canvas');
const suitCrop = document.createElement('canvas');
const ocrCrop = document.createElement('canvas');
const capture = document.getElementById('assistant-frame');
rankCrop.width = suitCrop.width = 144;
rankCrop.height = 128;
suitCrop.height = 128;
ocrCrop.width = rankCrop.width;
ocrCrop.height = rankCrop.height;
capture.width = 480;
capture.height = 640;

const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const suitNames = { S: ['Bích', 'Spades'], H: ['Cơ', 'Hearts'], D: ['Rô', 'Diamonds'], C: ['Chuồn', 'Clubs'] };
const suitSymbols = { S: '♠', H: '♥', D: '♦', C: '♣' };
const suitCanvases = makeSuitTemplates();
const rankCanvases = makeRankTemplates();
let stream;
let wakeLock;
let frameTimer;
let originalThemeColor;
const stableCardGate = createStableCardGate();
let lastScanAt = 0;
let scanning = false;
let previousScanPixels;

function isEnglish() { try { return localStorage.getItem('stack-converter-language') === 'en'; } catch { return false; } }
function text(vi, en) { return isEnglish() ? en : vi; }

function makeSuitTemplates() {
  const result = {};
  for (const suit of Object.keys(suitNames)) {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 40;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.beginPath();
    if (suit === 'H') {
      ctx.moveTo(16, 37); ctx.bezierCurveTo(12, 32, 2, 24, 2, 14); ctx.bezierCurveTo(2, 5, 12, 2, 16, 12);
      ctx.bezierCurveTo(20, 2, 30, 5, 30, 14); ctx.bezierCurveTo(30, 24, 20, 32, 16, 37);
    } else if (suit === 'D') {
      ctx.moveTo(16, 2); ctx.lineTo(30, 20); ctx.lineTo(16, 38); ctx.lineTo(2, 20); ctx.closePath();
    } else if (suit === 'C') {
      ctx.arc(16, 10, 8, 0, Math.PI * 2); ctx.moveTo(17, 26); ctx.arc(9, 19, 8, 0, Math.PI * 2); ctx.moveTo(31, 19); ctx.arc(23, 19, 8, 0, Math.PI * 2);
      ctx.moveTo(18, 24); ctx.lineTo(21, 37); ctx.lineTo(11, 37); ctx.lineTo(14, 24); ctx.closePath();
    } else {
      ctx.moveTo(16, 2); ctx.bezierCurveTo(11, 10, 2, 16, 2, 24); ctx.bezierCurveTo(2, 32, 12, 32, 16, 24);
      ctx.bezierCurveTo(20, 32, 30, 32, 30, 24); ctx.bezierCurveTo(30, 16, 21, 10, 16, 2); ctx.closePath();
      ctx.moveTo(14, 25); ctx.lineTo(11, 39); ctx.lineTo(21, 39); ctx.lineTo(18, 25); ctx.closePath();
    }
    ctx.fill();
    const masks = [maskOf(canvas.getContext('2d').getImageData(0, 0, 32, 40))];
    for (const font of ['serif', 'Georgia', 'Times New Roman', 'Arial', 'sans-serif']) {
      const glyph = document.createElement('canvas');
      glyph.width = 32; glyph.height = 40;
      const glyphCtx = glyph.getContext('2d');
      glyphCtx.fillStyle = '#000';
      glyphCtx.font = `36px "${font}"`;
      glyphCtx.textAlign = 'center';
      glyphCtx.textBaseline = 'middle';
      glyphCtx.fillText(suitSymbols[suit], 16, 20);
      masks.push(maskOf(glyphCtx.getImageData(0, 0, 32, 40)));
    }
    result[suit] = masks;
  }
  return result;
}

function makeRankTemplates() {
  const result = {};
  for (const rank of ranks) {
    result[rank] = [];
    for (const font of ['serif', 'Georgia', 'Times New Roman', 'Arial', 'sans-serif']) {
      const canvas = document.createElement('canvas');
      canvas.width = 32; canvas.height = 40;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#000';
      ctx.font = `${rank === '10' ? 27 : 36}px "${font}"`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(rank, 16, 20);
      result[rank].push(maskOf(ctx.getImageData(0, 0, 32, 40)));
    }
  }
  return result;
}

function maskOf(imageData) {
  const { data, width, height } = imageData;
  const mask = new Uint8Array(width * height);
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const hit = data[i + 3] > 20 && data[i] < 170;
    if (hit) { mask[y * width + x] = 1; left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
  }
  if (right < left || bottom < top) return { mask: new Uint8Array(width * height), width, height, left, top, right, bottom };
  const w = right - left + 1, h = bottom - top + 1;
  const scale = Math.min(26 / w, 34 / h);
  const outW = Math.max(1, Math.round(w * scale)), outH = Math.max(1, Math.round(h * scale));
  const normalized = new Uint8Array(width * height);
  const ox = Math.floor((width - outW) / 2), oy = Math.floor((height - outH) / 2);
  for (let y = 0; y < outH; y++) for (let x = 0; x < outW; x++) {
    const sx = left + Math.min(w - 1, Math.floor(x / scale));
    const sy = top + Math.min(h - 1, Math.floor(y / scale));
    normalized[(oy + y) * width + ox + x] = mask[sy * width + sx];
  }
  return { mask: normalized, width, height, left: ox, top: oy, right: ox + outW - 1, bottom: oy + outH - 1 };
}

function normalizedMask(imageData, largestOnly = true) {
  const { data, width, height } = imageData;
  const raw = new Uint8Array(width * height);
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const redInk = r > 55 && r > g * 1.28 && r > b * 1.15 && g < 175;
    const blackInk = (r + g + b) / 3 < 135;
    if (redInk || blackInk) { raw[y * width + x] = 1; left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
  }
  if (right <= left || bottom <= top) return null;
  if (largestOnly) {
    const visited = new Uint8Array(raw.length);
    const queue = new Int32Array(raw.length);
    let largest = [];
    for (let i = 0; i < raw.length; i++) {
      if (!raw[i] || visited[i]) continue;
      let head = 0, tail = 0;
      queue[tail++] = i; visited[i] = 1;
      while (head < tail) {
        const at = queue[head++], px = at % width, py = Math.floor(at / width);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx, ny = py + dy, ni = ny * width + nx;
          if ((dx || dy) && nx >= 0 && nx < width && ny >= 0 && ny < height && raw[ni] && !visited[ni]) {
            visited[ni] = 1; queue[tail++] = ni;
          }
        }
      }
      if (tail > largest.length) largest = Array.from(queue.subarray(0, tail));
    }
    if (largest.length < 12) return null;
    raw.fill(0);
    left = width; top = height; right = -1; bottom = -1;
    for (const i of largest) {
      raw[i] = 1;
      const x = i % width, y = Math.floor(i / width);
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
  }
  const w = right - left + 1, h = bottom - top + 1;
  const scale = Math.min(26 / w, 34 / h);
  const outW = Math.max(1, Math.round(w * scale)), outH = Math.max(1, Math.round(h * scale));
  const out = new Uint8Array(32 * 40);
  const ox = Math.floor((32 - outW) / 2), oy = Math.floor((40 - outH) / 2);
  for (let y = 0; y < outH; y++) for (let x = 0; x < outW; x++) {
    const sx = left + Math.min(w - 1, Math.floor(x / scale));
    const sy = top + Math.min(h - 1, Math.floor(y / scale));
    out[(oy + y) * 32 + ox + x] = raw[sy * width + sx];
  }
  return out;
}

function compareMasks(a, b) {
  let best = 0;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    let intersection = 0, union = 0;
    for (let y = 2; y < 38; y++) for (let x = 2; x < 30; x++) {
      const ai = a[y * 32 + x];
      const bx = x + dx, by = y + dy;
      const bi = bx >= 0 && bx < 32 && by >= 0 && by < 40 ? b[by * 32 + bx] : 0;
      if (ai && bi) intersection++;
      if (ai || bi) union++;
    }
    if (union) best = Math.max(best, intersection / union);
  }
  return best;
}

function suitShapeDescriptor(mask) {
  const rows = Array.from({ length: 40 }, (_, y) => {
    let width = 0, runs = 0, inside = false;
    for (let x = 0; x < 32; x++) {
      const on = Boolean(mask[y * 32 + x]);
      if (on) width++;
      if (on && !inside) runs++;
      inside = on;
    }
    return { width, runs };
  });
  const first = rows.findIndex(row => row.width);
  const widest = Math.max(...rows.map(row => row.width));
  const total = rows.reduce((sum, row) => sum + row.width, 0);
  const early = rows.slice(first, first + 7);
  const middle = rows[first + 8];
  const tail = rows.slice(30, 39);
  return {
    earlyWidth: Math.max(...early.map(row => row.width)) / Math.max(1, widest),
    earlyArea: early.reduce((sum, row) => sum + row.width, 0) / Math.max(1, total),
    middleRuns: middle?.runs ?? 0,
    tailWidth: Math.max(...tail.map(row => row.width)) / Math.max(1, widest),
  };
}

function scoreSuit(ctx, x, y, w, h) {
  const pixels = ctx.getImageData(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  const sample = normalizedMask(pixels);
  if (!sample) return null;
  let best = null, score = 0;
  const matches = [];
  for (const [suit, mask] of Object.entries(suitCanvases)) {
    const current = Math.max(...mask.map(template => compareMasks(sample, template.mask)));
    matches.push({ suit, score: current });
    if (current > score) { score = current; best = suit; }
  }
  const ranked = matches.sort((a, b) => b.score - a.score);
  let resolved = best;
  const gap = score - (ranked[1]?.score ?? 0);
  const blackPair = new Set([ranked[0]?.suit, ranked[1]?.suit]);
  const shape = suitShapeDescriptor(sample);
  if (gap < .06 && blackPair.has('S') && blackPair.has('C')) resolved = shape.earlyArea >= .125 ? 'C' : 'S';
  return { suit: resolved, score, gap, ranked, shape };
}

function identifySuit(ctx, x, y, w, h) {
  const result = scoreSuit(ctx, x, y, w, h);
  if (!result) return null;
  const blackScore = Math.max(result.ranked.find(match => match.suit === 'S')?.score ?? 0, result.ranked.find(match => match.suit === 'C')?.score ?? 0);
  const redScore = Math.max(result.ranked.find(match => match.suit === 'H')?.score ?? 0, result.ranked.find(match => match.suit === 'D')?.score ?? 0);
  const blackShapeClear = blackScore >= .62 && blackScore >= redScore + .04;
  if (blackShapeClear) return { suit: result.shape.earlyArea >= .125 ? 'C' : 'S', score: blackScore };
  if (result.score < .68 || result.gap < .06) return null;
  return { suit: result.suit, score: result.score };
}

function normalizeRank(raw) {
  let value = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  value = value.replace(/IO|1O|I0|LO/g, '10');
  if (value.includes('10')) return '10';
  if (value === 'O' || value === '0') return 'Q';
  const rank = value.match(/[AJQK2-9]/);
  return rank?.[0] ?? null;
}

function scoreRank(canvas) {
  const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < pixels.height; y++) for (let x = 0; x < pixels.width; x++) {
    if (x < 3 || y < 3 || x >= pixels.width - 3 || y >= pixels.height - 3) {
      const i = (y * pixels.width + x) * 4;
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 255;
    }
  }
  const sample = normalizedMask(pixels, false);
  if (!sample) return null;
  return ranks.map(rank => ({ rank, score: Math.max(...rankCanvases[rank].map(mask => compareMasks(sample, mask.mask))) }))
    .sort((a, b) => b.score - a.score);
}

function identifyRank(canvas) {
  const matches = scoreRank(canvas);
  return matches && matches[0].score >= .4 && matches[0].score - matches[1].score >= .035 ? matches[0] : null;
}

function prepareCardCrops(frameWidth, frameHeight) {
  const side = Math.min(frameWidth * .48, frameHeight * .54);
  const x = Math.round((frameWidth - side) / 2);
  const y = Math.round((frameHeight - side * 1.34) / 2);
  const w = Math.round(side);
  const h = Math.min(Math.round(side * 1.34), frameHeight - y);
  if (h < 80) return null;
  const rankCtx = rankCrop.getContext('2d', { willReadFrequently: true });
  const suitCtx = suitCrop.getContext('2d', { willReadFrequently: true });
  rankCtx.fillStyle = '#fff'; rankCtx.fillRect(0, 0, rankCrop.width, rankCrop.height);
  rankCtx.drawImage(capture, x, y, w * .74, h * .48, 0, 0, rankCrop.width, rankCrop.height);
  suitCtx.fillStyle = '#fff'; suitCtx.fillRect(0, 0, suitCrop.width, suitCrop.height);
  suitCtx.drawImage(capture, x, y + h * .5, w * .74, h * .48, 0, 0, suitCrop.width, suitCrop.height);
  return { rankCtx, suitCtx };
}

function paperRatio(canvas) {
  const data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
  let paper = 0;
  for (let i = 0; i < data.length; i += 4) {
    const low = Math.min(data[i], data[i + 1], data[i + 2]);
    const high = Math.max(data[i], data[i + 1], data[i + 2]);
    if (low > 175 && high - low < 48) paper++;
  }
  return paper / (data.length / 4);
}

function motionScore() {
  const current = new Uint8Array((rankCrop.width * rankCrop.height + suitCrop.width * suitCrop.height));
  let offset = 0;
  for (const canvas of [rankCrop, suitCrop]) {
    const data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < data.length; i += 4) current[offset++] = Math.round((data[i] * 3 + data[i + 1] * 6 + data[i + 2]) / 10);
  }
  const difference = meanPixelDifference(previousScanPixels, current);
  previousScanPixels = current;
  return difference;
}

function recognizePreparedCard() {
  const suitCtx = suitCrop.getContext('2d', { willReadFrequently: true });

  let rank = identifyRank(rankCrop)?.rank ?? null;
  if (!rank) {
    try {
      ocrCrop.getContext('2d').drawImage(rankCrop, 0, 0);
      rank = normalizeRank(window.OCRAD(ocrCrop, { scale: 4, filters: ['upper_num_only'] }));
    } catch {}
  }
  if (!rank || !ranks.includes(rank)) return null;
  const suit = identifySuit(suitCtx, 0, 0, suitCrop.width, suitCrop.height);
  if (!suit) return null;
  return { rank, suit: suit.suit, score: suit.score };
}

export function recognizeCard(frameCtx, frameWidth, frameHeight) {
  const crops = prepareCardCrops(frameWidth, frameHeight);
  return crops ? recognizePreparedCard() : null;
}

function updateStatus(vi, en) { $('assistant-scan-status').textContent = text(vi, en); }

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return false;
  try { wakeLock = await navigator.wakeLock.request('screen'); return true; } catch { return false; }
}

function stopTracks() {
  clearTimeout(frameTimer);
  frameTimer = undefined;
  if (stream) for (const track of stream.getTracks()) track.stop();
  stream = undefined;
  if (wakeLock) wakeLock.release().catch(() => {});
  wakeLock = undefined;
  scanning = false;
  stableCardGate.reset();
  previousScanPixels = undefined;
  document.body.classList.remove('assistant-scanning');
  if (originalThemeColor !== undefined) document.querySelector('meta[name="theme-color"]').content = originalThemeColor;
  originalThemeColor = undefined;
  $('assistant-live').hidden = true;
  $('assistant-setup').hidden = false;
  $('assistant-card-result').textContent = '';
  $('assistant-start').disabled = false;
}

async function start() {
  if (scanning) return;
  $('assistant-start').disabled = true;
  $('assistant-camera-note').textContent = text('Đang mở camera…', 'Opening camera…');
  let fullscreenRequest;
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('cameraUnavailable');
    const orientation = $('assistant-orientation').value;
    fullscreenRequest = document.documentElement.requestFullscreen?.();
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'user' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 15, max: 24 } },
    });
    const video = $('assistant-video');
    video.srcObject = stream;
    await video.play();
    const dimension = 480 / Math.max(video.videoWidth || 4, video.videoHeight || 3);
    capture.width = Math.max(1, Math.round(video.videoWidth * dimension));
    capture.height = Math.max(1, Math.round(video.videoHeight * dimension));
    if (fullscreenRequest) await fullscreenRequest.catch(() => {});
    try { await screen.orientation?.lock(orientation); } catch {}
    const screenHeld = await requestWakeLock();
    scanning = true;
    document.body.classList.add('assistant-scanning');
    const themeColor = document.querySelector('meta[name="theme-color"]');
    originalThemeColor = themeColor.content;
    themeColor.content = '#000000';
    $('assistant-setup').hidden = true;
    $('assistant-live').hidden = false;
    $('assistant-card-result').textContent = '';
    updateStatus(screenHeld ? 'Đang quét góc bài' : 'Đang quét · máy chưa hỗ trợ khóa màn hình', screenHeld ? 'Scanning card corner' : 'Scanning · screen wake lock unavailable');
    scanLoop();
  } catch (error) {
    if (fullscreenRequest) await fullscreenRequest.catch(() => {});
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    try { screen.orientation?.unlock(); } catch {}
    if (stream) for (const track of stream.getTracks()) track.stop();
    stream = undefined;
    $('assistant-start').disabled = false;
    const vi = error.message === 'cameraUnavailable' ? 'Máy không hỗ trợ camera trong trình duyệt này.' : 'Không mở được camera. Hãy cấp quyền rồi thử lại.';
    const en = error.message === 'cameraUnavailable' ? 'This browser does not support camera access.' : 'Could not open the camera. Allow camera access and try again.';
    $('assistant-camera-note').textContent = text(vi, en);
  }
}

function scanLoop() {
  if (!scanning) return;
  const video = $('assistant-video');
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && performance.now() - lastScanAt >= 240) {
    lastScanAt = performance.now();
    const ctx = capture.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, capture.width, capture.height);
    const crops = prepareCardCrops(capture.width, capture.height);
    const paper = crops ? Math.min(paperRatio(rankCrop), paperRatio(suitCrop)) : 0;
    const stillness = crops ? motionScore() : Infinity;
    const found = paper >= .55 && stillness <= 7 ? recognizePreparedCard() : null;
    const accepted = stableCardGate.update(found, stillness, performance.now());
    if (accepted) {
        const name = `${accepted.rank}${suitSymbols[accepted.suit]}`;
        $('assistant-card-result').textContent = name;
        updateStatus('Đã nhận diện', 'Card recognized');
    } else {
      $('assistant-card-result').textContent = '';
      if (stillness > 7) updateStatus('Giữ lá bài yên khoảng nửa giây', 'Hold the card still for about half a second');
      else if (paper < .55) updateStatus('Đưa góc lá bài sáng vào giữa camera', 'Center the light card corner in the camera view');
      else updateStatus('Đọc hạng và chất ở góc bài', 'Reading rank and suit from the card corner');
    }
  }
  frameTimer = setTimeout(scanLoop, 80);
}

$('assistant-start').addEventListener('click', start);
$('assistant-stop').addEventListener('click', () => {
  stopTracks();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  try { screen.orientation?.unlock(); } catch {}
});
document.addEventListener('fullscreenchange', () => { if (scanning && !document.fullscreenElement) stopTracks(); });
document.addEventListener('visibilitychange', async () => {
  if (!scanning || document.visibilityState !== 'visible') return;
  if (wakeLock) wakeLock.release().catch(() => {});
  wakeLock = undefined;
  await requestWakeLock();
});
window.addEventListener('hashchange', () => { if (!location.hash.startsWith('#assistant')) stopTracks(); });

