import { ConverterError } from './i18n.mjs';

export const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
// Keep the character encoding stable for saved solutions. Deck presets define
// physical card order separately from this internal lookup table.
const cardsById = [...'SDCH'].flatMap(suit => (('SD'.includes(suit) ? ranks : [...ranks].reverse()).map(rank => rank + suit)));
export const ndo = [...cardsById].reverse();
const size = cardsById.length;
const base = 33;
const ids = cardsById.map((_, i) => String.fromCharCode(base + i)).join('');
const cardIds = new Map(cardsById.map((card, i) => [card, ids[i]]));
const index = letter => letter.charCodeAt(0) - base;
const suits = { '♠': 'S', '♦': 'D', '♣': 'C', '♥': 'H' };

export const defaults = {
  out: true, in: true, near: true, cut: true, multiCut: false, multiCutReorder: false, run: true, cull: true,
  reverse: true, deal: false, dealMax: 10, dealOrder: 'ordered',
  faroWindow: 8, runMax: 39, cullMax: 5, cullDeeper: true, reverseCull: true, multiCutMax: 10,
};

export const mnemonica = '4C 2H 7D 3C 4H 6D AS 5H 9S 2S QH 3D QC 8H 6S 5S 9H KC 2D JH 3S 8S 6H 10C 5D KD 2C 3H 8D 5C KS JD 8C 10S KH JC 7S 10H AD 4S 7H 4D AC 9C JS QD 7C QS 10D 6C AH 9D';

const normalizeCards = raw => raw.trim().toUpperCase().replace(/[♠♦♣♥]/g, suit => suits[suit]);
const normalizeRank = card => card.replace(/^T([SDCH])$/, '10$1');

export function parseCards(raw) {
  const cards = normalizeCards(raw).split(/[\s,;|/]+/).filter(Boolean).map(normalizeRank);
  const invalid = cards.find(card => !cardIds.has(card));
  if (invalid) throw new ConverterError('unknownCard', invalid);
  if (new Set(cards).size !== cards.length) throw new ConverterError('repeatCard');
  if (cards.length !== size) throw new ConverterError('deckSize', cards.length);
  return cards.map(card => cardIds.get(card)).join('');
}

export function parsePositions(raw) {
  const entries = normalizeCards(raw).replace(/\s*[:=]\s*/g, '=').split(/[\s,;]+/).filter(Boolean);
  if (!entries.length) throw new ConverterError('needPositions');
  const slots = new Set();
  const cards = new Set();
  return entries.map(entry => {
    const match = /^(\d+)=([A-Z0-9]+)$/.exec(entry);
    if (!match) throw new ConverterError('badPosition', entry);
    const position = Number(match[1]);
    const card = cardIds.get(normalizeRank(match[2]));
    if (position < 1 || position > size) throw new ConverterError('positionRange', position);
    if (!card) throw new ConverterError('unknownCard', match[2]);
    if (slots.has(position) || cards.has(card)) throw new ConverterError('repeatPosition');
    slots.add(position);
    cards.add(card);
    return [position - 1, card];
  }).sort(([a], [b]) => a - b);
}

export const displayCards = state => [...state].map(letter => cardsById[index(letter)]);
export const newDeck = () => ndo.map(card => cardIds.get(card)).join('');

function weaveMap(mask) {
  const split = [...mask].filter(letter => letter === 'A').length;
  let a = 0;
  let b = split;
  return Array.from(mask, letter => letter === 'A' ? a++ : b++);
}

function interleave(split, first, lead = 0) {
  const pairs = Math.min(split, size - split);
  const spare = split > 26 ? 'A' : 'B';
  return spare.repeat(lead) + (first === 'A' ? 'AB' : 'BA').repeat(pairs) + spare.repeat(size - 2 * pairs - lead);
}

function applyMap(state, map) {
  let next = '';
  for (let i = 0; i < size; i++) next += state[map[i]];
  return next;
}

function compileMap(map) {
  const runs = [];
  for (const from of map) {
    const last = runs.at(-1);
    if (last && last[1] === from) last[1]++;
    else runs.push([from, from + 1]);
  }
  if (runs.length > 16) return state => applyMap(state, map);
  return state => {
    let next = '';
    for (const [from, to] of runs) next += to === from + 1 ? state[from] : state.slice(from, to);
    return next;
  };
}

const positions = Array.from({ length: size }, (_, i) => i);
const pileSlots = Array.from({ length: 11 }, (_, count) => Array.from({ length: count },
  (_, pile) => positions.filter(slot => slot % count === pile).reverse()));
const rotate = (state, n) => state.slice(n) + state.slice(0, n);
const cullKey = slots => slots.join(',');

function reverseRange(state, from, to) {
  let reversed = '';
  for (let i = to - 1; i >= from; i--) reversed += state[i];
  return reversed;
}

function moveFromMap(kind, label, map, params, apply) {
  const key = String.fromCharCode(...map.map(i => i + base));
  if (key === ids) return null;
  const inverse = new Uint8Array(size);
  map.forEach((from, to) => { inverse[from] = to; });
  const inverseKey = String.fromCharCode(...Array.from(inverse, to => to + base));
  return { kind, label, params, map, inverse, inverseKey, key, apply: apply ?? compileMap(map), undo: compileMap(inverse) };
}

const flipSlot = slot => size - 1 - slot;
const flipSlots = slots => slots.map(flipSlot).reverse();

export function makeCullMove(slots, landing, options = defaults, direction = 'down') {
  if (!options.cull || !slots.length || slots.length > options.cullMax) return null;
  const destinations = Array.isArray(landing) ? landing : slots.map((_, i) => landing + i);
  if (destinations.length !== slots.length) return null;
  if (slots.some((slot, i) => !Number.isInteger(slot) || slot < 0 || slot >= size || (i && slot <= slots[i - 1]))) return null;
  const up = direction === 'up';
  if (destinations.some((dest, i) => !Number.isInteger(dest) || dest < 0 || dest >= size ||
    (up ? dest >= slots[i] : dest <= slots[i]) || (i && dest <= destinations[i - 1]))) return null;
  const atEnd = destinations.every((dest, i) => dest === (up ? i : size - slots.length + i));
  if (!options.cullDeeper && !atEnd) return null;

  const rest = positions.filter(i => !slots.includes(i));
  const loads = new Map(destinations.map((dest, i) => [dest, slots[i]]));
  let next = 0;
  const map = positions.map(i => loads.get(i) ?? rest[next++]);
  const first = slots[0];
  const [insertAt] = destinations;
  const label = `Cull ${slots.length} · ${up ? 'dưới lên' : 'trên xuống'}`;
  const apply = slots.length === 1 && !up
    ? state => state.slice(0, first) + state.slice(first + 1, insertAt + 1) + state[first] + state.slice(insertAt + 1)
    : undefined;
  return moveFromMap('cull', label, map, { slots, destinations, direction }, apply);
}

export function makeReverseCullMove(insertAt) {
  if (!Number.isInteger(insertAt) || insertAt < 0 || insertAt >= size - 1) return null;
  const map = positions.slice(0, insertAt).concat(size - 1, positions.slice(insertAt, -1));
  return moveFromMap('reverse-cull', 'Reverse cull · dưới lên', map,
    { slots: [size - 1], destinations: [insertAt], insertAt, direction: 'up' },
    state => state.slice(0, insertAt) + state.at(-1) + state.slice(insertAt, -1));
}

export function makeDealMove(count, order) {
  if (!Number.isInteger(count) || count < 2 || count > 10 || !Array.isArray(order) || order.length !== count ||
    new Set(order).size !== count || order.some(pile => !Number.isInteger(pile) || pile < 1 || pile > count)) return null;
  const map = order.flatMap(pile => pileSlots[count][pile - 1]);
  return moveFromMap('deal', `Chia ${count} tụ · gom ${order.join(' → ')}`, map, { count, order: order.slice() });
}

