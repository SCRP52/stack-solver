import test from 'node:test';
import assert from 'node:assert/strict';
import { agreeOnCard, alignedCornerMotion, cardCornerPose, createCardMemory, createStableCardGate, meanPixelDifference } from '../assistant-scan-logic.mjs';
import { cardRotation, findCardCorners } from '../assistant-corners.mjs';
import { choosePacketFace, hasCoveringEdge } from '../assistant-packet.mjs';
import { createScanLog } from '../assistant-diagnostics.mjs';
import { cameraScanSize, enableContinuousFocus, isFullHd, previewFrameBounds, requireFullHd } from '../assistant-camera.mjs';
import { brightenCardShadows, cardFrameLuminance, sharpenCardFrame, sourceSuitContrast } from '../assistant-detail.mjs';

const card = { rank: 'Q', suit: 'S' };

test('soft ink detail gains contrast while a flat image stays unchanged', () => {
  const width = 29, height = 21;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([224, 224, 224, 255], i * 4);
  const frame = { data, width, height };
  assert.deepEqual(sharpenCardFrame(frame, cardFrameLuminance(frame)).data, data);

  const point = 10 * width + 14;
  for (let x = -4; x <= 4; x++) {
    const delta = Math.abs(x) * 8;
    data.set([172 + delta, 132 + delta, 132 + delta, 255], (point + x) * 4);
  }
  const gray = cardFrameLuminance(frame);
  const detailed = sharpenCardFrame(frame, gray).data;
  assert.ok(detailed[point * 4 + 1] < data[point * 4 + 1]);
  assert.equal(detailed[point * 4] - detailed[point * 4 + 1], 40);
  const suit = { x: 14, right: 14, y: 10, bottom: 10, h: 1, pixels: [point] };
  const corner = { suit, rotation: cardRotation(0) };
  assert.ok(sourceSuitContrast(gray, width, height, corner) < .45);
});

test('requests native Full HD and retries only a transposed resolution', async () => {
  const attempts = [];
  const error = Object.assign(new Error('width'), { name: 'OverconstrainedError', constraint: 'width' });
  const portraitCamera = { async applyConstraints(settings) {
    attempts.push(settings);
    if (attempts.length === 1) throw error;
  } };
  await requireFullHd(portraitCamera, true);
  assert.deepEqual(attempts.map(settings => [settings.width.min, settings.height.min, settings.resizeMode.exact]),
    [[1920, 1080, 'none'], [1080, 1920, 'none']]);

  const refused = [];
  await assert.rejects(requireFullHd({ async applyConstraints(settings) {
    refused.push(settings);
    throw error;
  } }, false), { name: 'OverconstrainedError' });
  assert.equal(refused.length, 2);
  assert.ok(refused.every(settings => !('resizeMode' in settings)));
  assert.equal(isFullHd(1920, 1080), true);
  assert.equal(isFullHd(1080, 1920), true);
  assert.equal(isFullHd(1080, 1440), false);
  assert.equal(isFullHd(1920, 720), false);
});

test('the full-frame scan and guide preserve the video aspect ratio in both orientations', () => {
  assert.deepEqual(cameraScanSize(1080, 1920), { scanWidth: 576, scanHeight: 1024 });
  assert.deepEqual(cameraScanSize(1920, 1080), { scanWidth: 1024, scanHeight: 576 });
  assert.deepEqual(cameraScanSize(3840, 2160), { scanWidth: 1024, scanHeight: 576 });
  assert.deepEqual(previewFrameBounds(1080, 1920, 360, 480), { left: 45, top: 0, width: 270, height: 480 });
  assert.deepEqual(previewFrameBounds(1920, 1080, 480, 360), { left: 0, top: 45, width: 480, height: 270 });
});

