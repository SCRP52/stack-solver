import { cardLabel, languageKey, library, libraryKey, readLocal, redCard, saveStack, stackOrder, suits } from './stack-library.mjs';
import { message } from './i18n.mjs';
import { ranks } from './solver.mjs';
import { advanced, answerChoices, basic, grade, questionSet, stackModel } from './drills.mjs?v=33';
import { drillCopy, drillDetails, groupCopy, groupDetails } from './trainer-copy.mjs?v=30';
import { beyond, beyondQuestions, isJazzing, isRecallOrder, isSplit, parseSplit, splitDefaults } from './beyond.mjs?v=43';
import { beyondDetails, beyondDrills, beyondGroups, handNames, specialBeyondPrompt } from './beyond-copy.mjs?v=43';
import { findJazzOptions, gradeJazz, jazzLength, jazzPositions, maxJazzGap, requiresBottom } from './jazzing.mjs?v=34';
import { activeStackKey, readProgress, saveProgress, slowCards, summarize, weakCards } from './trainer-progress.mjs';
import { exportStackCsv, importStackCsv } from './stack-csv.mjs';

const $ = id => document.getElementById(id);
const all = selector => [...document.querySelectorAll(selector)];
const basicGroups = { position: basic.slice(0, 2), neighbour: basic.slice(2) };
const levelMinimum = { basic: 0, advanced: 26, beyond: 52 };
const combinedDrills = {
  'quartet-numbers': { label: ['Tứ quý chỉ nhớ số', 'Quartet by position only'], skills: ['quartet-positions', 'relative-quartet'] },
  'count-steps': { label: ['Đếm số bước', 'Count steps'], skills: ['forward-distance', 'backward-distance'] },
  'find-by-steps': { label: ['Tìm lá theo số bước', 'Find a card by steps'], skills: ['forward-offset', 'backward-offset'] },
};
const localCopy = ['data-en', 'data-en-aria'].flatMap(key => all(`[${key}]`).map(node => ({
  node, attribute: key.endsWith('-aria') ? 'aria-label' : null, en: node.getAttribute(key), vi: key.endsWith('-aria') ? node.getAttribute('aria-label') : node.textContent,
})));

let lang = 'vi';
try { if (localStorage.getItem(languageKey) === 'en') lang = 'en'; } catch {}
const t = (vi, en) => lang === 'vi' ? vi : en;
const drillText = kind => beyondDrills[kind] ?? drillCopy[kind];
const groupText = key => t(...(beyondGroups[key] ?? groupCopy[key]));
const drillName = kind => t(...drillText(kind));
const promptText = question => specialBeyondPrompt(question, lang) ??
  t(...drillText(question.kind).slice(2)).replace(/\{(\d+)\}/g, (_, index) => question.args[index]);
const formatAnswer = ({ answer, answerLabels }) => answer.map((item, index) => {
  const value = typeof item === 'number' ? item : cardLabel(item);
  return answerLabels ? `${answerLabels[index]} ${value}` : value;
}).join(' · ');
const suitKeys = [['S', 'Bích', 'Spades'], ['H', 'Cơ', 'Hearts'], ['C', 'Chuồn', 'Clubs'], ['D', 'Rô', 'Diamonds']];
const isRecallPick = kind => beyond.recall.includes(kind) && !isRecallOrder(kind);
const hasBoard = kind => kind === 'restack' || isRecallOrder(kind) || isRecallPick(kind) || isSplit(kind) || isJazzing(kind);

let entries = [];
let selectedStack;
let order;
let model;
let progress;
let view = 'home';
let studyStyle = 'flip';
let studyIndex = 1;
let flipped = false;
let level = 'basic';
let mode = 'train';
let selectedDrill = '';
let settingsBack = '#home';
let run;
let timer;
let roundEndMessage = '';
const desktopLayout = matchMedia('(min-width: 760px)');
let openAdvancedGroup = '';

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function cardFace(card) {
  return element('span', cardLabel(card), redCard(card) ? 'card red' : 'card');
}

function fillStacks(desired) {
  entries = library();
  const picker = $('active-stack');
  picker.replaceChildren();
  for (const [category, title] of [['Stack', 'Stack'], ['Bộ mới', message(lang, 'factoryStacks')], ['custom', 'Custom Stack']]) {
    const group = element('optgroup');
    group.label = title;
    for (const entry of entries.filter(item => item.category === category)) {
      const label = ['phoenix', 'stebbins'].includes(entry.id) ? message(lang, entry.id) : entry.label;
      group.append(new Option(label, entry.id));
    }
    if (group.children.length) picker.append(group);
  }
  picker.value = entries.some(item => item.id === desired) ? desired : 'mnemonica';
}

function chooseStack() {
  selectedStack = entries.find(entry => entry.id === $('active-stack').value);
  order = stackOrder(selectedStack.cards);
  model = stackModel(selectedStack.cards);
  progress = readProgress(order);
  try { localStorage.setItem(activeStackKey, JSON.stringify(selectedStack.id)); } catch { storageError(); }
  resetFlip();
  renderSetup();
}

function storageError() { $('storage-error').hidden = false; }

function range() {
  const clamp = id => Math.max(1, Math.min(52, Math.round(Number($(id).value) || 1)));
  const start = clamp('range-start');
  return { start, end: Math.max(start, clamp('range-end')) };
}

function rangeLength() {
  const { start, end } = range();
  return end - start + 1;
}

function changeRange(start, end) {
  $('range-start').value = start;
  $('range-end').value = end;
  resetFlip();
  renderSetup();
}

function resetFlip() {
  studyIndex = range().start;
  flipped = false;
  renderStudy();
}