function* allPileOrders(piles, used = []) {
  if (!piles.length) { yield used; return; }
  for (let i = 0; i < piles.length; i++) {
    yield* allPileOrders(piles.slice(0, i).concat(piles.slice(i + 1)), used.concat(piles[i]));
  }
}

const threePileOrders = [...allPileOrders([1, 2, 3])];
const blockCutSplits = [[13, 26], [13, 39], [26, 39], [13, 26, 39]];

function makeMultiCutMove(splits, order, stacked = false) {
  const boundaries = [0, ...splits, size];
  const map = order.flatMap(pile => positions.slice(boundaries[pile - 1], boundaries[pile]));
  const params = { splits, order, stacked };
  const label = `${stacked ? 'Cắt chồng' : 'Cắt'} ${order.length} cọc · ${splits.join(', ')} → ${order.join('–')}`;
  return moveFromMap('multi-cut', label, map, params);
}

function* cyclicPileOrders(count) {
  for (const direction of [1, -1]) {
    for (let start = 0; start < count; start++) {
      yield Array.from({ length: count }, (_, i) => (start + direction * i + count) % count + 1);
    }
  }
}

export function cullTimeline({ slots, destinations, direction = 'down' }) {
  if (!destinations) return [];
  const up = direction === 'up';
  if (up) { slots = flipSlots(slots); destinations = flipSlots(destinations); }
  const pickups = new Map(slots.map((slot, i) => [slot, i]));
  const loads = new Map(destinations.map((dest, i) => [dest, i]));
  const cardIndex = index => up ? slots.length - 1 - index : index;
  const originalSlot = slot => slot >= 0 && slot < size ? (up ? flipSlot(slot) : slot) : null;
  const events = [];
  let cursor = 0;
  let previous = -1;
  const pick = () => events.push({ type: 'pick', card: cardIndex(pickups.get(cursor++)) });
  for (let dest = 0; dest < size; dest++) {
    const load = loads.get(dest);
    if (load !== undefined) {
      while (cursor <= slots[load]) pick();
      const before = originalSlot(previous);
      const after = originalSlot(cursor);
      events.push({ type: 'load', card: cardIndex(load), above: up ? after : before, below: up ? before : after });
      previous = slots[load];
    } else {
      while (pickups.has(cursor)) pick();
      previous = cursor++;
    }
  }
  return events;
}

export function makeMoves(options = defaults) {
  const config = { ...defaults, ...options };
  const unique = new Map();
  const cuts = new Map();
  const runs = new Map();
  const culls = new Map();

  function keep(move) {
    if (!move) return null;
    const existing = unique.get(move.key);
    if (existing) return existing;
    unique.set(move.key, move);
    return move;
  }

  function add(kind, label, map, params = {}, apply) {
    return keep(moveFromMap(kind, label, map, params, apply));
  }

  for (const kind of ['out', 'in']) {
    const first = kind === 'out' ? 'A' : 'B';
    if (config[kind]) add('faro', `Faro ${kind}`, weaveMap(interleave(26, first)), { split: 26, first });
    if (config.near) {
      if (!Number.isInteger(config.faroWindow) || config.faroWindow < 1 || config.faroWindow > 25) {
        throw new ConverterError('faroRange');
      }
      for (let split = 26 - config.faroWindow; split <= 26 + config.faroWindow; split++) {
        if (split === 26) continue;
        const spare = split > 26 ? 'A' : 'B';
        const extra = 2 * Math.abs(26 - split);
        for (const lead of [0, extra]) {
          const from = lead ? 'bottom' : 'top';
          const label = `Faro ${kind} ${split}/${size - split} · xen từ ${lead ? 'đáy' : 'đầu'}`;
          add('faro', label, weaveMap(interleave(split, first, lead)), { split, first, lead, spare, tail: extra - lead, from });
        }
      }
    }
  }
  if (config.cut) {
    for (let n = 1; n < size; n++) {
      const map = positions.slice(n).concat(positions.slice(0, n));
      const move = add('cut', `Cut ${n}`, map, { n }, state => rotate(state, n));
      if (move.kind === 'cut') move.undo = state => rotate(state, size - n);
      cuts.set(n, move);
    }
  }
  if (config.run) {
    for (let n = 2; n <= config.runMax; n++) {
      const map = positions.slice(n).concat(positions.slice(0, n).reverse());
      const move = add('run', `Run ${n}`, map, { n }, state => state.slice(n) + reverseRange(state, 0, n));
      if (move.kind === 'run') move.undo = state => reverseRange(state, size - n, size) + state.slice(0, size - n);
      runs.set(n, move);
    }
  }
  if (config.reverse) {
    for (let n = 2; n <= config.runMax; n++) {
      const apply = state => reverseRange(state, 0, n) + state.slice(n);
      const map = positions.slice(0, n).reverse().concat(positions.slice(n));
      const move = add('reverse', `Đảo ${n} lá đầu`, map, { n }, apply);
      if (move.kind === 'reverse') move.undo = apply;
    }
  }
  let wideMultiCut = null;
  const multiCut = options.multiCut ?? Boolean(options.multiCutOverhand || options.multiCutReorder);
  if (multiCut) {
    if (!Number.isInteger(config.multiCutMax) || config.multiCutMax < 3 || config.multiCutMax > 10) {
      throw new ConverterError('cutRange');
    }
    wideMultiCut = { maxPiles: config.multiCutMax, reorder: config.multiCutReorder, allowRotation: !config.cut };
    // Keep suit-sized blocks available during the search. Other cut positions
    // are inferred from the decks or varied dynamically.
    for (const splits of blockCutSplits) {
      const count = splits.length + 1;
      if (count > config.multiCutMax) continue;
      const piles = Array.from({ length: count }, (_, i) => i + 1);
      keep(makeMultiCutMove(splits, [...piles].reverse(), true));
      if (config.multiCutReorder) {
        for (const order of allPileOrders(piles)) keep(makeMultiCutMove(splits, order));
      }
    }
  }
  if (config.deal) {
    if (!Number.isInteger(config.dealMax) || config.dealMax < 2 || config.dealMax > 10) {
      throw new ConverterError('dealRange');
    }
    if (!['ordered', 'any'].includes(config.dealOrder)) throw new ConverterError('dealOrder');
    for (let count = 2; count <= config.dealMax; count++) {
      const orders = config.dealOrder === 'any' && count <= 5
        ? allPileOrders(Array.from({ length: count }, (_, i) => i + 1)) : cyclicPileOrders(count);
      for (const order of orders) {
        const move = makeDealMove(count, order);
        if (move && !unique.has(move.key)) unique.set(move.key, move);
      }
    }
  }
  // The lookup graph keeps a small cull vocabulary. The larger culls are
  // generated against the deck being solved, since choosing five subsets
  // and every landing point would dwarf the other move families.
  const wideCull = config.cull && (config.cullDeeper || config.cullMax > 2);
  if (config.cull) {
    if (!Number.isInteger(config.cullMax) || config.cullMax < 1 || config.cullMax > 5) {
      throw new ConverterError('cullRange');
    }
    for (let a = 0; a < size; a++) {
      keep(makeCullMove([a], 0, config, 'up'));
      if (!wideCull && config.cullMax === 2) {
        for (let b = a + 1; b < size; b++) keep(makeCullMove([a, b], 0, config, 'up'));
      }
    }
    function addCull(slots) {
      const move = keep(makeCullMove(slots, size - slots.length, config));
      if (move) culls.set(cullKey(slots), move);
    }
    for (let a = 0; a < size; a++) {
      addCull([a]);
      if (!wideCull && config.cullMax === 2) for (let b = a + 1; b < size; b++) addCull([a, b]);
    }
  }
  if (config.reverseCull) {
    for (let insertAt = 0; insertAt < size - 1; insertAt++) {
      const move = makeReverseCullMove(insertAt);
      if (!unique.has(move.key)) unique.set(move.key, move);
    }
  }
  const wideDeal = config.deal && config.dealOrder === 'any' && config.dealMax > 5;
  return { list: [...unique.values()], unique, cuts, culls, runs, config, wideCull, wideDeal, wideMultiCut };
}