test('autofocus retains Full HD when the browser accepts or separates camera controls', async () => {
  const video = { width: { min: 1920 }, height: { min: 1080 }, resizeMode: { exact: 'none' } };
  for (const separate of [false, true]) {
    let mode = 'none';
    const requests = [];
    const track = {
      getSettings: () => ({ width: 1920, height: 1080, focusMode: mode }),
      getCapabilities: () => ({ focusMode: ['none', 'continuous'] }),
      getConstraints: () => video,
      async applyConstraints(constraints) {
        requests.push(constraints);
        if (separate && constraints.width) throw Object.assign(new Error(), { name: 'OverconstrainedError' });
        mode = constraints.focusMode?.exact;
      },
    };
    assert.deepEqual(await enableContinuousFocus(track), { result: 'active', mode: 'continuous' });
    assert.deepEqual(requests, separate ? [{ ...video, focusMode: { exact: 'continuous' } }, { focusMode: { exact: 'continuous' } }]
      : [{ ...video, focusMode: { exact: 'continuous' } }]);
  }
  assert.deepEqual(await enableContinuousFocus({ getSettings: () => ({ focusMode: 'none' }) }), { result: 'unavailable', mode: 'none' });
});

test('autofocus rolls back a control that drops the camera below Full HD', async () => {
  const video = { width: { min: 1920 }, height: { min: 1080 } };
  let mode = 'none';
  const track = {
    getSettings: () => mode === 'continuous' ? { width: 1280, height: 720, focusMode: mode } : { width: 1920, height: 1080, focusMode: mode },
    getCapabilities: () => ({ focusMode: ['continuous'] }),
    getConstraints: () => video,
    async applyConstraints(constraints) { mode = constraints.focusMode?.exact ?? 'none'; },
  };
  assert.deepEqual(await enableContinuousFocus(track), { result: 'skipped-below-full-hd', mode: 'none' });
  assert.ok(isFullHd(track.getSettings().width, track.getSettings().height));
});

function packetScene({ x, y, artwork = false } = {}) {
  const width = 165, height = 125;
  const gray = new Uint8Array(width * height).fill(218);
  if (x !== undefined) for (let row = artwork ? 36 : 10; row < 112; row++) gray[row * width + x] = 156;
  if (y !== undefined) for (let column = artwork ? 74 : 18; column < 135; column++) gray[y * width + column] = 156;
  return { gray, width, height };
}

function packetIndex(x, y, mirrored = false) {
  return {
    rank: { x, right: x + 10, y, bottom: y + 19, h: 20 },
    suit: { x: x + 1, right: x + 9, y: y + 24, bottom: y + 34 },
    rotation: cardRotation(0),
    mirrored,
  };
}

test('a layer edge suppresses the rear card even when its index has the highest score', () => {
  const rear = { card, corner: packetIndex(40, 25), score: .9 };
  const bottom = { card: { rank: '6', suit: 'D' }, corner: packetIndex(64, 26), score: .8 };
  const frame = packetScene({ x: 57 });
  assert.equal(hasCoveringEdge(frame, rear.corner), true);
  assert.equal(hasCoveringEdge(frame, bottom.corner), false);
  assert.equal(choosePacketFace([rear, bottom], frame).best, bottom);
  assert.deepEqual(choosePacketFace([rear], frame), { best: null, ambiguous: true });
});

test('detects a horizontal layer edge and the reflected edge, while ignoring short artwork lines', () => {
  assert.equal(hasCoveringEdge(packetScene({ y: 66 }), packetIndex(40, 25)), true);
  assert.equal(hasCoveringEdge(packetScene({ x: 56 }), packetIndex(61, 25, true)), true);
  assert.equal(hasCoveringEdge(packetScene({ x: 57, artwork: true }), packetIndex(40, 25)), false);
});

test('holds ambiguous adjacent ranks blank and accepts an isolated or repeated read', () => {
  const read = { card, corner: packetIndex(40, 25), score: .9 };
  const nearby = { card: { rank: '6', suit: 'D' }, corner: packetIndex(63, 26), score: .75 };
  const frame = packetScene();
  assert.deepEqual(choosePacketFace([read, nearby], frame), { best: null, ambiguous: true });
  assert.equal(choosePacketFace([read, { ...nearby, card }], frame).best, read);
  assert.equal(choosePacketFace([read], frame).best, read);
});

