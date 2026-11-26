import { cardLabel, languageKey, library, libraryKey, readLocal, redCard, saveStack, stackOrder, suits } from './stack-library.mjs';
import { message } from './i18n.mjs';
import { ranks } from './solver.mjs';
import { advanced, answerChoices, basic, grade, questionSet, stackModel } from './drills.mjs';
import { drillCopy, groupCopy } from './trainer-copy.mjs';
import { activeStackKey, readProgress, saveProgress, slowCards, summarize, weakCards } from './trainer-progress.mjs';

const $ = id => document.getElementById(id);
const all = selector => [...document.querySelectorAll(selector)];
const basicGroups = { position: basic.slice(0, 2), neighbour: basic.slice(2) };
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
const drillName = kind => t(...drillCopy[kind]);
const promptText = ({ kind, args }) => t(...drillCopy[kind].slice(2)).replace(/\{(\d+)\}/g, (_, index) => args[index]);
const formatAnswer = ({ answer }) => answer.map(item => typeof item === 'number' ? item : cardLabel(item)).join(' · ');
const suitKeys = [['S', 'Bích', 'Spades'], ['H', 'Cơ', 'Hearts'], ['C', 'Chuồn', 'Clubs'], ['D', 'Rô', 'Diamonds']];

let entries = [];
let selectedStack;
let order;
let model;
let progress;
let view = 'learn';
let studyStyle = 'flip';
let studyIndex = 1;
let flipped = false;
let level = 'basic';
let mode = 'train';
let run;
let timer;
let roundEndMessage = '';

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

function activeGroups() { return level === 'basic' ? basicGroups : advanced; }

function currentSkills() {
  const value = $('skill').value;
  const groups = activeGroups();
  if (!value || value === 'all') return Object.values(groups).flat();
  if (value.startsWith('group:')) return groups[value.slice(6)];
  return combinedDrills[value]?.skills ?? [value];
}

function fillSkills(value = 'all') {
  const selector = $('skill');
  selector.replaceChildren(new Option(t('Trộn tất cả', 'Mix all drills'), 'all'));
  for (const [key, skills] of Object.entries(activeGroups())) {
    const name = t(...groupCopy[key]);
    const group = element('optgroup');
    group.label = name;
    const choices = key === 'distance' ? ['count-steps', 'find-by-steps'] : key === 'quartet' ? ['quartet-numbers', ...skills] : skills;
    for (const kind of choices) {
      const combined = combinedDrills[kind];
      group.append(new Option(combined ? t(...combined.label) : drillName(kind), kind));
    }
    if (skills.length > 1) {
      const mix = new Option(t(`Trộn ${name}`, `Mix ${name}`), `group:${key}`);
      group.insertBefore(mix, key === 'bottom' ? null : group.firstChild);
    }
    selector.append(group);
  }
  selector.value = [...selector.options].some(option => option.value === value) ? value : 'all';
}

function trainerRoute(stage) {
  if (view === 'learn') return `#learn/${studyStyle}`;
  if (view === 'assistant') return '#assistant';
  const skill = level === 'beyond' ? 'all' : $('skill').value || 'all';
  return ['#practice', level, skill, mode, stage].filter(Boolean).join('/');
}

function navigateTrainer(stage, replace = false) {
  const route = trainerRoute(stage);
  if (route === location.hash) return;
  const state = stage ? { trainerRound: true } : null;
  if (replace) history.replaceState(state, '', route);
  else history.pushState(state, '', route);
}

function readTrainerRoute() {
  const [section, nextLevel, skill, nextMode] = location.hash.slice(1).split('/');
  const leftRound = Boolean(run);
  clearInterval(timer);
  run = null;
  $('trial-review').open = false;
  view = section === 'assistant' || section === 'practice' ? section : 'learn';
  if (view === 'practice') {
    level = nextLevel === 'advanced' || nextLevel === 'beyond' ? nextLevel : 'basic';
    mode = nextMode === 'trial' ? 'trial' : 'train';
    if (level !== 'beyond') fillSkills(skill);
  } else if (view === 'learn') {
    studyStyle = nextLevel === 'grid' ? 'grid' : 'flip';
  }
  navigateTrainer(null, true);
  renderSetup();
  if (leftRound && view === 'practice') {
    if (roundEndMessage) $('practice-status').textContent = roundEndMessage;
    $('skill').focus();
  }
  roundEndMessage = '';
}