function renderStudy() {
  if (!model) return;
  const { start, end } = range();
  const weak = weakCards(progress);
  const showing = model.cards.slice(start - 1, end);
  const card = model.cards[studyIndex - 1];
  $('weak-guide').hidden = !showing.some(item => weak.has(item));
  const grid = studyStyle === 'grid';
  $('flip-view').hidden = grid;
  $('learn-grid').hidden = !grid;
  for (const button of all('[data-learn]')) button.setAttribute('aria-pressed', button.dataset.learn === studyStyle);
  for (const button of all('[data-range]')) button.setAttribute('aria-pressed', button.dataset.range === `${start},${end}`);
  if (grid) {
    $('learn-grid').replaceChildren(...showing.map((item, offset) => {
      const tile = element('li');
      const face = cardFace(item);
      face.classList.toggle('weak', weak.has(item));
      if (weak.has(item)) face.setAttribute('aria-label', `${cardLabel(item)} · ${t('hay sai', 'frequently missed')}`);
      tile.append(element('small', start + offset), face);
      return tile;
    }));
    return;
  }
  const showCard = ($('flip-side').value === 'card') !== flipped;
  $('flip-card').classList.toggle('red', showCard && redCard(card));
  $('flip-card').classList.toggle('weak', weak.has(card));
  $('flip-card').replaceChildren(element('strong', showCard ? cardLabel(card) : studyIndex), element('small', t('Chạm để lật', 'Tap to flip')));
  $('flip-progress').textContent = `${studyIndex - start + 1} / ${showing.length}`;
  $('flip-prev').disabled = studyIndex === start;
  $('flip-next').disabled = studyIndex === end;
}

function activeGroups() { return level === 'basic' ? basicGroups : level === 'advanced' ? advanced : beyond; }

function currentSkills() {
  const groups = activeGroups();
  if (selectedDrill === 'all') return Object.values(groups).flat();
  if (selectedDrill.startsWith('group:')) return groups[selectedDrill.slice(6)];
  return combinedDrills[selectedDrill]?.skills ?? [selectedDrill];
}

function directoryGroups() {
  return Object.entries(activeGroups()).map(([key, skills]) => {
    const choices = key === 'distance' ? ['count-steps', 'find-by-steps'] : key === 'quartet' ? ['quartet-numbers', ...skills] : skills;
    return { key, choices: skills.length > 1 ? [...choices, `group:${key}`] : choices };
  });
}

function drillTitle(drill) {
  if (drill === 'all') return t('Trộn tất cả', 'Mix all drills');
  if (drill.startsWith('group:')) {
    const name = groupText(drill.slice(6));
    return t(`Trộn ${name}`, `Mix ${name}`);
  }
  const combined = combinedDrills[drill];
  return combined ? t(...combined.label) : drillName(drill);
}

function renderDirectory() {
  const directory = $('practice-drills');
  const link = (drill, style = '') => {
    const anchor = element('a', undefined, `drill-link ${style}`.trim());
    anchor.href = `#practice/${level}/${drill}/train`;
    anchor.append(element('span', drillTitle(drill)));
    return anchor;
  };
  directory.replaceChildren(link('all', 'drill-mix'), ...directoryGroups().map(({ key, choices }) => {
    const section = element('details', undefined, 'panel drill-group');
    section.open = desktopLayout.matches || level === 'basic' || key === openAdvancedGroup;
    section.append(element('summary', groupText(key)), ...choices.map(drill => link(drill)));
    if (level !== 'basic' && !desktopLayout.matches) {
      section.addEventListener('toggle', () => {
        if (!section.isConnected) return;
        if (section.open) {
          openAdvancedGroup = key;
          for (const other of directory.querySelectorAll('details[open]')) if (other !== section) other.open = false;
        } else if (openAdvancedGroup === key) openAdvancedGroup = '';
      });
    }
    return section;
  }));
}

function mountControl(id, destination) {
  const control = $(id);
  if (control.parentElement !== destination) destination.append(control);
}

function trainerRoute(stage) {
  if (view === 'learn') return `#learn/${studyStyle}`;
  if (view !== 'practice') return `#${view}`;
  if (!selectedDrill) return `#practice/${level}`;
  return ['#practice', level, selectedDrill, mode, stage].filter(Boolean).join('/');
}

function navigateTrainer(stage, replace = false) {
  const route = trainerRoute(stage);
  if (route === location.hash) return;
  const state = { trainerParent: replace ? history.state?.trainerParent : location.hash, trainerRound: Boolean(stage) };
  if (replace) history.replaceState(state, '', route);
  else history.pushState(state, '', route);
}

function readTrainerRoute() {
  const [section, nextLevel, skill, nextMode] = location.hash.slice(1).split('/');
  const leftRound = Boolean(run);
  clearInterval(timer);
  run = null;
  $('trial-review').open = false;
  view = ['learn', 'practice', 'assistant', 'settings'].includes(section) ? section : 'home';
  if (view === 'practice') {
    level = nextLevel === 'advanced' || nextLevel === 'beyond' ? nextLevel : 'basic';
    mode = nextMode === 'trial' ? 'trial' : 'train';
    const known = skill === 'all' || directoryGroups().some(group => group.choices.includes(skill));
    selectedDrill = known ? skill : '';
  } else if (view === 'learn') {
    studyStyle = nextLevel === 'grid' ? 'grid' : 'flip';
  } else if (view === 'settings') {
    settingsBack = history.state?.trainerParent || '#home';
  }
  navigateTrainer(null, true);
  renderSetup();
  window.scrollTo(0, 0);
  if (leftRound && view === 'practice' && selectedDrill) {
    if (roundEndMessage) $('practice-status').textContent = roundEndMessage;
    $('practice-drill-title').focus();
  }
  roundEndMessage = '';
}