test('diagnostic export keeps startup and aggregates scan results in a bounded JSON file', () => {
  let time = 0;
  const log = createScanLog({ now: () => time, maxEntries: 5 });
  log.event('session.start', { orientation: 'portrait' });
  log.event('screen.fullscreen');
  log.event('camera.opened', { width: 1080 });
  log.event('video.first-frame', { width: 1080, height: 1920 });
  log.frame('no-index', 10);
  time = 1234;
  log.frame('recognized', 30);
  log.event('session.stop', { reason: 'user' });
  const file = JSON.parse(log.serialize());
  assert.deepEqual(file.entries.slice(0, 3).map(entry => entry.event), ['session.start', 'camera.opened', 'video.first-frame']);
  assert.equal(file.discardedEntries, 1);
  const summary = file.entries.find(entry => entry.event === 'scan.summary');
  assert.deepEqual(summary.outcomes, { 'no-index': 1, recognized: 1 });
  assert.equal(summary.averageProcessingMs, 20);
});

function cornerFrame({ x = 30, y = 30, brightness = 225, mirrored = false, covered = false, ten = false } = {}) {
  const width = 180, height = 140, data = new Uint8ClampedArray(width * height * 4);
  function fill(left, top, right, bottom, color) {
    for (let yy = top; yy < bottom; yy++) for (let xx = left; xx < right; xx++) {
      const column = mirrored ? width - xx - 1 : xx;
      data.set([color, color, color, 255], (yy * width + column) * 4);
    }
  }
  fill(0, 0, width, height, 21);
  fill(x, y, x + 45, y + 62, brightness);
  if (ten) {
    fill(x + 4, y + 4, x + 5, y + 16, 24);
    fill(x + 7, y + 4, x + 12, y + 16, 24);
    fill(x + 8, y + 5, x + 11, y + 15, brightness);
  } else {
    fill(x + 5, y + 4, x + 12, y + 16, 24);
  }
  if (!covered) fill(x + 5, y + 19, x + 12, y + 27, 24);
  return { data, width, height };
}

test('finds a small off-center index on a darker card and in its reflection', () => {
  const normal = findCardCorners(cornerFrame({ x: 110, y: 69, brightness: 142 })).corners[0];
  const mirrored = findCardCorners(cornerFrame({ x: 110, y: 69, brightness: 142, mirrored: true })).corners[0];
  assert.deepEqual([normal.rank.x, normal.rank.y, normal.suit.y], [115, 73, 88]);
  assert.equal(mirrored.rank.right, 179 - normal.rank.x);
  assert.ok(normal.leftEdge < normal.rightEdge);
  assert.ok(mirrored.rightEdge < mirrored.leftEdge);
});

test('a dim corner can be recovered independently of a much brighter background', () => {
  const frame = cornerFrame({ x: 52, y: 47, brightness: 106 });
  for (let y = 0; y < frame.height; y++) {
    for (let x = 120; x < frame.width; x++) frame.data.fill(232, (y * frame.width + x) * 4, (y * frame.width + x) * 4 + 3);
  }
  const old = findCardCorners(frame);
  const normalized = brightenCardShadows(frame, old.gray);
  assert.ok(normalized);
  assert.ok(!old.corners.some(({ rank }) => rank.x === 57));
  const candidate = findCardCorners(normalized).corners.find(({ rank }) => rank.x === 57);
  assert.ok(candidate);
  assert.equal(candidate.suit.y, 66);
  const background = (20 * frame.width + 160) * 4;
  assert.equal(normalized.data[background], frame.data[background]);
});

test('finds the intact index when a finger covers the margin on one side', () => {
  const frame = cornerFrame();
  for (let y = 30; y < 70; y++) {
    for (let x = 43; x < 72; x++) frame.data.set([155, 104, 89, 255], (y * frame.width + x) * 4);
  }
  const mustFind = findCardCorners(frame).corners.find(({ rank, suit }) => rank.x === 35 && rank.y === 34 && suit.y === 49);
  assert.ok(mustFind?.partial);
});

test('does not propose a card when the suit index is hidden', () => {
  assert.deepEqual(findCardCorners(cornerFrame({ covered: true })).corners, []);
});

