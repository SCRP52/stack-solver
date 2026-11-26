import { cardCode, cullTimeline, defaults, parseCards, parsePositions, displayCards } from './solver.mjs';
import { languageKey, library, libraryKey, saveStack, stackOrder } from './stack-library.mjs';
import { ConverterError, message } from './i18n.mjs';

const $ = id => document.getElementById(id);
const storageKey = 'stack-solver-history-v1';
const rankVersion = 3;
const suits = { S: '♠', D: '♦', C: '♣', H: '♥' };
const families = ['out', 'in', 'near', 'cut', 'run', 'reverse', 'cull', 'deal'];
const extraFamilies = [['reverse-cull', 'reverseCull'], ['multi-cut', 'multiCut']];
const switches = [['cull-deeper', 'cullDeeper'], ...extraFamilies];
const numeric = [['faro-window', 'faroWindow', 1, 25], ['run-max', 'runMax', 2, 52],
  ['cull-max', 'cullMax', 1, 5], ['deal-max', 'dealMax', 2, 10], ['multi-cut-max', 'multiCutMax', 3, 10]];
let worker;
let session;
let currentStep = 0;
let currentRoute = 0;
let stepButtons = [];
let language = 'vi';
let size = 52;
let presets = [];
const getPreset = id => presets.find(preset => preset.id === id);
const findPreset = cards => presets.find(preset => stackOrder(preset.cards) === stackOrder(cards));
const gridDrafts = new Map();
const gridNames = ['start-positions', 'target-positions', 'start-packet', 'target-packet'];
try { if (localStorage.getItem(languageKey) === 'en') language = 'en'; } catch {}

const liveCopy = new Map();
const t = (key, ...values) => message(language, key, ...values);
const staticCopy = [[null, 'data-en'], ['aria-label', 'data-en-aria'], ['placeholder', 'data-en-placeholder']]
  .flatMap(([attribute, source]) => [...document.querySelectorAll(`[${source}]`)].map(element => ({
    element, attribute, vi: attribute ? element.getAttribute(attribute) : element.textContent, en: element.getAttribute(source),
  })));

function setCopy(id, key, ...values) {
  liveCopy.set(id, [key, ...values]);
  $(id).textContent = t(key, ...values);
}

function setLanguage(next) {
  language = next;
  document.documentElement.lang = next;
  for (const item of staticCopy) {
    if (item.attribute) item.element.setAttribute(item.attribute, item[next]);
    else item.element.textContent = item[next];
  }
  for (const [id, words] of liveCopy) $(id).textContent = t(...words);
  $('language').textContent = next === 'vi' ? 'EN' : 'VI';
  $('language').lang = next === 'vi' ? 'en' : 'vi';
  $('language').setAttribute('aria-label', next === 'vi' ? 'Switch to English' : 'Chuyển sang tiếng Việt');
  installPresetOptions();
  updateStart();
  renderGrids();
  if (session?.steps) renderSolution();
  if ($('history').open) renderHistory();
}

function readHistory() {
  try { return JSON.parse(localStorage.getItem(storageKey)) || []; }
  catch { return []; }
}

function writeHistory(records) {
  try { localStorage.setItem(storageKey, JSON.stringify(records)); }
  catch { return false; }
  $('history-count').textContent = records.length;
  return true;
}

function saveSolution() {
  if (!session?.steps) return;
  const records = readHistory();
  const prior = records.find(entry => entry.key === session.key);
  const usePrior = prior?.rankVersion === rankVersion && (prior.practicalScore < session.practicalScore ||
    (prior.practicalScore === session.practicalScore && (prior.shortestLength < session.shortestLength ||
      (prior.shortestLength === session.shortestLength && prior.optimal && !session.optimal))));
  const record = usePrior ? { ...prior, name: session.name } : { ...session };
  const saved = writeHistory([record, ...records.filter(entry => entry.key !== session.key)].slice(0, 12));
  setCopy('saved-note', saved ? 'stored' : 'saveError');
}

function showError(error) {
  $('error').hidden = !error;
  if (error) setCopy('error', error.code ?? error.message, ...(error.parameters ?? []));
  else { liveCopy.delete('error'); $('error').textContent = ''; }
}

