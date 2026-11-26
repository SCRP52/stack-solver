import { readLocal } from './stack-library.mjs';

export const activeStackKey = 'thisdeck-active-stack-v1';
const keyFor = order => 'thisdeck-practice-v1:' + order;
const mean = numbers => numbers.reduce((sum, number) => sum + number, 0) / numbers.length;

export function readProgress(order, storage) {
  return readLocal(keyFor(order), {}, storage);
}

export function saveProgress(order, prompt, result, storage = localStorage) {
  const progress = readProgress(order, storage);
  const skill = progress[prompt.kind] ??= { total: 0, right: 0, cards: {} };
  skill.total++;
  skill.right += Number(result.correct);
  const attempt = [Number(result.correct), Math.round(result.ms), Date.now()];
  for (const card of new Set(prompt.focus)) {
    skill.cards[card] = [...(skill.cards[card] ?? []), attempt].slice(-8);
  }
  storage.setItem(keyFor(order), JSON.stringify(progress));
  return progress;
}

export function weakCards(progress) {
  const cards = new Map();
  for (const skill of Object.values(progress)) {
    for (const [card, attempts] of Object.entries(skill.cards)) {
      cards.set(card, [...(cards.get(card) ?? []), ...attempts]);
    }
  }
  return new Set([...cards].filter(([, attempts]) => {
    const recent = attempts.sort((a, b) => b[2] - a[2]).slice(0, 8);
    const misses = recent.filter(([ok]) => !ok).length;
    return misses >= 2 && misses * 3 >= recent.length;
  }).map(([card]) => card));
}

export function slowCards(progress, selectedSkills) {
  const slow = new Set();
  for (const name of selectedSkills) {
    const perCard = Object.entries(progress[name]?.cards ?? {}).flatMap(([card, attempts]) => {
      const correct = attempts.filter(([ok]) => ok).map(([, ms]) => ms);
      return correct.length ? [[card, mean(correct)]] : [];
    });
    const baseline = mean(perCard.map(([, average]) => average));
    for (const [card, average] of perCard) if (average > baseline) slow.add(card);
  }
  return slow;
}

export function summarize(results) {
  const accurate = results.filter(result => result.correct);
  const times = accurate.map(result => result.ms);
  let fastest = null;
  let slowest = null;
  for (const result of accurate) {
    if (!fastest || result.ms < fastest.ms) fastest = result;
    if (!slowest || result.ms > slowest.ms) slowest = result;
  }
  return { right: accurate.length, wrong: results.length - accurate.length, meanMs: times.length ? mean(times) : null, fastest, slowest };
}