test('groups a one-pixel 1 with the printed zero in either mirror direction', () => {
  for (const mirrored of [false, true]) {
    const { corners } = findCardCorners(cornerFrame({ ten: true, mirrored }));
    const upright = corners.filter(corner => corner.rotation.angle === 0);
    assert.equal(upright.length, 1);
    assert.equal(upright[0].rank.double, true);
    assert.equal(upright[0].rank.w, 8);
  }
});

function turnFrame({ data, width, height }, angle) {
  const result = new Uint8ClampedArray(data.length);
  const centerX = (width - 1) / 2, centerY = (height - 1) / 2;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sourceX = Math.round((x - centerX) * cos + (y - centerY) * sin + centerX);
    const sourceY = Math.round(-(x - centerX) * sin + (y - centerY) * cos + centerY);
    if (sourceX >= 0 && sourceX < width && sourceY >= 0 && sourceY < height) {
      const source = (sourceY * width + sourceX) * 4;
      result.set(data.subarray(source, source + 4), (y * width + x) * 4);
    }
  }
  return { data: result, width, height };
}

test('finds the rank above the suit after a quarter turn, half turn, or diagonal turn', () => {
  for (const angle of [Math.PI / 2, -Math.PI / 2, Math.PI, Math.PI / 4, Math.PI / 8]) {
    const { corners } = findCardCorners(turnFrame(cornerFrame({ x: 62, y: 43 }), angle));
    const match = corners.find(({ rank, suit, rotation }) =>
      rank.h > suit.h && Math.cos(rotation.angle - angle) > .92);
    assert.ok(match, `No matching card corner at ${angle} radians`);
  }
});

test('estimates warm lighting from the card paper before classifying black ink', () => {
  const frame = cornerFrame();
  for (let i = 0; i < frame.data.length; i += 4) {
    frame.data[i] += 37;
    frame.data[i + 1] += 13;
    frame.data[i + 2] += 3;
  }
  const [corner] = findCardCorners(frame).corners;
  assert.equal(corner.rank.red, false);
  assert.equal(corner.suit.red, false);
});

test('accepts either camera orientation and rejects conflicting reads', () => {
  assert.equal(agreeOnCard(card, null), card);
  assert.equal(agreeOnCard(null, card), card);
  assert.equal(agreeOnCard(card, { ...card }), card);
  assert.equal(agreeOnCard(card, { ...card, rank: '9' }), null);
  assert.equal(agreeOnCard(card, { ...card, suit: 'C' }), null);
  assert.equal(agreeOnCard(null, null), null);
});

test('requires at least three matching frames over 200 ms', () => {
  const gate = createStableCardGate();
  assert.equal(gate.update(card, Infinity, 0), null);
  assert.equal(gate.update(card, 0, 80), null);
  assert.equal(gate.update(card, 0, 199), null);
  assert.deepEqual(gate.update(card, 0, 200), card);
  gate.reset();
  assert.equal(gate.update(card, Infinity, 0), null);
  assert.equal(gate.update(card, 0, 200), null);
  assert.deepEqual(gate.update(card, 0, 250), card);
});

test('a moving hand resets the candidate and hides a previously accepted card', () => {
  const gate = createStableCardGate();
  gate.update(card, 0, 0);
  gate.update(card, 0, 80);
  assert.deepEqual(gate.update(card, 0, 200), card);
  assert.equal(gate.update(card, 18, 260), null);
  assert.equal(gate.update(card, 18, 330), null);
  assert.equal(gate.update(card, 0, 420), null);
  assert.equal(gate.update(card, 0, 529), null);
  assert.deepEqual(gate.update(card, 0, 530), card);
});

test('a card change starts a fresh stability window', () => {
  const gate = createStableCardGate();
  gate.update(card, 0, 0);
  gate.update(card, 0, 80);
  const other = { rank: '7', suit: 'H' };
  assert.equal(gate.update(other, 0, 180), null);
  assert.equal(gate.update(other, 0, 310), null);
  assert.deepEqual(gate.update(other, 0, 380), other);
});