function updateCount() {
  const raw = $('target').value.trim();
  const count = raw ? raw.split(/[\s,;|/]+/).filter(Boolean).length : 0;
  $('card-count').textContent = `${count}/52`;
  $('card-count').classList.toggle('full', count === 52);
}

function updateTargetMode() {
  const partial = $('target-mode').value === 'partial';
  $('full-target').hidden = partial;
  $('partial-target').hidden = !partial;
  $('target-full-fields').hidden = size !== 52;
  $('target-packet').hidden = size === 52;
  $('save-target-stack').hidden = partial;
  showError();
}

function updateStart() {
  const preset = getPreset($('start').value);
  const custom = $('start').value === 'custom';
  $('start-custom').hidden = !custom || size !== 52;
  $('start-packet').hidden = !custom || size === 52;
  $('start-pos-fields').hidden = $('start').value !== 'partial';
  $('start-preview').hidden = !preset;
  $('start-preview').value = preset?.cards.join(' ') ?? '';
  $('save-initial-stack').hidden = !custom && !preset;
}

function loadCards(cards, name) {
  if (size === 52) {
    $('target').value = cards.join(' ');
    $('target-preset').value = findPreset(cards)?.id ?? '';
  } else writeGrid('target-packet', cards);
  $('name').value = name;
  showError();
  updateCount();
}

function installPresetOptions() {
  presets = library();
  for (const id of ['start', 'target-preset']) {
    const select = $(id);
    const selected = select.value;
    select.replaceChildren();
    select.add(new Option(t(id === 'start' ? 'startPlaceholder' : 'targetPlaceholder'), ''));
    for (const category of size === 52 ? ['Bộ mới', 'Stack', 'custom'] : []) {
      const group = document.createElement('optgroup');
      group.label = category === 'custom' ? 'Custom Stack' : t(category === 'Bộ mới' ? 'factoryStacks' : 'presets');
      for (const preset of presets.filter(entry => entry.category === category)) {
        group.append(new Option(presetName(preset), preset.id));
      }
      if (group.children.length) select.append(group);
    }
    if (id === 'start') {
      select.add(new Option(t('customStart'), 'custom'));
      select.add(new Option(t('somePositions'), 'partial'));
    }
    select.value = [...select.options].some(option => option.value === selected) ? selected : '';
    if (id === 'start' && size !== 52 && !select.value) select.value = 'custom';
  }
}

const presetName = preset => ['phoenix', 'stebbins'].includes(preset.id) ? t(preset.id) : preset.label;

function saveLibraryStack(initial) {
  if (size !== 52 || (initial ? $('start').value === 'partial' : $('target-mode').value === 'partial')) return;
  try {
    const preset = getPreset($('start').value);
    const raw = initial ? (preset ? stackOrder(preset.cards) : $('start-custom').value) : $('target').value;
    const stored = saveStack($('name').value, raw);
    installPresetOptions();
    $(initial ? 'start' : 'target-preset').value = stored.id;
    updateStart();
    setCopy('library-status', 'librarySaved', presetName(stored));
  } catch (error) {
    setCopy('library-status', error.code ?? (error.message === 'stackName' ? 'stackName' : 'librarySaveError'), ...(error.parameters ?? []));
  }
  $('library-status').hidden = false;
}

function readGrid(id) {
  const key = `${id}:${size}`;
  if (!gridDrafts.has(key)) gridDrafts.set(key, Array(size).fill(''));
  return gridDrafts.get(key);
}

function writeGrid(id, cards) {
  const draft = readGrid(id);
  draft.splice(0, size, ...Array.from({ length: size }, (_, i) => cards[i] ?? ''));
  $(id).querySelectorAll('input').forEach((input, slot) => {
    input.value = draft[slot] ?? '';
    input.removeAttribute('aria-invalid');
  });
}

