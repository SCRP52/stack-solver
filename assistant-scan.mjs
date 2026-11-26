import { createStableCardGate } from './assistant-scan-logic.mjs?v=39';
import { cardRotation, findCardCorners, projectGlyph } from './assistant-corners.mjs?v=41';
import { cardIndexShapes } from './assistant-card-shapes.mjs?v=40';

const $ = id => document.getElementById(id);
const capture = $('assistant-frame');
const ocrCrop = document.createElement('canvas');
ocrCrop.width = 32;
ocrCrop.height = 40;

const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const suitSymbols = { S: '♠', H: '♥', D: '♦', C: '♣' };
const suits = Object.keys(suitSymbols);
const suitCanvases = makeSuitTemplates();
const rankCanvases = makeRankTemplates();
const stretchedRanks = Object.fromEntries(ranks.map(rank => [
  rank, rankCanvases[rank].map(({ mask }) => ({ mask: stretchRankWidth(mask) })),
]));
let stream;
let wakeLock;
let frameTimer;
let originalThemeColor;
const stableCardGate = createStableCardGate();
const scanIntervalMs = 55;
let lastVideoTime = -1;
let scanning = false;
const previousScanPixels = new Map();

function isEnglish() { try { return localStorage.getItem('stack-converter-language') === 'en'; } catch { return false; } }
function text(vi, en) { return isEnglish() ? en : vi; }

