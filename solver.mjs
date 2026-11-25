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
  out: true, in: true, near: true, cut: true, triple: false, run: true, cull: true,
  reverse: true, deal: false, dealMax: 10, dealOrder: 'ordered', faroOffsets: true,
  faroWindow: 8, runMax: 39, cullMax: 5, cullDeeper: true, reverseCull: true, tripleSplits: '13,26,39',
};

export const mnemonica = '4C 2H 7D 3C 4H 6D AS 5H 9S 2S QH 3D QC 8H 6S 5S 9H KC 2D JH 3S 8S 6H 10C 5D KD 2C 3H 8D 5C KS JD 8C 10S KH JC 7S 10H AD 4S 7H 4D AC 9C JS QD 7C QS 10D 6C AH 9D';

export function parseCards(raw) {
  const cards = raw.trim().toUpperCase().replace(/[♠♦♣♥]/g, suit => suits[suit])
    .split(/[\s,;|/]+/).filter(Boolean).map(card => card.replace(/^T([SDCH])$/, '10$1'));
  const invalid = cards.find(card => !cardIds.has(card));
  if (invalid) throw new Error(`Không nhận ra lá ${invalid}. Dùng AS, 10D, QC hoặc A♠, 10♦, Q♣.`);
  if (new Set(cards).size !== cards.length) throw new Error('Có lá xuất hiện nhiều hơn một lần.');
  if (cards.length !== size) throw new Error(`Đang có ${cards.length}/52 lá. Hãy nhập đủ cả bộ, bỏ joker.`);
  return cards.map(card => cardIds.get(card)).join('');
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

function moveFromMap(kind, label, map, params, apply = state => applyMap(state, map)) {
  const key = String.fromCharCode(...map.map(i => i + base));
  if (key === ids) return null;
  const inverse = new Uint8Array(size);
  map.forEach((from, to) => { inverse[from] = to; });
  return { kind, label, params, map, inverse, key, apply, undo: state => applyMap(state, inverse) };
}

export function makeCullMove(slots, landing, options = defaults) {
  if (!options.cull || !slots.length || slots.length > options.cullMax) return null;
  const destinations = Array.isArray(landing) ? landing : slots.map((_, i) => landing + i);
  if (destinations.length !== slots.length) return null;
  if (slots.some((slot, i) => !Number.isInteger(slot) || slot < 0 || slot >= size || (i && slot <= slots[i - 1]))) return null;
  if (destinations.some((dest, i) => !Number.isInteger(dest) || dest >= size || dest <= slots[i] || (i && dest <= destinations[i - 1]))) return null;
  const toBottom = destinations.every((dest, i) => dest === size - slots.length + i);
  if (!options.cullDeeper && !toBottom) return null;

  const rest = positions.filter(i => !slots.includes(i));
  const loads = new Map(destinations.map((dest, i) => [dest, slots[i]]));
  let next = 0;
  const map = positions.map(i => loads.get(i) ?? rest[next++]);
  const first = slots[0];
  const [insertAt] = destinations;
  const label = `Cull ${slots.length} → ${toBottom ? 'đáy' : destinations.map(dest => `#${dest + 1}`).join(', ')}`;
  const apply = slots.length === 1
    ? state => state.slice(0, first) + state.slice(first + 1, insertAt + 1) + state[first] + state.slice(insertAt + 1)
    : state => applyMap(state, map);
  return moveFromMap('cull', label, map, { slots, destinations }, apply);
}

export function makeReverseCullMove(insertAt) {
  if (!Number.isInteger(insertAt) || insertAt < 0 || insertAt >= size - 1) return null;
  const map = positions.slice(0, insertAt).concat(size - 1, positions.slice(insertAt, -1));
  return moveFromMap('reverse-cull', `Reverse cull → vị trí ${insertAt + 1}`, map, { slots: [size - 1], insertAt },
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

function* cyclicPileOrders(count) {
  for (const direction of [1, -1]) {
    for (let start = 0; start < count; start++) {
      yield Array.from({ length: count }, (_, i) => (start + direction * i + count) % count + 1);
    }
  }
}

export function cullTimeline({ slots, destinations }) {
  if (!destinations) return [];
  const pickups = new Map(slots.map((slot, i) => [slot, i]));
  const loads = new Map(destinations.map((dest, i) => [dest, i]));
  const events = [];
  let cursor = 0;
  for (let dest = 0; dest < size; dest++) {
    const load = loads.get(dest);
    if (load !== undefined) {
      while (cursor <= slots[load]) events.push({ type: 'pick', card: pickups.get(cursor++) });
      events.push({ type: 'load', card: load });
    } else {
      while (pickups.has(cursor)) events.push({ type: 'pick', card: pickups.get(cursor++) });
      cursor++;
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

  function add(kind, label, map, params = {}, apply = state => applyMap(state, map)) {
    const move = moveFromMap(kind, label, map, params, apply);
    if (!move) return null;
    const existing = unique.get(move.key);
    if (existing) return existing;
    unique.set(move.key, move);
    return move;
  }

  for (const kind of ['out', 'in']) {
    const first = kind === 'out' ? 'A' : 'B';
    if (config[kind]) add('faro', `Faro ${kind}`, weaveMap(interleave(26, first)), { split: 26, first });
    if (config.near) {
      if (!Number.isInteger(config.faroWindow) || config.faroWindow < 1 || config.faroWindow > 25) {
        throw new Error('Độ lệch faro phải từ 1 đến 25 lá.');
      }
      for (let split = 26 - config.faroWindow; split <= 26 + config.faroWindow; split++) {
        if (split === 26) continue;
        const spare = split > 26 ? 'A' : 'B';
        const extra = 2 * Math.abs(26 - split);
        const maxLead = config.faroOffsets ? extra : 0;
        for (let lead = 0; lead <= maxLead; lead++) {
          const label = `Faro ${kind} ${split}/${size - split}${lead ? ` · chừa ${lead} đầu` : ''}`;
          add('faro', label, weaveMap(interleave(split, first, lead)), { split, first, lead, spare, tail: extra - lead });
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
  if (config.triple) {
    const raw = config.tripleSplits.trim().split(/[\s,]+/);
    if (raw.some(value => !/^\d+$/.test(value) || +value < 1 || +value >= size)) {
      throw new Error('Mốc triple cut phải là các số từ 1 đến 51.');
    }
    const splits = [...new Set(raw.map(Number))].sort((a, b) => a - b);
    if (splits.length < 2) throw new Error('Triple cut cần ít nhất hai mốc khác nhau.');
    for (let i = 0; i < splits.length; i++) {
      for (const b of splits.slice(i + 1)) {
        const a = splits[i];
        const packets = { A: positions.slice(0, a), B: positions.slice(a, b), C: positions.slice(b) };
        for (const order of ['CBA', 'ACB', 'BAC']) {
          const map = Array.from(order, letter => packets[letter]).flat();
          add('triple', `Triple cut ${a} · ${b} → ${order}`, map, { a, b, order });
        }
      }
    }
  }
  if (config.deal) {
    if (!Number.isInteger(config.dealMax) || config.dealMax < 2 || config.dealMax > 10) {
      throw new Error('Chỉ được chia từ 2 đến 10 tụ.');
    }
    if (!['ordered', 'any'].includes(config.dealOrder)) throw new Error('Kiểu gom tụ không hợp lệ.');
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
      throw new Error('Cull chỉ được lấy từ 1 đến 5 lá.');
    }
    function addCull(slots) {
      const move = makeCullMove(slots, size - slots.length, config);
      if (!move) return;
      if (!unique.has(move.key)) unique.set(move.key, move);
      culls.set(cullKey(slots), unique.get(move.key));
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
  return { list: [...unique.values()], unique, cuts, culls, runs, config, wideCull, wideDeal };
}

const isCull = move => move?.kind === 'cull' || move?.kind === 'reverse-cull';
const sameCull = (a, b) => isCull(a) && isCull(b);

export function replay(start, route) {
  const steps = [];
  let state = start;
  for (const move of route) {
    if (sameCull(steps.at(-1), move)) throw new Error('Hai cull liền nhau.');
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
  const slots = [];
  const destinations = [];
  let lastUnmoved = -1;
  let lastPicked = -1;
  // The cards left in the spread can only stay put or move towards the
  // front. The cards displaced towards the back uniquely identify the held
  // cards. Both streams have to preserve their original internal order.
  for (let dest = 0; dest < size; dest++) {
    const original = sourceSlots[index(target[dest])];
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
  return makeCullMove(slots, destinations, config);
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

function directExpandedMove(start, target, moves) {
  return (moves.wideCull ? findDirectCull(start, target, moves.config) : null) ??
    (moves.wideDeal ? findDirectDeal(start, target, moves.config.dealMax) : null);
}

function shallowWithExpandedMoves(start, target, moves, expired) {
  const before = new Map();
  const after = new Map();
  for (const move of moves.list) {
    if (expired()) return { depth: 0 };
    const state = move.apply(start);
    if (state === target) return { depth: 0, route: [move] };
    if (!isCull(move)) {
      before.set(state, move);
      after.set(move.undo(target), move);
    }
  }
  const direct = directExpandedMove(start, target, moves);
  if (direct) return { depth: 0, route: [direct] };
  for (const [state, first] of before) {
    if (expired()) return { depth: 1 };
    const last = after.get(state) ?? directExpandedMove(state, target, moves);
    if (last) return { depth: 1, route: [first, last] };
  }
  for (const [state, last] of after) {
    if (expired()) return { depth: 1 };
    const first = directExpandedMove(start, state, moves);
    if (first) return { depth: 1, route: [first, last] };
  }
  if (moves.wideDeal) {
    for (const cull of moves.list.filter(isCull)) {
      if (expired()) return { depth: 1 };
      const last = findDirectDeal(cull.apply(start), target, moves.config.dealMax);
      if (last) return { depth: 1, route: [cull, last] };
      const first = findDirectDeal(start, cull.undo(target), moves.config.dealMax);
      if (first) return { depth: 1, route: [first, cull] };
    }
    // Pairs consisting entirely of dynamically generated moves have not
    // been exhausted, so only report the complete one-move check.
    return { depth: 1 };
  }
  return { depth: 2 };
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
    const cards = Array.from(wanted.slice(end - count + 1, end + 1));

    let cull = !isCull(route.at(-1)) ? moveBefore(state, cards, anchor) : null;
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
function findStructured(start, target, moves, expired) {
  const blockMoves = moves.list.filter(move => {
    const p = move.params;
    if (move.kind === 'triple') return p.a % 13 === 0 && p.b % 13 === 0;
    return ['cut', 'run', 'reverse'].includes(move.kind) && p.n % 13 === 0;
  });
  const faros = moves.list.filter(move => move.kind === 'faro' && move.params.split === 26);
  const reversals = moves.list.filter(move => move.kind === 'reverse');
  const finishingMoves = moves.list.filter(move => ['faro', 'deal'].includes(move.kind));

  const suffixes = new Map();
  function addSuffix(state, route) {
    const old = suffixes.get(state);
    if (!old || route.length < old.length) suffixes.set(state, route);
  }

  const lastCuts = [...new Set(moves.cuts.values())];
  for (const cut of [null, ...lastCuts]) {
    if (expired()) return null;
    const beforeCut = cut ? cut.undo(target) : target;
    const trail = cut ? [cut] : [];
    addSuffix(beforeCut, trail);
    for (const move of finishingMoves) addSuffix(move.undo(beforeCut), [move, ...trail]);
  }

  let best = null;
  let frontier = [{ state: start, route: [] }];
  const seen = new Set([start]);

  function join(state, route, reverse) {
    let tail = suffixes.get(state);
    if (!tail && (!best || route.length + (reverse ? 2 : 1) < best.length)) {
      const last = reverse && !moves.wideCull ? null : reverse ? findDirectCull(state, target, moves.config)
        : directExpandedMove(state, target, moves);
      if (last) tail = [last];
    }
    if (!tail) return;
    const cost = route.length + (reverse ? 1 : 0) + tail.length;
    if (!best || cost < best.length) best = route.concat(reverse ? [reverse, ...tail] : tail);
  }

  function weave(state, route, count) {
    if (expired() || (best && route.length >= best.length)) return;
    join(state, route);
    if (!best || route.length + 1 < best.length) {
      for (const reverse of reversals) join(reverse.apply(state), route, reverse);
    }
    if (count < 4) {
      for (const faro of faros) weave(faro.apply(state), route.concat(faro), count + 1);
    }
  }

  for (let depth = 0; depth <= 4 && frontier.length; depth++) {
    const next = [];
    for (const { state, route } of frontier) {
      if (expired()) return best;
      weave(state, route, 0);
      if (depth === 4 || (best && depth + 1 >= best.length)) continue;
      for (const move of blockMoves) {
        const neighbor = move.apply(state);
        if (seen.has(neighbor)) continue;
        seen.add(neighbor);
        next.push({ state: neighbor, route: route.concat(move) });
      }
    }
    frontier = next;
  }
  return best;
}

function findExact(start, target, moves, limits, report, clock, getBest) {
  const root = state => ({ state, parent: null, move: null });
  const side = (state, backward) => {
    const node = root(state);
    return { backward, frontier: [node], seen: new Map([[state, [node, null]]]) };
  };
  const left = side(start, false);
  const right = side(target, true);
  let depth = 0;
  let checked = 0;
  let saved = 2;

  while (!getBest() || depth < getBest().length - 1) {
    const [current, other] = left.frontier.length <= right.frontier.length ? [left, right] : [right, left];
    const nextLayer = [];
    let capped = false;
    for (const node of current.frontier) {
      if (clock.expired()) return { depth, checked, timedOut: true };
      const previousCull = isCull(node.move);
      for (const move of moves.list) {
        if (previousCull && isCull(move)) continue;
        if ((++checked & 2047) === 0) {
          report('exact', depth, checked);
          if (clock.expired()) return { depth, checked, timedOut: true };
        }
        const state = current.backward ? move.undo(node.state) : move.apply(node.state);
        const flag = isCull(move) ? 1 : 0;
        const match = other.seen.get(state);
        const partner = match?.[0] ?? (flag === 0 ? match?.[1] : null);
        if (partner) {
          const join = { state, parent: node, move };
          const route = current.backward ? readRoute(partner, join) : readRoute(join, partner);
          return { depth: route.length - 1, checked, route };
        }
        if (capped) continue;
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
    depth++;
    report('exact', depth, checked, true);
    if (capped) return { depth, checked };
    if (!nextLayer.length) return { depth, checked, exhausted: true };
    current.frontier = nextLayer;
  }
  return { depth, checked };
}

function shorten(route, moves, clock) {
  for (let begin = 0; begin + 1 < route.length; begin++) {
    if (clock.expired()) return route;
    for (let length = Math.min(5, route.length - begin); length >= 2; length--) {
      const end = begin + length;
      let permutation = ids;
      for (let i = begin; i < end; i++) permutation = route[i].apply(permutation);
      const before = route[begin - 1];
      const after = route[end];
      let replacement;
      const direct = moves.unique.get(permutation) ?? directExpandedMove(ids, permutation, moves);
      if (permutation === ids && !sameCull(before, after)) replacement = [];
      else if (direct && !sameCull(before, direct) && !sameCull(direct, after)) replacement = [direct];
      else if (length > 2) {
        for (const first of moves.list) {
          if (sameCull(before, first)) continue;
          let needed = '';
          for (let i = 0; i < size; i++) needed += ids[first.inverse[index(permutation[i])]];
          const second = moves.unique.get(needed);
          if (second && !sameCull(first, second) && !sameCull(second, after)) {
            replacement = [first, second];
            break;
          }
        }
      }
      if (replacement) {
        route = route.slice(0, begin).concat(replacement, route.slice(end));
        begin = Math.max(-1, begin - 5);
        break;
      }
    }
  }
  return route;
}

function varyMove(state, target, moves, listed) {
  if (moves.wideDeal && Math.random() < 0.2) {
    const count = 6 + Math.floor(Math.random() * (moves.config.dealMax - 5));
    const order = Array.from({ length: count }, (_, i) => i + 1);
    if (Math.random() < 0.5) {
      const firstPosition = pile => target.indexOf(state[pileSlots[count][pile - 1][0]]);
      order.sort((a, b) => firstPosition(a) - firstPosition(b));
    } else {
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
    }
    return makeDealMove(count, order);
  }
  return listed[Math.floor(Math.random() * listed.length)];
}

export function solve(start, target, options, limits, notify = () => {}) {
  const moves = makeMoves(options);
  const expanded = moves.wideCull || moves.wideDeal;
  const started = performance.now();
  const clock = { expired: () => performance.now() - started >= limits.seconds * 1000 };
  let previousReport = -Infinity;
  let best = null;
  let provedThrough = start === target ? -1 : 0;
  let attempts = 0;
  let checked = 0;

  function report(phase, depth, count, force = false) {
    const elapsed = performance.now() - started;
    if (!force && elapsed - previousReport < 350) return;
    previousReport = elapsed;
    notify({ type: 'progress', phase, provedThrough: depth, checked: count, attempts,
      seconds: elapsed / 1000, moveCount: moves.list.length, bestLength: best?.length ?? null });
  }

  function offer(route, announce = true) {
    if (!route || (best && route.length >= best.length)) return;
    if (replay(start, route).final !== target) throw new Error('Chuỗi tìm được chưa về đúng stack đích.');
    best = route;
    if (announce) notify({ type: 'candidate', steps: replay(start, best).steps });
  }

  if (start === target) offer([]);
  else if (expanded) {
    const shallow = shallowWithExpandedMoves(start, target, moves, clock.expired);
    provedThrough = shallow.depth;
    if (shallow.route) offer(shallow.route);
  }
  if (start !== target && !best && !clock.expired()) {
    report('structured', provedThrough, checked, true);
    // Keep this preliminary search brief on slower devices so enough time
    // remains for the general search and the fallback builder.
    const structuredUntil = started + Math.min(8, limits.seconds * 0.6) * 1000;
    offer(findStructured(start, target, moves, () => clock.expired() || performance.now() >= structuredUntil), false);
    for (let rotation = 0; rotation < size; rotation++) {
      offer(buildWithCulls(start, target, moves, rotation), false);
      offer(buildWithInsertedCulls(start, target, moves, rotation), false);
    }
    offer(buildWithRuns(start, target, moves), false);
    if (best) notify({ type: 'candidate', steps: replay(start, best).steps });
    if (!best || provedThrough < best.length - 1) {
      const onProof = (phase, depth, count, force) => report(phase, expanded ? provedThrough : depth, count, force);
      const exact = findExact(start, target, moves, limits, onProof, clock, () => best);
      checked = exact.checked;
      if (!expanded) provedThrough = exact.depth;
      if (exact.route) offer(exact.route);

      if ((!exact.exhausted || expanded) && !clock.expired() && (!best || provedThrough < best.length - 1)) {
        report('improve', provedThrough, checked, true);
        if (best) offer(shorten(best, moves, clock));
        const varied = moves.list.filter(move => !isCull(move));
        while (varied.length && !clock.expired() && (!best || provedThrough < best.length - 1)) {
          let state = start;
          const prefix = [];
          const length = 1 + (attempts % 7);
          for (let i = 0; i < length; i++) {
            const move = varyMove(state, target, moves, varied);
            prefix.push(move);
            state = move.apply(state);
          }
          const rotation = Math.floor(Math.random() * size);
          const chooseCullTail = (attempts % 2 ? buildWithCulls : buildWithInsertedCulls);
          const last = directExpandedMove(state, target, moves);
          const tail = state === target ? [] : last ? [last] : chooseCullTail(state, target, moves, rotation) ??
            buildWithCulls(state, target, moves, rotation) ?? buildWithRuns(state, target, moves);
          if (tail && (!best || prefix.length + tail.length <= best.length + 5)) {
            offer(shorten(prefix.concat(tail), moves, clock));
          }
          attempts++;
          report('improve', provedThrough, checked);
        }
      }
    }
  }
  const optimal = best !== null && provedThrough >= best.length - 1;
  return { type: 'done', optimal, provedThrough, checked, attempts, seconds: (performance.now() - started) / 1000,
    steps: best ? replay(start, best).steps : null };
}

export function demoStack() {
  const moves = makeMoves();
  let state = newDeck();
  for (const move of [moves.list[0], moves.culls.get('19'), moves.cuts.get(17), moves.runs.get(7)]) {
    state = move.apply(state);
  }
  return displayCards(state).join(' ');
}
