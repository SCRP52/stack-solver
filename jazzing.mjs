import { ranks } from './solver.mjs';

export const hands = { pair: 2, 'two-pair': 4, three: 3, straight: 5, flush: 5, 'full-house': 5, four: 4, 'straight-flush': 5, royal: 5 };
export const straights = [...Array.from({ length: 9 }, (_, i) => ranks.slice(i, i + 5)), ['10', 'J', 'Q', 'K', 'A']];
const rankOf = card => card.slice(0, -1);
const suitOf = card => card.at(-1);
const ascending = (a, b) => a - b;
const rankKey = values => [...values].sort().join(' ');
const straightKeys = new Set(straights.map(rankKey));
const royalKey = rankKey(straights.at(-1));

export function rotatedDeck(cards, bottom) {
  const cut = cards.indexOf(bottom) + 1;
  return [...cards.slice(cut), ...cards.slice(0, cut)];
}

export const jazzPositions = ({ first, last, cards }) => [...Array.from({ length: last - first + 1 }, (_, i) => first + i),
  ...(last < cards.length ? [cards.length] : [])];
export const jazzLength = context => context.targetRanks?.length ?? hands[context.hand];

export function validJazz(context, positions) {
  const { cards, hand, targetRanks, first, last } = context;
  if (positions.length !== jazzLength(context) || new Set(positions).size !== positions.length ||
    positions.some(position => !Number.isInteger(position) || position !== cards.length && (position < first || position > last))) return false;
  const selected = positions.map(position => cards[position - 1]);
  const values = selected.map(rankOf);
  const valuesKey = rankKey(values);
  if (targetRanks) return valuesKey === rankKey(targetRanks);
  const flush = selected.every(card => suitOf(card) === suitOf(selected[0]));
  const straight = straightKeys.has(valuesKey);
  if (hand === 'straight') return straight;
  if (hand === 'flush') return flush;
  if (hand === 'straight-flush') return straight && flush;
  if (hand === 'royal') return flush && valuesKey === royalKey;
  const counts = new Map();
  for (const rank of values) counts.set(rank, (counts.get(rank) ?? 0) + 1);
  const pattern = [...counts.values()].sort(ascending).join('');
  return pattern === { pair: '2', 'two-pair': '22', three: '3', 'full-house': '23', four: '4' }[hand];
}

export function jazzScore(positions, bottom = 52) {
  const top = positions.filter(position => position !== bottom).sort(ascending);
  if (top.length < 2) return [top[0] ?? Infinity, 0, 0];
  const gaps = top.slice(1).map((position, i) => position - top[i]);
  return [top[0], top.at(-1) - top[0], Math.max(...gaps) - Math.min(...gaps)];
}

export function compareScore(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

function* combinations(values, count, start = 0, picked = []) {
  if (!count) { yield picked; return; }
  for (let i = start; i <= values.length - count; i++) yield* combinations(values, count - 1, i + 1, [...picked, values[i]]);
}

function* combinationsAcross(groups, index = 0, picked = []) {
  if (index === groups.length) { yield picked; return; }
  for (const value of groups[index]) yield* combinationsAcross(groups, index + 1, [...picked, value]);
}

function groupPositions(positions, cards, keyFor) {
  const groups = new Map();
  for (const position of positions) {
    const key = keyFor(cards[position - 1]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(position);
  }
  return groups;
}

function* jazzCandidates(context) {
  const { cards, hand, targetRanks } = context;
  const available = jazzPositions(context);
  if (hand === 'flush' || hand === 'straight-flush' || hand === 'royal') {
    for (const suit of groupPositions(available, cards, suitOf).values()) {
      if (hand === 'flush') yield* combinations(suit, 5);
      else {
        const byRank = groupPositions(suit, cards, rankOf);
        const patterns = hand === 'royal' ? [straights.at(-1)] : straights;
        for (const pattern of patterns) yield* combinationsAcross(pattern.map(rank => byRank.get(rank) ?? []));
      }
    }
    return;
  }
  const byRank = groupPositions(available, cards, rankOf);
  if (hand === 'straight' || targetRanks) {
    for (const pattern of targetRanks ? [targetRanks] : straights) {
      yield* combinationsAcross(pattern.map(rank => byRank.get(rank) ?? []));
    }
    return;
  }
  const groups = [...byRank.values()];
  if (hand === 'two-pair' || hand === 'full-house') {
    for (let first = 0; first < groups.length; first++) {
      for (let second = hand === 'two-pair' ? first + 1 : 0; second < groups.length; second++) {
        if (first === second) continue;
        for (const left of combinations(groups[first], hand === 'two-pair' ? 2 : 3)) {
          for (const right of combinations(groups[second], 2)) yield [...left, ...right];
        }
      }
    }
    return;
  }
  for (const group of groups) yield* combinations(group, hands[hand]);
}

const compareSolutions = (a, b) => compareScore(a.rank, b.rank) || compareScore(a.positions, b.positions);
const bottomTolerance = { first: 1, span: 2 };

function rankedScore(positions, score, bottom, baseline) {
  if (!positions.includes(bottom)) return [1, ...score];
  const competitive = !baseline ||
    score[0] <= baseline[0] + bottomTolerance.first && score[1] <= baseline[1] + bottomTolerance.span;
  return [competitive ? 0 : 2, ...score];
}

export function findJazzOptions(context, limit = 3) {
  const options = [];
  const bottom = context.cards.length;
  let baseline = null;
  let count = 0;
  for (const positions of jazzCandidates(context)) {
    count++;
    if (positions.includes(bottom)) continue;
    const score = jazzScore(positions, bottom);
    if (!baseline || compareScore(score, baseline) < 0) baseline = score;
  }
  if (!limit) return { options, count, baseline };
  for (const positions of jazzCandidates(context)) {
    const score = jazzScore(positions, bottom);
    const rank = rankedScore(positions, score, bottom, baseline);
    if (options.length === limit && compareScore(rank, options.at(-1).rank) > 0) continue;
    const option = { positions: positions.sort(ascending), score, rank };
    options.push(option);
    options.sort(compareSolutions);
    if (options.length > limit) options.pop();
  }
  return { options, count, baseline };
}

export function gradeJazz(context, positions) {
  const found = findJazzOptions(context);
  if (positions === null) return { ...found, valid: found.count === 0, noSolution: true };
  const valid = validJazz(context, positions);
  const score = valid ? jazzScore(positions, context.cards.length) : null;
  const best = found.options[0];
  const rank = valid ? rankedScore(positions, score, context.cards.length, found.baseline) : null;
  const comparison = valid && best ? compareScore(rank, best.rank) : null;
  return { ...found, valid, score, optimal: comparison === 0, betterOptions: valid && comparison > 0
    ? found.options.filter(option => compareScore(option.rank, rank) < 0) : valid ? [] : found.options };
}