function makeSuitTemplates() {
  const result = {};
  for (const suit of suits) {
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
    const masks = [maskOf(canvas.getContext('2d').getImageData(0, 0, 32, 40)), decodeShape(suit)];
    for (const font of ['Georgia', 'Times New Roman', 'Arial', 'Verdana', 'Tahoma']) {
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
    result[rank] = [decodeShape(rank)];
    for (const font of ['Georgia', 'Times New Roman', 'Arial', 'Tahoma']) {
      for (const weight of [400, 700]) {
        const canvas = document.createElement('canvas');
        canvas.width = 144; canvas.height = 112;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#000';
        ctx.font = `${weight} 80px "${font}"`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(rank, 72, 56);
        result[rank].push(maskOf(ctx.getImageData(0, 0, 144, 112)));
      }
    }
  }
  return result;
}

function decodeShape(label) {
  const bytes = atob(cardIndexShapes[label]);
  const mask = new Uint8Array(32 * 40);
  for (let i = 0; i < mask.length; i++) mask[i] = (bytes.charCodeAt(i >> 3) >> (i & 7)) & 1;
  return { mask };
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
  if (right < left || bottom < top) return { mask: new Uint8Array(32 * 40) };
  const w = right - left + 1, h = bottom - top + 1;
  const scale = Math.min(26 / w, 34 / h);
  const outW = Math.max(1, Math.round(w * scale)), outH = Math.max(1, Math.round(h * scale));
  const normalized = new Uint8Array(32 * 40);
  const ox = Math.floor((32 - outW) / 2), oy = Math.floor((40 - outH) / 2);
  for (let y = 0; y < outH; y++) for (let x = 0; x < outW; x++) {
    const sx = left + Math.min(w - 1, Math.floor(x / scale));
    const sy = top + Math.min(h - 1, Math.floor(y / scale));
    normalized[(oy + y) * 32 + ox + x] = mask[sy * width + sx];
  }
  return { mask: normalized };
}

function maskRows(mask) {
  const rows = new Uint32Array(40);
  for (let y = 0; y < 40; y++) for (let x = 0; x < 32; x++) rows[y] |= mask[y * 32 + x] << x;
  return rows;
}

function countBits(value) {
  value -= (value >>> 1) & 0x55555555;
  value = (value & 0x33333333) + ((value >>> 2) & 0x33333333);
  return Math.imul((value + (value >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
}

function compareMasks(a, b) {
  let best = 0;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    let intersection = 0, union = 0;
    for (let y = 2; y < 38; y++) {
      const ai = a[y] & 0x3ffffffc;
      const shifted = dx < 0 ? b[y + dy] << -dx : b[y + dy] >>> dx;
      const bi = shifted & 0x3ffffffc;
      intersection += countBits(ai & bi);
      union += countBits(ai | bi);
    }
    if (union) best = Math.max(best, intersection / union);
  }
  return best;
}

function glyphMask(frameWidth, glyph, { cos, sin }, mirrored) {
  const pixels = new Set();
  for (const part of glyph.parts ?? [glyph]) for (const pixel of part.pixels) pixels.add(pixel);
  const mask = new Uint8Array(32 * 40);
  const scale = Math.min(26 / glyph.w, 34 / glyph.h);
  const width = Math.round(glyph.w * scale), height = Math.round(glyph.h * scale);
  const left = Math.floor((32 - width) / 2), top = Math.floor((40 - height) / 2);
  for (let y = 0; y < height; y++) {
    const viewY = glyph.y + Math.min(glyph.h - 1, Math.floor(y / scale));
    for (let x = 0; x < width; x++) {
      const offset = Math.min(glyph.w - 1, Math.floor(x / scale));
      const viewX = mirrored ? glyph.right - offset : glyph.x + offset;
      const sourceX = Math.round(viewX * cos - viewY * sin);
      const sourceY = Math.round(viewX * sin + viewY * cos);
      if (sourceX >= 0 && sourceX < frameWidth && pixels.has(sourceY * frameWidth + sourceX)) {
        mask[(top + y) * 32 + left + x] = 1;
      }
    }
  }
  return mask;
}

function matchShapes(sample, templates, labels) {
  const rows = maskRows(sample);
  return labels.map(label => ({
    label,
    score: Math.max(...templates[label].map(template => compareMasks(rows, template.rows ??= maskRows(template.mask)))),
  })).sort((a, b) => b.score - a.score);
}

function stretchRankWidth(mask) {
  let left = 32, right = -1;
  for (let i = 0; i < mask.length; i++) if (mask[i]) {
    left = Math.min(left, i % 32);
    right = Math.max(right, i % 32);
  }
  if (right < left) return mask;
  const normalized = new Uint8Array(mask.length);
  const width = right - left + 1;
  for (let y = 0; y < 40; y++) for (let x = 0; x < 24; x++) {
    normalized[y * 32 + x + 4] = mask[y * 32 + left + Math.floor(x * width / 24)];
  }
  return normalized;
}

function readRankText(mask) {
  if (typeof window.OCRAD !== 'function') return null;
  const context = ocrCrop.getContext('2d');
  const image = context.createImageData(32, 40);
  for (let i = 0; i < mask.length; i++) {
    const value = mask[i] ? 0 : 255;
    image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = value;
    image.data[i * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  try {
    return window.OCRAD(ocrCrop, { scale: 4, filters: ['upper_num_only'] }).trim().toUpperCase();
  } catch {
    return null;
  }
}

function readRank(mask, glyph) {
  const narrow = glyph.w < glyph.h * .5;
  const matches = narrow
    ? matchShapes(stretchRankWidth(mask), stretchedRanks, ranks)
    : matchShapes(mask, rankCanvases, ranks);
  const [best, next] = matches;
  if (glyph.double && best.label !== '10') return null;
  const gap = best.score - next.score;
  const strongShape = glyph.double
    ? best.score >= .53 && gap >= .105
    : best.score >= .60 && gap >= .07;
  const matchesText = best.score >= .49 && gap >= .02 && !strongShape && readRankText(mask) === best.label;
  if (!strongShape && !matchesText) return null;
  // A pip from the main artwork can sit directly over another pip in the same suit.
  // Compare the first shape against both alphabets before treating it as a rank.
  const [pip] = matchShapes(mask, suitCanvases, suits);
  return pip.score > Math.max(.66, best.score + .055) ? null : best;
}

function readSuit(mask, rank, suit) {
  // Rank and suit shapes can remain clear even when white balance changes the perceived ink color.
  const matches = matchShapes(mask, suitCanvases, suits);
  const [best, next] = matches;
  const redSuit = label => label === 'D' || label === 'H';
  const sameInk = rank.red === suit.red;
  const gap = best.score - next.score;
  const clubDiamond = (best.label === 'C' && next.label === 'D') || (best.label === 'D' && next.label === 'C');
  if (sameInk && redSuit(best.label) !== suit.red) return null;
  const minGap = clubDiamond ? .047 : sameInk && redSuit(next.label) !== suit.red ? .019 : .028;
  return best.score >= .59 && gap >= minGap ? best : null;
}

function readCornerView(width, { rank, suit, rotation, leftEdge, rightEdge, upperEdge }) {
  const sideEdge = Math.min(leftEdge, rightEdge);
  if (Math.min(sideEdge, upperEdge) > .5) return null;
  const bestSuit = readSuit(glyphMask(width, suit, rotation, false), rank, suit);
  if (!bestSuit) return null;

  // Near a distinct left or right card edge, we know which way the index was printed.
  let bestRank;
  const edgeDifference = leftEdge - rightEdge;
  if (Math.abs(edgeDifference) >= .28) {
    bestRank = readRank(glyphMask(width, rank, rotation, edgeDifference > 0), rank);
  } else {
    const normal = readRank(glyphMask(width, rank, rotation, false), rank);
    const mirrored = readRank(glyphMask(width, rank, rotation, true), rank);
    if (normal && mirrored && normal.label !== mirrored.label && Math.abs(normal.score - mirrored.score) < .1) return null;
    bestRank = normal && (!mirrored || normal.score >= mirrored.score) ? normal : mirrored;
  }
  if (!bestRank) return null;
  if ((sideEdge > .4 || (upperEdge > .6 && sideEdge > .15)) && (bestRank.score < .78 || bestSuit.score < .78)) return null;
  return { rank: bestRank.label, suit: bestSuit.label, score: (bestRank.score + bestSuit.score) / 2 };
}

function readCorner(width, corner) {
  const primary = readCornerView(width, corner);
  const { rank, suit, rotation } = corner;
  const dx = (rank.x + rank.right - suit.x - suit.right) / 2;
  const dy = (suit.y + suit.bottom - rank.y - rank.bottom) / 2;
  const correction = Math.atan2(dx, dy);
  if (Math.abs(correction) < .12 || Math.abs(correction) > .51 || (primary && primary.score > .85)) return primary;

  const straightened = cardRotation(rotation.angle + correction);
  const alternate = readCornerView(width, {
    ...corner, rotation: straightened,
    rank: projectGlyph(rank, width, straightened),
    suit: projectGlyph(suit, width, straightened),
  });
  if (!primary || !alternate) return primary ?? alternate;
  const same = primary.rank === alternate.rank && primary.suit === alternate.suit;
  if (!same && Math.abs(primary.score - alternate.score) < .075) return null;
  return primary.score >= alternate.score ? primary : alternate;
}

function cornerMotion(previous, current, { width, height }, { rank, suit, rotation }) {
  if (previous?.length !== current.length) return Infinity;
  const margin = Math.max(2, Math.round(rank.h * .15));
  const left = Math.min(rank.x, suit.x) - margin;
  const right = Math.max(rank.right, suit.right) + margin;
  const { cos, sin } = rotation;
  let difference = 0, samples = 0;
  for (let y = rank.y - margin; y <= suit.bottom + margin; y++) {
    for (let x = left; x <= right; x++) {
      const sourceX = Math.round(x * cos - y * sin), sourceY = Math.round(x * sin + y * cos);
      if (sourceX < 0 || sourceX >= width || sourceY < 0 || sourceY >= height) continue;
      const i = sourceY * width + sourceX;
      difference += Math.abs(previous[i] - current[i]);
      samples++;
    }
  }
  return samples ? difference / samples : Infinity;
}

export function scanCardFrame(frame, history) {
  const { width, height } = frame;
  const context = frame.getContext('2d', { willReadFrequently: true });
  const { corners, gray, paper } = findCardCorners(context.getImageData(0, 0, width, height));
  const previous = history.get(width);
  history.clear();
  history.set(width, gray);

  let best = null;
  for (const corner of corners) {
    const card = readCorner(width, corner);
    if (!card) continue;
    const score = corner.quality + card.score * .45;
    if (!best || score > best.score) best = { card, corner, score };
  }
  return {
    card: best?.card ?? null,
    motion: best ? cornerMotion(previous, gray, frame, best.corner) : 0,
    paper,
  };
}

function updateStatus(vi, en) {
  const status = $('assistant-scan-status');
  const message = text(vi, en);
  if (status.textContent !== message) status.textContent = message;
}

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
  lastVideoTime = -1;
  previousScanPixels.clear();
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
      video: { facingMode: { ideal: 'user' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } },
    });
    const video = $('assistant-video');
    video.srcObject = stream;
    await video.play();
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
  const now = performance.now();
  const video = $('assistant-video');
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0 &&
      video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const scale = Math.min(1, 480 / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));
    if (capture.width !== width || capture.height !== height) {
      capture.width = width;
      capture.height = height;
      previousScanPixels.clear();
      stableCardGate.reset();
    }
    const ctx = capture.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, capture.width, capture.height);
    const { card: found, motion: stillness, paper } = scanCardFrame(capture, previousScanPixels);
    const accepted = stableCardGate.update(found, stillness, now);
    const result = $('assistant-card-result');
    const name = accepted ? `${accepted.rank}${suitSymbols[accepted.suit]}` : '';
    if (result.textContent !== name) result.textContent = name;
    if (accepted) {
      updateStatus('Đã nhận diện', 'Card recognized');
    } else {
      if (!paper) updateStatus('Đưa cả số và chất ở góc bài vào khung hình', 'Bring both the corner rank and suit into view');
      else if (stillness > 7 || found) updateStatus('Giữ lá bài yên khoảng 0,2 giây', 'Hold the card still for about 0.2 seconds');
      else updateStatus('Đọc hạng và chất ở góc bài', 'Reading rank and suit from the card corner');
    }
  }
  frameTimer = setTimeout(scanLoop, Math.max(0, scanIntervalMs - (performance.now() - now)));
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