function renderSetup() {
  const beyond = level === 'beyond';
  const trial = mode === 'trial';
  const practice = view === 'practice';
  const selectedCount = rangeLength();
  const minimum = levelMinimum[level];
  const locked = practice && selectedCount < minimum;
  const configuring = practice && selectedDrill && !locked && !run;
  document.documentElement.classList.toggle('trainer-playing', Boolean(practice && run && !run.finished));
  for (const screen of ['home', 'learn', 'practice', 'assistant', 'settings']) $(screen).hidden = view !== screen;
  $('trainer-back').hidden = view === 'home' || Boolean(practice && run);
  $('trainer-back').href = view === 'settings' ? settingsBack : configuring ? `#practice/${level}` : '#home';
  $('settings-link').hidden = view === 'settings' || Boolean(practice && run);
  mountControl('stack-control', view === 'learn' ? $('learn-stack') : configuring ? $('practice-stack') : $('settings-stack'));
  const rangeHost = locked ? 'practice-gate-range' : configuring && level === 'basic' ? 'practice-range' : 'learn-range';
  mountControl('range-field', $(rangeHost));
  $('practice-directory').hidden = Boolean(!locked && (selectedDrill || run));
  $('practice-gate').hidden = !locked;
  $('practice-drills').hidden = locked;
  if (locked) {
    const name = beyond ? 'Beyond' : 'Advanced';
    $('practice-gate-message').textContent = t(`Chọn vùng ít nhất ${minimum} lá để mở ${name}. Hiện đang chọn ${selectedCount} lá.`,
      `Select at least ${minimum} cards to open ${name}. Your current range has ${selectedCount} cards.`);
  }
  $('practice-setup').hidden = !configuring;
  $('practice-session').hidden = !run || run.finished;
  $('trial-results').hidden = !run?.finished;
  for (const button of all('[data-level]')) button.setAttribute('aria-pressed', button.dataset.level === level);
  for (const button of all('[data-mode]')) button.setAttribute('aria-pressed', button.dataset.mode === mode);
  $('advanced-range').hidden = level !== 'advanced';
  $('trial-count-field').hidden = !trial;
  $('order-field').hidden = trial;
  $('focus-field').hidden = trial;
  if (practice && !selectedDrill && !locked) renderDirectory();
  if (configuring) {
    $('practice-drill-title').textContent = drillTitle(selectedDrill);
    const group = directoryGroups().find(item => item.choices.includes(selectedDrill))?.key;
    $('drill-description').textContent = selectedDrill === 'all'
      ? t('Luyện xen kẽ các bài của cấp này trong cùng một lượt.', 'Practice drills from this level together in one session.')
      : t(...(drillDetails[selectedDrill] ?? beyondDetails[group] ?? groupDetails[group]));
    $('practice-mode-description').textContent = trial
      ? t('Làm đủ số câu đã chọn. Xem điểm và thời gian khi kết thúc.', 'Complete the selected number of questions and see your score and time at the end.')
      : t('Xem đáp án sau từng câu. Có thể dừng bất cứ lúc nào.', 'See the answer after each question. Stop whenever you like.');
    const skills = currentSkills();
    const boardOnly = skills.every(hasBoard);
    $('beyond-split-settings').hidden = !skills.some(isSplit);
    $('beyond-jazz-settings').hidden = !skills.some(isJazzing);
    $('poker-hand-setting').hidden = !skills.includes('poker-hand');
    $('answer-mode-field').hidden = trial && boardOnly;
    $('choice-mode').hidden = $('choice-mode').disabled = boardOnly;
    $('reveal-mode').hidden = $('reveal-mode').disabled = trial;
    $('manual-mode').textContent = boardOnly ? t('Chạm để chọn', 'Tap to choose') : t('Nhập trên màn hình', 'On-screen input');
    const selector = $('answer-mode');
    if (selector.selectedOptions[0]?.disabled) selector.value = 'manual';
    const count = skills.reduce((sum, kind) => sum + (progress?.[kind]?.total ?? 0), 0);
    $('practice-status').textContent = count ? t(`Đã trả lời ${count} câu ở các bài đã chọn.`, `${count} answers recorded for the selected drills.`) : '';
  }
  if (view === 'learn') renderStudy();
}

function applyLanguage() {
  document.documentElement.lang = lang;
  $('language').textContent = t('EN', 'VI');
  $('language').lang = t('en', 'vi');
  $('language').setAttribute('aria-label', t('Switch to English', 'Chuyển sang tiếng Việt'));
  for (const item of localCopy) {
    if (item.attribute) item.node.setAttribute(item.attribute, item[lang]);
    else item.node.textContent = item[lang];
  }
  fillStacks(selectedStack?.id ?? readLocal(activeStackKey, 'mnemonica'));
  if (run?.finished) renderResults();
  else renderSetup();
}

function formatMs(ms) {
  if (ms === null) return '—';
  const locale = t('vi-VN', 'en');
  return `${(ms / 1000).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${t('giây', 's')}`;
}