test('index motion compensates for a small translation and rejects a large shift or changed image', () => {
  const width = 120, height = 100;
  function scene(x, y) {
    const gray = new Uint8Array(width * height).fill(231);
    for (let row = y; row < y + 34; row++) {
      for (let col = x; col < x + 10; col++) gray[row * width + col] = (col === x + 4 || row === y + 8) ? 15 : 92;
    }
    return gray;
  }
  const from = cardCornerPose(packetIndex(35, 28));
  const to = cardCornerPose(packetIndex(44, 25));
  const previous = scene(35, 28);
  assert.equal(alignedCornerMotion(previous, scene(44, 25), { width, height }, from, to), 0);
  assert.ok(alignedCornerMotion(previous, new Uint8Array(previous.length), { width, height }, from, to) > 22);
  const shifted = cardCornerPose(packetIndex(65, 28));
  assert.equal(alignedCornerMotion(previous, scene(65, 28), { width, height }, from, shifted), Infinity);
});

test('the vote survives one unreadable frame, but repeated misses or overlap clear the votes', () => {
  const gate = createStableCardGate();
  const oneMiss = { allowMiss: true };
  gate.update(card, Infinity, 0);
  gate.update(card, 0, 70);
  assert.equal(gate.update(null, 0, 140, oneMiss), null);
  assert.equal(gate.update(card, 0, 210), card);
  assert.equal(gate.update(null, 0, 270, oneMiss), null);
  assert.equal(gate.update(null, 0, 330, oneMiss), null);
  assert.equal(gate.update(card, 0, 400), null);
  gate.update(card, 0, 470);
  assert.equal(gate.update(card, 0, 600), card);
  assert.equal(gate.update(null, 0, 650), null);
  gate.update(card, 0, 700);
  gate.update(card, 0, 800);
  assert.equal(gate.update(card, 0, 900), card);
  assert.equal(gate.update({ rank: 'J', suit: 'H' }, 0, 970), null);
});

test('a brief wrong reading cannot beat the majority of matching rank-and-suit votes', () => {
  const gate = createStableCardGate();
  const minority = { rank: 'Q', suit: 'C' };
  for (const [index, reading] of [card, minority, card, minority].entries()) {
    assert.equal(gate.update(reading, 0, index * 75), null);
  }
  assert.equal(gate.update(card, 0, 300), card);
  assert.equal(gate.update(minority, 0, 375), null);
  assert.equal(gate.update(card, 0, 450), card);
  assert.equal(gate.update(minority, Infinity, 525), null);
  assert.equal(gate.update(minority, 0, 625), null);
  assert.equal(gate.update(minority, 0, 725), minority);
});

test('a confirmed card stays available for four seconds and a fresh confirmation replaces it', () => {
  const memory = createCardMemory();
  const newer = { rank: 'A', suit: 'H' };
  assert.equal(memory.read(0), null);
  memory.remember(card, 100);
  assert.equal(memory.read(4099), card);
  assert.equal(memory.read(4100), null);
  memory.remember(card, 4200);
  memory.remember(newer, 4500);
  assert.equal(memory.read(8499), newer);
  assert.equal(memory.read(8500), null);
  memory.remember(newer, 8600);
  memory.reset();
  assert.equal(memory.read(8601), null);
});

test('a passing card cannot settle by moving steadily at a tolerable speed per frame', () => {
  const gate = createStableCardGate();
  for (let frame = 0; frame < 9; frame++) {
    assert.equal(gate.update(card, 0, frame * 70, { pose: { x: frame * 12, y: 48, span: 24 } }), null);
  }
});

test('pixel motion is measured as average gray-level change', () => {
  assert.equal(meanPixelDifference(new Uint8Array([20, 40]), new Uint8Array([20, 54])), 7);
  assert.equal(meanPixelDifference(new Uint8Array([0]), new Uint8Array([18])), 18);
  assert.equal(meanPixelDifference(null, new Uint8Array([1])), Infinity);
  assert.equal(meanPixelDifference(new Uint8Array([1]), new Uint8Array([1, 2])), Infinity);
});
