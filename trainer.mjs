import { cardLabel, languageKey, library, libraryKey, readLocal, redCard, saveStack, stackOrder } from './stack-library.mjs';
import { message } from './i18n.mjs';
import { advanced, basic, grade, questionSet, stackModel } from './drills.mjs';
import { drillCopy, groupCopy } from './trainer-copy.mjs';
import { activeStackKey, readProgress, saveProgress, slowCards, summarize, weakCards } from './trainer-progress.mjs';

const $ = id => document.getElementById(id);
const all = selector => [...document.querySelectorAll(selector)];
const basicGroups = { position: basic.slice(0, 2), neighbour: basic.slice(2) };
const localCopy = ['data-en', 'data-en-aria'].flatMap(key => all(`[${key}]`).map(node => ({
  node, attribute: key.endsWith('-aria') ? 'aria-label' : null, en: node.getAttribute(key), vi: key.endsWith('-aria') ? node.getAttribute('aria-label') : node.textContent,
})));

let lang = 'vi';
try { if (localStorage.getItem(languageKey) === 'en') lang = 'en'; } catch {}
const t = (vi, en) => lang === 'vi' ? vi : en;
const drillName = kind => t(...drillCopy[kind]);
const promptText = ({ kind, args }) => t(...drillCopy[kind].slice(2)).replace(/\{(\d+)\}/g, (_, index) => args[index]);
const formatAnswer = ({ answer }) => answer.map(item => typeof item === 'number' ? item : cardLabel(item)).join(' · ');

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
  return [value];
}