function renderGrids() {
  for (const id of gridNames) {
    const grid = $(id);
    if (grid.childElementCount !== size) {
      grid.replaceChildren(...readGrid(id).map((card, slot) => {
        const label = document.createElement('label');
        label.append(slot + 1);
        const input = document.createElement('input');
        input.type = 'text';
        input.maxLength = 3;
        input.autocapitalize = 'characters';
        input.spellcheck = false;
        input.autocomplete = 'off';
        input.dataset.lock = '';
        input.disabled = Boolean(worker);
        input.value = card;
        function focusAt(at) {
          const next = grid.children[at]?.querySelector('input');
          next?.focus();
          next?.select();
        }
        input.addEventListener('input', () => {
          const value = input.value.trim().toUpperCase();
          const valid = cardCode(value);
          input.value = readGrid(id)[slot] = valid ?? value;
          input.setAttribute('aria-invalid', String(Boolean(value && !valid && value.length >= 2 && value !== '10')));
          showError();
          if (valid) focusAt(slot + 1);
        });
        input.addEventListener('keydown', event => {
          if (event.key === 'Backspace' && !input.value && slot) { event.preventDefault(); focusAt(slot - 1); }
        });
        input.addEventListener('paste', event => {
          const pasted = event.clipboardData.getData('text').trim().split(/[\s,;|/]+/).map(cardCode);
          if (!pasted.length || pasted.some(card => !card)) return;
          event.preventDefault();
          pasted.slice(0, size - slot).forEach((card, i) => { readGrid(id)[slot + i] = card; });
          writeGrid(id, [...readGrid(id)]);
          showError();
          focusAt(Math.min(size - 1, slot + pasted.length));
        });
        label.append(input);
        return label;
      }));
    }
    grid.querySelectorAll('input').forEach((input, slot) => {
      input.setAttribute('aria-label', t(id.startsWith('start') ? 'initialSlot' : 'targetSlot', slot + 1));
    });
  }
}

function updateDeck() {
  const packet = $('deck-format').value === 'packet';
  $('packet-size-field').hidden = !packet;
  const next = packet ? Number($('packet-size').value) : 52;
  if (!Number.isInteger(next) || next < 1 || next > 52) { showError(new ConverterError('packetSize')); return false; }
  if (size !== next) {
    size = next;
    installPresetOptions();
    renderGrids();
  }
  $('library-actions').hidden = size !== 52;
  $('library-status').hidden = true;
  updateStart();
  updateTargetMode();
  return true;
}

function reverseInput(side) {
  const starting = side === 'start';
  const partial = starting ? $('start').value === 'partial' : $('target-mode').value === 'partial';
  if (partial || size !== 52) {
    const id = `${side}-${partial ? 'positions' : 'packet'}`;
    if (starting && !partial) { $('start').value = 'custom'; updateStart(); }
    writeGrid(id, [...readGrid(id)].reverse());
  } else {
    const input = starting ? $('start-custom') : $('target');
    const cards = (starting ? getPreset($('start').value)?.cards : null) ?? input.value.trim().split(/[\s,;|/]+/).filter(Boolean);
    if (!cards.length || (starting && !$('start').value)) return;
    const reversed = [...cards].reverse();
    if (starting) {
      const preset = findPreset(reversed);
      $('start').value = preset?.id ?? 'custom';
      input.value = reversed.join(' ');
      updateStart();
    } else loadCards(reversed, $('name').value);
  }
  showError();
}

function parseGrid(id, partial) {
  const cards = readGrid(id);
  if (partial) return parsePositions(cards.map((card, slot) => card ? `${slot + 1}=${card}` : '').join(' '), size);
  if (cards.some(card => !card)) throw new ConverterError('deckSize', cards.filter(Boolean).length, size);
  return parseCards(cards.join(' '), size);
}

function setLocked(locked) {
  $('solver-form').querySelectorAll('[data-lock]').forEach(control => { control.disabled = locked; });
  updateMultiCut();
  $('solve').hidden = locked;
  $('stop').hidden = !locked;
}

function updateMultiCut() {
  const toggle = $('multi-cut');
  $('multi-cut-reorder').disabled = toggle.disabled || !toggle.checked;
  $('multi-cut-settings').hidden = !toggle.checked;
}