const isCull = move => move?.kind === 'cull' || move?.kind === 'reverse-cull';
const sameCull = (a, b) => isCull(a) && isCull(b);
const isHeavy = move => isCull(move) || move?.kind === 'multi-cut';

function handlingPenalty(move, neighbor) {
  let penalty = isHeavy(move) ? 2 : 0;
  if (move.kind === 'multi-cut' && neighbor?.kind === 'multi-cut') penalty += 2;
  else if ((isCull(move) && neighbor?.kind === 'cut') || (isCull(neighbor) && move.kind === 'cut')) penalty++;
  return penalty;
}

export function replay(start, route) {
  const steps = [];
  let state = start;
  for (const move of route) {
    if (sameCull(steps.at(-1), move)) throw new ConverterError('cullsConsecutive');
    const cards = isCull(move) ? move.params.slots.map(slot => cardsById[index(state[slot])]) : undefined;
    state = move.apply(state);
    steps.push({ kind: move.kind, label: move.label, params: move.params, cards, deck: displayCards(state) });
  }
  return { final: state, steps };
}

function findDirectCull(start, target, config) {
  if (start === target) return null;
  if (config.reverseCull) {
    const dest = target.indexOf(start.at(-1));
    if (dest < size - 1 && target.slice(0, dest) + target.slice(dest + 1) === start.slice(0, -1)) {
      return makeReverseCullMove(dest);
    }
  }
  if (!config.cull) return null;

  const sourceSlots = new Uint8Array(size);
  for (let i = 0; i < size; i++) sourceSlots[index(start[i])] = i;

  function alongSpread(direction) {
    const up = direction === 'up';
    const slots = [];
    const destinations = [];
    let lastUnmoved = -1;
    let lastPicked = -1;
    // Read both streams in the direction of the spread. Only picked cards
    // move further along that direction, and each stream preserves its order.
    for (let dest = 0; dest < size; dest++) {
      const originalSlot = sourceSlots[index(target[up ? flipSlot(dest) : dest])];
      const original = up ? flipSlot(originalSlot) : originalSlot;
      if (dest > original) {
        if (slots.length === config.cullMax || original <= lastPicked) return null;
        slots.push(original);
        destinations.push(dest);
        lastPicked = original;
      } else {
        if (original <= lastUnmoved) return null;
        lastUnmoved = original;
      }
    }
    return makeCullMove(up ? flipSlots(slots) : slots, up ? flipSlots(destinations) : destinations, config, direction);
  }
  return alongSpread('up') ?? alongSpread('down');
}

function findDirectDeal(start, target, max) {
  // Once piles are collected, the first card of each remaining pile identifies
  // that pile. Check it in place instead of generating up to 10! permutations.
  for (let count = 6; count <= max; count++) {
    const piles = pileSlots[count];
    const order = [];
    let cursor = 0;
    while (cursor < size) {
      const number = piles.findIndex(pile => target[cursor] === start[pile[0]]);
      if (number < 0 || order.includes(number + 1)) break;
      const pile = piles[number];
      if (pile.some((slot, i) => target[cursor + i] !== start[slot])) break;
      cursor += pile.length;
      order.push(number + 1);
    }
    if (order.length === count && cursor === size) return makeDealMove(count, order);
  }
  return null;
}

function findDirectMultiCut(start, target, { maxPiles, reorder, allowRotation }) {
  // Each packet is an intact run from the source deck. Its first position
  // tells us where the cut was made and where the packet was placed.
  const starts = [];
  let previous = -2;
  for (const card of target) {
    const position = start.indexOf(card);
    if (position !== previous + 1) {
      if (!reorder && starts.length && position >= starts.at(-1)) return null;
      starts.push(position);
      if (starts.length > maxPiles) return null;
    }
    previous = position;
  }
  if (starts.length < 2) return null;
  if (starts.length === 2) {
    if (!reorder || !allowRotation) return null;
    // A rotation can also be made with three packets when only this move is enabled.
    if (starts[0] < size - 1) starts.splice(1, 0, starts[0] + 1);
    else starts.push(1);
  }
  const boundaries = [...starts].sort((a, b) => a - b);
  const order = starts.map(position => boundaries.indexOf(position) + 1);
  const stacked = order.every((pile, i) => pile === order.length - i);
  return makeMultiCutMove(boundaries.slice(1), order, stacked);
}

function directExpandedMove(start, target, moves, allowCull = true) {
  return (moves.wideDeal ? findDirectDeal(start, target, moves.config.dealMax) : null) ??
    (moves.wideMultiCut ? findDirectMultiCut(start, target, moves.wideMultiCut) : null) ??
    (allowCull && moves.wideCull ? findDirectCull(start, target, moves.config) : null);
}

function finishingKey(start, target) {
  const slots = new Uint8Array(size);
  for (let i = 0; i < size; i++) slots[index(start[i])] = i;
  let permutation = '';
  for (let i = 0; i < size; i++) permutation += ids[slots[index(target[i])]];
  return permutation;
}

function finishingMove(start, target, moves, allowCull = true) {
  const listed = moves.unique.get(finishingKey(start, target));
  if (listed && (allowCull || !isCull(listed))) return listed;
  return directExpandedMove(start, target, moves, allowCull);
}

function findShallowRoutes(start, target, moves, expired, offer, enough) {
  const before = new Map();
  const after = new Map();
  for (const move of moves.list) {
    if (expired()) return 0;
    const state = move.apply(start);
    if (state === target) offer([move]);
    before.set(state, move);
    after.set(move.undo(target), move);
  }
  if (moves.wideCull) offer([findDirectCull(start, target, moves.config)]);
  if (moves.wideDeal) offer([findDirectDeal(start, target, moves.config.dealMax)]);
  if (moves.wideMultiCut) offer([findDirectMultiCut(start, target, moves.wideMultiCut)]);
  for (const [state, first] of before) {
    if (expired() || enough(2)) return 1;
    const last = after.get(state);
    if (last && !sameCull(first, last)) offer([first, last]);
    offer([first, directExpandedMove(state, target, moves, !isCull(first))]);
  }
  for (const [state, last] of after) {
    if (expired() || enough(2)) return 1;
    offer([directExpandedMove(start, state, moves, !isCull(last)), last]);
  }
  // Only cull + cull is disallowed. Other pairs of dynamically generated
  // moves still need a search before we can rule out two-move solutions.
  const proved = moves.wideDeal || moves.wideMultiCut ? 1 : 2;
  const threeMoveDeadline = performance.now() + 350;
  let checked = 0;
  for (const [state, first] of before) {
    for (const middle of moves.list) {
      if ((++checked & 127) === 0 && (expired() || enough(3) || performance.now() >= threeMoveDeadline)) return proved;
      if (sameCull(first, middle)) continue;
      const last = after.get(middle.apply(state));
      if (last && !sameCull(middle, last)) offer([first, middle, last]);
    }
  }
  return proved;
}

function completeTarget(state, required) {
  const target = new Array(size);
  const fixed = new Set();
  for (const [slot, card] of required) {
    target[slot] = card;
    fixed.add(card);
  }
  let slot = 0;
  for (const card of state) {
    if (fixed.has(card)) continue;
    while (target[slot]) slot++;
    target[slot++] = card;
  }
  return target.join('');
}

