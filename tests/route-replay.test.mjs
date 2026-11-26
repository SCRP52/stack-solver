import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, displayCards, makeCullMove, makeDealMove, makeMoves, makeReverseCullMove, parseCards, parsePositions, replay } from '../solver.mjs';
import { createRouteVerifier, simulateStep } from '../route-replay.mjs';
import { presets } from '../presets.mjs';

const cards = presets.find(stack => stack.id === 'ndo').cards;
const encoded = parseCards(cards.join(' '));

test('independent replay agrees with all registered full-deck operations and target-directed moves', () => {
  const profiles = [
    { ...defaults, multiCut: true, multiCutReorder: true, deal: true, dealOrder: 'any' },
    { ...defaults, multiCut: true, multiCutReorder: false, deal: true, dealOrder: 'ordered', cullMax: 2, cullDeeper: false },
  ];
  for (const options of profiles) {
    for (const move of makeMoves(options).list) {
      const [step] = replay(encoded, [move]).steps;
      assert.deepEqual(simulateStep(cards, step, options), step.deck, move.label);
    }
  }
  const profilesWithDynamicMoves = { ...profiles[0], cullMax: 5 };
  for (const move of [
    makeCullMove([1, 6, 9, 15, 24], [8, 12, 30, 40, 46], profilesWithDynamicMoves, 'down'),
    makeCullMove([10, 21, 26, 43, 50], [1, 5, 14, 30, 40], profilesWithDynamicMoves, 'up'),
    makeReverseCullMove(21),
    makeDealMove(8, [4, 2, 1, 7, 8, 6, 3, 5]),
  ]) {
    const [step] = replay(encoded, [move]).steps;
    assert.deepEqual(simulateStep(cards, step, profilesWithDynamicMoves), step.deck, move.label);
  }
});

test('rejects illegal mechanics and intermediate diagrams even when a route claims to match the target', () => {
  const { list } = makeMoves(defaults);
  const bottomFaro = list.find(move => move.kind === 'faro' && move.params.split === 25 && move.params.from === 'bottom');
  const cut = list.find(move => move.kind === 'cut' && move.params.n === 13);
  const step = replay(encoded, [bottomFaro]).steps[0];
  const cutStep = replay(encoded, [cut]).steps[0];
  const verifier = target => createRouteVerifier({ size: 52, start: cards, target, options: defaults });
  const publish = (verify, ...route) => verify({ routes: [route] });
  assert.equal(publish(verifier(step.deck), step).replayVerified, true);
  assert.throws(() => publish(verifier(step.deck), { ...step, params: { ...step.params, from: 'top' } }), { code: 'replayStep', parameters: [1] });
  assert.throws(() => publish(verifier(step.deck), { ...step, deck: cutStep.deck }), { code: 'replayStep', parameters: [1] });
  assert.throws(() => publish(verifier(step.deck), cutStep), { code: 'wrongFinal' });
  assert.equal(simulateStep(cards, step, { ...defaults, near: false }), null);
  const cull1 = makeCullMove([2], [8]);
  const cull2 = makeCullMove([3], [9]);
  const { steps } = replay(encoded, [cull1]);
  const second = replay(cull1.apply(encoded), [cull2]).steps[0];
  assert.throws(() => publish(verifier(second.deck), ...steps, second), { code: 'replayStep', parameters: [2] });
});

test('partial-start replay uses the proposed initial order and checks both ends', () => {
  const initial = ['AS', '?', 'JK', '?', 'KD'];
  const final = ['JK', '?', 'KD', 'AS', '?'];
  const step = { kind: 'cut', params: { n: 2 }, deck: final };
  const verify = createRouteVerifier({ size: 5, startPositions: [[0, 'AS'], [2, 'JK']], targetPositions: [[0, 'JK'], [3, 'AS']], options: defaults });
  const route = [step];
  assert.equal(verify({ routes: [route], routeStarts: [initial] }).replayVerified, true);
  assert.throws(() => verify({ routes: [route], routeStarts: [['KD', '?', 'JK', '?', 'AS']] }), { code: 'replayStart' });
  assert.throws(() => verify({ routes: [[{ ...step, deck: ['AS', '?', 'KD', 'JK', '?'] }]], routeStarts: [initial] }), { code: 'replayStep' });
  assert.equal(verify({ routes: [] }).replayVerified, false);
});

test('worker verifies candidate and final messages for a full target and a partial packet', async () => {
  const messages = [];
  globalThis.self = { postMessage: message => messages.push(message) };
  await import('../worker.mjs');
  try {
    const options = { ...defaults, near: false, cull: false, reverseCull: false, deal: false, multiCut: false, run: false, reverse: false };
    const limits = { seconds: .35, maxStates: 85000 };
    const target = parseCards(cards.slice(13).concat(cards.slice(0, 13)).join(' '));
    for (const data of [
      { size: 52, start: encoded, target },
      { size: 13, start: parsePositions('1=AS 3=2H', 13), target: parsePositions('4=AS 6=2H', 13) },
      { size: 3, start: parseCards('AS 2S JK', 3, true), target: parseCards('AS 2S JK', 3, true) },
    ]) {
      messages.length = 0;
      self.onmessage({ data: { ...data, options, limits } });
      assert.ok(messages.some(message => message.type === 'candidate' && message.replayVerified));
      assert.ok(messages.filter(message => message.type === 'candidate' || message.type === 'done').every(message => message.replayVerified));
      assert.equal(messages.at(-1).type, 'done');
    }
  } finally { delete globalThis.self; }
});
