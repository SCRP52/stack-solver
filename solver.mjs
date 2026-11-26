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
  out: true, in: true, near: true, cut: true, multiCutOverhand: false, multiCutReorder: false, run: true, cull: true,
  reverse: true, deal: false, dealMax: 10, dealOrder: 'ordered',
  faroWindow: 8, runMax: 39, cullMax: 5, cullDeeper: true, reverseCull: true, multiCutSplits: '13,26,39',
};

export const mnemonica = '4C 2H 7D 3C 4H 6D AS 5H 9S 2S QH 3D QC 8H 6S 5S 9H KC 2D JH 3S 8S 6H 10C 5D KD 2C 3H 8D 5C KS JD 8C 10S KH JC 7S 10H AD 4S 7H 4D AC 9C JS QD 7C QS 10D 6C AH 9D';

const normalizeCards = raw => raw.trim().toUpperCase().replace(/[♠♦♣♥]/g, suit => suits[suit]);
const normalizeRank = card => card.replace(/^T([SDCH])$/, '10$1');

export function parseCards(raw) {
  const cards = normalizeCards(raw).split(/[\s,;|/]+/).filter(Boolean).map(normalizeRank);
  const invalid = cards.find(card => !cardIds.has(card));
  if (invalid) throw new Error(`Không nhận ra lá ${invalid}. Dùng AS, 10D, QC hoặc A♠, 10♦, Q♣.`);
  if (new Set(cards).size !== cards.length) throw new Error('Có lá xuất hiện nhiều hơn một lần.');
  if (cards.length !== size) throw new Error(`Đang có ${cards.length}/52 lá. Hãy nhập đủ cả bộ, bỏ joker.`);
  return cards.map(card => cardIds.get(card)).join('');
}