function findPartialStackedCut(start, required, maxPiles) {
  const requiredSums = new Int16Array(size).fill(-1);
  for (const [destination, card] of required) {
    const source = start.indexOf(card);
    requiredSums[source] = size + source - destination;
  }
  const failed = new Set();
  function findSplits(from, remaining) {
    if (!remaining) return from === size ? [] : null;
    const key = from * (maxPiles + 1) + remaining;
    if (failed.has(key)) return null;
    let expected = -1;
    for (let end = from + 1; end <= size - remaining + 1; end++) {
      const sum = requiredSums[end - 1];
      if (sum !== -1) {
        if (expected !== -1 && expected !== sum) break;
        expected = sum;
      }
      // A packet [from, end) lands at size - end when packets are stacked.
      if (expected !== -1 && from + end !== expected) continue;
      const rest = findSplits(end, remaining - 1);
      if (rest) return end === size ? rest : [end, ...rest];
    }
    failed.add(key);
    return null;
  }
  for (let count = 3; count <= maxPiles; count++) {
    const splits = findSplits(0, count);
    if (splits) return makeMultiCutMove(splits, Array.from({ length: count }, (_, i) => count - i), true);
  }
  return null;
}

function searchPartialThreePileCuts(start, required, allowRotation, expired, offer, enough) {
  const orders = threePileOrders.filter(([first, second, third]) =>
    first !== 1 || second !== 2 || third !== 3).filter(([first, second]) => allowRotation || second !== first % 3 + 1);
  for (let a = 1; a < size - 1; a++) {
    for (let b = a + 1; b < size; b++) {
      if (expired() || enough(1)) return;
      const boundaries = [0, a, b, size];
      for (const order of orders) {
        const fits = required.every(([destination, card]) => {
          for (const pile of order) {
            const from = boundaries[pile - 1];
            const length = boundaries[pile] - from;
            if (destination < length) return start[from + destination] === card;
            destination -= length;
          }
          return false;
        });
        if (fits) offer([makeMultiCutMove([a, b], order, order[0] === 3 && order[1] === 2)]);
      }
    }
  }
}

function searchPartialShallow(start, required, moves, expired, offer, enough) {
  const expanded = moves.wideCull || moves.wideDeal || moves.wideMultiCut;
  const matches = state => required.every(([slot, card]) => state[slot] === card);
  const afterOne = [];
  for (const move of moves.list) {
    if (expired()) return 0;
    const state = move.apply(start);
    if (matches(state)) offer([move]);
    else afterOne.push([state, move]);
  }
  if (expanded) offer([directExpandedMove(start, completeTarget(start, required), moves)]);
  if (moves.wideMultiCut && !enough(1) && !expired()) {
    const { maxPiles, reorder, allowRotation } = moves.wideMultiCut;
    offer([findPartialStackedCut(start, required, maxPiles)]);
    if (reorder) searchPartialThreePileCuts(start, required, allowRotation, expired, offer, enough);
  }
  for (const [state, first] of afterOne) {
    if (expired() || enough(2)) return expanded ? 0 : 1;
    for (const last of moves.list) {
      if (!sameCull(first, last) && required.every(([slot, card]) => state[last.map[slot]] === card)) offer([first, last]);
    }
    if (expanded) offer([first, directExpandedMove(state, completeTarget(state, required), moves, !isCull(first))]);
  }
  if (expanded) {
    for (const last of moves.list) {
      if (expired() || enough(2)) break;
      const before = required.map(([slot, card]) => [last.map[slot], card]);
      offer([directExpandedMove(start, completeTarget(start, before), moves, !isCull(last)), last]);
    }
  }
  return expanded ? 0 : 2;
}

function searchPractical(start, target, required, moves, expired, offer, enough, width, adjacencyWeight = 8) {
  const operations = moves.list.filter(move => !isCull(move));
  if (!operations.some(move => move.kind !== 'cut')) return;
  function side(state, wanted, backward) {
    const root = { state, handling: 0 };
    const weights = Array.from({ length: size }, () => new Uint8Array(size));
    const nextCard = new Uint8Array(size);
    for (const [slot, card] of required ?? [...wanted].map((card, slot) => [slot, card])) {
      for (let at = Math.max(0, slot - 3); at <= Math.min(size - 1, slot + 3); at++) {
        weights[at][index(card)] = at === slot ? 12 : 4 - Math.abs(at - slot);
      }
    }
    for (let i = 0; i < size; i++) nextCard[index(wanted[i])] = index(wanted[(i + 1) % size]);
    return { root, frontier: [root], seen: new Map([[state, root]]), depth: 0, backward, weights, nextCard };
  }

  const left = side(start, target, false);
  const right = required ? { root: {} } : side(target, start, true);
  const neighbors = required ? 14 : 22;
  let checked = 0;
  for (let depth = 0; depth < neighbors && !enough(depth); depth++) {
    const [current, other] = !required && depth % 2 ? [right, left] : [left, right];
    if (!current.frontier.length) break;
    const { backward, weights, nextCard } = current;
    const candidates = new Map();
    for (const parent of current.frontier) {
      if (expired()) return;
      if (parent.move) {
        if (backward) {
          const first = directExpandedMove(start, parent.state, moves);
          if (first) offer([first, ...readRoute(left.root, parent)]);
        } else {
          const finish = directExpandedMove(parent.state, required ? completeTarget(parent.state, required) : target, moves);
          if (finish) offer([...readRoute(parent, right.root), finish]);
        }
      }
      for (const move of operations) {
        if ((++checked & 127) === 0 && expired()) return;
        if (parent.move?.kind === 'cut' && move.kind === 'cut') continue;
        const state = backward ? move.undo(parent.state) : move.apply(parent.state);
        const match = other.seen?.get(state);
        const handling = parent.handling + handlingPenalty(move, parent.move);
        const node = { state, parent, move, handling };
        if (match) offer(backward ? readRoute(match, node) : readRoute(node, match));
        if (required?.every(([slot, card]) => state[slot] === card)) { offer(readRoute(node, right.root)); continue; }
        const prior = candidates.get(state) ?? current.seen.get(state);
        if (prior && prior.handling <= handling) continue;
        let score = -6 * handling;
        let previous = index(state.at(-1));
        for (let slot = 0; slot < size; slot++) {
          const card = index(state[slot]);
          score += weights[slot][card];
          if (!required && nextCard[previous] === card) score += adjacencyWeight;
          previous = card;
        }
        candidates.set(state, { ...node, score });
      }
    }
    current.frontier = [...candidates.values()].sort((a, b) => b.score - a.score).slice(0, width);
    const anchors = current.depth++ === 0 ? candidates.values() : current.frontier;
    for (const node of anchors) current.seen.set(node.state, node);
  }
}

function cutAndAppend(route, move, moves) {
  const previous = route.at(-1);
  if (move.kind === 'cut' && previous?.kind === 'cut') {
    const count = (previous.params.n + move.params.n) % size;
    const combined = moves.cuts.get(count);
    if (count === 0) {
      // The pair may be separating culls, in which case keep both cuts.
      if (!isCull(route.at(-2))) { route.pop(); return; }
    } else if (combined?.kind === 'cut') {
      route[route.length - 1] = combined;
      return;
    }
  }
  route.push(move);
}

