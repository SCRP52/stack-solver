import { cardCode, deckLength as size, cardLabel } from './stack-library.mjs';

export const basic = ['card-position', 'position-card', 'previous', 'next'];
export const advanced = {
  acaan: ['cut-count', 'cut-card', 'offset-order'],
  quartet: ['quartet-positions', 'quartet-order', 'quartet-distances', 'relative-quartet', 'next-rank', 'previous-rank'],
  mate: ['mate-position', 'mate-distance', 'relative-mate'],
  distance: ['forward-distance', 'backward-distance', 'forward-offset', 'backward-offset', 'between'],
  relative: ['relative-position', 'relative-card', 'bottom-position', 'bottom-card'],
  missing: ['single-missing', 'multiple-missing', 'shuffled-missing'],
};

const mod = value => (value % size + size) % size;
const rank = card => card.slice(0, -1);
const suit = card => card.at(-1);
const mateSuit = { S: 'C', C: 'S', H: 'D', D: 'H' };
const quartetSuits = ['S', 'H', 'C', 'D'];
const positions = Array.from({ length: size }, (_, index) => index + 1);

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

function question(kind, args, answer, focus, labels = [], unordered = false, shown = []) {
  return { kind, args, answer, focus, labels, unordered, shown };
}

export function buildQuestion(model, skill, index, variant = 0) {
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
  const ask = (args, answer, focus = [card], labels, unordered, shown) =>
    question(skill, args, Array.isArray(answer) ? answer : [answer], focus, labels, unordered, shown);

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
      const ordered = quartetSuits.map(mark => cardRank + mark);
      return ask([cardRank], ordered.map(member => slot(member) + 1), ordered, ordered.map(cardLabel));
    }
    case 'quartet-order': return ask([cardRank], quartet.get(cardRank), quartet.get(cardRank));
    case 'quartet-distances': {
      const group = quartet.get(cardRank);
      const ordered = [...group.slice(group.indexOf(card)), ...group.slice(0, group.indexOf(card))];
      return ask([face], ordered.slice(1).map((member, i) => forwardDistance(slot(ordered[i]), slot(member))), ordered);
    }
    case 'relative-quartet': {
      const others = quartetSuits.map(mark => cardRank + mark).filter(member => member !== card);
      return ask([face], others.map(member => positionAfterCut(slot(member), index)), [card, ...others], others.map(cardLabel));
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
      return ask([face, cardLabel(bottom)], positionAfterCut(slot(mate), cut), [card, mate, bottom]);
    }
    case 'forward-distance': return ask([face, cardLabel(other)], forwardDistance(index, otherIndex), [card, other]);
    case 'backward-distance': return ask([face, cardLabel(other)], forwardDistance(otherIndex, index), [card, other]);
    case 'between': return ask([face, cardLabel(other)], forwardDistance(index, otherIndex) - 1, [card, other]);
    case 'forward-offset': return ask([face, variant + 1], other, [card, other]);
    case 'backward-offset': return ask([face, variant + 1], at(index - variant - 1), [card, at(index - variant - 1)]);
    case 'relative-position': return ask([cardLabel(bottom), face], positionAfterCut(index, cut), [card, bottom]);
    case 'relative-card':
    case 'offset-order': return ask([cardLabel(bottom), fromTop], at(cut + index), [bottom, at(cut + index)]);
    case 'bottom-position': return ask([face], fromBottom);
    case 'bottom-card': return ask([fromBottom], card);
    case 'single-missing':
    case 'multiple-missing':
    case 'shuffled-missing': {
      const start = Math.min(index, size - 7);
      const segment = cards.slice(start, start + 7);
      const first = (index - start + variant) % 7;
      const gaps = skill === 'single-missing' ? [first] : [first, (first + 3) % 7];
      const missing = gaps.map(i => segment[i]);
      let shown = segment.filter((_, i) => !gaps.includes(i));
      if (skill === 'shuffled-missing') shown = [shown[2], shown[0], shown[4], shown[1], shown[3]];
      return ask([start + 1, start + segment.length, missing.length], missing, missing, [], true, shown);
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
const fixed = new Set([...basic, ...rankOnly, 'quartet-distances', 'relative-quartet', 'next-rank', 'previous-rank', 'mate-position', 'mate-distance', 'bottom-position', 'bottom-card', 'offset-order']);

export function questionSet(model, skills, { start = 1, end = size, random = Math.random, sequential = false, eligible = () => true } = {}) {
  const buckets = skills.map(skill => {
    const seen = new Set();
    const variants = fixed.has(skill) ? 1 : 8;
    const items = [];
    for (let index = start - 1; index < end; index++) {
      if (start !== 1 || end !== size) {
        if ((skill === 'previous' && index === start - 1) || (skill === 'next' && index === end - 1)) continue;
      }
      const key = rank(model.cards[index]);
      if (rankOnly.has(skill) && seen.has(key)) continue;
      seen.add(key);
      const firstVariant = sequential ? index % 13 : Math.floor(random() * 45);
      for (let i = 0; i < variants; i++) {
        const prompt = buildQuestion(model, skill, index, (firstVariant + i) % 51);
        if (prompt && eligible(prompt)) items.push(prompt);
      }
    }
    return sequential ? items : shuffle(items, random);
  });
  if (!sequential) shuffle(buckets, random);
  const questions = [];
  const seen = new Set();
  const count = Math.max(0, ...buckets.map(bucket => bucket.length));
  for (let i = 0; i < count; i++) {
    for (const bucket of buckets) {
      const prompt = bucket[i];
      if (!prompt) continue;
      const key = JSON.stringify([prompt.kind, prompt.args, prompt.shown]);
      if (seen.has(key)) continue;
      seen.add(key);
      questions.push(prompt);
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