const isCull = step => step?.kind === 'cull' || step?.kind === 'reverse-cull';
const cullDirection = step => step.params.direction ?? (step.kind === 'reverse-cull' ? 'up' : 'down');
const cullCount = steps => steps.filter(isCull).length;
const packetCutCount = steps => steps.filter(step => step.kind === 'multi-cut' || step.kind === 'triple').length;

function cutGuide(step, before) {
  if (step && ['faro', 'weave'].includes(step.kind) && step.params.split > 0 && step.params.split < before.length) {
    const slot = step.params.split;
    return { gaps: [{ above: before[slot - 1], below: before[slot], slot }], packets: [] };
  }
  if (!step || !['cut', 'triple', 'multi-cut'].includes(step.kind)) return null;
  const p = step.params;
  const splits = p.splits ?? (step.kind === 'cut' ? [p.n] : [p.a, p.b]);
  const order = Array.isArray(p.order) ? p.order : p.order ? Array.from(p.order, card => card.charCodeAt(0) - 64) : [2, 1];
  const edges = [0, ...splits, before.length];
  return {
    gaps: splits.map(slot => ({ above: before[slot - 1], below: before[slot], slot })),
    packets: order.map(number => ({ number, count: edges[number] - edges[number - 1] })),
  };
}

function moveName(step) {
  const p = step.params;
  if (step.kind === 'multi-cut') {
    return t((p.stacked ?? p.overhand) ? 'stackCut' : 'packetCut', p.order.length);
  }
  if (step.kind === 'triple') return t('packetCut', 3);
  if (step.kind === 'reverse') return t('reverseLabel', p.n);
  if (step.kind === 'deal') return t('dealLabel', p.count);
  if (step.kind === 'weave') return `Faro ${p.split}/${step.deck.length - p.split}`;
  if (step.kind === 'faro') {
    const kind = p.first === 'A' ? 'out' : 'in';
    return p.split * 2 === step.deck.length ? `Faro ${kind}` : t('faroLabel', kind, p.split, step.deck.length - p.split, t(p.lead ? 'bottom' : 'top'));
  }
  if (!isCull(step)) return step.label;
  const name = step.kind === 'reverse-cull' ? 'Reverse cull' : `Cull ${step.cards.length}`;
  const direction = cullDirection(step);
  const cards = direction === 'up' ? [...step.cards].reverse() : step.cards;
  return `${name} · ${t(direction)} · ${cards.map(cardText).join(', ')}`;
}

function cardText(card) {
  if (card === '?') return '?';
  return card.slice(0, -1) + suits[card.at(-1)];
}

const cardAt = (card, slot) => card === '?' ? `#${slot}` : cardText(card);

function instructions(step) {
  if (!step) return t('startDetail');
  const p = step.params;
  if (isCull(step)) return t('cullDetail', t(cullDirection(step)));
  if (['cut', 'triple', 'multi-cut'].includes(step.kind)) return t((p.stacked ?? p.overhand) ? 'stackHint' : 'cutHint');
  if (step.kind === 'run') return t('runDetail', p.n);
  if (step.kind === 'reverse') return t('reverseDetail', p.n);
  if (step.kind === 'deal') return t('dealDetail', p.count, p.order.join(' → '));
  if (step.kind === 'weave') return t('weave', p.split, step.deck.length - p.split, p.mask.match(/.{1,13}/g).join(' '));
  if (p.lead && p.tail) return t('legacyFaro');
  const larger = t(p.spare === 'A' ? 'upperPacket' : 'lowerPacket');
  const bottom = p.from === 'bottom' || Boolean(p.lead);
  const first = t((p.first === 'A') !== bottom ? 'upperPacket' : 'lowerPacket');
  const lead = p.lead ? ` ${t('faroLead', p.lead, larger)}` : '';
  const tail = p.tail ? ` ${t('faroTail', p.tail, larger)}` : '';
  return `${t('faroDetail', p.split, step.deck.length - p.split, t(bottom ? 'bottom' : 'top'), first)}${lead}${tail}`;
}

