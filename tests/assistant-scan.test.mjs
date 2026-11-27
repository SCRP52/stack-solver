import test from 'node:test';
import assert from 'node:assert/strict';
import { agreeOnCard, createStableCardGate, meanPixelDifference } from '../assistant-scan-logic.mjs';
import { cardRotation, findCardCorners } from '../assistant-corners.mjs';
import { choosePacketFace, hasCoveringEdge } from '../assistant-packet.mjs';
import { createScanLog } from '../assistant-diagnostics.mjs';

const card = { rank: 'Q', suit: 'S' };

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
  const log = createScanLog({ now: () => time, maxEntries: 3 });
  log.event('session.start', { orientation: 'portrait' });
  log.event('camera.opened', { width: 640 });
  log.frame('no-index', 10);
  time = 1234;
  log.frame('recognized', 30);
  log.event('session.stop', { reason: 'user' });
  const file = JSON.parse(log.serialize());
  assert.equal(file.entries[0].event, 'session.start');
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

test('pixel motion is measured as average gray-level change', () => {
  assert.equal(meanPixelDifference(new Uint8Array([20, 40]), new Uint8Array([20, 54])), 7);
  assert.equal(meanPixelDifference(new Uint8Array([0]), new Uint8Array([18])), 18);
  assert.equal(meanPixelDifference(null, new Uint8Array([1])), Infinity);
  assert.equal(meanPixelDifference(new Uint8Array([1]), new Uint8Array([1, 2])), Infinity);
});
