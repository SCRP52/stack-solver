import { alignedCornerMotion, cardCornerPose, createStableCardGate } from './assistant-scan-logic.mjs?v=46';
import { cardRotation, findCardCorners, projectGlyph } from './assistant-corners.mjs?v=41';
import { cardIndexShapes } from './assistant-card-shapes.mjs?v=40';
import { choosePacketFace } from './assistant-packet.mjs?v=42';
import { createScanLog } from './assistant-diagnostics.mjs?v=46';
import { cameraScanRegion, isFullHd, previewScanRegion, requireFullHd } from './assistant-camera.mjs?v=46';

const $ = id => document.getElementById(id);
const capture = $('assistant-frame');
const preview = $('assistant-preview');
const guide = $('assistant-scan-guide');
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
let pendingPermissionTimer;
let runNumber = 0;
let scanLog;
let phaseKey;
let lastFrameAt;
let firstFrameSeen;
let scanRegion;
let ownedFullscreen;
let originalThemeColor;
const stableCardGate = createStableCardGate({ maxMotion: 22 });
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
  let bestRank, mirrored;
  const edgeDifference = leftEdge - rightEdge;
  if (Math.abs(edgeDifference) >= .28) {
    mirrored = edgeDifference > 0;
    bestRank = readRank(glyphMask(width, rank, rotation, mirrored), rank);
  } else {
    const normal = readRank(glyphMask(width, rank, rotation, false), rank);
    const flipped = readRank(glyphMask(width, rank, rotation, true), rank);
    if (normal && flipped && normal.label !== flipped.label && Math.abs(normal.score - flipped.score) < .1) return null;
    bestRank = normal && (!flipped || normal.score >= flipped.score) ? normal : flipped;
    const even = normal && flipped && normal.label === flipped.label && Math.abs(normal.score - flipped.score) < .05;
    mirrored = even ? null : bestRank === flipped;
  }
  if (!bestRank) return null;
  if ((sideEdge > .4 || (upperEdge > .6 && sideEdge > .15)) && (bestRank.score < .78 || bestSuit.score < .78)) return null;
  return { rank: bestRank.label, suit: bestSuit.label, score: (bestRank.score + bestSuit.score) / 2, mirrored };
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

export function scanCardFrame(frame, history) {
  const { width, height } = frame;
  const context = frame.getContext('2d', { willReadFrequently: true });
  const { corners, gray, paper } = findCardCorners(context.getImageData(0, 0, width, height));
  const reads = [];
  for (const corner of corners) {
    const card = readCorner(width, corner);
    if (!card) continue;
    const score = corner.quality + card.score * .45;
    reads.push({ card, corner: { ...corner, mirrored: card.mirrored }, score });
  }
  const { best, ambiguous } = choosePacketFace(reads, { gray, width, height });
  const pose = best ? cardCornerPose(best.corner) : undefined;
  const previous = history.get(width);
  if (best) history.set(width, { gray, pose });
  else if (ambiguous || !paper) history.clear();
  return {
    card: best?.card ?? null,
    pose,
    motion: pose ? alignedCornerMotion(previous?.gray, gray, frame, previous?.pose, pose) : 0,
    paper,
    ambiguous,
    corners: corners.length,
    candidates: reads.length,
  };
}

function updateStatus(vi, en) {
  const status = $('assistant-scan-status');
  const message = text(vi, en);
  if (status.textContent !== message) status.textContent = message;
}

function updateGuide() {
  const { width, height } = preview.getBoundingClientRect();
  if (!scanRegion || !width || !height) return;
  const box = previewScanRegion(scanRegion, scanRegion.sourceWidth, scanRegion.sourceHeight, width, height);
  for (const [name, value] of Object.entries(box)) guide.style[name] = `${value}px`;
  guide.hidden = false;
}

