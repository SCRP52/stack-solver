import { cardCode, displayCards, parseCards } from './solver.mjs';
import { presets } from './presets.mjs';

export const languageKey = 'stack-converter-language';
export const libraryKey = 'thisdeck-custom-stacks-v1';
export const deckLength = 52;
export const suits = { S: '♠', D: '♦', C: '♣', H: '♥' };
export const cardLabel = card => card.slice(0, -1) + suits[card.at(-1)];
export const redCard = card => /[DH]$/.test(card);
export const stackOrder = cards => cards.join(' ');
export const fullStack = raw => displayCards(parseCards(raw, deckLength));
export { cardCode };

export function readLocal(key, fallback, storage) {
  try { return JSON.parse((storage ?? localStorage).getItem(key)) ?? fallback; }
  catch { return fallback; }
}

export function library(storage) {
  const saved = readLocal(libraryKey, [], storage);
  return presets.concat(Array.isArray(saved) ? saved.flatMap(entry => {
    if (typeof entry?.label !== 'string' || !Array.isArray(entry.cards)) return [];
    try {
      const cards = fullStack(stackOrder(entry.cards));
      return [{ id: `user:${stackOrder(cards)}`, label: entry.label, category: 'custom', cards }];
    } catch { return []; }
  }) : []);
}

export function saveStack(label, raw, storage = localStorage) {
  const cards = fullStack(raw);
  const order = stackOrder(cards);
  const entries = library(storage);
  const existing = entries.find(entry => stackOrder(entry.cards) === order);
  if (existing) return existing;
  const entry = { id: `user:${order}`, label: label.trim(), category: 'custom', cards };
  if (!entry.label) throw new Error('stackName');
  storage.setItem(libraryKey, JSON.stringify([...entries.filter(item => item.category === 'custom'), entry]));
  return entry;
}
