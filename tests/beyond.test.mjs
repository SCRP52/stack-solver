import test from 'node:test';
import assert from 'node:assert/strict';
import { presets } from '../presets.mjs';
import { beyond, beyondQuestions, parseSplit, splitDefaults, splitPile } from '../beyond.mjs';
import { answerChoices, grade, stackModel } from '../drills.mjs';
import { findJazzOptions, gradeJazz, hands, jazzScore, rotatedDeck, validJazz } from '../jazzing.mjs';
import { exportStackCsv, importStackCsv } from '../stack-csv.mjs';

function seeded(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

function* choose(items, size, picked = []) {
  if (!size) { yield picked; return; }
  for (const [index, item] of items.entries()) {
    if (items.length - index < size) break;
    yield* choose(items.slice(index + 1), size - 1, [...picked, item]);
  }
}

function matches(cards, hand, target) {
  const values = 'A 2 3 4 5 6 7 8 9 10 J Q K'.split(' ');
  const ranks = cards.map(card => values.indexOf(card.slice(0, -1))).sort((a, b) => a - b);
  const counts = [...new Set(ranks)].map(rank => ranks.filter(value => value === rank).length).sort();
  const flush = new Set(cards.map(card => card.at(-1))).size === 1;
  const royal = ranks.join() === '0,9,10,11,12';
  const straight = royal || (ranks.length === 5 && ranks.every((rank, index) => rank - ranks[0] === index));
  if (target) return ranks.join() === target.map(rank => values.indexOf(rank)).sort((a, b) => a - b).join();
  return { pair: counts.join() === '2', 'two-pair': counts.join() === '2,2', three: counts.join() === '3',
    straight, flush, 'full-house': counts.join() === '2,3', four: counts.join() === '4',
    'straight-flush': straight && flush, royal: royal && flush }[hand];
}

function exhaustive({ cards, hand, targetRanks, first, last }) {
  const available = [];
  for (let i = first; i <= last; i++) available.push(i);
  for (const position of [51, 52]) if (!available.includes(position)) available.push(position);
  const matchesInRange = [];
  for (const subset of choose(available.sort((a, b) => a - b), targetRanks?.length ?? hands[hand])) {
    if (subset.some(position => position === 51 && (position < first || position > last)) && !subset.includes(52)) continue;
    if (matches(subset.map(position => cards[position - 1]), hand, targetRanks)) matchesInRange.push(subset);
  }
  return matchesInRange;
}

function referenceOrder(subsets) {
  const weight = positions => {
    let remaining = positions;
    if (remaining.at(-1) === 52) {
      remaining = remaining.slice(0, -1);
      if (remaining.at(-1) === 51) remaining = remaining.slice(0, -1);
    }
    const gaps = remaining.slice(1).map((position, index) => position - remaining[index]).sort((a, b) => a - b);
    const longest = gaps.at(-1) ?? 0;
    const uneven = longest - (gaps[0] ?? 0);
    const span = (remaining.at(-1) ?? 0) - (remaining[0] ?? 0);
    return longest > 10 ? null : [remaining.length, uneven, longest, span, ...positions];
  };
  return subsets.map(positions => [positions, weight(positions)]).filter(([, weight]) => weight)
    .sort(([, a], [, b]) => {
      const index = a.findIndex((value, i) => value !== b[i]);
      return index === -1 ? 0 : a[index] - b[index];
    }).map(([positions]) => positions);
}

test('Jazzing agrees with exhaustive combinations and ranking across all 52 cuts on every preset', () => {
  for (const { id, cards } of presets) {
    for (const [cut, bottom] of cards.entries()) {
      const rotated = rotatedDeck(cards, bottom);
      assert.equal(rotated[51], bottom);
      assert.equal(rotated[0], cards[(cut + 1) % 52]);
      const variants = [...Object.keys(hands).map(hand => ({ hand })), { targetRanks: ['10', 'J', 'Q', 'K', 'A'] }];
      for (const variant of variants) {
        const context = { ...variant, cards: rotated, first: cut % 3 + 1, last: cut % 6 + 7 };
        const valid = exhaustive(context);
        const expected = referenceOrder(valid);
        const found = findJazzOptions(context);
        const sample = `${id} / ${bottom} / ${variant.hand ?? 'specific'}`;
        assert.equal(found.count, valid.length, sample);
        assert.deepEqual(found.options.map(option => option.positions), expected.slice(0, 3), sample);
        assert.ok(found.options.every(option => validJazz(context, option.positions)), sample);
      }
    }
  }
});

function arrangedDeck(head, bottomCards, hand, last = head.length) {
  const occupied = head.filter(Boolean).concat(bottomCards);
  const spare = presets[0].cards.filter(card => !occupied.includes(card));
  const cards = Array.from({ length: 52 - bottomCards.length }, (_, i) => head[i] ?? spare.shift()).concat(bottomCards);
  return { cards, first: 1, last, hand };
}

test('Jazzing prefers even gaps to proximity and accepts equally ranked answers', () => {
  const head = ['AS', 'AD', '5C', 'AH', '2S', '8C', '7C', '9C', '2D', '10C', 'JC', 'QC', '2H'];
  const context = arrangedDeck(head, ['KS', 'KH'], 'three');
  assert.deepEqual(findJazzOptions(context).options[0].positions, [5, 9, 13]);
  assert.deepEqual(gradeJazz(context, [1, 2, 4]).betterOptions[0].positions, [5, 9, 13]);
  assert.equal(gradeJazz(context, [1, 2, 4]).valid, true);

  const tied = arrangedDeck(['AS', '2S', '2H', '3S', '4S', '4H', '5S'], ['KD', 'KH'], 'straight');
  assert.equal(gradeJazz(tied, [1, 2, 4, 5, 7]).optimal, true);
  assert.equal(gradeJazz(tied, [1, 3, 4, 6, 7]).optimal, true);
  assert.deepEqual(gradeJazz(tied, [1, 3, 4, 6, 7]).betterOptions, []);
});

test('Jazzing counts 52 as covered and counts 51 only together with 52', () => {
  const context = arrangedDeck(['AS', 'AD', 'AH', '2S', '3S', 'KH', '7C', '8C', 'KC'], ['KD', 'KS'], 'three');
  assert.deepEqual(findJazzOptions(context).options[0].positions, [6, 51, 52]);
  assert.deepEqual(findJazzOptions({ ...context, hand: 'four' }).options[0].positions, [6, 9, 51, 52]);
  assert.equal(gradeJazz(context, [1, 2, 3]).optimal, false);
  assert.equal(gradeJazz(context, [6, 9, 52]).valid, true);
  assert.equal(gradeJazz(context, [6, 9, 51]).valid, false);
  assert.equal(gradeJazz({ ...context, last: 51 }, [6, 9, 51]).valid, true);
  assert.deepEqual(jazzScore([3, 5, 7, 52]).gaps, [2, 2]);
  assert.deepEqual(jazzScore([3, 4, 7, 51, 52]).gaps, [1, 3]);
  assert.deepEqual(jazzScore([3, 4, 7, 51]).gaps, [1, 3, 44]);
  assert.deepEqual(findJazzOptions({ ...context, hand: 'pair' }).options[0].positions, [51, 52]);
  assert.equal(findJazzOptions({ ...context, hand: 'pair', last: 52 }).count, 78);
});

test('Jazzing caps each suggested gap at 10 positions, while grading wider valid hands correctly', () => {
  const head = ['AS', '2S', '2D', '2H', '9S', '7H', '8S', 'JC', 'KD', '4C', 'AD', '6S', '3D', '4D', 'KH', '5S', '6H', 'JH', '8H', '9H', 'AC'];
  const context = arrangedDeck(head, ['KC', 'AH'], 'three');
  assert.equal(jazzScore([1, 11, 21]).withinLimit, true);
  assert.equal(jazzScore([1, 12]).withinLimit, false);
  assert.deepEqual(findJazzOptions(context).options[0].positions, [1, 11, 52]);
  assert.equal(gradeJazz(context, [1, 21, 52]).valid, true);
  assert.equal(gradeJazz(context, [1, 21, 52]).optimal, false);
  assert.deepEqual(gradeJazz(context, [1, 21, 52]).betterOptions[0].positions, [1, 11, 52]);
  assert.equal(gradeJazz(context, [1, 1, 52]).valid, false);
  assert.equal(gradeJazz(context, [1, 11, 50]).valid, false);
  assert.equal(gradeJazz(context, null).valid, false);

  const noClose = arrangedDeck(['AS', '2D', '3D', '4D', '5D', '6D', '7D', '8D', '9D', '10D', 'JD', 'AH'],
    ['KC', 'QH'], 'pair');
  assert.deepEqual(findJazzOptions(noClose), { count: 1, options: [] });
  assert.equal(gradeJazz(noClose, [1, 12]).valid, true);
  assert.equal(gradeJazz(noClose, null).valid, false);
  assert.equal(gradeJazz({ ...noClose, last: 11 }, null).valid, true);
});

test('Specific Straight uses the same consecutively available bottom cards', () => {
  const context = { ...arrangedDeck(['AS', '2S', '3S', '7D', '8H'], ['4S', '5H'], null), targetRanks: ['A', '2', '3', '4', '5'] };
  const answer = [1, 2, 3, 51, 52];
  assert.deepEqual(findJazzOptions(context).options[0].positions, answer);
  const result = gradeJazz(context, answer);
  assert.equal(result.optimal, true);
  assert.deepEqual(result.score.gaps, [1, 1]);
  assert.equal(result.score.bottomCount, 2);
});

test('Beyond generates unique, gradable prompts for every skill from each actual stack', () => {
  for (const [number, { cards }] of presets.entries()) {
    const model = stackModel(cards);
    const piles = [10, 14, 15, 13];
    const questions = beyondQuestions(model, Object.values(beyond).flat(), { random: seeded(number + 1), piles });
    const seen = new Set();
    for (const q of questions) {
      const key = JSON.stringify([q.kind, q.args, q.direction, q.condition, q.jazz?.hand, q.jazz?.targetRanks, [...q.shown].sort()]);
      assert.equal(seen.has(key), false, q.kind);
      seen.add(key);
      assert.ok(q.focus.length > 0 && q.focus.every(card => cards.includes(card)), q.kind);
      if (q.jazz) {
        assert.equal(q.jazz.cards.at(-1), q.focus[0]);
        continue;
      }
      assert.equal(grade(q, q.answer.map(String)), true, q.kind);
      if (q.piles) assert.deepEqual(q.answer, q.shown.map(card => splitPile(cards.indexOf(card), piles)));
      if (q.kind === 'recall-up' || q.kind === 'recall-down') {
        const sorted = [...q.shown].sort((a, b) => cards.indexOf(a) - cards.indexOf(b));
        assert.deepEqual(q.answer, q.kind === 'recall-down' ? sorted.reverse() : sorted);
      }
      if (q.kind === 'suit-distribution') {
        const positions = q.focus.map(card => cards.indexOf(card));
        const section = cards.slice(positions[0] + 1, positions[1]);
        assert.deepEqual(q.answer, ['S','H','C','D'].map(suit => section.filter(card => card.endsWith(suit)).length));
      }
      if (q.kind === 'value-sum') {
        const entries = answerChoices(q, cards, {}, seeded(12));
        assert.equal(entries.filter(entry => grade(q, entry.map(String))).length, 1);
      }
    }
    assert.deepEqual(new Set(questions.map(q => q.kind)), new Set(Object.values(beyond).flat()));
    const progress = questions.filter(q => q.kind === 'recall-progressive').map(q => q.answer.length);
    assert.ok(progress.every((length, i) => i === 0 || length >= progress[i - 1]));
  }
});

test('Split defaults and unequal custom boundaries work for 2 through 5 piles', () => {
  for (const count of [2, 3, 4, 5]) assert.deepEqual(parseSplit('', count), splitDefaults[count]);
  const custom = parseSplit('10,14,15,13', 4);
  assert.deepEqual(custom, [10, 14, 15, 13]);
  assert.deepEqual([0, 9, 10, 23, 24, 38, 39, 51].map(index => splitPile(index, custom)), [1, 1, 2, 2, 3, 3, 4, 4]);
  for (const invalid of ['13,13,13', '13,13,13,14', '0,13,13,26', '13,13,13,1.3']) {
    assert.throws(() => parseSplit(invalid, 4), { message: 'splitSizes' });
  }
});

test('Twice as Hard calculates ordered cut markers on the selected stack for every eligible number pair', () => {
  for (const { cards } of presets) {
    const questions = beyondQuestions(stackModel(cards), ['twice-as-hard'], { sequential: true });
    assert.equal(questions.length, 1176);
    assert.equal(new Set(questions.map(q => q.args.join())).size, questions.length);
    assert.deepEqual(questions.find(q => q.args.join() === '18,43').answer, [cards[8], cards[26]]);
    for (const q of questions) {
      const [low, high] = q.args;
      const [a, b] = q.answer.map(card => cards.indexOf(card) + 1);
      assert.ok(a >= 1 && a + 1 < b && b < 51);
      const reordered = [...cards.slice(a, b), ...cards.slice(b), ...cards.slice(0, a)];
      assert.equal(reordered[low - 1], q.answer[1]);
      assert.equal(reordered[high - 1], cards[51]);
      assert.equal(grade(q, q.answer), true);
      assert.equal(grade(q, [...q.answer].reverse()), false);
    }
    const mixed = beyondQuestions(stackModel(cards), ['twice-as-hard'], { random: seeded(51) });
    assert.notDeepEqual(mixed.slice(0, 52).map(q => q.args), questions.slice(0, 52).map(q => q.args));
    assert.equal(answerChoices(mixed[0], cards, {}, seeded(12)).filter(entry => grade(mixed[0], entry)).length, 1);
  }
});

test('Stack CSV round-trips names and position order and rejects ambiguous decks', () => {
  const cards = [...presets[0].cards].reverse();
  for (const label of ['Stack "Ca phe", 2026', '=Formula', "'My Stack"]) {
    const csv = exportStackCsv({ label, cards });
    const [header, ...body] = csv.trimEnd().split('\r\n');
    assert.deepEqual(importStackCsv([header, ...body.reverse()].join('\r\n'), 'File'), { label, cards });
  }
  const rows = cards.map((card, i) => `${i + 1};${card}`);
  assert.deepEqual(importStackCsv(['Position;Card', ...rows.reverse()].join('\n'), 'File'), { label: 'File', cards });
  assert.deepEqual(importStackCsv(['Card', ...cards].join('\n'), 'File'), { label: 'File', cards });
  assert.throws(() => importStackCsv(['Position;Card', ...rows, rows[0]].join('\n'), 'File'), { message: 'csvPositions' });
  assert.throws(() => importStackCsv(cards.slice(1).join(','), 'File'), { code: 'deckSize' });
  assert.throws(() => importStackCsv([cards[1], ...cards.slice(1)].join(','), 'File'), { code: 'repeatCard' });
});
