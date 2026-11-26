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
  if (last < 52) available.push(52);
  const matchesInRange = [];
  for (const subset of choose(available, targetRanks?.length ?? hands[hand])) {
    if (matches(subset.map(position => cards[position - 1]), hand, targetRanks)) matchesInRange.push(subset);
  }
  return matchesInRange;
}

function geometry(positions) {
  const upper = positions.filter(position => position < 52);
  const first = upper[0], width = upper.at(-1) - first;
  const gaps = upper.slice(1).map((position, index) => position - upper[index]).sort((a, b) => a - b);
  return [first, width, gaps.length ? gaps.at(-1) - gaps[0] : 0];
}

function compare(a, b) {
  const difference = a.findIndex((value, i) => value !== b[i]);
  return difference === -1 ? 0 : a[difference] - b[difference];
}

function referenceOrder(subsets) {
  const withoutBottom = subsets.filter(positions => positions.at(-1) < 52).map(geometry).sort(compare)[0];
  const weight = positions => {
    const [first, width, gaps] = geometry(positions);
    const usingBottom = positions.at(-1) === 52;
    const assisted = !withoutBottom || first - withoutBottom[0] <= 1 && width - withoutBottom[1] <= 2;
    const preference = usingBottom ? (assisted ? 0 : 2) : 1;
    return [preference, first, width, gaps, ...positions];
  };
  return subsets.sort((a, b) => compare(weight(a), weight(b)));
}

test('Jazzing agrees with exhaustive combinations and ranking across all 52 cuts on every preset', () => {
  for (const { id, cards } of presets) {
    for (const [cut, bottom] of cards.entries()) {
      const rotated = rotatedDeck(cards, bottom);
      assert.equal(rotated[51], bottom);
      assert.equal(rotated[0], cards[(cut + 1) % 52]);
      const variants = [...Object.keys(hands).map(hand => ({ hand })), { targetRanks: ['10', 'J', 'Q', 'K', 'A'] }];
      for (const variant of variants) {
        const context = { ...variant, cards: rotated, first: cut % 3 + 1, last: cut % 4 + 7 };
        const expected = referenceOrder(exhaustive(context));
        const found = findJazzOptions(context);
        const sample = `${id} / ${bottom} / ${variant.hand ?? 'specific'}`;
        assert.equal(found.count, expected.length, sample);
        assert.deepEqual(found.options.map(option => option.positions), expected.slice(0, 3), sample);
        assert.ok(found.options.every(option => validJazz(context, option.positions)), sample);
      }
    }
  }
});

test('Jazzing accepts useful alternatives, distinguishes no solution and considers the real bottom', () => {
  const make = (head, bottom, hand = 'pair', last = head.length) => {
    const cards = [...head, ...presets[0].cards.filter(card => !head.includes(card) && card !== bottom), bottom];
    return { cards, first: 1, last, hand };
  };
  const available = make(['AS', '2S', '3S', 'AD', '4S'], '2H');
  assert.deepEqual(findJazzOptions(available).options[0].positions, [2, 52]);
  const alternative = gradeJazz(available, [4, 1]);
  assert.equal(alternative.valid, true);
  assert.equal(alternative.optimal, false);
  assert.deepEqual(alternative.betterOptions.map(option => option.positions), [[2, 52]]);
  assert.equal(gradeJazz(available, [1, 1]).valid, false);
  assert.equal(gradeJazz(available, [2, 51]).valid, false);
  assert.equal(gradeJazz(available, null).valid, false);
  assert.equal(gradeJazz({ ...available, last: 1 }, null).valid, true);

  const distantBottom = make(['AS', '3S', 'AD', '2S', '7C'], '2H');
  assert.deepEqual(findJazzOptions(distantBottom).options[0].positions, [1, 3]);
  const wideBottom = make(['AS','2S','3S','4S','5S','6S','7S','8S','9S','KH','QD','2D','3D','4D','AD'], 'AH', 'three');
  assert.deepEqual(jazzScore([3, 5, 7, 52]), [3, 4, 0]);
  assert.deepEqual(jazzScore([3, 4, 7, 52]), [3, 4, 2]);
  assert.equal(validJazz(wideBottom, [1, 15, 52]), true);
  assert.deepEqual(findJazzOptions({ ...wideBottom, last: 14 }).options, []);

  const badSpan = make(['AS', '2S', '2D', '2H', '9S', '7H', '8S', 'JC', 'KD', '4C', 'AD'], 'AH', 'three');
  assert.deepEqual(findJazzOptions(badSpan).options[0].positions, [2, 3, 4]);
  assert.equal(gradeJazz(badSpan, [1, 11, 52]).valid, true);
  assert.equal(gradeJazz(badSpan, [1, 11, 52]).optimal, false);

  const tied = make(['AS', '2S', '2H', '3S', '4S', '4H', '5S'], 'KH', 'straight');
  assert.equal(gradeJazz(tied, [1, 2, 4, 5, 7]).optimal, true);
  assert.equal(gradeJazz(tied, [1, 3, 4, 6, 7]).optimal, true);
  assert.deepEqual(gradeJazz(tied, [1, 3, 4, 6, 7]).betterOptions, []);
  const options = findJazzOptions({ ...available, last: 52 });
  assert.equal(options.count, 78);
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