// Grow a contiguous part of the goal backward. After each cull to the end,
// a real cut brings the new cards in front of the already ordered block.
function buildWithCulls(start, target, moves, rotation) {
  if (!moves.culls.size || !moves.cuts.size) return null;
  const wanted = rotate(target, rotation);
  const route = [];
  let state = start;
  const anchor = state.indexOf(wanted.at(-1));
  if (anchor) {
    const cut = moves.cuts.get(anchor);
    route.push(cut);
    state = cut.apply(state);
  }
  for (let end = size - 2; end >= 0;) {
    let count = 1;
    const last = state.indexOf(wanted[end]);
    const slots = [last];
    if (last < size - 1) {
      while (count < moves.config.cullMax && end >= count) {
        const first = state.indexOf(wanted[end - count]);
        if (first >= slots[0]) break;
        slots.unshift(first);
        count++;
      }
    }
    const cull = makeCullMove(slots, size - count, moves.config);
    if (cull) {
      if (sameCull(route.at(-1), cull)) return null;
      cutAndAppend(route, cull, moves);
      state = cull.apply(state);
    }
    const cut = moves.cuts.get(size - count);
    cutAndAppend(route, cut, moves);
    state = cut.apply(state);
    end -= count;
  }
  if (rotation) {
    const cut = moves.cuts.get(size - rotation);
    cutAndAppend(route, cut, moves);
  }
  return route;
}

function buildWithInsertedCulls(start, target, moves, rotation) {
  if (!moves.config.cull || !moves.config.cullDeeper) return null;
  const wanted = rotate(target, rotation);
  const route = [];
  let state = start;

  function moveBefore(deck, cards, anchor) {
    const anchorAt = deck.indexOf(anchor);
    const slots = cards.map(card => deck.indexOf(card));
    if (slots.every(slot => slot > anchorAt)) return makeCullMove(slots, anchorAt, moves.config, 'up');
    if (anchorAt === 0) return makeCullMove(slots, size - cards.length, moves.config);
    if (slots.some(slot => slot >= anchorAt)) return null;
    return makeCullMove(slots, anchorAt - cards.length, moves.config);
  }

  // Assemble a contiguous suffix of the goal, in circular deck order.
  // A genuine cut reorients the deck when the next group would otherwise
  // move upwards or follow another cull directly.
  for (let end = size - 2; end >= 0;) {
    const anchor = wanted[end + 1];
    const anchorAt = state.indexOf(anchor);
    if (state[(anchorAt + size - 1) % size] === wanted[end]) { end--; continue; }
    const relative = card => (state.indexOf(card) + size - anchorAt) % size;
    let count = 1;
    while (count < moves.config.cullMax && end >= count &&
      relative(wanted[end - count]) < relative(wanted[end - count + 1])) count++;
    let cards = Array.from(wanted.slice(end - count + 1, end + 1));
    let cull = null;
    while (!isCull(route.at(-1)) && !(cull = moveBefore(state, cards, anchor)) && count > 1) {
      cards = cards.slice(1);
      count--;
    }
    if (!cull) {
      const cut = moves.cuts.get(state.indexOf(cards[0])) ?? moves.cuts.get(anchorAt);
      if (!cut) return null;
      const afterCut = cut.apply(state);
      cull = moveBefore(afterCut, cards, anchor);
      if (!cull) return null;
      cutAndAppend(route, cut, moves);
      state = afterCut;
    }
    route.push(cull);
    state = cull.apply(state);
    end -= count;
  }
  const align = state.indexOf(target[0]);
  if (align) {
    const cut = moves.cuts.get(align);
    if (!cut) return null;
    cutAndAppend(route, cut, moves);
  }
  return route;
}

function buildWithRuns(start, target, moves) {
  if (!moves.cuts.size || !moves.runs.has(size)) return null;
  const route = [];
  let state = start;

  function flip(count) {
    if (count < 2) return;
    const run = moves.runs.get(count);
    route.push(run);
    state = run.apply(state);
    if (count !== size) {
      const cut = moves.cuts.get(size - count);
      route.push(cut);
      state = cut.apply(state);
    }
  }

  for (let end = size - 1; end > 0; end--) {
    const position = state.indexOf(target[end]);
    if (position === end) continue;
    flip(position + 1);
    flip(end + 1);
  }
  return route;
}

function buildWithPacketCuts(start, target, moves, expired, fromBottom = false) {
  if (!moves.wideMultiCut?.reorder) return null;
  let state = start;
  let fixed = 0;
  const route = [];
  while (state !== target) {
    if (expired()) return null;
    while (fixed < size) {
      const slot = fromBottom ? flipSlot(fixed) : fixed;
      if (state[slot] !== target[slot]) break;
      fixed++;
    }
    let next;
    for (let length = size; length > fixed; length--) {
      const block = fromBottom ? target.slice(size - length) : target.slice(0, length);
      let rest = '';
      for (const card of state) if (!block.includes(card)) rest += card;
      const goal = fromBottom ? rest + block : block + rest;
      next = moves.unique.get(finishingKey(state, goal)) ?? findDirectMultiCut(state, goal, moves.wideMultiCut);
      if (!next || !['cut', 'multi-cut'].includes(next.kind)) continue;
      cutAndAppend(route, next, moves);
      state = goal;
      fixed = length;
      break;
    }
    if (!next || !['cut', 'multi-cut'].includes(next.kind)) return null;
  }
  return route;
}

function packetBlocks(state, goalSlots) {
  const blocks = [];
  let start = 0;
  let previous = goalSlots[index(state[0])];
  for (let slot = 1; slot < size; slot++) {
    const position = goalSlots[index(state[slot])];
    if (position !== previous + 1) {
      blocks.push(state.slice(start, slot));
      if (blocks.length === 10) return null;
      start = slot;
    }
    previous = position;
  }
  blocks.push(state.slice(start));
  return blocks;
}

function organizePackets(blocks, goalSlots, moves, expired) {
  const count = blocks.length;
  const initial = ids.slice(0, count);
  const target = [...initial].sort((a, b) => goalSlots[index(blocks[index(a)][0])] - goalSlots[index(blocks[index(b)][0])]).join('');
  if (initial === target) return [];
  const list = new Map();
  const seen = [...initial].map((_, i) => i);

  function add(splits, order, stacked = false) {
    const boundaries = [0, ...splits, count];
    const map = order.flatMap(pile => seen.slice(boundaries[pile - 1], boundaries[pile]));
    const key = map.map(slot => initial[slot]).join('');
    if (key === initial || list.has(key)) return;
    const inverse = [];
    map.forEach((slot, i) => { inverse[slot] = i; });
    list.set(key, { kind: splits.length === 1 ? 'cut' : 'multi-cut', splits, order, stacked,
      apply: state => map.map(slot => state[slot]).join(''), undo: state => inverse.map(slot => state[slot]).join('') });
  }

  if (moves.config.cut) for (let a = 1; a < count; a++) add([a], [2, 1]);
  const { reorder, maxPiles } = moves.wideMultiCut;
  const cuts = maxPiles >= 4 && count >= 4 ? [3, 4] : [3];
  for (const packets of cuts) {
    const reverse = Array.from({ length: packets }, (_, i) => packets - i);
    const orders = reorder ? [...allPileOrders(reverse)] : [reverse];
    for (let a = 1; a < count; a++) for (let b = a + 1; b < count; b++) {
      if (expired()) return null;
      for (let c = b + 1; c <= count; c++) {
        if (packets === 4 && c === count) continue;
        for (const order of orders) add(packets === 3 ? [a, b] : [a, b, c], order, order.every((n, i) => n === packets - i));
        if (packets === 3) break;
      }
    }
  }
  let route;
  findExact(initial, target, { list: [...list.values()] }, { maxStates: 8500 }, () => {}, { expired },
    () => route, candidate => { route = candidate; }, () => Boolean(route));
  if (!route) return null;
  const expanded = [];
  let state = initial;
  for (const move of route) {
    const offsets = [0];
    for (const letter of state) offsets.push(offsets.at(-1) + blocks[index(letter)].length);
    const splits = move.splits.map(split => offsets[split]);
    const full = move.kind === 'cut' ? moves.cuts.get(splits[0]) : makeMultiCutMove(splits, move.order, move.stacked);
    cutAndAppend(expanded, full, moves);
    state = move.apply(state);
  }
  return expanded;
}