function cullDescriptions(step, before) {
  if (!isCull(step)) return [];
  const source = slot => before[slot] === '?' ? `#${slot + 1}` : `${cardText(before[slot])} (#${slot + 1})`;
  const { slots, destinations = step.cards.map(card => step.deck.indexOf(card)) } = step.params;
  return cullTimeline({ slots, destinations, direction: cullDirection(step) }, before.length).map(event => {
    const card = cardAt(step.cards[event.card], slots[event.card] + 1);
    if (event.type === 'pick') return t('pick', source(slots[event.card]));
    if (event.above === null) return t('loadTop', card, source(event.below));
    if (event.below === null) return t('loadBottom', card, source(event.above));
    return t('loadBetween', card, source(event.above), source(event.below));
  });
}

function makeCard(card) {
  const element = document.createElement('span');
  element.className = /[DH]$/.test(card) ? 'card red' : 'card';
  element.textContent = cardText(card);
  return element;
}

function cardReferences(text) {
  return text.split(/((?:10|[2-9AJQK])[♠♣♥♦])/g).map((part, i) => {
    if (i % 2 === 0) return part;
    const card = document.createElement('span');
    card.className = /[♥♦]$/.test(part) ? 'card-reference red' : 'card-reference';
    card.textContent = part;
    return card;
  });
}

function showCutGuide(guide) {
  $('cut-guide').hidden = !guide;
  if (!guide) return;
  $('packet-collect').hidden = !guide.packets.length;
  $('cut-gaps').replaceChildren(...guide.gaps.map(({ above, below, slot }) => {
    const item = document.createElement('li');
    item.setAttribute('aria-label', t('cutBetween', cardAt(above, slot), cardAt(below, slot + 1)));
    const scissors = document.createElement('span');
    scissors.textContent = '✂';
    scissors.setAttribute('aria-hidden', 'true');
    const anchors = [makeCard(above), makeCard(below)];
    anchors[0].textContent = cardAt(above, slot);
    anchors[1].textContent = cardAt(below, slot + 1);
    item.append(anchors[0], scissors, anchors[1]);
    return item;
  }));
  $('packet-order').replaceChildren(...guide.packets.map(({ number, count }) => {
    const item = document.createElement('li');
    const name = document.createElement('strong');
    name.textContent = t('packet', number);
    const length = document.createElement('small');
    length.textContent = t('cards', count);
    item.append(name, length);
    return item;
  }));
}

function showStep(number) {
  const steps = session.routes?.[currentRoute] ?? session.steps;
  currentStep = number;
  const step = steps[number - 1];
  const initial = session.routeStarts?.[currentRoute] ?? session.startCards;
  const before = steps[number - 2]?.deck ?? initial;
  $('step-number').textContent = number ? t('step', number, steps.length) : t('startStep');
  $('step-detail').textContent = instructions(step);
  showCutGuide(cutGuide(step, before));
  const events = cullDescriptions(step, before);
  $('cull-events').hidden = !events.length;
  $('cull-events').replaceChildren(...events.map(description => {
    const item = document.createElement('li');
    item.append(...cardReferences(description));
    return item;
  }));
  $('previous').disabled = !number;
  $('next').disabled = number === steps.length;
  const goals = new Map(session.targetPositions);
  $('deck-grid').replaceChildren(...(step?.deck ?? initial).map((card, slot) => {
    const tile = makeCard(card);
    if (goals.get(slot) === card) {
      tile.classList.add('goal-card');
      tile.title = t('positionMatched', slot + 1);
    }
    return tile;
  }));
  for (const [index, button] of stepButtons.entries()) button.setAttribute('aria-current', String(index + 1 === number));
}

