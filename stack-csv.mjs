import { deckLength, fullStack } from './stack-library.mjs';

function csvRows(source) {
  const text = source.replace(/^\uFEFF/, '').trim();
  const firstLine = text.split(/\r?\n/, 1)[0];
  const delimiter = firstLine.includes(',') ? ',' : firstLine.includes(';') ? ';' : firstLine.includes('\t') ? '\t' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (character === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (character === delimiter || character === '\n' || character === '\r')) {
      row.push(cell.trim());
      cell = '';
      if (character !== delimiter) {
        if (row.some(Boolean)) rows.push(row);
        row = [];
        if (character === '\r' && text[i + 1] === '\n') i++;
      }
    } else cell += character;
  }
  if (quoted) throw new Error('csvFormat');
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function orderedCards(rows, positionColumn, cardColumn) {
  const ordered = Array(deckLength).fill('');
  for (const row of rows) {
    const position = row[positionColumn];
    const card = row[cardColumn];
    const slot = Number(position) - 1;
    if (!/^\d+$/.test(position ?? '') || slot < 0 || slot >= deckLength || ordered[slot] || !card) throw new Error('csvPositions');
    ordered[slot] = card;
  }
  return ordered;
}

const unsafePrefix = /^(?:\s*[=+@-]|')/;
const csvCell = value => '"' + String(value).replaceAll('"', '""') + '"';
const fromCsvLabel = value => value.startsWith("'") && unsafePrefix.test(value.slice(1)) ? value.slice(1) : value;

export function exportStackCsv({ label, cards }) {
  const safeLabel = unsafePrefix.test(label) ? "'" + label : label;
  return '\uFEFFStack,Position,Card\r\n' + cards
    .map((card, i) => [csvCell(safeLabel), i + 1, card].join(','))
    .join('\r\n') + '\r\n';
}

export function importStackCsv(text, fallbackName) {
  const rows = csvRows(text);
  if (!rows.length) throw new Error('csvFormat');
  const header = rows[0].map(cell => cell.toLowerCase());
  const cardColumn = header.indexOf('card');
  const positionColumn = header.indexOf('position');
  const labelColumn = header.indexOf('stack');
  let label = fallbackName;
  let cards;

  if (cardColumn !== -1) {
    const body = rows.slice(1);
    if (labelColumn !== -1) {
      const names = new Set(body.map(row => row[labelColumn]).filter(Boolean));
      if (names.size > 1) throw new Error('csvOneStack');
      const [name] = names;
      if (name) label = fromCsvLabel(name);
    }
    cards = positionColumn === -1 ? body.map(row => row[cardColumn] || '') : orderedCards(body, positionColumn, cardColumn);
  } else if (rows.length > 1 && rows.every(row => row.length === 2 && /^\d+$/.test(row[0]))) {
    cards = orderedCards(rows, 0, 1);
  } else if (rows.length === 1 || rows.every(row => row.length === 1)) {
    cards = rows.flat();
  } else throw new Error('csvFormat');

  return { label, cards: fullStack(cards.join(' ')) };
}