function fillSkills(value = 'all') {
  const selector = $('skill');
  selector.replaceChildren(new Option(t('Trộn tất cả', 'Mix all drills'), 'all'));
  for (const [key, skills] of Object.entries(activeGroups())) {
    const name = t(...groupCopy[key]);
    const group = element('optgroup');
    group.label = name;
    group.append(new Option(t(`Trộn ${name}`, `Mix ${name}`), `group:${key}`));
    for (const kind of skills) group.append(new Option(drillName(kind), kind));
    selector.append(group);
  }
  selector.value = [...selector.options].some(option => option.value === value) ? value : 'all';
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
  $('answer-mode-field').hidden = trial;
  if (!beyond) {
    const count = currentSkills().reduce((sum, kind) => sum + (progress?.[kind]?.total ?? 0), 0);
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
  run = { trial, questions, options, skills, index: 0, results: [], self: !trial && $('answer-mode').value === 'self',
    limit: trial ? Number($('trial-count').value) : Infinity, started: performance.now(), count: 0 };
  renderSetup();
  showQuestion();
  if (trial) { tick(); timer = setInterval(tick, 200); }
}

function showQuestion() {
  const prompt = run.questions[run.index];
  run.answered = false;
  run.revealMs = null;
  $('session-mode').textContent = run.trial ? t('Thi', 'Time Trial') : t('Tập', 'Trainer');
  $('question-count').textContent = run.trial ? `${run.count + 1} / ${run.limit}` : t(`Câu ${run.count + 1}`, `Question ${run.count + 1}`);
  $('trial-time').hidden = !run.trial;
  $('trial-progress').hidden = !run.trial;
  if (run.trial) { $('trial-progress').max = run.limit; $('trial-progress').value = run.count; }
  $('question-skill').textContent = drillName(prompt.kind);
  $('question-text').textContent = promptText(prompt);
  $('question-cards').replaceChildren(...prompt.shown.map(cardFace));
  $('question-cards').hidden = !prompt.shown.length;
  $('answer-form').hidden = run.self;
  $('reveal-answer').hidden = !run.self;
  $('self-grade').hidden = true;
  $('next-question').hidden = true;
  $('feedback').hidden = true;
  $('answer-error').hidden = true;
  if (!run.self) {
    const numeric = typeof prompt.answer[0] === 'number';
    const labels = prompt.labels.length ? prompt.labels : numeric && prompt.answer.length > 1
      ? prompt.answer.map((_, i) => t(`Chặng ${i + 1}`, `Gap ${i + 1}`)) : [t('Đáp án', 'Answer')];
    $('answer-fields').replaceChildren(...labels.map((heading, i) => {
      const field = element('div');
      const label = element('label', heading);
      const input = element('input');
      input.id = label.htmlFor = `answer-${i}`;
      input.inputMode = numeric ? 'numeric' : 'text';
      input.autocapitalize = 'characters';
      input.spellcheck = false;
      input.autocomplete = 'off';
      if (!numeric) input.placeholder = prompt.answer.length > 1 ? 'AS 2H …' : 'AS';
      field.append(label, input);
      return field;
    }));
  }
  run.questionStarted = performance.now();
  if (run.self) $('reveal-answer').focus();
  else $('answer-0').focus();
}

function feedback(prompt, right = null, skipped = false) {
  const title = skipped ? t('Đã bỏ qua', 'Skipped') : right === null ? t('Đáp án', 'Answer') : right ? t('Đúng', 'Correct') : t('Sai', 'Incorrect');
  $('feedback').dataset.result = right === false ? 'wrong' : 'answer';
  $('feedback').textContent = `${title} · ${formatAnswer(prompt)}`;
  $('feedback').hidden = false;
}

function record(correct, values = [], skipped = false) {
  if (!run || run.answered) return;
  const prompt = run.questions[run.index];
  run.answered = true;
  run.count++;
  const result = { prompt, correct, values, skipped, ms: run.revealMs ?? (performance.now() - run.questionStarted) };
  try { progress = saveProgress(order, prompt, result); } catch { storageError(); }
  if (run.trial) {
    run.results.push(result);
    if (run.count >= run.limit) {
      run.elapsed = performance.now() - run.started;
      run.finished = true;
      clearInterval(timer);
      renderResults();
      $('back-to-practice').focus();
    } else advanceQuestion();
    return;
  }
  $('answer-form').hidden = true;
  $('self-grade').hidden = true;
  $('answer-error').hidden = true;
  feedback(prompt, correct, skipped);
  $('next-question').hidden = false;
  $('next-question').focus();
}

function advanceQuestion() {
  run.index++;
  if (run.index >= run.questions.length) {
    const last = run.questions.at(-1);
    run.questions = questionSet(model, run.skills, run.options);
    if (!run.options.sequential && run.questions.length > 1 && promptText(run.questions[0]) === promptText(last)) {
      run.questions.push(run.questions.shift());
    }
    run.index = 0;
  }
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

function exitRound() {
  clearInterval(timer);
  run = null;
  $('trial-review').open = false;
  renderSetup();
  $('skill').focus();
}

$('language').addEventListener('click', () => {
  lang = t('en', 'vi');
  try { localStorage.setItem(languageKey, lang); } catch { storageError(); }
  applyLanguage();
});

for (const button of all('[data-view]')) button.addEventListener('click', () => { view = button.dataset.view; renderSetup(); });
for (const button of all('[data-level]')) button.addEventListener('click', () => {
  level = button.dataset.level;
  if (level !== 'beyond') fillSkills();
  renderSetup();
});
for (const button of all('[data-mode]')) button.addEventListener('click', () => { mode = button.dataset.mode; renderSetup(); });
for (const button of all('[data-learn]')) button.addEventListener('click', () => { studyStyle = button.dataset.learn; renderStudy(); });
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
for (const id of ['skill', 'practice-focus']) $(id).addEventListener('change', renderSetup);
$('practice-form').addEventListener('submit', newRound);
$('answer-form').addEventListener('submit', event => {
  event.preventDefault();
  const answers = all('#answer-fields input').map(input => input.value);
  const correct = grade(run.questions[run.index], answers);
  if (correct === null) {
    $('answer-error').hidden = false;
    $('answer-error').textContent = t('Điền đủ đáp án. Dùng số hoặc mã lá như AS, 10H tùy câu.', 'Enter the full answer. Use numbers or card codes such as AS and 10H as requested.');
  } else record(correct, answers);
});
$('skip-answer').addEventListener('click', () => record(false, [], true));
$('reveal-answer').addEventListener('click', () => {
  run.revealMs = performance.now() - run.questionStarted;
  feedback(run.questions[run.index]);
  $('reveal-answer').hidden = true;
  $('self-grade').hidden = false;
  $('mark-right').focus();
});
$('mark-right').addEventListener('click', () => record(true));
$('mark-wrong').addEventListener('click', () => record(false));
$('next-question').addEventListener('click', advanceQuestion);
$('quit-practice').addEventListener('click', exitRound);
$('back-to-practice').addEventListener('click', exitRound);

applyLanguage();
chooseStack();
if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('./offline.js').catch(() => {});