function renderSetup() {
  const beyond = level === 'beyond';
  const trial = mode === 'trial';
  const inSession = run && !run.finished;
  for (const button of all('[data-view]')) {
    const active = button.dataset.view === view;
    $(button.dataset.view).hidden = !active;
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
    button.disabled = Boolean(inSession);
  }
  $('trainer-settings').hidden = view === 'assistant' || (view === 'practice' && Boolean(run || beyond));
  $('range-field').hidden = view === 'practice' && level !== 'basic';
  $('practice-setup').hidden = Boolean(run);
  $('practice-session').hidden = !run || run.finished;
  $('trial-results').hidden = !run?.finished;
  $('language').disabled = Boolean(inSession);
  $('practice-form').hidden = beyond;
  $('beyond').hidden = !beyond;
  for (const button of all('[data-level]')) button.setAttribute('aria-pressed', button.dataset.level === level);
  for (const button of all('[data-mode]')) button.setAttribute('aria-pressed', button.dataset.mode === mode);
  $('advanced-range').hidden = level !== 'advanced';
  $('trial-count-field').hidden = !trial;
  $('order-field').hidden = trial;
  $('focus-field').hidden = trial;
  if (!beyond) {
    const skills = currentSkills();
    const restackOnly = skills.every(skill => skill === 'restack');
    $('answer-mode-field').hidden = trial && restackOnly;
    $('choice-mode').hidden = $('choice-mode').disabled = restackOnly;
    $('reveal-mode').hidden = $('reveal-mode').disabled = trial;
    $('manual-mode').textContent = restackOnly ? t('Chạm để xếp', 'Tap to order') : t('Nhập trên màn hình', 'On-screen input');
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
  if (level !== 'beyond') fillSkills($('skill').value);
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
  const trial = mode === 'trial';
  const skills = currentSkills();
  const focus = trial ? 'all' : $('practice-focus').value;
  const focusCards = focus === 'weak' ? weakCards(progress) : focus === 'slow' ? slowCards(progress, skills) : null;
  const options = { ...(level === 'basic' ? range() : {}), sequential: !trial && $('question-order').value === 'sequential',
    eligible: prompt => !focusCards || prompt.focus.some(card => focusCards.has(card)) };
  const questions = questionSet(model, skills, options);
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
    $('restack-answer').replaceChildren(...selected.map((card, i) => {
      const label = cardLabel(card);
      const style = redCard(card) ? 'restack-card answer-red' : 'restack-card';
      return answerButton(label, style, () => {
        selected.splice(i, 1);
        refresh();
        source.get(card).focus({ preventScroll: true });
      }, t(`Ô ${i + 1}, bỏ ${label} khỏi thứ tự`, `Entry ${i + 1}, remove ${label} from your order`));
    }));
    $('restack-count').textContent = `${selected.length} / ${prompt.answer.length}`;
    $('submit-answer').disabled = selected.length !== prompt.answer.length;
  }

  $('restack-source').replaceChildren(...source.values());
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
      button.textContent = value || '—';
      const label = !numeric || prompt.unordered ? t(`Ô ${i + 1}`, `Entry ${i + 1}`) : t(`Chặng ${i + 1}`, `Gap ${i + 1}`);
      button.setAttribute('aria-label', `${entries.length === 1 ? t('Đáp án', 'Answer') : label} · ${button.textContent}`);
      button.setAttribute('aria-pressed', i === manual.active);
      button.classList.toggle('answer-red', !numeric && redCard(entries[i].suit));
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
        if (previous.length < 2) entries[manual.active] = previous + value;
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
  const restack = isRestack && !run.reveal;
  run.answered = false;
  run.restack = null;
  $('session-mode').textContent = run.trial ? t('Thi', 'Time Trial') : t('Tập', 'Trainer');
  $('question-count').textContent = run.trial ? `${run.count + 1} / ${run.limit}` : t(`Câu ${run.count + 1}`, `Question ${run.count + 1}`);
  $('trial-time').hidden = !run.trial;
  $('trial-progress').hidden = !run.trial;
  if (run.trial) { $('trial-progress').max = run.limit; $('trial-progress').value = run.count; }
  $('question-skill').textContent = drillName(prompt.kind);
  $('question-text').textContent = isRestack && run.reveal
    ? t('Nhẩm thứ tự stack của các lá này từ trên xuống.', 'Recall the order of these cards from top to bottom.')
    : promptText(prompt);
  $('question-cards').replaceChildren(...(restack ? [] : prompt.shown.map(cardFace)));
  $('question-cards').hidden = restack || !prompt.shown.length;
  $('answer-form').hidden = run.reveal;
  $('reveal-answer').hidden = !run.reveal;
  $('answer-choices').hidden = restack || !run.choice;
  $('answer-pad').hidden = restack || run.choice;
  $('restack-board').hidden = !restack;
  $('submit-answer').hidden = !restack && run.choice;
  $('next-question').hidden = true;
  $('feedback').hidden = true;
  if (!run.reveal) {
    if (restack) setupRestack(prompt);
    else if (run.choice) renderChoices(prompt);
    else setupManual(prompt);
  }
  run.questionStarted = performance.now();
  $('question-text').focus({ preventScroll: true });
}