function readRoute(left, right) {
  const before = [];
  const after = [];
  for (let node = left; node.move; node = node.parent) before.push(node.move);
  for (let node = right; node.move; node = node.parent) after.push(node.move);
  return before.reverse().concat(after);
}

// Search routes that prepare four 13-card blocks, use whole-deck faros, then
// finish with a reversal, partial weave or deal, and cut. This applies to any
// pair of decks and produces candidates checked by the same replay as BFS.
function findStructured(start, target, moves, expired, offer, enough, suggestPackets) {
  const blockMoves = moves.list.filter(move => {
    const p = move.params;
    if (move.kind === 'multi-cut') return p.splits.every(split => split % 13 === 0);
    return ['cut', 'run', 'reverse'].includes(move.kind) && p.n % 13 === 0;
  });
  const faros = moves.list.filter(move => move.kind === 'faro' && move.params.split === 26);
  const reversals = moves.list.filter(move => move.kind === 'reverse');
  const finishingMoves = moves.list.filter(move => ['faro', 'deal', 'run', 'reverse'].includes(move.kind));

  const suffixes = new Map();
  const window = Math.min(size - 8, Math.max(0, ...reversals.map(move => move.params.n)));
  const shortReversals = reversals.filter(move => move.params.n <= window);
  const longReversals = reversals.filter(move => move.params.n > window);
  const endings = new Set();
  function addSuffix(state, route) {
    const tails = suffixes.get(state);
    if (!tails) suffixes.set(state, [route]);
    else if (tails.length < 3) tails.push(route);
    if (!tails) endings.add(state.slice(window));
  }

  const lastCuts = [...new Set(moves.cuts.values())];
  for (const cut of [null, ...lastCuts]) {
    if (expired()) return;
    const beforeCut = cut ? cut.undo(target) : target;
    const trail = cut ? [cut] : [];
    addSuffix(beforeCut, trail);
    for (const move of finishingMoves) addSuffix(move.undo(beforeCut), [move, ...trail]);
  }

  let frontier = [{ state: start, route: [] }];
  const seen = new Map([[start, { depth: 0, count: 1 }]]);

  function join(state, route, reverse) {
    const prefix = reverse ? route.concat(reverse) : route;
    const tails = suffixes.get(state);
    if (tails) {
      for (const tail of tails) offer(prefix.concat(tail));
    } else if (!reverse && (moves.wideDeal || moves.wideMultiCut)) {
      const last = directExpandedMove(state, target, moves, false);
      if (last) offer(prefix.concat(last));
      else if (moves.wideMultiCut) suggestPackets(state, route);
    }
  }

  function weave(state, route, count) {
    if (expired() || enough(route.length - 1)) return;
    join(state, route);
    if (!enough(route.length)) {
      if (endings.has(state.slice(window))) {
        for (const reverse of shortReversals) join(reverse.apply(state), route, reverse);
      }
      for (const reverse of longReversals) join(reverse.apply(state), route, reverse);
    }
    if (count < 6) {
      for (const faro of faros) weave(faro.apply(state), route.concat(faro), count + 1);
    }
  }

  for (let depth = 0; depth <= 5 && frontier.length; depth++) {
    const next = [];
    for (const { state, route } of frontier) {
      if (expired()) return;
      weave(state, route, 0);
      if (depth === 5 || enough(depth)) continue;
      for (const move of blockMoves) {
        const neighbor = move.apply(state);
        const visit = seen.get(neighbor);
        if (visit && (visit.depth <= depth || visit.count === 3)) continue;
        if (visit) visit.count++;
        else seen.set(neighbor, { depth: depth + 1, count: 1 });
        next.push({ state: neighbor, route: route.concat(move) });
      }
    }
    frontier = next;
  }
}

function findExact(start, target, moves, limits, report, clock, getBest, offer, enough) {
  const root = state => ({ state, parent: null, move: null });
  const side = (state, backward) => {
    const node = root(state);
    return { backward, frontier: [node], seen: new Map([[state, [node, null]]]) };
  };
  const left = side(start, false);
  const right = side(target, true);
  const nonCull = moves.list.filter(move => !isCull(move));
  let depth = 0;
  let checked = 0;
  let saved = 2;

  while (!getBest() || depth < getBest().length - 1) {
    const [current, other] = left.frontier.length <= right.frontier.length ? [left, right] : [right, left];
    const nextLayer = [];
    let capped = false;
    let foundLength = 0;
    for (const node of current.frontier) {
      if (clock.expired()) return { depth: Math.max(depth, foundLength - 1), checked, timedOut: true };
      for (const move of isCull(node.move) ? nonCull : moves.list) {
        if ((++checked & 2047) === 0) {
          report('exact', depth, checked);
          if (clock.expired()) return { depth: Math.max(depth, foundLength - 1), checked, timedOut: true };
        }
        const state = current.backward ? move.undo(node.state) : move.apply(node.state);
        const flag = isCull(move) ? 1 : 0;
        const match = other.seen.get(state);
        const partner = match?.[0] ?? (flag === 0 ? match?.[1] : null);
        if (partner) {
          const join = { state, parent: node, move };
          const route = current.backward ? readRoute(partner, join) : readRoute(join, partner);
          foundLength ||= route.length;
          offer(route, true);
          if (enough(foundLength)) return { depth: foundLength - 1, checked };
        }
        if (capped || foundLength) continue;
        const entry = current.seen.get(state);
        if (!entry?.[flag]) {
          if (saved >= limits.maxStates) { capped = true; continue; }
          const next = { state, parent: node, move };
          if (entry) entry[flag] = next;
          else current.seen.set(state, flag ? [null, next] : [next, null]);
          nextLayer.push(next);
          saved++;
        }
      }
    }
    if (foundLength) return { depth: foundLength - 1, checked };
    depth++;
    report('exact', depth, checked, true);
    if (capped) return { depth, checked };
    if (!nextLayer.length) return { depth, checked, exhausted: true };
    current.frontier = nextLayer;
  }
  return { depth, checked };
}

function makeShortener(moves, clock, pairLimit) {
  const cache = new Map();
  let cleanPairs;

  function pairIndex() {
    const pairs = new Map();
    const clean = moves.list.filter(move => !isCull(move));
    let checked = 0;
    for (const first of clean) {
      for (const second of clean) {
        if ((++checked & 255) === 0 && clock.expired()) return pairs;
        if (first.kind === 'cut' && second.kind === 'cut') continue;
        const permutation = second.apply(first.key);
        if (permutation !== ids && !pairs.has(permutation)) pairs.set(permutation, [first, second]);
        if (pairs.size >= pairLimit) return pairs;
      }
    }
    return pairs;
  }

  function replacement(permutation, before, after, maxMoves) {
    const key = permutation + Number(isCull(before)) + Number(isCull(after)) + maxMoves;
    if (cache.has(key)) return cache.get(key);
    let result = null;
    if (permutation === ids && !sameCull(before, after)) result = [];
    else {
      const direct = moves.unique.get(permutation) ?? directExpandedMove(ids, permutation, moves, !isCull(before) && !isCull(after));
      if (direct && !sameCull(before, direct) && !sameCull(direct, after)) result = [direct];
      else if (maxMoves >= 2) {
        let checked = 0;
        let triple;
        for (const first of moves.list) {
          if ((++checked & 63) === 0 && clock.expired()) return null;
          if (sameCull(before, first)) continue;
          let needed = '';
          for (let i = 0; i < size; i++) needed += first.inverseKey[index(permutation[i])];
          const second = moves.unique.get(needed);
          if (second && !sameCull(first, second) && !sameCull(second, after)) { result = [first, second]; break; }
          if (maxMoves === 3 && !triple) {
            const pair = cleanPairs.get(needed);
            if (pair) triple = [first, ...pair];
          }
        }
        result ??= triple ?? null;
      }
    }
    if (cache.size === 4096) cache.delete(cache.keys().next().value);
    cache.set(key, result);
    return result;
  }

  return (route, deep = false) => {
    if (deep) cleanPairs ??= pairIndex();
    const window = deep ? 10 : 7;
    for (let begin = 0; begin + 1 < route.length; begin++) {
      if (clock.expired()) return route;
      const permutations = [ids];
      const limit = Math.min(window, route.length - begin);
      for (let length = 1; length <= limit; length++) permutations.push(route[begin + length - 1].apply(permutations[length - 1]));
      for (let length = limit; length >= 2; length--) {
        const end = begin + length;
        const maxMoves = Math.min(length - 1, deep ? 3 : 2);
        const shortcut = replacement(permutations[length], route[begin - 1], route[end], maxMoves);
        if (!shortcut) continue;
        route = route.slice(0, begin).concat(shortcut, route.slice(end));
        begin = Math.max(-1, begin - window);
        break;
      }
    }
    return route;
  };
}