async function requestWakeLock(session) {
  if (!navigator.wakeLock?.request) {
    scanLog?.event('screen.wake-lock', { result: 'unavailable' });
    return;
  }
  try {
    const lock = await navigator.wakeLock.request('screen');
    if (session !== runNumber) {
      await lock.release();
      return;
    }
    if (wakeLock) await wakeLock.release().catch(() => {});
    wakeLock = lock;
    scanLog.event('screen.wake-lock', { result: 'active' });
  } catch (error) {
    if (session === runNumber) scanLog?.event('screen.wake-lock', { result: error.name });
  }
}

function stopTracks(reason) {
  if (!scanning) return;
  scanning = false;
  runNumber++;
  clearTimeout(frameTimer);
  clearTimeout(pendingPermissionTimer);
  scanLog?.flush();
  scanLog?.event('session.stop', { reason, receivedFrames: firstFrameSeen });
  if (stream) for (const track of stream.getTracks()) track.stop();
  stream = undefined;
  $('assistant-video').srcObject = null;
  if (wakeLock) wakeLock.release().catch(() => {});
  wakeLock = undefined;
  if (ownedFullscreen && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  ownedFullscreen = false;
  try { screen.orientation?.unlock(); } catch {}
  stableCardGate.reset();
  lastVideoTime = -1;
  previousScanPixels.clear();
  scanRegion = undefined;
  guide.hidden = true;
  guide.classList.remove('recognized');
  document.body.classList.remove('assistant-scanning');
  if (originalThemeColor !== undefined) document.querySelector('meta[name="theme-color"]').content = originalThemeColor;
  originalThemeColor = undefined;
  $('assistant-live').hidden = true;
  $('assistant-setup').hidden = false;
  $('assistant-card-result').textContent = '';
  $('assistant-start').disabled = false;
  $('assistant-log-download').disabled = !scanLog;
}

function enterFullscreen(session, orientation) {
  if (!document.documentElement.requestFullscreen) {
    scanLog.event('screen.fullscreen', { result: 'unavailable' });
    return;
  }
  const log = scanLog;
  document.documentElement.requestFullscreen().then(async () => {
    if (session !== runNumber) {
      if (!scanning && document.fullscreenElement) await document.exitFullscreen().catch(() => {});
      return;
    }
    ownedFullscreen = Boolean(document.fullscreenElement);
    log.event('screen.fullscreen', { result: ownedFullscreen ? 'active' : 'inactive' });
    if (!screen.orientation?.lock || !ownedFullscreen) return;
    try {
      await screen.orientation.lock(orientation);
      if (session === runNumber) log.event('screen.orientation', { result: 'active', type: screen.orientation.type });
    } catch (error) {
      if (session === runNumber) log.event('screen.orientation', { result: error.name });
    }
  }).catch(error => {
    if (session === runNumber) log.event('screen.fullscreen', { result: error.name });
  });
}

function cameraError(session, stage, error) {
  if (session !== runNumber) return;
  const code = error.name ?? 'Error';
  scanLog.event('camera.error', { stage, code, constraint: error.constraint });
  stopTracks(code);
  const messages = {
    CameraUnavailable: ['Trình duyệt này không mở được camera. Hãy mở trang trực tiếp trong trình duyệt.', 'Camera access is unavailable. Open this page in your browser.'],
    NotAllowedError: ['Ứng dụng chưa có quyền dùng camera. Kiểm tra quyền camera rồi thử lại.', 'Camera permission was not granted. Check the permission and try again.'],
    NotReadableError: ['Camera đang bận hoặc không đọc được hình. Thử thoát app đang dùng camera.', 'The camera is busy or unable to deliver video. Close other apps using it and try again.'],
    NotFoundError: ['Không tìm thấy camera.', 'No camera was found.'],
    OverconstrainedError: ['Trình duyệt không cấp được camera Full HD (1920 × 1080).',
      'The browser could not provide a Full HD (1920 × 1080) camera stream.'],
    CameraBelowFullHd: ['Hình từ camera thấp hơn Full HD (1920 × 1080). Xem nhật ký để biết độ phân giải thực tế.',
      'The camera returned video below Full HD (1920 × 1080). See the scan log for its actual resolution.'],
    TrackEnded: ['Camera đã ngắt. Bấm Bắt đầu quét để kết nối lại.', 'The camera disconnected. Start scanning to reconnect.'],
  };
  const message = messages[code] ?? ['Không mở được hình từ camera. Bạn có thể tải nhật ký để kiểm tra.', 'Could not start camera video. Download the scan log to diagnose it.'];
  $('assistant-camera-note').textContent = text(...message);
}

async function start() {
  if (scanning) return;
  const session = ++runNumber;
  const orientation = $('assistant-orientation').value;
  const video = $('assistant-video');
  scanLog = createScanLog();
  scanLog.event('session.start', {
    orientation,
    minimumResolution: '1920 × 1080',
    secureContext: window.isSecureContext,
    embedded: self !== top,
    viewport: [window.innerWidth, window.innerHeight],
    frameCallback: typeof video.requestVideoFrameCallback === 'function',
  });
  scanning = true;
  phaseKey = '';
  firstFrameSeen = false;
  ownedFullscreen = false;
  $('assistant-start').disabled = true;
  const themeColor = document.querySelector('meta[name="theme-color"]');
  originalThemeColor = themeColor.content;
  themeColor.content = '#000000';
  document.body.classList.add('assistant-scanning');
  $('assistant-setup').hidden = true;
  $('assistant-live').hidden = false;
  $('assistant-card-result').textContent = '';
  $('assistant-camera-note').textContent = '';
  updateStatus('Đang mở camera…', 'Opening camera…');
  if (!navigator.mediaDevices?.getUserMedia) {
    cameraError(session, 'permission', { name: 'CameraUnavailable' });
    return;
  }

  let stage = 'permission';
  try {
    enterFullscreen(session, orientation);
    pendingPermissionTimer = setTimeout(() => {
      if (session !== runNumber || stream) return;
      scanLog.event('camera.waiting-permission');
      updateStatus('Đang chờ quyền dùng camera', 'Waiting for camera permission');
    }, 6500);
    const input = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'user' } } });
    if (session !== runNumber) {
      for (const track of input.getTracks()) track.stop();
      return;
    }
    clearTimeout(pendingPermissionTimer);
    stream = input;
    const track = input.getVideoTracks()[0];
    if (!track) {
      cameraError(session, stage, { name: 'NotFoundError' });
      return;
    }
    stage = 'resolution';
    updateStatus('Đang đặt camera Full HD…', 'Setting the camera to Full HD…');
    const nativeResize = navigator.mediaDevices.getSupportedConstraints?.().resizeMode;
    await requireFullHd(track, nativeResize);
    if (session !== runNumber) return;
    const { width, height, frameRate, facingMode, resizeMode } = track.getSettings?.() ?? {};
    scanLog.event('camera.opened', { width, height, frameRate, facingMode, resizeMode, muted: track.muted });
    stage = 'playback';
    track.addEventListener('ended', () => cameraError(session, 'stream', { name: 'TrackEnded' }), { once: true });
    video.muted = true;
    video.playsInline = true;
    video.srcObject = input;
    lastFrameAt = performance.now();
    scanLoop();
    void requestWakeLock(session);
    await video.play();
    if (session === runNumber) scanLog.event('video.playing', { readyState: video.readyState });
  } catch (error) {
    cameraError(session, stage, error);
  }
}

