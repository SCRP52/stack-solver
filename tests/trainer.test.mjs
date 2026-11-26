import test from 'node:test';
import assert from 'node:assert/strict';
import { presets } from '../presets.mjs';
import { advanced, answerChoices, basic, buildQuestion, grade, questionSet, stackModel } from '../drills.mjs';
import { library, saveStack, stackOrder } from '../stack-library.mjs';
import { readProgress, saveProgress, slowCards, summarize, weakCards } from '../trainer-progress.mjs';
import { drillCopy } from '../trainer-copy.mjs';
import { parseCards, parsePositions, solve } from '../solver.mjs';

function memoryStorage() {
  const records = new Map();
  return { getItem: key => records.get(key), setItem: (key, value) => records.set(key, value) };
}

test('the shared library validates exact orders and deduplicates them', () => {
  const storage = memoryStorage();
  const catalog = library(storage);
  assert.equal(catalog.length, presets.length);
  for (const { cards } of catalog) assert.equal(stackModel(cards).cards.length, 52);
  assert.equal(new Set(catalog.map(entry => stackOrder(entry.cards))).size, catalog.length);
  const cards = [...presets[4].cards].reverse();
  const saved = saveStack('Reversed', stackOrder(cards), storage);
  assert.deepEqual(library(storage).at(-1), saved);
  assert.equal(saveStack('Duplicate', stackOrder(cards), storage).id, saved.id);
  assert.equal(saveStack('Same as preset', stackOrder(presets[4].cards), storage).id, presets[4].id);
  assert.throws(() => saveStack('Packet', stackOrder(cards.slice(0, 13)), storage), { code: 'deckSize' });
  assert.throws(() => saveStack('Repeated', stackOrder([cards[1], ...cards.slice(1)]), storage), { code: 'repeatCard' });
});

test('all 52 cut states produce the right ACAAN and relative positions on every stack', () => {
  for (const { cards } of presets) {
    const model = stackModel(cards);
    for (let index = 0; index < 52; index++) {
      const card = cards[index];
      for (let variant = 0; variant < 52; variant++) {
        const cutIndex = (index + variant + 2) % 52;
        const rotated = cards.slice(cutIndex).concat(cards.slice(0, cutIndex));
        const wanted = 1 + (variant + index * 7) % 52;
        const [amount] = buildQuestion(model, 'cut-count', index, variant).answer;
        const afterCut = cards.slice(amount).concat(cards.slice(0, amount));
        assert.equal(afterCut[wanted - 1], card);
        const cutCard = buildQuestion(model, 'cut-card', index, variant);
        assert.deepEqual(cutCard?.answer ?? null, amount ? [afterCut.at(-1)] : null);
        assert.equal(buildQuestion(model, 'relative-position', index, variant).answer[0], rotated.indexOf(card) + 1);
      }
    }
  }
});

test('neighbours stay within a study range and use the cycle for full decks', () => {
  const cards = presets[4].cards;
  const model = stackModel(cards);
  const chosen = cards.slice(9, 13);
  const pool = questionSet(model, basic, { start: 10, end: 13, sequential: true });
  assert.equal(pool.length, 14);
  assert.ok(pool.every(q => q.focus.every(card => chosen.includes(card))));
  assert.equal(questionSet(model, ['previous'], { start: 25, end: 25 }).length, 0);
  assert.equal(buildQuestion(model, 'previous', 0).answer[0], cards.at(-1));
  assert.equal(buildQuestion(model, 'next', 51).answer[0], cards[0]);
});

test('distance, offset and bottom count are distinct', () => {
  const { cards } = presets[5];
  const model = stackModel(cards);
  assert.equal(buildQuestion(model, 'forward-distance', 51).answer[0], 1);
  assert.equal(buildQuestion(model, 'backward-distance', 51).answer[0], 51);
  assert.equal(buildQuestion(model, 'forward-offset', 51).answer[0], cards[0]);
  assert.equal(buildQuestion(model, 'backward-offset', 0).answer[0], cards[51]);
  assert.equal(buildQuestion(model, 'bottom-position', 51).answer[0], 1);
  assert.equal(buildQuestion(model, 'bottom-card', 0).answer[0], cards[0]);
});

test('Quartet and Mate match the actual rank, suit and relative order', () => {
  const { cards } = presets[4];
  const model = stackModel(cards);
  const index = cards.indexOf('7H');
  const inOrder = cards.filter(card => /^7/.test(card));
  assert.deepEqual(buildQuestion(model, 'quartet-order', index).answer, inOrder);
  const quartetPositions = buildQuestion(model, 'quartet-positions', index);
  assert.deepEqual(quartetPositions.answer, inOrder.map(card => cards.indexOf(card) + 1));
  assert.equal(grade(quartetPositions, quartetPositions.answer.map(String).reverse()), true);
  assert.equal(grade(quartetPositions, Array(4).fill(String(index + 1))), false);
  const relative = cards.slice(index).concat(cards.slice(0, index));
  const relativeQuartet = buildQuestion(model, 'relative-quartet', index);
  assert.deepEqual(relativeQuartet.answer, relative.flatMap((card, i) => card !== '7H' && card.startsWith('7') ? [i + 1] : []));
  assert.equal(grade(relativeQuartet, relativeQuartet.answer.map(String).reverse()), true);
  assert.equal(buildQuestion(model, 'mate-position', index).answer[0], cards.indexOf('7D') + 1);
  const from = inOrder.indexOf('7H');
  const nextRanks = inOrder.slice(from).concat(inOrder.slice(0, from));
  assert.equal(buildQuestion(model, 'next-rank', index).answer[0], nextRanks[1]);
  assert.equal(buildQuestion(model, 'previous-rank', index).answer[0], nextRanks[3]);
  assert.deepEqual(buildQuestion(model, 'quartet-distances', index).answer,
    nextRanks.slice(1).map((card, i) => relative.indexOf(card) - relative.indexOf(nextRanks[i])));
});

