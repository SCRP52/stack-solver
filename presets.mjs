import { mnemonica, ndo, ranks } from './solver.mjs';

function bySuit(order, descending = '') {
  return Array.from(order, suit => {
    const values = descending.includes(suit) ? [...ranks].reverse() : ranks;
    return values.map(rank => rank + suit);
  }).flat();
}

const suitCycle = 'CHSD';
const stebbins = Array.from({ length: 52 }, (_, i) => ranks[(3 * i) % 13] + suitCycle[i % 4]);
const stebbinsStart = stebbins.indexOf('KD') + 1;
const eightKingsValues = '8 K 3 10 2 7 9 5 Q 4 A 6 J'.split(' ');

const sorted = bySuit(suitCycle);
const harding = Array.from({ length: 52 }, (_, i) => {
  const slot = i + 1;
  if (slot === 6 || slot === 7) return sorted[i];
  const reversed = (slot % 10) * 10 + Math.floor(slot / 10);
  return sorted[(reversed > 52 ? reversed - 45 : reversed) - 1];
});

const europeanOrder = bySuit('SHDC', 'DC');

export const presets = [
  { id: 'ndo', label: 'NDO US · USPCC', category: 'Bộ mới', cards: ndo },
  { id: 'eu', label: 'NDO EU', category: 'Bộ mới', cards: europeanOrder },
  { id: 'phoenix', label: 'Phoenix · EU ngược', category: 'Bộ mới', cards: [...europeanOrder].reverse() },
  { id: 'asia', label: 'NDO Asia', category: 'Bộ mới', cards: bySuit('DCHS', 'DCHS') },
  { id: 'mnemonica', label: 'Mnemonica', category: 'Stack', cards: mnemonica.split(' ') },
  { id: 'memorandum', label: 'Memorandum', category: 'Stack', cards: (
    'JS 7C 10H AD 4C 7H 4D AS 4H 7D 4S AH 10D ' +
    '7S JC KD 10S 8C JH AC KS 5C 8H 3D QS KH ' +
    '9C QH 6C 9H 2D 3C 6H 5D 2S 3H 8D 5S KC ' +
    'JD 8S 10C 2C 5H 6D 3S 2H 9D 6S QC QD 9S').split(' ') },
  { id: 'stebbins', label: 'Si Stebbins · K♦ đáy', category: 'Stack', cards: stebbins.slice(stebbinsStart).concat(stebbins.slice(0, stebbinsStart)) },
  { id: 'eight-kings', label: '8K · Eight Kings', category: 'Stack', cards: Array.from({ length: 52 },
    (_, i) => eightKingsValues[i % 13] + suitCycle[i % 4]) },
  { id: 'aronson', label: 'Aronson', category: 'Stack', cards: (
    'JS KC 5C 2H 9S AS 3H 6C 8D AC 10S 5H 2D ' +
    'KD 7D 8C 3S AD 7S 5S QD AH 8S 3D 7H QH ' +
    '5D 7C 4H KH 4D 10D JC JH 10C JD 4S 10H 6H ' +
    '3C 2S 9H KS 6S 4C 8H 9C QS 6D QC 2C 9D').split(' ') },
  { id: 'redford', label: 'Redford', category: 'Stack', cards: (
    'QH 2S 5D 8C JH KS 10H 7C 4D AS 8H 5C 2D ' +
    'QS 9H 6C 3D 10S 7H 4C AD JS 9S 6H 3C KD ' +
    'QD 10D 7S 4H AC JD 8S 5H 2C 2H QC 9D 6S ' +
    '3H KC 4S AH JC 8D 5S 3S KH 10C 7D 6D 9C').split(' ') },
  { id: 'harding', label: 'BH · Bart Harding', category: 'Stack', cards: harding },
];

const byId = new Map(presets.map(preset => [preset.id, preset]));
export const getPreset = id => byId.get(id);
export const findPreset = cards => presets.find(preset => preset.cards.length === cards.length &&
  preset.cards.every((card, index) => card === cards[index]));
