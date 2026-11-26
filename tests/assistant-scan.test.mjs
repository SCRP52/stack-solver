import test from 'node:test';
import assert from 'node:assert/strict';
import { agreeOnCard, createStableCardGate, meanPixelDifference } from '../assistant-scan-logic.mjs';
import { findCardCorners } from '../assistant-corners.mjs';

const card = { rank: 'Q', suit: 'S' };

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
    assert.equal(corners.length, 1);
    assert.equal(corners[0].rank.double, true);
    assert.equal(corners[0].rank.w, 8);
  }
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