test('every supported drill generates distinct prompts and grades the generated answer', () => {
  const skills = [...basic, ...Object.values(advanced).flat()];
  for (const { cards } of presets) {
    const pool = questionSet(stackModel(cards), skills, { sequential: true });
    assert.equal(new Set(pool.map(q => q.kind)).size, skills.length);
    assert.equal(new Set(pool.map(q => JSON.stringify([q.kind, q.args, q.shown]))).size, pool.length);
    for (const q of pool) {
      assert.ok(drillCopy[q.kind]);
      assert.equal(grade(q, [q.answer.join(' ')]), true);
      if (typeof q.answer[0] === 'string') assert.equal(new Set(q.answer).size, q.answer.length);
    }
  }
});

test('Missing Card accepts either order and requires the full set of distinct answers', () => {
  const { cards } = presets[4];
  const model = stackModel(cards);
  const pool = questionSet(model, advanced.missing, { random: () => 0.99 });
  assert.equal(pool.length, 46 * (7 + 21));
  for (const { args: [start, end], shown, answer } of pool) {
    const segment = cards.slice(start - 1, end);
    assert.deepEqual([...shown, ...answer].sort(), [...segment].sort());
    assert.notDeepEqual(shown, segment.filter(card => !answer.includes(card)));
  }
  const q = buildQuestion(model, 'multiple-missing', 51, 6);
  assert.equal(grade(q, q.answer.slice().reverse()), true);
  assert.equal(grade(q, [q.answer[0], q.answer[0]]), false);
  assert.equal(grade(q, [q.answer[0]]), null);
});

test('A/B/C offers three distinct options with exactly one correct answer', () => {
  const cards = presets[4].cards;
  const model = stackModel(cards);
  const skills = [...basic, ...Object.values(advanced).flat()];
  const pool = questionSet(model, skills, { sequential: true });
  for (const q of pool) {
    const options = answerChoices(q, cards, {}, () => 0.65);
    assert.equal(options.length, 3, q.kind);
    assert.equal(new Set(options.map(option => option.join(' '))).size, 3, q.kind);
    assert.equal(options.filter(option => grade(q, option.map(String)) === true).length, 1, q.kind);
    assert.ok(options.every(option => option.every(value => !q.shown.includes(value))), q.kind);
  }
  const position = buildQuestion(model, 'card-position', 2);
  assert.deepEqual(answerChoices(position, cards, { start: 2, end: 4 }).flat().sort(), [2, 3, 4]);
});

test('practice progress is isolated by exact stack order and by drill', () => {
  const storage = memoryStorage();
  const order = stackOrder(presets[4].cards);
  const reversed = stackOrder([...presets[4].cards].reverse());
  const question = { kind: 'next', focus: ['AS'] };
  saveProgress(order, question, { correct: false, ms: 300 }, storage);
  assert.equal(weakCards(readProgress(order, storage)).size, 0);
  saveProgress(order, question, { correct: false, ms: 310 }, storage);
  assert.ok(weakCards(readProgress(order, storage)).has('AS'));
  saveProgress(order, question, { correct: true, ms: 330 }, storage);
  saveProgress(order, { kind: 'next', focus: ['AD'] }, { correct: true, ms: 100 }, storage);
  assert.deepEqual([...slowCards(readProgress(order, storage), ['next'])], ['AS']);
  assert.equal(slowCards(readProgress(order, storage), ['previous']).size, 0);
  assert.deepEqual(readProgress(reversed, storage), {});
});

test('trial rates count misses while timing statistics use correct answers', () => {
  const fastest = { correct: true, ms: 800 };
  const slowest = { correct: true, ms: 1600 };
  assert.deepEqual(summarize([fastest, { correct: false, ms: 200 }, slowest, { correct: false, skipped: true, ms: 1900 }]),
    { right: 2, wrong: 2, meanMs: 1200, fastest, slowest });
  assert.deepEqual(summarize([{ correct: false, ms: 200 }]),
    { right: 0, wrong: 1, meanMs: null, fastest: null, slowest: null });
});

test('existing Converter solves full presets and partial packets', () => {
  const cards = presets[4].cards;
  const starting = parseCards(cards.join(' '));
  assert.equal(solve(starting, starting, {}, { seconds: 1 }).steps.length, 0);
  const interleaved = cards.slice(0, 26).flatMap((card, index) => [card, cards[index + 26]]);
  const faro = solve(starting, parseCards(interleaved.join(' ')), { out: true }, { seconds: 1 });
  assert.equal(faro.steps.length, 1);
  assert.equal(faro.steps[0].label, 'Faro out');
  assert.deepEqual(faro.steps[0].deck, interleaved);
  const start = parsePositions('1=AS 4=KH 12=QD', 13);
  const end = parsePositions('1=QD 3=AS 4=2C 6=KH', 13);
  const result = solve(start, end, { cut: true }, { seconds: 2 }, undefined, 13);
  assert.equal(result.steps.length, 1);
  const [step] = result.steps;
  assert.equal(step.deck[0], 'QD');
  assert.equal(step.deck[2], 'AS');
  assert.equal(step.deck[3], '2C');
  assert.equal(step.deck[5], 'KH');
});