function renderSolution() {
  if (!session.steps) { $('solution').hidden = true; return; }
  const routes = session.routes?.length ? session.routes : [session.steps];
  const steps = routes[currentRoute];
  $('solution').hidden = false;
  $('partial-note').hidden = !session.startPositions;
  $('study').hidden = false;
  $('route-picker').hidden = routes.length < 2;
  if (routes.length > 1) {
    const minimum = session.shortestLength ?? Math.min(...routes.map(route => route.length));
    $('route').replaceChildren(...routes.map((route, index) =>
      new Option(t('routeOption', index + 1, route.length, cullCount(route), packetCutCount(route), route.length === minimum), index)));
    $('route').value = currentRoute;
  }
  $('move-total').textContent = steps.length;
  $('move-unit').textContent = language === 'vi' ? 'nước' : steps.length === 1 ? 'move' : 'moves';
  $('move-operations').textContent = t('moveOperations', cullCount(steps), packetCutCount(steps));
  $('copy').disabled = steps.length === 0;
  stepButtons = steps.map((step, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'quiet';
    const number = document.createElement('span');
    number.className = 'number';
    number.textContent = index + 1;
    const label = document.createElement('span');
    label.append(...cardReferences(moveName(step)));
    button.append(number, label);
    button.addEventListener('click', () => {
      showStep(index + 1);
      $('study').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    return button;
  });
  $('step-list').replaceChildren(...stepButtons.map(button => {
    const item = document.createElement('li');
    item.append(button);
    return item;
  }));
  showStep(Math.min(currentStep, steps.length));
}

function receiveRoutes({ steps, routes = steps ? [steps] : [], shortestLength = steps?.length, practicalScore, routeStarts }) {
  const previous = session.routes?.[currentRoute];
  session.steps = steps;
  session.routes = routes;
  session.routeStarts = routeStarts;
  session.shortestLength = shortestLength;
  session.practicalScore = practicalScore;
  if (!currentRoute || !previous) return;
  const signature = route => JSON.stringify(route.map(step => [step.kind, step.params]));
  const index = routes.findIndex(route => signature(route) === signature(previous));
  currentRoute = Math.max(0, index);
  if (index < 0) currentStep = 0;
}

function formatTime(seconds) {
  const time = Math.floor(seconds);
  return `${Math.floor(time / 60)}:${String(time % 60).padStart(2, '0')}`;
}

function setProgress(message) {
  session.provedThrough = message.provedThrough;
  session.elapsed = message.seconds;
  $('meter').value = message.seconds;
  $('elapsed').textContent = formatTime(message.seconds);
  setCopy('proof', message.provedThrough > 0 ? 'ruledOut' : 'comparing', message.provedThrough);
}

function finish(stopped = false) {
  worker?.terminate();
  worker = undefined;
  setLocked(false);
  if (session.steps) {
    setCopy('status', session.optimal ? 'proved' : 'best');
    const count = session.routes?.length || 1;
    setCopy('progress-message', 'finishedRoutes', count, session.shortestLength, stopped, session.optimal, session.targetPositions?.length);
    saveSolution();
  } else {
    setCopy('status', stopped ? 'cancelled' : 'noSolution');
    setCopy('progress-message', stopped ? 'stoppedNoSolution' : 'noSolutionDetail');
  }
  if (session.optimal) setCopy('proof', 'proved');
  else if (session.provedThrough < 1) setCopy('proof', 'openProof');
}

function restore(entry) {
  if (worker) return;
  session = { ...entry };
  const savedSize = entry.size ?? entry.startCards.length;
  $('deck-format').value = savedSize === 52 ? 'full' : 'packet';
  if (savedSize !== 52) $('packet-size').value = savedSize;
  updateDeck();
  $('start').value = entry.startPositions ? 'partial' : findPreset(entry.startCards)?.id ?? 'custom';
  if (entry.startPositions) {
    const cards = new Map(entry.startPositions);
    writeGrid('start-positions', Array.from({ length: size }, (_, slot) => cards.get(slot) ?? ''));
  } else if (size !== 52) writeGrid('start-packet', entry.startCards);
  else $('start-custom').value = entry.startCards.join(' ');
  updateStart();
  $('target-mode').value = entry.targetPositions ? 'partial' : 'full';
  updateTargetMode();
  if (entry.targetPositions) {
    const cards = new Map(entry.targetPositions);
    writeGrid('target-positions', Array.from({ length: size }, (_, slot) => cards.get(slot) ?? ''));
    $('name').value = entry.name;
  } else loadCards(entry.targetCards, entry.name);
  for (const family of families) $(family).checked = entry.options[family];
  for (const [id, key] of switches) $(id).checked = entry.options[key] ?? false;
  $('multi-cut').checked = entry.options.multiCut ?? Boolean(entry.options.multiCutOverhand || entry.options.multiCutReorder || entry.options.triple);
  $('multi-cut-reorder').checked = entry.options.multiCutReorder ?? entry.options.triple ?? false;
  for (const [id, key] of [...numeric, ['deal-order', 'dealOrder']]) {
    $(id).value = entry.options[key] ?? defaults[key];
  }
  updateMultiCut();
  currentStep = 0;
  currentRoute = 0;
  $('progress-block').hidden = true;
  setCopy('status', entry.optimal ? 'proved' : 'saved');
  const minimum = entry.shortestLength ?? entry.steps.length;
  setCopy('progress-message', entry.optimal ? 'savedProof' : 'savedRoute', minimum);
  setCopy('saved-note', 'stored');
  renderSolution();
  $('history').close();
  $('work').scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function renderHistory() {
  const entries = readHistory();
  $('history-list').replaceChildren(...entries.map(entry => {
    const item = document.createElement('li');
    const load = document.createElement('button');
    load.className = 'secondary';
    load.textContent = `${entry.name} · ${t('titleMoves', entry.steps.length)}`;
    load.disabled = Boolean(worker);
    load.addEventListener('click', () => restore(entry));
    const remove = document.createElement('button');
    remove.className = 'quiet';
    remove.textContent = t('delete');
    remove.addEventListener('click', () => {
      writeHistory(readHistory().filter(record => record.key !== entry.key));
      renderHistory();
    });
    item.append(load, remove);
    return item;
  }));
  if (!entries.length) {
    const item = document.createElement('li');
    item.textContent = t('emptyHistory');
    $('history-list').append(item);
  }
}

$('solver-form').addEventListener('submit', event => {
  event.preventDefault();
  if (worker) return;
  showError();
  try {
    if (!updateDeck()) return;
    if (!$('start').value) throw new ConverterError('needSource');
    const startPreset = getPreset($('start').value);
    const startPartial = $('start').value === 'partial';
    const start = startPartial ? parseGrid('start-positions', true) : size !== 52 ? parseGrid('start-packet', false)
      : parseCards(startPreset ? startPreset.cards.join(' ') : $('start-custom').value);
    const partial = $('target-mode').value === 'partial';
    const target = partial ? parseGrid('target-positions', true) : size !== 52 ? parseGrid('target-packet', false) : parseCards($('target').value);
    const options = { ...defaults };
    for (const family of families) options[family] = $(family).checked;
    for (const [id, key] of switches) options[key] = $(id).checked;
    for (const [id, key, min, max] of numeric) {
      const value = Number($(id).value);
      if (!Number.isInteger(value) || value < min || value > max) throw new ConverterError('range', min, max);
      options[key] = value;
    }
    options.multiCutReorder = options.multiCut && $('multi-cut-reorder').checked;
    options.dealOrder = $('deal-order').value;
    if (!families.some(family => options[family]) && !extraFamilies.some(([, key]) => options[key])) {
      throw new ConverterError('needMove');
    }
    const seconds = Number($('seconds').value);
    const memory = navigator.deviceMemory || 4;
    const limits = { seconds, maxStates: memory <= 2 ? 85_000 : memory <= 4 ? 180_000 : 340_000 };
    const startPositions = startPartial ? start.map(([slot, card]) => [slot, displayCards(card)[0]]) : null;
    const provided = new Map(startPositions);
    session = { key: JSON.stringify(size === 52 ? [start, target, options] : [start, target, options, size]), name: $('name').value.trim() || t('unnamed'),
      size, startPositions, startCards: startPartial ? Array.from({ length: size }, (_, slot) => provided.get(slot) ?? '?') : displayCards(start),
      targetCards: partial ? null : displayCards(target),
      targetPositions: partial ? target.map(([slot, card]) => [slot, displayCards(card)[0]]) : null,
      options, rankVersion, steps: null, optimal: false, provedThrough: 0, elapsed: 0 };
    currentStep = 0;
    currentRoute = 0;
    renderSolution();
    setCopy('status', 'working');
    setCopy('progress-message', 'workingDetail');
    $('progress-block').hidden = false;
    $('meter').max = seconds;
    $('meter').value = 0;
    $('elapsed').textContent = '0:00';
    setCopy('proof', 'openProof');
    worker = new Worker(new URL('./worker.mjs', import.meta.url), { type: 'module' });
    setLocked(true);
    if (matchMedia('(max-width: 814px)').matches) $('work').scrollIntoView({ block: 'start', behavior: 'smooth' });
    worker.onmessage = ({ data }) => {
      if (data.type === 'candidate') {
        receiveRoutes(data);
        setCopy('progress-message', 'progressRoutes', session.routes.length, session.shortestLength);
        renderSolution();
        saveSolution();
      } else if (data.type === 'progress') {
        setProgress(data);
        setCopy('status', data.phase);
      } else if (data.type === 'done') {
        setProgress(data);
        receiveRoutes(data);
        session.optimal = data.optimal;
        renderSolution();
        finish();
      } else if (data.type === 'error') {
        finish(true);
        setCopy('progress-message', data.code ?? data.message, ...(data.parameters ?? []));
      }
    };
    worker.onerror = () => {
      finish(true);
      setCopy('progress-message', 'workerError');
    };
    worker.postMessage({ start, target, options, limits, size });
  } catch (error) {
    showError(error);
    if (error.code === 'needSource') $('start').focus();
    else $('error').scrollIntoView({ block: 'nearest' });
  }
});

$('target').addEventListener('input', () => { $('target-preset').value = ''; updateCount(); showError(); });
$('target-mode').addEventListener('change', updateTargetMode);
$('start').addEventListener('change', () => { updateStart(); showError(); });
$('save-initial-stack').addEventListener('click', () => saveLibraryStack(true));
$('save-target-stack').addEventListener('click', () => saveLibraryStack(false));
window.addEventListener('storage', event => { if (event.key === libraryKey) installPresetOptions(); });
window.addEventListener('pageshow', event => { if (event.persisted) installPresetOptions(); });
$('deck-format').addEventListener('change', updateDeck);
$('packet-size').addEventListener('change', updateDeck);
$('reverse-start').addEventListener('click', () => reverseInput('start'));
$('reverse-target').addEventListener('click', () => reverseInput('target'));
$('language').addEventListener('click', () => {
  setLanguage(language === 'vi' ? 'en' : 'vi');
  try { localStorage.setItem(languageKey, language); } catch {}
});
$('multi-cut').addEventListener('change', updateMultiCut);
$('target-preset').addEventListener('change', () => {
  const preset = getPreset($('target-preset').value);
  if (preset) loadCards(preset.cards, presetName(preset));
});
$('stop').addEventListener('click', () => finish(true));
$('previous').addEventListener('click', () => showStep(currentStep - 1));
$('next').addEventListener('click', () => showStep(currentStep + 1));
$('route').addEventListener('change', () => {
  currentRoute = Number($('route').value);
  currentStep = 0;
  renderSolution();
});
$('copy').addEventListener('click', async () => {
  try {
    const steps = session.routes?.[currentRoute] ?? session.steps;
    const lines = steps.map((step, index) => {
      const before = steps[index - 1]?.deck ?? session.routeStarts?.[currentRoute] ?? session.startCards;
      const guide = cutGuide(step, before);
      const cuts = guide ? guide.gaps.map(({ above, below, slot }) => t('cutBetween', cardAt(above, slot), cardAt(below, slot + 1))) : [];
      if (guide?.packets.length) cuts.push(t('collect', guide.packets.map(({ number }) => number).join(' → ')));
      return [`${index + 1}. ${moveName(step)}`, instructions(step), ...cuts, ...cullDescriptions(step, before)].join('\n');
    });
    await navigator.clipboard.writeText(lines.join('\n'));
    setCopy('copy', 'copied');
    setTimeout(() => setCopy('copy', 'copy'), 1300);
  } catch { setCopy('saved-note', 'copyError'); }
});
$('history-button').addEventListener('click', () => { renderHistory(); $('history').showModal(); });
$('history-count').textContent = readHistory().length;
setLanguage(language);
updateTargetMode();
updateMultiCut();
updateCount();

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('./offline.js').catch(() => {});
}