export function parsePositions(raw) {
  const entries = normalizeCards(raw).replace(/\s*[:=]\s*/g, '=').split(/[\s,;]+/).filter(Boolean);
  if (!entries.length) throw new Error('Nhập ít nhất một vị trí và lá bài, ví dụ 1=AS, 17=QC.');
  const slots = new Set();
  const cards = new Set();
  return entries.map(entry => {
    const match = /^(\d+)=([A-Z0-9]+)$/.exec(entry);
    if (!match) throw new Error(`Không đọc được ${entry}. Dùng dạng 1=AS hoặc 17=Q♣.`);
    const position = Number(match[1]);
    const card = cardIds.get(normalizeRank(match[2]));
    if (position < 1 || position > size) throw new Error(`Vị trí ${position} nằm ngoài bộ 52 lá.`);
    if (!card) throw new Error(`Không nhận ra lá ${match[2]}.`);
    if (slots.has(position) || cards.has(card)) throw new Error('Mỗi vị trí và mỗi lá chỉ được dùng một lần.');
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
    : state => applyMap(state, map);
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

function* cutSplits(marks, max, chosen = [], from = 0) {
  for (let i = from; i < marks.length; i++) {
    const splits = [...chosen, marks[i]];
    if (splits.length >= 2) yield splits;
    if (splits.length < max) yield* cutSplits(marks, max, splits, i + 1);
  }
}

function makeMultiCutMove(splits, order, overhand = false) {
  const boundaries = [0, ...splits, size];
  const map = order.flatMap(pile => positions.slice(boundaries[pile - 1], boundaries[pile]));
  const label = `Multi Cut ${overhand ? 'overhand' : 'gom tự do'} · ${splits.length + 1} cọc · ${splits.join(', ')} → ${order.join('–')}`;
  return moveFromMap('multi-cut', label, map, { splits, order, overhand });
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

  function add(kind, label, map, params = {}, apply = state => applyMap(state, map)) {
    return keep(moveFromMap(kind, label, map, params, apply));
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
  if (config.multiCutOverhand || config.multiCutReorder) {
    const raw = config.multiCutSplits.trim().split(/[\s,]+/);
    if (raw.some(value => !/^\d+$/.test(value) || +value < 1 || +value >= size)) {
      throw new Error('Mốc Multi Cut phải là các số từ 1 đến 51.');
    }
    const marks = [...new Set(raw.map(Number))].sort((a, b) => a - b);
    if (marks.length < 2 || marks.length > 9) throw new Error('Multi Cut cần từ 2 đến 9 mốc khác nhau.');
    if (config.multiCutOverhand) {
      for (const splits of cutSplits(marks, marks.length)) {
        const order = Array.from({ length: splits.length + 1 }, (_, i) => splits.length + 1 - i);
        keep(makeMultiCutMove(splits, order, true));
      }
    }
    if (config.multiCutReorder) {
      for (const splits of cutSplits(marks, 3)) {
        const piles = Array.from({ length: splits.length + 1 }, (_, i) => i + 1);
        for (const order of allPileOrders(piles)) keep(makeMultiCutMove(splits, order));
      }
      if (marks.length > 3) wideMultiCut = marks;
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

function findDirectMultiCut(start, target, marks) {
  // Each cọc is an intact run from the source deck. Its first position
  // therefore tells us where the cut was made and where the cọc was placed.
  const starts = [];
  let previous = -2;
  for (const card of target) {
    const position = start.indexOf(card);
    if (position !== previous + 1) {
      if (position !== 0 && !marks.includes(position)) return null;
      starts.push(position);
    }
    previous = position;
  }
  if (starts.length < 5) return null; // Smaller cuts are already in the move list.
  const boundaries = [...starts].sort((a, b) => a - b);
  return makeMultiCutMove(boundaries.slice(1), starts.map(position => boundaries.indexOf(position) + 1));
}

function directExpandedMove(start, target, moves, allowCull = true) {
  return (moves.wideDeal ? findDirectDeal(start, target, moves.config.dealMax) : null) ??
    (moves.wideMultiCut ? findDirectMultiCut(start, target, moves.wideMultiCut) : null) ??
    (allowCull && moves.wideCull ? findDirectCull(start, target, moves.config) : null);
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
  for (const [state, first] of before) {
    for (const middle of moves.list) {
      if (expired() || enough(3) || performance.now() >= threeMoveDeadline) return proved;
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

function searchPractical(start, target, required, moves, expired, offer, enough) {
  const operations = moves.list.filter(move => !isCull(move));
  if (!operations.some(move => move.kind !== 'cut')) return;
  const fixedSlots = new Int8Array(size).fill(-1);
  for (const [slot, card] of required ?? [...target].map((card, slot) => [slot, card])) fixedSlots[index(card)] = slot;
  const nextCard = new Int8Array(size);
  if (!required) {
    for (let i = 0; i < size; i++) nextCard[index(target[i])] = index(target[(i + 1) % size]);
  }

  function score(state) {
    let value = 0;
    let previous = index(state.at(-1));
    for (let slot = 0; slot < size; slot++) {
      const card = index(state[slot]);
      const fixed = fixedSlots[card];
      if (fixed >= 0) value += slot === fixed ? 12 : Math.max(0, 4 - Math.abs(slot - fixed));
      if (!required && nextCard[previous] === card) value += 8;
      previous = card;
    }
    return value;
  }

  function routeTo(node) {
    const route = [];
    for (; node.move; node = node.parent) route.push(node.move);
    return route.reverse();
  }

  const beamWidth = 24;
  let frontier = [{ state: start }];
  const seen = new Set([start]);
  let checked = 0;
  for (let depth = 1; depth <= 12 && frontier.length && !enough(depth - 1); depth++) {
    const candidates = new Map();
    for (const parent of frontier) {
      if (expired()) return;
      if (parent.move) {
        const finish = directExpandedMove(parent.state, required ? completeTarget(parent.state, required) : target, moves);
        if (finish) offer([...routeTo(parent), finish]);
      }
      for (const move of operations) {
        if ((++checked & 63) === 0 && expired()) return;
        if (parent.move?.kind === 'cut' && move.kind === 'cut') continue;
        const state = move.apply(parent.state);
        if (seen.has(state)) continue;
        const node = { state, parent, move };
        if (required ? required.every(([slot, card]) => state[slot] === card) : state === target) offer(routeTo(node));
        else if (!candidates.has(state)) candidates.set(state, { ...node, score: score(state) });
      }
    }
    frontier = [...candidates.values()].sort((a, b) => b.score - a.score).slice(0, beamWidth);
    for (const { state } of frontier) seen.add(state);
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
    if (move.kind === 'multi-cut') return p.splits.every(split => split % 13 === 0);
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
      const last = directExpandedMove(state, target, moves);
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

function findExact(start, target, moves, limits, report, clock, getBest, offer, enough) {
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
    let foundLength = 0;
    for (const node of current.frontier) {
      if (clock.expired()) return { depth: Math.max(depth, foundLength - 1), checked, timedOut: true };
      const previousCull = isCull(node.move);
      for (const move of moves.list) {
        if (previousCull && isCull(move)) continue;
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

function shuffle(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function varyMove(state, target, moves, listed) {
  const draw = Math.random();
  if (moves.wideMultiCut && draw < 0.2) {
    const marks = moves.wideMultiCut;
    const count = 4 + Math.floor(Math.random() * (marks.length - 3));
    const splits = shuffle([...marks]).slice(0, count).sort((a, b) => a - b);
    const starts = [0, ...splits];
    const order = starts.map((_, i) => i + 1);
    if (Math.random() < 0.5) {
      const firstPosition = pile => target.indexOf(state[starts[pile - 1]]);
      order.sort((a, b) => firstPosition(a) - firstPosition(b));
    } else shuffle(order);
    return makeMultiCutMove(splits, order) ?? listed[Math.floor(Math.random() * listed.length)];
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
  let culls = 0;
  let cullCuts = 0;
  let topDown = 0;
  for (let i = 0; i < route.length; i++) {
    const move = route[i];
    if (!isCull(move)) continue;
    culls++;
    if (move.params.direction === 'down') topDown++;
    if (route[i - 1]?.kind === 'cut') cullCuts++;
    if (route[i + 1]?.kind === 'cut') cullCuts++;
  }
  return { score: route.length + 2 * culls + cullCuts, culls, topDown };
}

const compareRoutes = (a, b) => a.score - b.score || a.culls - b.culls || a.topDown - b.topDown || a.route.length - b.route.length;

export function solve(start, requested, options, limits, notify = () => {}) {
  const moves = makeMoves(options);
  const expanded = moves.wideCull || moves.wideDeal || moves.wideMultiCut;
  const required = Array.isArray(requested) ? requested : null;
  const target = required ? completeTarget(start, required) : requested;
  const matches = state => required ? required.every(([slot, card]) => state[slot] === card) : state === target;
  const alreadyMatched = matches(start);
  const started = performance.now();
  const clock = { expired: () => performance.now() - started >= limits.seconds * 1000 };
  let previousReport = -Infinity;
  let best = null;
  let provedThrough = alreadyMatched ? -1 : 0;
  let attempts = 0;
  let checked = 0;
  let lastCandidate = -Infinity;
  const choices = [];
  const maxChoices = 5;
  const enough = maxCost => choices.length === maxChoices && choices.at(-1).score <= maxCost;

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
      steps: choices[0].steps, routes: choices.map(choice => choice.steps) });
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
    if (!matches(final)) throw new Error('Chuỗi tìm được chưa khớp vị trí đích.');
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
    best = shortest.route;
    provedThrough = Math.min(provedThrough, best.length - 1);
    if (announce) publishCandidate();
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
    if (!best || best.length > provedThrough + 1 || choices.length < maxChoices) {
      report('structured', provedThrough, checked, true);
      const structuredUntil = started + Math.min(8, limits.seconds * 0.6) * 1000;
      offer(findStructured(start, target, moves, () => clock.expired() || performance.now() >= structuredUntil));
      report('practical', provedThrough, checked, true);
      const practicalUntil = performance.now() + Math.min(required ? 4 : 2, limits.seconds * 0.22) * 1000;
      searchPractical(start, target, required, moves, () => clock.expired() || performance.now() >= practicalUntil, offer, enough);
      for (let rotation = 0; rotation < size && !clock.expired(); rotation++) {
        offer(buildWithInsertedCulls(start, target, moves, rotation));
        offer(buildWithCulls(start, target, moves, rotation));
      }
      offer(buildWithRuns(start, target, moves));
      publishCandidate(true);
    }
    let exact;
    if (!best || provedThrough < best.length - 1) {
      const onProof = (phase, depth, count, force) => report(phase, expanded || required ? provedThrough : depth, count, force);
      const guideUntil = performance.now() + Math.min(3, limits.seconds * 0.12) * 1000;
      const exactClock = required ? { expired: () => clock.expired() || performance.now() >= guideUntil } : clock;
      exact = findExact(start, target, moves, limits, onProof, exactClock, () => best, offer, enough);
      checked = exact.checked;
      if (!expanded && !required) provedThrough = Math.max(provedThrough, exact.depth);
    }

    const varied = moves.list.filter(move => !isCull(move));
    const canVary = varied.some(move => move.kind !== 'cut') || expanded;
    const extraUntil = performance.now() + Math.min(6000, limits.seconds * 300);
    while (canVary && varied.length && !clock.expired() && (!exact?.exhausted || expanded) &&
      (!best || provedThrough < best.length - 1 || (!enough(best.length + 2) && performance.now() < extraUntil))) {
      report('improve', provedThrough, checked);
      if (!attempts && best) offer(shorten(best, moves, clock), true);
      let state = start;
      const prefix = [];
      const length = 1 + (attempts % 7);
      for (let i = 0; i < length; i++) {
        const move = varyMove(state, target, moves, varied);
        prefix.push(move);
        state = move.apply(state);
        if (required && matches(state)) break;
      }
      const rotation = Math.floor(Math.random() * size);
      const chooseCullTail = attempts % 2 ? buildWithCulls : buildWithInsertedCulls;
      const goal = required ? completeTarget(state, required) : target;
      let permutation = '';
      for (const card of goal) permutation += ids[state.indexOf(card)];
      const finishing = moves.unique.get(permutation) ?? directExpandedMove(state, goal, moves);
      const tail = matches(state) ? [] : finishing ? [finishing] : chooseCullTail(state, goal, moves, rotation) ??
        buildWithCulls(state, goal, moves, rotation) ?? buildWithRuns(state, goal, moves);
      if (tail) {
        const route = prefix.concat(tail);
        if (!enough(route.length - 4)) {
          offer(shorten(route, moves, clock), true);
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
    steps: choices[0]?.steps ?? null, routes: choices.map(choice => choice.steps) };
}

export function demoStack() {
  const moves = makeMoves();
  let state = newDeck();
  for (const move of [moves.list[0], moves.culls.get('19'), moves.cuts.get(17), moves.runs.get(7)]) {
    state = move.apply(state);
  }
  return displayCards(state).join(' ');
}