function feedback(prompt, right, skipped) {
  const title = skipped ? t('Đã bỏ qua', 'Skipped') : right === null ? t('Đáp án', 'Answer') : right ? t('Đúng', 'Correct') : t('Sai', 'Incorrect');
  $('feedback').dataset.result = right === false ? 'wrong' : 'answer';
  $('feedback').textContent = `${title} · ${formatAnswer(prompt)}`;
  $('feedback').hidden = false;
}

function showNextButton() {
  const next = $('next-question');
  next.textContent = run.count === run.limit ? t('Kết thúc lượt', 'Finish session') : t('Câu tiếp theo', 'Next question');
  next.hidden = false;
  next.focus();
}

function record(correct, values = [], skipped = false) {
  if (!run || run.answered) return;
  const prompt = run.questions[run.index];
  run.answered = true;
  run.count++;
  const result = { prompt, correct, values, skipped, ms: performance.now() - run.questionStarted };
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
  feedback(prompt, correct, skipped);
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

$('language').addEventListener('click', () => {
  lang = t('en', 'vi');
  try { localStorage.setItem(languageKey, lang); } catch { storageError(); }
  applyLanguage();
});

window.addEventListener('hashchange', readTrainerRoute);
for (const button of all('[data-view]')) button.addEventListener('click', () => {
  view = button.dataset.view;
  if (run) {
    clearInterval(timer);
    run = null;
    $('trial-review').open = false;
  }
  navigateTrainer();
  renderSetup();
});
for (const button of all('[data-level]')) button.addEventListener('click', () => {
  level = button.dataset.level;
  if (level !== 'beyond') fillSkills();
  navigateTrainer();
  renderSetup();
});
for (const button of all('[data-mode]')) button.addEventListener('click', () => {
  mode = button.dataset.mode;
  navigateTrainer();
  renderSetup();
});
for (const button of all('[data-learn]')) button.addEventListener('click', () => {
  studyStyle = button.dataset.learn;
  navigateTrainer();
  renderStudy();
});
for (const button of all('[data-range]')) button.addEventListener('click', () => changeRange(...button.dataset.range.split(',').map(Number)));
for (const id of ['range-start', 'range-end']) $(id).addEventListener('change', () => { const { start, end } = range(); changeRange(start, end); });

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

$('flip-side').addEventListener('change', () => { flipped = false; renderStudy(); });
$('flip-card').addEventListener('click', () => { flipped = !flipped; renderStudy(); });
$('flip-prev').addEventListener('click', () => { studyIndex--; flipped = false; renderStudy(); });
$('flip-next').addEventListener('click', () => { studyIndex++; flipped = false; renderStudy(); });
$('skill').addEventListener('change', () => { navigateTrainer(); renderSetup(); });
$('practice-focus').addEventListener('change', renderSetup);
$('practice-form').addEventListener('submit', newRound);
$('answer-form').addEventListener('submit', event => {
  event.preventDefault();
  if (run?.restack) submitAnswer(run.restack);
  else if (run && !run.choice && !run.reveal) submitAnswer(manualValues(run.manual));
});
$('skip-answer').addEventListener('click', () => record(false, [], true));
$('reveal-answer').addEventListener('click', () => {
  if (!run?.reveal || run.answered) return;
  run.answered = true;
  run.count++;
  feedback(run.questions[run.index], null, false);
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