function shuffle(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function varyMove(state, target, moves, listed, tryPacketCut) {
  const draw = Math.random();
  if (moves.wideMultiCut && tryPacketCut && draw < 0.2) {
    const { maxPiles, reorder, allowRotation } = moves.wideMultiCut;
    const count = 2 + Math.floor(Math.random() * (maxPiles - 2));
    const splits = shuffle(positions.slice(1)).slice(0, count).sort((a, b) => a - b);
    const starts = [0, ...splits];
    const order = starts.map((_, i) => i + 1);
    if (!reorder) order.reverse();
    else if (Math.random() < 0.5) {
      const firstPosition = pile => target.indexOf(state[starts[pile - 1]]);
      order.sort((a, b) => firstPosition(a) - firstPosition(b));
    } else shuffle(order);
    const rotation = order.every((pile, i) => pile === (order[0] + i - 1) % order.length + 1);
    if (!rotation || allowRotation) {
      const move = makeMultiCutMove(splits, order, order.every((pile, i) => pile === order.length - i));
      if (move) return move;
    }
    return listed[Math.floor(Math.random() * listed.length)];
  }
  if (moves.wideDeal && draw >= 0.8) {
    const count = 6 + Math.floor(Math.random() * (moves.config.dealMax - 5));
    const order = Array.from({ length: count }, (_, i) => i + 1);
    if (Math.random() < 0.5) {
      const firstPosition = pile => target.indexOf(state[pileSlots[count][pile - 1][0]]);
      order.sort((a, b) => firstPosition(a) - firstPosition(b));
    } else shuffle(order);
    return makeDealMove(count, order);
  }
  return listed[Math.floor(Math.random() * listed.length)];
}

function routeCost(route) {
  let heavy = 0;
  let score = route.length;
  let topDown = 0;
  for (let i = 0; i < route.length; i++) {
    const move = route[i];
    score += handlingPenalty(move, route[i - 1]);
    if (isHeavy(move)) heavy++;
    if (isCull(move) && move.params.direction === 'down') topDown++;
  }
  return { score, heavy, topDown };
}

const compareRoutes = (a, b) => a.score - b.score || a.heavy - b.heavy || a.topDown - b.topDown || a.route.length - b.route.length;

export function solve(start, requested, options, limits, notify = () => {}) {
  const moves = makeMoves(options);
  const expanded = moves.wideCull || moves.wideDeal || moves.wideMultiCut;
  const required = Array.isArray(requested) ? requested : null;
  const target = required ? completeTarget(start, required) : requested;
  const matches = state => required ? required.every(([slot, card]) => state[slot] === card) : state === target;
  const alreadyMatched = matches(start);
  const started = performance.now();
  const clock = { expired: () => performance.now() - started >= limits.seconds * 1000 };
  const shorten = makeShortener(moves, clock, Math.max(4000, Math.min(45_000, Math.floor(limits.maxStates / 4))));
  const beamWidth = limits.maxStates <= 85_000 ? 20 : limits.maxStates <= 180_000 ? 28 : 36;
  let previousReport = -Infinity;
  let best = null;
  let provedThrough = alreadyMatched ? -1 : 0;
  let attempts = 0;
  let checked = 0;
  let lastCandidate = -Infinity;
  const choices = [];
  const maxChoices = 5;
  const enough = maxCost => choices.length === maxChoices && choices.at(-1).score <= maxCost;
  const suggested = () => choices.filter(choice => choice.route === best ||
    choice.heavy <= choices[0].heavy + 2 || choice.score <= choices[0].score + 6);

  function report(phase, depth, count, force = false) {
    const elapsed = performance.now() - started;
    if (!force && elapsed - previousReport < 350) return;
    previousReport = elapsed;
    notify({ type: 'progress', phase, provedThrough: depth, checked: count, attempts,
      seconds: elapsed / 1000, moveCount: moves.list.length, bestLength: best?.length ?? null });
  }

  function publishCandidate(force = false) {
    const now = performance.now();
    if (!best || (!force && now - lastCandidate < 175)) return;
    lastCandidate = now;
    notify({ type: 'candidate', shortestLength: best.length, practicalScore: choices[0].score,
      steps: choices[0].steps, routes: suggested().map(choice => choice.steps) });
  }

  function offer(route, announce = false) {
    if (!route || route.some(move => !move)) return;
    if (required) {
      let state = start;
      const end = route.findIndex(move => { state = move.apply(state); return matches(state); });
      if (end >= 0) route = route.slice(0, end + 1);
    }
    const candidate = { route, key: route.map(move => move.key).join(''), ...routeCost(route) };
    const duplicate = choices.find(choice => choice.key === candidate.key);
    if (duplicate && compareRoutes(candidate, duplicate) >= 0) return;
    if (!duplicate && choices.length === maxChoices && route.length >= best.length && compareRoutes(candidate, choices.at(-1)) >= 0) return;
    for (let i = 1; i < route.length; i++) {
      if (route[i - 1].kind !== 'cut' || route[i].kind !== 'cut') continue;
      if ((route[i - 1].params.n + route[i].params.n) % size || !sameCull(route[i - 2], route[i + 1])) return;
    }
    const { final, steps } = replay(start, route);
    if (!matches(final)) throw new ConverterError('wrongFinal');
    const seen = new Map([[displayCards(start).join(','), 0]]);
    for (let i = 0; i < steps.length; i++) {
      const deck = steps[i].deck.join(',');
      if (seen.has(deck) && !sameCull(route[seen.get(deck) - 1], route[i + 1])) return;
      seen.set(deck, i + 1);
    }
    if (duplicate) choices.splice(choices.indexOf(duplicate), 1);
    choices.push({ ...candidate, steps });
    choices.sort(compareRoutes);
    // Keep one shortest chain alongside the most practical choices.
    const shortest = choices.reduce((first, choice) => choice.route.length < first.route.length ? choice : first);
    if (choices.length > maxChoices) choices.splice(shortest === choices.at(-1) ? maxChoices - 1 : maxChoices, 1);
    const previous = best;
    best = shortest.route;
    provedThrough = Math.min(provedThrough, best.length - 1);
    if (!previous || previous.length > best.length || announce) publishCandidate(!previous);
  }

  if (alreadyMatched) offer([]);
  else {
    const shallowDepth = required
      ? searchPartialShallow(start, required, moves, clock.expired, offer, enough)
      : findShallowRoutes(start, target, moves, clock.expired, offer, enough);
    provedThrough = best ? Math.min(shallowDepth, best.length - 1) : shallowDepth;
    publishCandidate(true);
  }
  if (!alreadyMatched && !clock.expired()) {
    const searching = () => !best || best.length > provedThrough + 1 || !enough(best.length + 1);
    if (searching()) {
      report('structured', provedThrough, checked, true);
      const goalSlots = new Uint8Array(size);
      for (let slot = 0; slot < size; slot++) goalSlots[index(target[slot])] = slot;
      const seeds = new Map();
      function suggestPackets(state, route) {
        if (seeds.has(state) || enough(route.length + 1)) return;
        const blocks = packetBlocks(state, goalSlots);
        if (blocks && seeds.size < 64) seeds.set(state, { blocks, route });
      }
      const phaseStart = performance.now();
      const quickUntil = phaseStart + Math.min(3, limits.seconds * 0.34) * 1000;
      const extendedUntil = phaseStart + Math.min(6, limits.seconds * 0.57) * 1000;
      const until = () => choices[0]?.heavy === 0 ? extendedUntil : quickUntil;
      findStructured(start, target, moves, () => clock.expired() || performance.now() >= until(), offer, enough, suggestPackets);
      const packetUntil = performance.now() + Math.min(1.2, limits.seconds * 0.23) * 1000;
      const packetExpired = () => clock.expired() || performance.now() >= packetUntil;
      const orderedSeeds = [...seeds.values()].sort((a, b) => a.route.length + a.blocks.length - b.route.length - b.blocks.length);
      for (const { blocks, route } of orderedSeeds) {
        if (packetExpired()) break;
        if (enough(route.length + 1)) continue;
        const until = performance.now() + 130;
        const finishing = organizePackets(blocks, goalSlots, moves, () => packetExpired() || performance.now() >= until);
        if (finishing) offer(route.concat(finishing));
      }
    }
    let exact;
    if (!clock.expired() && (!best || provedThrough < best.length - 1)) {
      const onProof = (phase, depth, count, force) => report(phase, expanded || required ? provedThrough : depth, count, force);
      const guideUntil = performance.now() + Math.min(2, limits.seconds * 0.32) * 1000;
      const exactClock = required || expanded ? { expired: () => clock.expired() || performance.now() >= guideUntil } : clock;
      exact = findExact(start, target, moves, limits, onProof, exactClock, () => best, offer, enough);
      checked = exact.checked;
      if (!expanded && !required) provedThrough = Math.max(provedThrough, exact.depth);
    }
    if (!clock.expired() && searching()) {
      // Seed a usable route before spending the remaining budget on better joins.
      offer(buildWithRuns(start, target, moves));
      offer(buildWithInsertedCulls(start, target, moves, 0));
      offer(buildWithCulls(start, target, moves, 0));
      report('practical', provedThrough, checked, true);
      const practicalUntil = performance.now() + Math.min(3, limits.seconds * 0.22) * 1000;
      searchPractical(start, target, required, moves, () => clock.expired() || performance.now() >= practicalUntil, offer, enough, beamWidth);
      offer(buildWithPacketCuts(start, target, moves, clock.expired));
      offer(buildWithPacketCuts(start, target, moves, clock.expired, true));
      for (let rotation = 1; rotation < size && !clock.expired() && searching(); rotation++) {
        offer(buildWithInsertedCulls(start, target, moves, rotation));
        offer(buildWithCulls(start, target, moves, rotation));
      }
    }
    publishCandidate(true);

    const varied = moves.list.filter(move => !isCull(move));
    const simpleMoves = varied.filter(move => !isHeavy(move));
    const canVary = varied.some(move => move.kind !== 'cut') || expanded;
    const extraUntil = performance.now() + Math.min(6000, limits.seconds * 300);
    let beamAt = performance.now() + 3500;
    let beamRuns = 0;
    let refined;
    let refineAt = performance.now() + 400;
    let savedRoute;
    let checkpoints = [];
    while (canVary && varied.length && !clock.expired() && (!exact?.exhausted || expanded) &&
      (!best || provedThrough < best.length - 1 || (!enough(best.length + 2) && performance.now() < extraUntil))) {
      report('improve', provedThrough, checked);
      if (!attempts && best) offer(shorten(best), true);
      if (limits.seconds >= 2 && best?.length >= 4 && best !== refined && performance.now() >= refineAt) {
        refined = best;
        offer(shorten(best, true), true);
        refineAt = performance.now() + 1200;
      }
      if (performance.now() >= beamAt) {
        const until = performance.now() + 1500;
        searchPractical(start, target, required, moves, () => clock.expired() || performance.now() >= until,
          offer, enough, beamWidth * 2, [4, 14, 0, 8][beamRuns++ % 4]);
        beamAt = performance.now() + 6000;
      }
      if (best !== savedRoute) {
        savedRoute = best;
        checkpoints = [start];
        for (const move of best ?? []) checkpoints.push(move.apply(checkpoints.at(-1)));
      }
      const splice = attempts % 3 === 1 && (best?.length ?? 0) >= 4;
      const anchor = splice ? Math.floor(Math.random() * (savedRoute.length - 2)) : 0;
      let state = checkpoints[anchor];
      const prefix = anchor ? savedRoute.slice(0, anchor) : [];
      const length = 1 + (attempts % (splice ? 3 : 7));
      for (let i = 0; i < length; i++) {
        const tryPacketCut = !simpleMoves.length || (prefix.at(-1)?.kind !== 'multi-cut' && attempts % 3 === 0);
        const move = varyMove(state, target, moves, tryPacketCut ? varied : simpleMoves, tryPacketCut);
        prefix.push(move);
        state = move.apply(state);
        if (required && matches(state)) break;
      }
      if (splice && prefix.length < savedRoute.length) {
        const resume = prefix.length + 1 + Math.floor(Math.random() * (savedRoute.length - prefix.length));
        if (resume <= savedRoute.length) {
          const tail = savedRoute.slice(resume);
          const bridge = checkpoints[resume] === state ? [] : [finishingMove(state, checkpoints[resume], moves, !isCull(tail[0]))];
          if (bridge.every(Boolean) && !sameCull(prefix.at(-1), tail[0])) offer(prefix.concat(bridge, tail), true);
        }
      }
      const rotation = Math.floor(Math.random() * size);
      const chooseCullTail = attempts % 2 ? buildWithCulls : buildWithInsertedCulls;
      const goal = required ? completeTarget(state, required) : target;
      const finishing = finishingMove(state, goal, moves);
      const tail = matches(state) ? [] : finishing ? [finishing] : chooseCullTail(state, goal, moves, rotation) ??
        buildWithCulls(state, goal, moves, rotation) ?? buildWithRuns(state, goal, moves);
      if (tail) {
        const route = prefix.concat(tail);
        if (!enough(route.length - 4)) {
          offer(shorten(route), true);
          offer(route, true);
        }
      }
      attempts++;
    }
  }
  if (best) provedThrough = Math.min(provedThrough, best.length - 1);
  const optimal = best !== null && provedThrough >= best.length - 1;
  return { type: 'done', optimal, provedThrough, checked, attempts, seconds: (performance.now() - started) / 1000,
    shortestLength: best?.length ?? null, practicalScore: choices[0]?.score ?? null,
    steps: choices[0]?.steps ?? null, routes: suggested().map(choice => choice.steps) };
}

export function demoStack(start = newDeck()) {
  const moves = makeMoves();
  let state = start;
  for (const move of [moves.list[0], moves.culls.get('19'), moves.cuts.get(17), moves.runs.get(7)]) {
    state = move.apply(state);
  }
  return displayCards(state).join(' ');
}
