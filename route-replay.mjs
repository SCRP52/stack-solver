import { ConverterError } from './i18n.mjs?v=35';
import { cullTimeline } from './solver.mjs?v=35';

const equalCards = (a, b) => Array.isArray(b) && a.length === b.length && a.every((card, i) => card === b[i]);
const fits = (n, first, last) => Number.isInteger(n) && n >= first && n <= last;
const isCull = step => step?.kind === 'cull' || step?.kind === 'reverse-cull';

function ascendingSlots(slots, size) {
  return Array.isArray(slots) && slots.every((slot, i) => fits(slot, 0, size - 1) && (!i || slot > slots[i - 1]));
}

function packetOrder(order, count) {
  return Array.isArray(order) && order.length === count && new Set(order).size === count &&
    order.every(number => fits(number, 1, count));
}

function faro(cards, { split, first, from = 'top', lead = 0, spare, tail = 0 }, options) {
  const size = cards.length;
  if (!fits(split, 1, size - 1) || !['A', 'B'].includes(first) || !['top', 'bottom'].includes(from)) return null;
  const bottom = from === 'bottom';
  const extra = Math.abs(2 * split - size);
  if (!extra) {
    if (!(first === 'A' ? options.out : options.in) || bottom || lead || tail) return null;
  } else if (!options.near || Math.abs(split - size / 2) > options.faroWindow ||
    spare !== (2 * split > size ? 'A' : 'B') || lead !== (bottom ? extra : 0) || tail !== (bottom ? 0 : extra)) return null;

  const upper = cards.slice(0, split);
  const lower = cards.slice(split);
  const [a, b] = (first === 'A') !== bottom ? [upper, lower] : [lower, upper];
  const weave = [];
  if (bottom) {
    while (a.length && b.length) weave.push(a.pop(), b.pop());
    return weave.concat(upper.reverse(), lower.reverse()).reverse();
  }
  while (a.length && b.length) weave.push(a.shift(), b.shift());
  return weave.concat(upper, lower);
}

function cutPackets(cards, { splits, order, stacked }, options) {
  if (!options.multiCut || !ascendingSlots(splits, cards.length) || splits[0] === 0 ||
    !fits(splits.length + 1, 3, options.multiCutMax) || !packetOrder(order, splits.length + 1)) return null;
  if ((stacked || !options.multiCutReorder) && !order.every((pile, i) => pile === order.length - i)) return null;
  const edges = [0, ...splits, cards.length];
  return order.flatMap(pile => cards.slice(edges[pile - 1], edges[pile]));
}

function deal(cards, { count, order }, options) {
  if (!options.deal || !fits(count, 2, Math.min(options.dealMax, cards.length)) || !packetOrder(order, count)) return null;
  if (options.dealOrder === 'ordered' && ![1, -1].some(direction =>
    order.every((pile, i) => pile === (order[0] - 1 + direction * i + count) % count + 1))) return null;
  const piles = Array.from({ length: count }, () => []);
  cards.forEach((card, i) => piles[i % count].unshift(card));
  return order.flatMap(pile => piles[pile - 1]);
}

function spreadCull(cards, step, options) {
  const size = cards.length;
  const { slots, destinations, direction } = step.params;
  if (!ascendingSlots(slots, size) || !slots.length || !ascendingSlots(destinations, size) ||
    slots.length !== destinations.length || !equalCards(slots.map(slot => cards[slot]), step.cards)) return null;
  const up = direction === 'up';
  if (step.kind === 'reverse-cull') {
    if (!options.reverseCull || !up || slots.length !== 1 || slots[0] !== size - 1) return null;
  } else if (!options.cull || !['up', 'down'].includes(direction) || slots.length > options.cullMax ||
    (!options.cullDeeper && !destinations.every((dest, i) => dest === (up ? i : size - slots.length + i)))) return null;
  if (!destinations.every((dest, i) => up ? dest < slots[i] : dest > slots[i])) return null;

  // Use the same named pickup and insertion points shown in the move guide.
  const remaining = Array.from({ length: size }, (_, slot) => slot);
  const held = new Set();
  for (const event of cullTimeline({ slots, destinations, direction }, size)) {
    const slot = slots[event.card];
    if (event.type === 'pick') {
      const position = remaining.indexOf(slot);
      if (position < 0 || held.has(slot)) return null;
      held.add(slot);
      remaining.splice(position, 1);
    } else {
      if (!held.delete(slot)) return null;
      const above = event.above === null ? -1 : remaining.indexOf(event.above);
      const below = event.below === null ? remaining.length : remaining.indexOf(event.below);
      if ((event.above !== null && above < 0) || below < 0 || above + 1 !== below) return null;
      remaining.splice(below, 0, slot);
    }
  }
  if (held.size || !destinations.every((dest, i) => remaining[dest] === slots[i])) return null;
  return remaining.map(slot => cards[slot]);
}

export function simulateStep(cards, step, options) {
  const { kind, params } = step;
  const { n } = params;
  const size = cards.length;
  switch (kind) {
    case 'cut':
      return options.cut && fits(n, 1, size - 1) ? cards.slice(n).concat(cards.slice(0, n)) : null;
    case 'run':
      return options.run && fits(n, 2, Math.min(size, options.runMax)) ? cards.slice(n).concat(cards.slice(0, n).reverse()) : null;
    case 'reverse':
      return options.reverse && fits(n, 2, Math.min(size, options.runMax)) ? cards.slice(0, n).reverse().concat(cards.slice(n)) : null;
    case 'faro': return faro(cards, params, options);
    case 'multi-cut': return cutPackets(cards, params, options);
    case 'deal': return deal(cards, params, options);
    case 'cull':
    case 'reverse-cull': return spreadCull(cards, step, options);
    default: return null;
  }
}

export function createRouteVerifier({ size, start, target, startPositions, targetPositions, options }) {
  const verified = new WeakMap();
  const matches = (cards, positions) => positions.every(([slot, card]) => cards[slot] === card);
  return result => {
    for (const [index, route] of result.routes.entries()) {
      const initial = start ?? result.routeStarts?.[index];
      if (initial && verified.get(route) === initial) continue;
      if (!Array.isArray(initial) || initial.length !== size ||
        initial.some(card => typeof card !== 'string') ||
        (startPositions && !matches(initial, startPositions))) throw new ConverterError('replayStart');
      const named = initial.filter(card => card !== '?');
      if (new Set(named).size !== named.length) throw new ConverterError('replayStart');
      let cards = initial;
      for (const [i, step] of route.entries()) {
        if (isCull(step) && isCull(route[i - 1])) throw new ConverterError('replayStep', i + 1);
        const next = simulateStep(cards, step, options);
        if (!next || !equalCards(next, step.deck)) throw new ConverterError('replayStep', i + 1);
        cards = next;
      }
      if (targetPositions ? !matches(cards, targetPositions) : !equalCards(cards, target)) throw new ConverterError('wrongFinal');
      verified.set(route, initial);
    }
    return { ...result, replayVerified: result.routes.length > 0 };
  };
}