function tick() {
  const total = Math.floor((performance.now() - run.started) / 1000);
  $('trial-time').textContent = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function newRound(event) {
  event.preventDefault();
  if (!selectedDrill || rangeLength() < levelMinimum[level]) return;
  const trial = mode === 'trial';
  const skills = currentSkills();
  const focus = trial ? 'all' : $('practice-focus').value;
  const focusCards = focus === 'weak' ? weakCards(progress) : focus === 'slow' ? slowCards(progress, skills) : null;
  const options = { ...(level === 'basic' ? range() : {}), sequential: !trial && $('question-order').value === 'sequential',
    eligible: prompt => !focusCards || prompt.focus.some(card => focusCards.has(card)) };
  if (skills.some(isSplit)) {
    try { options.piles = parseSplit($('split-sizes').value, Number($('split-count').value)); }
    catch {
      $('beyond-split-settings').open = true;
      $('practice-status').textContent = t('Nhập đúng số tụ. Mỗi tụ phải có ít nhất một lá và tổng bằng 52.', 'Enter one positive size per pile. All sizes must add up to 52.');
      return;
    }
  }
  if (skills.some(isJazzing)) {
    options.first = Number($('jazz-first').value);
    options.last = Number($('jazz-last').value);
    options.hand = $('jazz-hand').value;
    if (!Number.isInteger(options.first) || !Number.isInteger(options.last) || options.first < 1 || options.last > 52 || options.first > options.last) {
      $('beyond-jazz-settings').open = true;
      $('practice-status').textContent = t('Chọn Jazzing Range từ 1 đến 52 và để điểm đầu trước hoặc bằng điểm cuối.', 'Use positions 1–52, with the start at or before the end.');
      return;
    }
  }
  const questions = (level === 'beyond' ? beyondQuestions : questionSet)(model, skills, options);
  if (!questions.length) {
    $('practice-status').textContent = t('Chưa có câu phù hợp với vùng và kiểu ôn này.', 'No questions match this range and review focus yet.');
    return;
  }
  const requested = trial ? Number($('trial-count').value) : questions.length;
  const limit = Math.min(requested, questions.length);
  const answerMode = $('answer-mode').value;
  run = { trial, questions, limit, index: 0, results: [], choice: answerMode === 'choice', reveal: !trial && answerMode === 'reveal', range: options,
    started: performance.now(), count: 0 };
  $('trial-size-note').hidden = limit === requested;
  $('trial-size-note').textContent = t(`Bài đã chọn có ${limit} câu khác nhau. Lượt thi dùng toàn bộ số câu này.`,
    `The selected drills have ${limit} unique questions. This trial uses all of them.`);
  navigateTrainer('session');
  renderSetup();
  showQuestion();
  window.scrollTo(0, 0);
  if (trial) { tick(); timer = setInterval(tick, 200); }
}

function answerButton(text, className, action, label) {
  const button = element('button', text, `secondary ${className}`);
  button.type = 'button';
  if (label) button.setAttribute('aria-label', label);
  button.addEventListener('click', action);
  return button;
}

function submitAnswer(values) {
  if (!run || run.answered) return;
  const prompt = run.questions[run.index];
  const raw = values.map(value => typeof value === 'number' ? String(value) : value);
  const correct = grade(prompt, raw);
  if (correct === null) return;
  const numeric = typeof prompt.answer[0] === 'number';
  record(correct, values.map(value => numeric ? String(value) : cardLabel(value)));
}

function renderChoices(prompt) {
  const choices = answerChoices(prompt, model.cards, run.range);
  $('answer-choices').replaceChildren(...choices.map((option, i) => {
    const letter = 'ABC'[i];
    const button = answerButton(undefined, 'answer-choice', () => submitAnswer(option));
    const value = typeof option[0] === 'number'
      ? element('span', formatAnswer({ answer: option }))
      : element('span', undefined, 'answer-choice-cards');
    if (typeof option[0] !== 'number') value.append(...option.map(cardFace));
    button.append(element('strong', letter), value);
    return button;
  }));
}

function setupRestack(prompt) {
  const selected = [];
  run.restack = selected;
  const source = new Map(prompt.shown.map(card => {
    const style = redCard(card) ? 'restack-card answer-red' : 'restack-card';
    const button = answerButton(cardLabel(card), style, () => {
      selected.push(card);
      refresh();
      [...source.values()].find(item => !item.disabled)?.focus({ preventScroll: true });
    });
    return [card, button];
  }));

  function refresh() {
    const placed = new Set(selected);
    for (const [card, button] of source) button.disabled = placed.has(card);
    const slots = prompt.answer.map((_, i) => {
      const card = selected[i];
      if (!card) {
        const empty = element('span', undefined, 'restack-empty');
        empty.setAttribute('aria-hidden', 'true');
        return empty;
      }
      const label = cardLabel(card);
      const style = redCard(card) ? 'restack-card answer-red' : 'restack-card';
      return answerButton(label, style, () => {
        selected.splice(i, 1);
        refresh();
        source.get(card).focus({ preventScroll: true });
      }, t(`Ô ${i + 1}, bỏ ${label} khỏi thứ tự`, `Entry ${i + 1}, remove ${label} from your order`));
    });
    $('restack-answer').replaceChildren(...slots);
    if (selected.length && prompt.answer.length > 26) slots[selected.length - 1].scrollIntoView({ block: 'nearest' });
    $('restack-count').textContent = `${selected.length} / ${prompt.answer.length}`;
    $('submit-answer').disabled = selected.length !== prompt.answer.length;
  }

  $('restack-board').classList.toggle('restack-large', prompt.answer.length > 26);
  $('restack-source').replaceChildren(...source.values());
  refresh();
}

function setupBeyondBoard(prompt) {
  const board = $('beyond-board');
  board.replaceChildren();
  const grid = element('div', undefined, 'beyond-grid');
  board.append(grid);
  if (isRecallPick(prompt.kind)) {
    for (const card of prompt.shown) {
      grid.append(answerButton(cardLabel(card), redCard(card) ? 'answer-red' : '', () => submitAnswer([card])));
    }
    return;
  }

  const submit = $('submit-answer');
  if (isSplit(prompt.kind)) {
    const assignments = Array(prompt.shown.length).fill(0);
    let active = 0;
    board.prepend(element('p', prompt.piles.map((size, i) => t(`Tụ ${i + 1} · ${size} lá`, `Pile ${i + 1} · ${size} cards`)).join('  /  '), 'hint'));
    const cardButtons = prompt.shown.map((card, i) => answerButton(undefined, redCard(card) ? 'answer-red' : '', () => {
      active = i;
      refresh();
    }));
    grid.append(...cardButtons);
    const piles = element('div', undefined, 'beyond-grid split-piles');
    for (const [i] of prompt.piles.entries()) {
      piles.append(answerButton(t(`Tụ ${i + 1}`, `Pile ${i + 1}`), '', () => {
        assignments[active] = i + 1;
        const next = assignments.indexOf(0, active + 1);
        const unassigned = next === -1 ? assignments.indexOf(0) : next;
        if (unassigned !== -1) active = unassigned;
        refresh();
        if (unassigned !== -1) cardButtons[active].scrollIntoView({ block: 'nearest' });
      }));
    }
    board.insertBefore(piles, grid);

    function refresh() {
      cardButtons.forEach((button, i) => {
        const label = cardLabel(prompt.shown[i]);
        const pile = assignments[i];
        button.textContent = label;
        button.classList.toggle('assigned', Boolean(pile));
        const assigned = t(`Tụ ${pile}`, `Pile ${pile}`);
        if (pile) button.append(element('span', assigned));
        button.setAttribute('aria-label', pile ? `${label} · ${assigned}` : label);
        button.setAttribute('aria-pressed', i === active);
      });
      submit.disabled = assignments.includes(0);
    }
    run.submitBoard = () => submitAnswer(assignments);
    refresh();
    return;
  }

  const positions = new Set();
  let none = false;
  const size = jazzLength(prompt.jazz);
  const bottom = prompt.jazz.cards.length;
  const count = element('p', undefined, 'hint');
  count.setAttribute('role', 'status');
  const noSolution = answerButton(t('Không có phương án', 'No valid hand'), 'no-jazz', () => {
    none = !none;
    if (none) positions.clear();
    refresh();
  });
  const buttons = jazzPositions(prompt.jazz).map(position => {
    const bottomLabel = position === bottom ? t('Đáy', 'Bottom')
      : position === bottom - 1 ? t('Sát đáy', 'Above bottom') : '';
    const button = answerButton(String(position), bottomLabel ? 'jazz-bottom' : '', () => {
      none = false;
      if (positions.has(position)) {
        positions.delete(position);
        if (position === bottom && requiresBottom(prompt.jazz, bottom - 1)) positions.delete(bottom - 1);
      } else if (positions.size < size) positions.add(position);
      refresh();
    }, bottomLabel ? `${position} · ${bottomLabel}` : String(position));
    if (bottomLabel) button.append(element('small', bottomLabel));
    return [position, button];
  });
  board.prepend(count);
  grid.append(...buttons.map(([, button]) => button));
  board.append(noSolution);

  function refresh() {
    count.textContent = t(`Đã chọn ${positions.size}/${size} vị trí`, `${positions.size}/${size} positions selected`);
    for (const [position, button] of buttons) {
      button.setAttribute('aria-pressed', positions.has(position));
      button.disabled = requiresBottom(prompt.jazz, position) && !positions.has(bottom);
    }
    noSolution.setAttribute('aria-pressed', none);
    submit.disabled = !none && positions.size !== size;
  }
  run.submitBoard = () => {
    run.submittedAt = performance.now();
    const answer = none ? null : [...positions].sort((a, b) => a - b);
    const result = gradeJazz(prompt.jazz, answer);
    record(result.valid, answer?.map(String) ?? [t('Không có phương án', 'No valid hand')], false, result);
  };
  refresh();
}

function manualValues({ numeric, entries }) {
  return numeric ? entries : entries.map(({ rank, suit }) => rank && suit ? rank + suit : '');
}

function setupManual(prompt) {
  const numeric = typeof prompt.answer[0] === 'number';
  const entries = prompt.answer.map(() => numeric ? '' : { rank: '', suit: '' });
  const manual = { numeric, entries, active: 0 };
  run.manual = manual;
  const slots = entries.map((_, i) => answerButton(undefined, 'answer-slot', () => {
    manual.active = i;
    refresh();
  }));
  const next = answerButton('→', 'answer-key', () => {
    manual.active++;
    refresh();
  }, t('Ô tiếp theo', 'Next entry'));
  const remove = answerButton('⌫', 'answer-key', () => {
    const entry = entries[manual.active];
    if (numeric) entries[manual.active] = entry.slice(0, -1);
    else if (entry.suit) entry.suit = '';
    else entry.rank = '';
    refresh();
  }, t('Xóa ký tự', 'Delete character'));
  const rankButtons = [];
  const suitButtons = [];

  function refresh() {
    const entry = entries[manual.active];
    slots.forEach((button, i) => {
      const value = numeric ? entries[i] : entries[i].rank + (suits[entries[i].suit] ?? '');
      const name = prompt.entryLabels?.[i];
      button.textContent = name ? `${name} ${value || '—'}` : value || '—';
      const label = !numeric || prompt.unordered ? t(`Ô ${i + 1}`, `Entry ${i + 1}`) : t(`Chặng ${i + 1}`, `Gap ${i + 1}`);
      button.setAttribute('aria-label', `${entries.length === 1 ? t('Đáp án', 'Answer') : label} · ${button.textContent}`);
      button.setAttribute('aria-pressed', i === manual.active);
      button.classList.toggle('answer-red', (!numeric && redCard(entries[i].suit)) || ['♥', '♦'].includes(name));
    });
    for (const [value, button] of rankButtons) button.setAttribute('aria-pressed', entry.rank === value);
    for (const [value, button] of suitButtons) button.setAttribute('aria-pressed', entry.suit === value);
    $('submit-answer').disabled = manualValues(manual).some(value => !value);
    next.disabled = manual.active === entries.length - 1;
    remove.disabled = numeric ? !entry : !(entry.rank || entry.suit);
  }

  function setPart(part, value) {
    const entry = entries[manual.active];
    const wasComplete = entry.rank && entry.suit;
    entry[part] = value;
    if (!wasComplete && entry.rank && entry.suit) {
      const empty = entries.findIndex((item, i) => i > manual.active && !(item.rank && item.suit));
      if (empty !== -1) manual.active = empty;
    }
    refresh();
  }

  const keys = $('answer-keys');
  if (numeric) {
    const digits = element('div', undefined, 'number-keys');
    for (const value of '1234567890') {
      const button = answerButton(value, 'answer-key', () => {
        const previous = entries[manual.active];
        if (previous.length < (prompt.numericDigits ?? 2)) entries[manual.active] = previous + value;
        refresh();
      });
      if (value === '0') digits.append(remove);
      digits.append(button);
    }
    digits.append(next);
    keys.replaceChildren(digits);
  } else {
    const rankRow = element('div', undefined, 'rank-keys');
    for (const rank of ranks) {
      const button = answerButton(rank, 'answer-key', () => setPart('rank', rank));
      rankButtons.push([rank, button]);
      rankRow.append(button);
    }
    const suitRow = element('div', undefined, 'suit-keys');
    for (const [suit, vi, en] of suitKeys) {
      const style = redCard(suit) ? 'answer-key answer-red' : 'answer-key';
      const button = answerButton(suits[suit], style, () => setPart('suit', suit), t(vi, en));
      suitButtons.push([suit, button]);
      suitRow.append(button);
    }
    const tools = element('div', undefined, 'answer-pad-tools');
    tools.append(remove);
    if (entries.length > 1) tools.append(next);
    keys.replaceChildren(rankRow, suitRow, tools);
  }
  $('answer-slots').replaceChildren(...slots);
  refresh();
}

function showQuestion() {
  const prompt = run.questions[run.index];
  const isRestack = prompt.kind === 'restack';
  const restack = (isRestack || isRecallOrder(prompt.kind)) && !run.reveal;
  const special = hasBoard(prompt.kind) && !restack && !run.reveal;
  const pick = isRecallPick(prompt.kind);
  run.answered = false;
  run.restack = null;
  run.submitBoard = null;
  run.submittedAt = null;
  $('session-mode').textContent = run.trial ? t('Thi', 'Time Trial') : t('Tập', 'Trainer');
  $('question-count').textContent = run.trial ? `${run.count + 1} / ${run.limit}` : t(`Câu ${run.count + 1}`, `Question ${run.count + 1}`);
  $('trial-time').hidden = !run.trial;
  $('trial-progress').hidden = !run.trial;
  if (run.trial) { $('trial-progress').max = run.limit; $('trial-progress').value = run.count; }
  $('question-skill').textContent = drillName(prompt.kind);
  $('question-text').textContent = isRestack && run.reveal
    ? t('Nhẩm thứ tự stack của các lá này từ trên xuống.', 'Recall the order of these cards from top to bottom.')
    : promptText(prompt);
  $('question-cards').replaceChildren(...(restack || special ? [] : prompt.shown.map(cardFace)));
  $('question-cards').hidden = restack || special || !prompt.shown.length;
  $('answer-form').hidden = run.reveal;
  $('reveal-answer').hidden = !run.reveal;
  $('answer-choices').hidden = restack || special || !run.choice;
  $('answer-pad').hidden = restack || special || run.choice;
  $('restack-board').hidden = !restack;
  $('beyond-board').hidden = !special;
  $('submit-answer').hidden = run.reveal || pick || (!restack && !special && run.choice);
  $('skip-answer').hidden = run.reveal;
  $('next-question').hidden = true;
  $('feedback').hidden = true;
  if (!run.reveal) {
    if (restack) setupRestack(prompt);
    else if (special) setupBeyondBoard(prompt);
    else if (run.choice) renderChoices(prompt);
    else setupManual(prompt);
  }
  run.questionStarted = performance.now();
  $('session-content').scrollTop = 0;
  $('question-text').focus({ preventScroll: true });
}

function jazzReview(prompt, result) {
  const review = element('div', undefined, 'jazz-review');
  const spacing = score => {
    const gaps = score.gaps.length
      ? t(`Khoảng cách ${score.gaps.join('–')}`, `Gaps ${score.gaps.join('–')}`)
      : t('Không có khoảng cách cần tính', 'No gaps to measure');
    const bottom = score.bottomCount === 1 ? t('52 tính sẵn', '52 covered')
      : score.bottomCount === 2 ? t('51 và 52 tính sẵn', '51 and 52 covered') : '';
    return bottom ? `${gaps} · ${bottom}` : gaps;
  };
  if (result.score) {
    const label = result.optimal ? t('Phương án tối ưu', 'Top-ranked answer') : t('Phương án hợp lệ', 'Valid answer');
    const overLimit = result.score.withinLimit ? '' :
      t(` · Có khoảng cách vượt ${maxJazzGap} vị trí`, ` · A gap exceeds ${maxJazzGap} positions`);
    review.append(element('small', `${label} · ${spacing(result.score)}${overLimit}`));
  }
  if (!result.count) review.append(element('small', t('Không có phương án hợp lệ trong vùng.', 'There is no valid hand in this range.')));
  else if (!result.options.length) review.append(element('small', t(
    `Các cụm hợp lệ trong vùng đều có khoảng cách vượt ${maxJazzGap} vị trí.`,
    `Every valid hand in this range has a gap over ${maxJazzGap} positions.`,
  )));
  const alternatives = result.betterOptions ?? result.options;
  if (alternatives.length) {
    review.append(element('strong', result.score ? t('Phương án thuận tiện hơn', 'More convenient options') : t('Phương án gợi ý', 'Suggested answers')));
    for (const { positions, score } of alternatives) {
      const line = positions.map(position => `${position} ${cardLabel(prompt.jazz.cards[position - 1])}`).join(' · ');
      review.append(element('small', `${line} · ${spacing(score)}`));
    }
  }
  return review;
}

function feedback(prompt, right, skipped, jazzResult) {
  const title = skipped ? t('Đã bỏ qua', 'Skipped') : right === null ? t('Đáp án', 'Answer') : right ? t('Đúng', 'Correct') : t('Sai', 'Incorrect');
  const panel = $('feedback');
  panel.dataset.result = right === false ? 'wrong' : 'answer';
  if (jazzResult) panel.replaceChildren(element('strong', title), jazzReview(prompt, jazzResult));
  else panel.textContent = `${title} · ${formatAnswer(prompt)}`;
  panel.hidden = false;
}

function showNextButton() {
  const next = $('next-question');
  next.textContent = run.count === run.limit ? t('Kết thúc lượt', 'Finish session') : t('Câu tiếp theo', 'Next question');
  next.hidden = false;
  next.focus({ preventScroll: true });
}

function record(correct, values = [], skipped = false, jazzResult) {
  if (!run || run.answered) return;
  const prompt = run.questions[run.index];
  run.answered = true;
  run.count++;
  const ms = (run.submittedAt ?? performance.now()) - run.questionStarted;
  const result = { prompt, correct, values, skipped, ms, jazz: jazzResult };
  const trackedPrompt = run.restack && !correct && !skipped
    ? { ...prompt, focus: prompt.answer.filter((card, i) => card !== run.restack[i]) }
    : prompt;
  try { progress = saveProgress(order, trackedPrompt, result); } catch { storageError(); }
  if (run.trial) {
    run.results.push(result);
    if (run.count >= run.limit) {
      run.elapsed = performance.now() - run.started;
      run.finished = true;
      clearInterval(timer);
      navigateTrainer('results', true);
      renderResults();
      $('back-to-practice').focus();
    } else advanceQuestion();
    return;
  }
  $('answer-form').hidden = true;
  $('submit-answer').hidden = true;
  $('skip-answer').hidden = true;
  $('session-content').scrollTop = 0;
  feedback(prompt, correct, skipped, jazzResult);
  showNextButton();
}

function advanceQuestion() {
  if (run.count >= run.limit) {
    const count = run.count;
    exitRound(t(`Đã làm hết ${count} câu khác nhau trong lượt này.`, `You finished all ${count} unique questions in this session.`));
    return;
  }
  run.index++;
  showQuestion();
}

function renderResults() {
  const { right, wrong, fastest, slowest, meanMs } = summarize(run.results);
  const rate = count => `${count} (${(count / run.count).toLocaleString(t('vi-VN', 'en'), { style: 'percent', maximumFractionDigits: 1 })})`;
  $('trial-metrics').replaceChildren(...[
    [t('Thời gian cả lượt', 'Total time'), formatMs(run.elapsed)], [t('Đúng', 'Correct'), rate(right)], [t('Sai', 'Incorrect'), rate(wrong)],
    [t('Trung bình', 'Average'), formatMs(meanMs)], [t('Nhanh nhất', 'Fastest'), formatMs(fastest?.ms ?? null)], [t('Chậm nhất', 'Slowest'), formatMs(slowest?.ms ?? null)],
  ].map(([label, value]) => {
    const metric = element('div');
    metric.append(element('dt', label), element('dd', value));
    return metric;
  }));
  $('trial-answers').replaceChildren(...run.results.map((result, index) => {
    const item = element('li');
    const label = result.skipped ? t('Bỏ qua', 'Skipped') : result.correct ? t('Đúng', 'Correct') : t('Sai', 'Incorrect');
    const badge = [label, formatMs(result.ms)];
    if (result === fastest) badge.push(t('Nhanh nhất', 'Fastest'));
    if (result === slowest) badge.push(t('Chậm nhất', 'Slowest'));
    item.value = index + 1;
    item.append(element('strong', promptText(result.prompt)));
    if (result.prompt.shown.length) item.append(element('small', result.prompt.shown.map(cardLabel).join(' '), 'muted'));
    const input = result.values.join(' · ');
    if (result.jazz) {
      const choice = input ? ` · ${t('Bạn nhập', 'You entered')} ${input}` : '';
      item.append(element('small', badge.join(' · ') + choice, 'muted'), jazzReview(result.prompt, result.jazz));
      return item;
    }
    const reviewText = `${input && !result.correct ? `${t('Bạn nhập', 'You entered')} ${input}. ` : ''}${t('Đáp án', 'Answer')} ${formatAnswer(result.prompt)}.`;
    item.append(element('small', `${badge.join(' · ')}. ${reviewText}`, 'muted'));
    return item;
  }));
  renderSetup();
}

function exitRound(note = '') {
  if (!run || run.exiting) return;
  run.exiting = true;
  roundEndMessage = note;
  clearInterval(timer);
  if (history.state?.trainerRound) history.back();
  else readTrainerRoute();
}

function showCsvStatus(text, error = false) {
  const status = $('stack-csv-status');
  status.textContent = text;
  status.classList.toggle('error', error);
  status.hidden = false;
}

function saveSelectedStackCsv() {
  if (!selectedStack) return;
  const blob = new Blob([exportStackCsv(selectedStack)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = element('a');
  link.href = url;
  link.download = (selectedStack.label.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').trim() || 'stack') + '.csv';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showCsvStatus(t(`Đã xuất ${selectedStack.label}.`, `Exported ${selectedStack.label}.`));
}

$('language').addEventListener('click', () => {
  lang = t('en', 'vi');
  try { localStorage.setItem(languageKey, lang); } catch { storageError(); }
  applyLanguage();
});

window.addEventListener('hashchange', readTrainerRoute);
desktopLayout.addEventListener('change', () => { if (view === 'practice' && !selectedDrill) renderDirectory(); });
document.addEventListener('click', event => {
  const link = event.target.closest('a[href^="#"]');
  if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  const route = link.hash;
  if (route === location.hash) return;
  if (link.id === 'trainer-back') {
    if (history.state?.trainerParent === route) { history.back(); return; }
    history.replaceState(null, '', route);
  } else {
    history.pushState({ trainerParent: location.hash }, '', route);
  }
  readTrainerRoute();
});
for (const button of all('[data-level]')) button.addEventListener('click', () => {
  level = button.dataset.level;
  selectedDrill = '';
  navigateTrainer(null, true);
  renderSetup();
});
for (const button of all('[data-mode]')) button.addEventListener('click', () => {
  mode = button.dataset.mode;
  navigateTrainer(null, true);
  renderSetup();
});
for (const button of all('[data-learn]')) button.addEventListener('click', () => {
  studyStyle = button.dataset.learn;
  navigateTrainer();
  renderStudy();
});
for (const button of all('[data-range]')) button.addEventListener('click', () => changeRange(...button.dataset.range.split(',').map(Number)));
for (const id of ['range-start', 'range-end']) {
  const field = $(id);
  field.addEventListener('input', () => {
    if (!field.value || !field.validity.valid) return;
    resetFlip();
    renderSetup();
  });
  field.addEventListener('change', () => {
    const { start, end } = range();
    changeRange(start, end);
  });
}

$('active-stack').addEventListener('change', chooseStack);
window.addEventListener('storage', event => { if (event.key === libraryKey) fillStacks(selectedStack.id); });
window.addEventListener('pageshow', event => {
  if (event.persisted) {
    fillStacks(selectedStack.id);
    progress = readProgress(order);
    renderSetup();
  }
});
$('save-stack').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const entry = saveStack($('stack-name').value, $('stack-cards').value);
    fillStacks(entry.id);
    chooseStack();
    $('save-stack').reset();
    $('custom-stack').open = false;
    $('custom-error').hidden = true;
    $('active-stack').focus();
  } catch (error) {
    $('custom-error').hidden = false;
    $('custom-error').textContent = error.code ? message(lang, error.code, ...error.parameters) : error.message === 'stackName'
      ? t('Nhập tên stack.', 'Enter a stack name.') : t('Không lưu được stack trên trình duyệt này.', 'This browser could not save the stack.');
  }
});
$('export-stack').addEventListener('click', saveSelectedStackCsv);
$('import-stack').addEventListener('click', () => $('stack-csv-file').click());
$('stack-csv-file').addEventListener('change', async event => {
  const input = event.currentTarget;
  const file = input.files[0];
  if (!file) return;
  $('import-stack').disabled = true;
  try {
    const fallback = file.name.replace(/\.csv$/i, '').trim() || t('Stack nhập từ CSV', 'Imported stack');
    const imported = importStackCsv(await file.text(), fallback);
    const entry = saveStack(imported.label, stackOrder(imported.cards));
    fillStacks(entry.id);
    chooseStack();
    showCsvStatus(t(`Đã nạp ${entry.label} vào thư viện.`, `Loaded ${entry.label} into your library.`));
  } catch (error) {
    const copy = {
      csvFormat: t('CSV cần một cột Card hoặc một danh sách 52 lá.', 'Use a Card column or a list of 52 cards.'),
      csvPositions: t('Cột Position phải có các vị trí từ 1 đến 52, mỗi vị trí một lần.', 'Use positions 1 through 52, with each position listed once.'),
      csvOneStack: t('Mỗi file CSV chỉ chứa một stack.', 'Each CSV must contain one stack.'),
    };
    showCsvStatus(error.code ? message(lang, error.code, ...error.parameters) : copy[error.message] ||
      t('Không thể đọc hoặc lưu stack từ CSV.', 'Could not read or save the stack from CSV.'), true);
  } finally {
    input.value = '';
    $('import-stack').disabled = false;
  }
});

$('flip-side').addEventListener('change', () => { flipped = false; renderStudy(); });
$('flip-card').addEventListener('click', () => { flipped = !flipped; renderStudy(); });
$('flip-prev').addEventListener('click', () => { studyIndex--; flipped = false; renderStudy(); });
$('flip-next').addEventListener('click', () => { studyIndex++; flipped = false; renderStudy(); });
$('practice-focus').addEventListener('change', renderSetup);
for (const [value, label] of Object.entries(handNames)) $('jazz-hand').add(new Option(label, value));
$('split-count').addEventListener('change', () => {
  const sizes = splitDefaults[$('split-count').value];
  $('split-sizes').value = '';
  $('split-sizes').placeholder = sizes.join(', ');
});
$('practice-form').addEventListener('submit', newRound);
$('answer-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!run || run.answered || $('submit-answer').disabled || $('submit-answer').hidden) return;
  if (run.submitBoard) run.submitBoard();
  else if (run.restack) submitAnswer(run.restack);
  else if (!run.choice && !run.reveal) submitAnswer(manualValues(run.manual));
});
$('skip-answer').addEventListener('click', () => {
  if (!run || run.answered) return;
  const prompt = run.questions[run.index];
  run.submittedAt = performance.now();
  record(false, [], true, prompt.jazz ? findJazzOptions(prompt.jazz) : undefined);
});
$('reveal-answer').addEventListener('click', () => {
  if (!run?.reveal || run.answered) return;
  run.answered = true;
  run.count++;
  const prompt = run.questions[run.index];
  feedback(prompt, null, false, prompt.jazz ? findJazzOptions(prompt.jazz) : undefined);
  $('reveal-answer').hidden = true;
  showNextButton();
});
$('next-question').addEventListener('click', advanceQuestion);
$('quit-practice').addEventListener('click', () => exitRound());
$('back-to-practice').addEventListener('click', () => exitRound());

applyLanguage();
chooseStack();
readTrainerRoute();
if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('./offline.js').catch(() => {});
