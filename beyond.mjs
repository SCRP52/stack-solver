import { deckLength, cardLabel, redCard } from './stack-library.mjs';
import { ranks } from './solver.mjs';
import { hands, rotatedDeck, straights } from './jazzing.mjs?v=34';

export const beyond = {
  recall: ['earlier', 'first-card', 'last-card', 'recall-up', 'recall-down', 'recall-progressive', 'recall-full'],
  split: ['split-one', 'split-group', 'split-full'],
  relations: ['next-suit', 'previous-suit', 'next-color', 'previous-color', 'next-opposite', 'previous-opposite', 'next-color-suit', 'previous-color-suit'],
  knowledge: ['color-count', 'suit-count', 'suit-distribution', 'value-sum'],
  poker: ['poker-hand'],
  straight: ['specific-straight'],
  'undo-influence': ['twice-as-hard'],
};

export const splitDefaults = { 2: [26, 26], 3: [18, 17, 17], 4: [13, 13, 13, 13], 5: [11, 11, 10, 10, 10] };
export const suitOrder = ['♠', '♥', '♣', '♦'];
export const isRecallOrder = kind => kind.startsWith('recall-');
export const isSplit = kind => kind.startsWith('split-');
export const isJazzing = kind => kind === 'poker-hand' || kind === 'specific-straight';
const mod = n => (n + deckLength) % deckLength;
const rank = card => card.slice(0, -1);
const suit = card => card.at(-1);
const allSuits = ['S', 'H', 'C', 'D'];

export function parseSplit(raw, count) {
  if (!raw.trim()) return [...splitDefaults[count]];
  const pieces = raw.trim().split(/[\s,;–-]+/);
  const sizes = pieces.map(Number);
  if (sizes.length !== count || pieces.some(piece => !/^\d+$/.test(piece)) ||
    sizes.some(size => size < 1) || sizes.reduce((sum, size) => sum + size, 0) !== deckLength) throw new Error('splitSizes');
  return sizes;
}

export function splitPile(index, sizes) {
  let boundary = 0;
  return sizes.findIndex(size => { boundary += size; return index < boundary; }) + 1;
}

function shuffled(values, random) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function scramble(values, random) {
  const result = shuffled(values, random);
  if (result.every((value, i) => value === values[i])) result.push(result.shift());
  return result;
}

const question = (kind, args, answer, focus, shown = [], extra = {}) => ({ kind, args, answer, focus, shown, unordered: false, ...extra });

function twiceAsHardQuestions(model) {
  const questions = [];
  // Leave one possible selection cut strictly between A and B and one below B.
  for (let low = 2; low <= deckLength - 3; low++) {
    for (let high = low + 2; high < deckLength; high++) {
      const a = deckLength - high;
      const b = a + low;
      const answer = [model.at(a - 1), model.at(b - 1)];
      questions.push(question('twice-as-hard', [low, high], answer, answer, [], { entryLabels: ['A', 'B'] }));
    }
  }
  return questions;
}