function scanPhase(phase, details = {}) {
  const key = phase + (details.card ?? '');
  if (key === phaseKey) return;
  phaseKey = key;
  scanLog?.event('scan.phase', { phase, ...details });
}

function scanLoop() {
  if (!scanning) return;
  const now = performance.now();
  const video = $('assistant-video');
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0 &&
      video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    lastFrameAt = now;
    const { videoWidth: width, videoHeight: height } = video;
    if (scanRegion?.sourceWidth !== width || scanRegion?.sourceHeight !== height) {
      const region = cameraScanRegion(width, height);
      scanLog?.event(firstFrameSeen ? 'video.resized' : 'video.first-frame', {
        width, height, scanWidth: region.scanWidth, scanHeight: region.scanHeight,
        region: { x: region.x, y: region.y, width: region.width, height: region.height },
      });
      firstFrameSeen = true;
      if (!isFullHd(width, height)) {
        cameraError(runNumber, 'video-frame', { name: 'CameraBelowFullHd' });
        return;
      }
      scanRegion = { ...region, sourceWidth: width, sourceHeight: height };
      capture.width = region.scanWidth;
      capture.height = region.scanHeight;
      updateGuide();
      previousScanPixels.clear();
      stableCardGate.reset();
    }
    try {
      const ctx = capture.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(video, scanRegion.x, scanRegion.y, scanRegion.width, scanRegion.height, 0, 0, capture.width, capture.height);
      const { card: found, pose, motion, paper, ambiguous, corners, candidates } = scanCardFrame(capture, previousScanPixels);
      const accepted = stableCardGate.update(found, motion, now, { pose, allowMiss: paper && !ambiguous });
      const result = $('assistant-card-result');
      const name = accepted ? accepted.rank + suitSymbols[accepted.suit] : '';
      if (result.textContent !== name) result.textContent = name;
      guide.classList.toggle('recognized', Boolean(accepted));
      const phase = accepted ? (found ? 'recognized' : 'held') : ambiguous ? 'overlap' :
        !paper ? 'no-paper' : found ? 'settling' : !corners ? 'no-index' : 'unreadable-index';
      scanPhase(phase, { corners, candidates, card: accepted ? accepted.rank + accepted.suit : undefined,
        motion: found ? (Number.isFinite(motion) ? Math.round(motion) : 'new-or-shifted') : undefined });
      scanLog?.frame(phase, performance.now() - now);
      if (accepted) updateStatus('Đã nhận diện', 'Card recognized');
      else if (ambiguous) updateStatus('Ép vuông bộ bài để lộ một góc', 'Square the deck so only one corner is visible');
      else if (found) updateStatus('Giữ lá bài yên khoảng 0,2 giây', 'Hold the card still for about 0.2 seconds');
      else updateStatus('Đưa góc có số và chất vào khung', 'Place the rank and suit corner inside the box');
    } catch (error) {
      $('assistant-card-result').textContent = '';
      guide.classList.remove('recognized');
      stableCardGate.reset();
      scanPhase('processing-error', { code: error.name });
      updateStatus('Không xử lý được khung hình', 'Could not process the camera frame');
    }
  } else if (now - lastFrameAt >= 1600) {
    $('assistant-card-result').textContent = '';
    guide.classList.remove('recognized');
    stableCardGate.reset();
    scanPhase('no-frames', { readyState: video.readyState, paused: video.paused, trackMuted: stream?.getVideoTracks()[0]?.muted });
    updateStatus('Camera chưa gửi khung hình', 'Waiting for video frames from the camera');
  }
  frameTimer = setTimeout(scanLoop, Math.max(0, scanIntervalMs - (performance.now() - now)));
}

function downloadLog() {
  if (!scanLog) return;
  const contents = scanLog.serialize();
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'thisdeck-assistant-log-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

$('assistant-start').addEventListener('click', start);
$('assistant-stop').addEventListener('click', () => stopTracks('user'));
$('assistant-log-download')?.addEventListener('click', downloadLog);
new ResizeObserver(updateGuide).observe(preview);
document.addEventListener('fullscreenchange', () => {
  if (!scanning || document.fullscreenElement || !ownedFullscreen) return;
  ownedFullscreen = false;
  scanLog?.event('screen.fullscreen-exit');
  if (firstFrameSeen) stopTracks('fullscreen-exit');
});
document.addEventListener('visibilitychange', () => {
  if (!scanning) return;
  scanLog?.event('screen.visibility', { state: document.visibilityState });
  if (document.visibilityState === 'visible' && stream) void requestWakeLock(runNumber);
});
window.addEventListener('hashchange', () => { if (!location.hash.startsWith('#assistant')) stopTracks('navigation'); });
window.addEventListener('pagehide', () => stopTracks('pagehide'));

