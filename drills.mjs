import { cardCode, deckLength as size, cardLabel } from './stack-library.mjs';

export const basic = ['card-position', 'position-card', 'previous', 'next'];
export const advanced = {
  acaan: ['cut-count', 'cut-card'],
  quartet: ['quartet-positions', 'quartet-order', 'quartet-distances', 'relative-quartet', 'next-rank', 'previous-rank'],
  mate: ['mate-position', 'mate-distance', 'relative-mate'],
  distance: ['forward-distance', 'backward-distance', 'forward-offset', 'backward-offset'],
  relative: ['relative-position', 'bottom-position', 'bottom-card'],
  missing: ['single-missing', 'multiple-missing'],
};

const mod = value => (value % size + size) % size;
const rank = card => card.slice(0, -1);
const suit = card => card.at(-1);
const mateSuit = { S: 'C', C: 'S', H: 'D', D: 'H' };
const positions = Array.from({ length: size }, (_, index) => index + 1);
const segmentSize = 7;
const missingPairs = Array.from({ length: segmentSize }, (_, left) =>
  Array.from({ length: segmentSize - left - 1 }, (_, gap) => [left, left + gap + 1])).flat();

export function stackModel(cards) {
  if (cards.length !== size || new Set(cards).size !== size || cards.some(card => cardCode(card) !== card)) {
    throw new TypeError('A stack must contain 52 distinct cards');
  }
  const slot = new Map(cards.map((card, index) => [card, index]));
  const quartet = new Map();
  for (const card of cards) {
    if (!quartet.has(rank(card))) quartet.set(rank(card), []);
    quartet.get(rank(card)).push(card);
  }
  return { cards, at: offset => cards[mod(offset)], slot: card => slot.get(card), quartet };
}

export function forwardDistance(fromSlot, toSlot) { return mod(toSlot - fromSlot); }
export function positionAfterCut(slot, cutCount) { return mod(slot - cutCount) + 1; }
export function cutCountFor(position, wanted) { return mod(position - wanted); }

export function buildQuestion(model, skill, index, variant = 0, random = Math.random) {
  const { cards, at, slot, quartet } = model;
  const card = at(index);
  const face = cardLabel(card);
  const cardRank = rank(card);
  const fromTop = index + 1;
  const fromBottom = size - index;
  const otherIndex = mod(index + variant + 1);
  const other = at(otherIndex);
  const number = positions[mod(variant + index * 7)];
  const bottom = other;
  const cut = otherIndex + 1;
  const ask = (args, answer, focus = [card], { unordered = false, shown = [] } = {}) =>
    ({ kind: skill, args, answer: Array.isArray(answer) ? answer : [answer], focus, unordered, shown });

  switch (skill) {
    case 'card-position': return ask([face], fromTop);
    case 'position-card': return ask([fromTop], card);
    case 'previous': return ask([face], at(index - 1), [card, at(index - 1)]);
    case 'next': return ask([face], at(index + 1), [card, at(index + 1)]);
    case 'cut-count': return ask([face, number], cutCountFor(fromTop, number));
    case 'cut-card': {
      const count = cutCountFor(fromTop, number);
      if (!count) return null;
      return ask([face, number], at(count - 1));
    }
    case 'quartet-positions': {
      const group = quartet.get(cardRank);
      return ask([cardRank], group.map(member => slot(member) + 1), group, { unordered: true });
    }
    case 'quartet-order': return ask([cardRank], quartet.get(cardRank), quartet.get(cardRank));
    case 'quartet-distances': {
      const group = quartet.get(cardRank);
      const ordered = [...group.slice(group.indexOf(card)), ...group.slice(0, group.indexOf(card))];
      return ask([face], ordered.slice(1).map((member, i) => forwardDistance(slot(ordered[i]), slot(member))), ordered);
    }
    case 'relative-quartet': {
      const group = quartet.get(cardRank);
      const others = group.filter(member => member !== card);
      const positions = others.map(member => positionAfterCut(slot(member), index)).sort((a, b) => a - b);
      return ask([face], positions, group, { unordered: true });
    }
    case 'next-rank':
    case 'previous-rank': {
      const group = quartet.get(cardRank);
      const next = group[(group.indexOf(card) + (skill === 'next-rank' ? 1 : 3)) % 4];
      return ask([face], next, [card, next]);
    }
    case 'mate-position':
    case 'mate-distance':
    case 'relative-mate': {
      const mate = cardRank + mateSuit[suit(card)];
      if (skill === 'mate-position') return ask([face], slot(mate) + 1, [card, mate]);
      if (skill === 'mate-distance') return ask([face], forwardDistance(index, slot(mate)), [card, mate]);
      return mate === bottom ? null : ask([face, cardLabel(bottom)], positionAfterCut(slot(mate), cut), [card, mate, bottom]);
    }
    case 'forward-distance': return ask([face, cardLabel(other)], forwardDistance(index, otherIndex), [card, other]);
    case 'backward-distance': return ask([face, cardLabel(other)], forwardDistance(otherIndex, index), [card, other]);
    case 'forward-offset': return ask([face, variant + 1], other, [card, other]);
    case 'backward-offset': return ask([face, variant + 1], at(index - variant - 1), [card, at(index - variant - 1)]);
    case 'relative-position': return ask([cardLabel(bottom), face], positionAfterCut(index, cut), [card, bottom]);
    case 'bottom-position': return ask([face], fromBottom);
    case 'bottom-card': return ask([fromBottom], card);
    case 'single-missing':
    case 'multiple-missing': {
      const start = Math.min(index, size - segmentSize);
      const segment = cards.slice(start, start + segmentSize);
      const gaps = skill === 'single-missing' ? [variant] : missingPairs[variant];
      const missing = gaps.map(i => segment[i]);
      const visible = segment.filter((_, i) => !gaps.includes(i));
      // The shown cards must identify a single window without a position hint.
      const earliest = Math.max(0, slot(visible.at(-1)) - segmentSize + 1);
      const latest = Math.min(size - segmentSize, slot(visible[0]));
      if (earliest !== latest) return null;
      const shown = shuffle([...visible], random);
      if (shown.every((card, i) => card === visible[i])) shown.push(shown.shift());
      return ask([missing.length], missing, missing, { unordered: true, shown });
    }
    default: throw new RangeError(`Unknown drill ${skill}`);
  }
}