function makeQuestion(model, kind, index, { random, piles, first, last, hand }) {
  const { cards, slot, at } = model;
  const card = at(index);
  if (beyond.recall.includes(kind)) {
    const count = kind === 'earlier' ? 2 : kind === 'recall-full' ? 52 : kind === 'recall-progressive' ? Math.min(26, 3 + Math.floor(index / 3)) : 5;
    const sample = shuffled(cards, random).slice(0, count);
    const ordered = sample.sort((a, b) => slot(a) - slot(b));
    if (kind === 'recall-down') ordered.reverse();
    const answer = isRecallOrder(kind) ? ordered : [kind === 'last-card' ? ordered.at(-1) : ordered[0]];
    return question(kind, [], answer, answer, scramble(ordered, random));
  }
  if (isSplit(kind)) {
    const count = kind === 'split-one' ? 1 : kind === 'split-full' ? 52 : 8;
    const shown = count === 1 ? [card] : shuffled(cards, random).slice(0, count);
    return question(kind, [], shown.map(item => splitPile(slot(item), piles)), shown, shown, { piles });
  }
  if (beyond.relations.includes(kind)) {
    const [direction, ...condition] = kind.split('-');
    const step = direction === 'next' ? 1 : -1;
    const pattern = condition.join('-');
    for (let distance = 1; distance < deckLength; distance++) {
      const other = at(mod(slot(card) + step * distance));
      const sameColor = redCard(other) === redCard(card);
      const sameSuit = suit(other) === suit(card);
      if ({ suit: sameSuit, color: sameColor, opposite: !sameColor, 'color-suit': sameColor && !sameSuit }[pattern]) {
        return question(kind, [cardLabel(card)], [other], [card, other]);
      }
    }
  }
  if (isJazzing(kind)) {
    const selected = kind === 'poker-hand' ? (hand === 'all' ? Object.keys(hands)[Math.floor(index / deckLength) % Object.keys(hands).length] : hand) : null;
    const targetRanks = kind === 'specific-straight' ? straights[Math.floor(index / deckLength) % straights.length] : null;
    return question(kind, [cardLabel(card), first, last], null, [card], [], {
      jazz: { cards: rotatedDeck(cards, card), hand: selected, targetRanks, first, last },
    });
  }

  const direction = kind === 'suit-distribution' ? 'between' : ['above', 'below', 'between'][Math.floor(index / deckLength) % 3];
  const cardSlot = slot(card);
  const second = mod(cardSlot + 1 + Math.floor(random() * 51));
  const low = Math.min(cardSlot, second);
  const high = Math.max(cardSlot, second);
  const region = direction === 'above' ? cards.slice(0, cardSlot)
    : direction === 'below' ? cards.slice(cardSlot + 1) : cards.slice(low + 1, high);
  const locations = direction === 'between' ? [cardLabel(at(low)), cardLabel(at(high))] : [cardLabel(card)];
  const focus = direction === 'between' ? [at(low), at(high)] : [card];
  const chosenSuit = allSuits[Math.floor(index / 7) % allSuits.length];
  const red = Math.floor(index / 5) % 2 === 0;
  const countSuit = mark => region.filter(item => suit(item) === mark).length;
  const condition = kind === 'color-count' ? (red ? 'red' : 'black') : kind === 'suit-count' ? chosenSuit : '';
  const answer = kind === 'color-count' ? [region.filter(item => redCard(item) === red).length]
    : kind === 'suit-count' ? [countSuit(chosenSuit)]
      : kind === 'suit-distribution' ? allSuits.map(countSuit) : [region.reduce((total, item) => total + ranks.indexOf(rank(item)) + 1, 0)];
  return question(kind, locations, answer, focus, [], { direction, condition, zeroAllowed: true,
    maxAnswer: kind === 'value-sum' ? 364 : deckLength - 1, numericDigits: kind === 'value-sum' ? 3 : 2,
    entryLabels: kind === 'suit-distribution' ? suitOrder : null });
}

export function beyondQuestions(model, skills, { sequential = false, eligible = () => true, random = Math.random,
  piles = splitDefaults[4], first = 1, last = 13, hand = 'all' } = {}) {
  const options = { random, piles, first, last, hand };
  const buckets = skills.map(kind => {
    if (kind === 'twice-as-hard') {
      const questions = twiceAsHardQuestions(model).filter(eligible);
      return sequential ? questions : shuffled(questions, random);
    }
    const unique = new Set();
    const count = kind.endsWith('-full') ? 1 : kind === 'recall-progressive' ? 72 : beyond.knowledge.includes(kind) ? deckLength * 3
      : kind === 'poker-hand' && hand === 'all' ? deckLength * Object.keys(hands).length
        : kind === 'specific-straight' ? deckLength * straights.length : deckLength;
    const questions = [];
    for (let i = 0; i < count; i++) {
      const q = makeQuestion(model, kind, i, options);
      const key = JSON.stringify([q.args, q.direction, q.condition, q.jazz?.hand, q.jazz?.targetRanks, [...q.shown].sort()]);
      if (unique.has(key) || !eligible(q)) continue;
      unique.add(key);
      questions.push(q);
    }
    return sequential || kind === 'recall-progressive' ? questions : shuffled(questions, random);
  });
  const all = [];
  const count = Math.max(0, ...buckets.map(bucket => bucket.length));
  for (let i = 0; i < count; i++) {
    for (const bucket of sequential ? buckets : shuffled(buckets, random)) if (bucket[i]) all.push(bucket[i]);
  }
  return all;
}
