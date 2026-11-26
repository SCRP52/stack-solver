import test from 'node:test';
import assert from 'node:assert/strict';
import { agreeOnCard, createStableCardGate, meanPixelDifference } from '../assistant-scan-logic.mjs';

const card = { rank: 'Q', suit: 'S' };

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