function shuffle(items, random) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

const rankOnly = new Set(['quartet-positions', 'quartet-order']);
const fixed = new Set([...basic, ...rankOnly, 'quartet-distances', 'relative-quartet', 'next-rank', 'previous-rank', 'mate-position', 'mate-distance', 'bottom-position', 'bottom-card']);
const fullVariants = new Set(['cut-count', 'cut-card']);
const missingVariants = { 'single-missing': segmentSize, 'multiple-missing': missingPairs.length };

export function questionSet(model, skills, { start = 1, end = size, random = Math.random, sequential = false, eligible = () => true } = {}) {
  const unique = new Set();
  const buckets = skills.map(skill => {
    const seenRanks = new Set();
    const variants = fixed.has(skill) ? 1 : fullVariants.has(skill) ? size : missingVariants[skill] ?? size - 1;
    const items = [];
    for (let index = start - 1; index < end; index++) {
      if (start !== 1 || end !== size) {
        if ((skill === 'previous' && index === start - 1) || (skill === 'next' && index === end - 1)) continue;
      }
      if (rankOnly.has(skill)) {
        const key = rank(model.cards[index]);
        if (seenRanks.has(key)) continue;
        seenRanks.add(key);
      }
      for (let variant = 0; variant < variants; variant++) {
        const prompt = buildQuestion(model, skill, index, variant, random);
        if (!prompt || !eligible(prompt)) continue;
        const shown = missingVariants[skill] ? [...prompt.shown].sort() : prompt.shown;
        const key = JSON.stringify([prompt.kind, prompt.args, shown]);
        if (unique.has(key)) continue;
        unique.add(key);
        items.push(prompt);
      }
    }
    return sequential ? items : shuffle(items, random);
  });
  const questions = [];
  const count = Math.max(0, ...buckets.map(bucket => bucket.length));
  for (let i = 0; i < count; i++) {
    if (!sequential) shuffle(buckets, random);
    for (const bucket of buckets) {
      if (bucket[i]) questions.push(bucket[i]);
    }
  }
  return questions;
}

export function grade(prompt, raw) {
  const entries = raw.flatMap(value => value.trim().split(/[\s,/;|]+/).filter(Boolean));
  if (entries.length !== prompt.answer.length) return null;
  const values = entries.map((value, index) => typeof prompt.answer[index] === 'number'
    ? (/^\d+$/.test(value) ? Number(value) : null) : cardCode(value));
  if (values.some(value => value === null)) return null;
  if (prompt.unordered) return new Set(values).size === values.length && values.every(value => prompt.answer.includes(value));
  return values.every((value, index) => value === prompt.answer[index]);
}

export function answerChoices(prompt, cards, { start = 1, end = size } = {}, random = Math.random) {
  const { kind, answer, shown, unordered } = prompt;
  const numeric = typeof answer[0] === 'number';
  const normalize = values => unordered ? [...values].sort(numeric ? (a, b) => a - b : undefined) : values;
  const correct = normalize(answer);
  const keyFor = values => values.join(' ');
  const candidates = new Map();
  const correctKey = keyFor(correct);
  const add = values => {
    const normalized = normalize(values);
    const key = keyFor(normalized);
    if (key !== correctKey) candidates.set(key, normalized);
  };
  if (kind === 'quartet-order') {
    for (let left = 0; left < answer.length; left++) {
      for (let right = left + 1; right < answer.length; right++) {
        const changed = [...answer];
        [changed[left], changed[right]] = [changed[right], changed[left]];
        add(changed);
      }
    }
  } else {
    for (let i = 0; i < answer.length; i++) {
      let alternatives;
      if (numeric) {
        const min = kind === 'cut-count' ? 0 : kind === 'relative-quartet' ? 2 : 1;
        const max = kind === 'quartet-distances' ? size - 1 - answer.reduce((sum, value, j) => sum + (i === j ? 0 : value), 0)
          : ['cut-count', 'forward-distance', 'backward-distance'].includes(kind) ? size - 1 : size;
        alternatives = kind === 'card-position' && end - start >= 2 ? positions.slice(start - 1, end)
          : Array.from({ length: max - min + 1 }, (_, index) => min + index);
      } else {
        alternatives = basic.includes(kind) && end - start >= 2 ? cards.slice(start - 1, end) : cards;
        if (kind === 'next-rank' || kind === 'previous-rank') {
          alternatives = alternatives.filter(value => rank(value) === rank(answer[0]) && cardLabel(value) !== prompt.args[0]);
        } else if ((kind === 'next' || kind === 'previous') && alternatives.length > 3) {
          alternatives = alternatives.filter(value => cardLabel(value) !== prompt.args[0]);
        }
      }
      for (const alternative of alternatives) {
        const needsDistinct = unordered || !numeric;
        if ((needsDistinct && answer.includes(alternative)) || shown.includes(alternative)) continue;
        const changed = [...answer];
        changed[i] = alternative;
        add(changed);
      }
    }
  }
  return shuffle([correct, ...shuffle([...candidates.values()], random).slice(0, 2)], random);
}
