import { cullTimeline, defaults, demoStack, parseCards, parsePositions, displayCards, ndo } from './solver.mjs';
import { findPreset, getPreset, presets } from './presets.mjs';

const $ = id => document.getElementById(id);
const storageKey = 'stack-solver-history-v1';
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
  const usePrior = prior && (prior.practicalScore < session.practicalScore ||
    (prior.practicalScore === session.practicalScore && (prior.shortestLength < session.shortestLength ||
      (prior.shortestLength === session.shortestLength && prior.optimal && !session.optimal))));
  const record = usePrior ? { ...prior, name: session.name } : { ...session };
  $('saved-note').textContent = writeHistory([record, ...records.filter(entry => entry.key !== session.key)].slice(0, 12))
    ? 'Đã lưu trên thiết bị này.' : 'Trình duyệt chưa cho lưu trên thiết bị này.';
}

function showError(message = '') {
  $('error').textContent = message;
  $('error').hidden = !message;
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
  showError();
}

function updateStart() {
  const preset = getPreset($('start').value);
  $('start-custom').hidden = Boolean(preset);
  $('start-preview').hidden = !preset;
  $('start-preview').value = preset?.cards.join(' ') ?? '';
}

function loadCards(cards, name) {
  $('target').value = cards.join(' ');
  $('target-preset').value = findPreset(cards)?.id ?? '';
  $('name').value = name;
  showError();
  updateCount();
}

function installPresetOptions() {
  for (const id of ['start', 'target-preset']) {
    const select = $(id);
    select.replaceChildren();
    if (id === 'target-preset') select.add(new Option('Chọn stack có sẵn', ''));
    for (const category of ['Bộ mới', 'Stack']) {
      const group = document.createElement('optgroup');
      group.label = category;
      for (const preset of presets.filter(entry => entry.category === category)) {
        group.append(new Option(preset.label, preset.id));
      }
      select.append(group);
    }
    if (id === 'start') { select.add(new Option('Nhập thứ tự khác', 'custom')); select.value = 'ndo'; }
  }
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

function cutCards(splits, before) {
  return splits.map(slot => `${cardText(before[slot - 1])} (#${slot})`).join(', ');
}

function moveName(step, before) {
  if (step.kind === 'multi-cut') {
    const { splits, order, stacked, overhand } = step.params;
    const name = (stacked ?? overhand) ? 'Cắt chồng' : 'Cắt';
    return `${name} ${order.length} cọc · sau ${cutCards(splits, before)} · gom ${order.join('–')}`;
  }
  if (step.kind === 'triple') return `Cắt 3 cọc · sau ${cutCards([step.params.a, step.params.b], before)} · gom ${step.params.order}`;
  if (!isCull(step)) return step.label;
  const name = step.kind === 'reverse-cull' ? 'Reverse cull' : `Cull ${step.cards.length}`;
  const direction = cullDirection(step);
  const cards = direction === 'up' ? [...step.cards].reverse() : step.cards;
  return `${name} · ${direction === 'up' ? 'dưới lên' : 'trên xuống'} · ${cards.map(cardText).join(', ')}`;
}

function cardText(card) {
  return card.slice(0, -1) + suits[card.at(-1)];
}

function instructions(step, before) {
  if (!step) return 'Thứ tự trước khi bắt đầu. Đọc từ trái sang phải, rồi xuống dòng.';
  const p = step.params;
  if (isCull(step)) return `Xòe từ ${cullDirection(step) === 'up' ? 'dưới lên' : 'trên xuống'}. Số vị trí đếm từ đầu bộ lúc chưa cull.`;
  if (step.kind === 'cut') return `Chuyển ${p.n} lá đầu xuống cuối bộ.`;
  if (step.kind === 'run') return `Run ${p.n} lá đầu, rồi đặt phần còn lại lên trên tụ vừa run.`;
  if (step.kind === 'reverse') return `Run ${p.n} lá đầu để đảo thứ tự, rồi đặt phần còn lại xuống dưới tụ vừa run.`;
  if (step.kind === 'triple') return `Cắt sau ${cutCards([p.a, p.b], before)}, rồi gom ba cọc theo thứ tự ${p.order}.`;
  if (step.kind === 'multi-cut') {
    const cut = `Cắt sau ${cutCards(p.splits, before)}. Đánh số cọc từ đầu bộ xuống.`;
    const method = (p.stacked ?? p.overhand) ? ' Đặt từng cọc vừa lấy lên trên cọc trước, kể cả cọc cuối.' : '';
    return `${cut}${method} Thứ tự từ trên xuống sau khi gom là ${p.order.join(' → ')}.`;
  }
  if (step.kind === 'deal') return `Chia lần lượt từ tụ 1 tới tụ ${p.count} rồi lặp lại. Gom theo thứ tự từ đầu bộ xuống: ${p.order.join(' → ')}.`;
  if (step.kind === 'weave') return `Chia ${p.split}/${52 - p.split}. A là tụ trên, B là tụ dưới. Xen theo thứ tự ${p.mask.match(/.{1,13}/g).join(' ')}.`;
  if (p.lead && p.tail) return 'Faro xen đoạn giữa từ một lời giải cũ. Hãy tìm lại chuỗi với luật faro hiện tại.';
  const larger = p.spare === 'A' ? 'tụ trên' : 'tụ dưới';
  const bottom = p.from === 'bottom' || Boolean(p.lead);
  const first = (p.first === 'A') !== bottom ? 'tụ trên' : 'tụ dưới';
  const lead = p.lead ? `Chừa ${p.lead} lá đầu của ${larger}. ` : '';
  const tail = p.tail ? ` Để ${p.tail} lá còn lại của ${larger} ở cuối.` : '';
  return `Cắt ${p.split}/${52 - p.split}. ${lead}Xen từ ${bottom ? 'đáy' : 'đầu'}, bắt đầu bằng ${first}.${tail}`;
}

function cullDescriptions(step, before) {
  if (!isCull(step)) return [];
  const source = slot => `${cardText(before[slot])} (#${slot + 1})`;
  const { slots, destinations = step.cards.map(card => step.deck.indexOf(card)) } = step.params;
  return cullTimeline({ slots, destinations, direction: cullDirection(step) }).map(event => {
    const card = cardText(step.cards[event.card]);
    if (event.type === 'pick') return `Lấy ${source(slots[event.card])}.`;
    if (event.above === null) return `Nạp ${card} lên đầu bộ, ngay trên ${source(event.below)}.`;
    if (event.below === null) return `Nạp ${card} xuống đáy, ngay dưới ${source(event.above)}.`;
    return `Nạp ${card} vào giữa ${source(event.above)} và ${source(event.below)}.`;
  });
}

function showStep(number) {
  const steps = session.routes?.[currentRoute] ?? session.steps;
  currentStep = number;
  const step = steps[number - 1];
  const before = steps[number - 2]?.deck ?? session.startCards;
  $('step-number').textContent = number ? `Nước ${number}/${steps.length}` : 'Bộ xuất phát';
  $('step-detail').textContent = instructions(step, before);
  const events = cullDescriptions(step, before);
  $('cull-events').hidden = !events.length;
  $('cull-events').replaceChildren(...events.map(description => {
    const item = document.createElement('li');
    item.textContent = description;
    return item;
  }));
  $('previous').disabled = !number;
  $('next').disabled = number === steps.length;
  const goals = new Map(session.targetPositions);
  $('deck-grid').replaceChildren(...(step?.deck ?? session.startCards).map((card, slot) => {
    const tile = document.createElement('span');
    tile.className = /[DH]$/.test(card) ? 'card red' : 'card';
    tile.textContent = cardText(card);
    if (goals.get(slot) === card) {
      tile.classList.add('goal-card');
      tile.title = `Vị trí ${slot + 1} đã khớp`;
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
  $('study').hidden = false;
  $('route-picker').hidden = routes.length < 2;
  if (routes.length > 1) {
    $('route').replaceChildren(...routes.map((route, index) => new Option(`${index + 1} · ${route.length} nước · ${cullCount(route)} cull`, index)));
    $('route').value = currentRoute;
  }
  $('move-total').textContent = steps.length;
  $('move-culls').textContent = ` · ${cullCount(steps)} cull`;
  $('copy').disabled = steps.length === 0;
  stepButtons = steps.map((step, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'quiet';
    const number = document.createElement('span');
    number.className = 'number';
    number.textContent = index + 1;
    button.append(number, document.createTextNode(moveName(step, steps[index - 1]?.deck ?? session.startCards)));
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

function receiveRoutes({ steps, routes = steps ? [steps] : [], shortestLength = steps?.length, practicalScore }) {
  const previous = session.routes?.[currentRoute];
  session.steps = steps;
  session.routes = routes;
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
  $('proof').textContent = message.provedThrough > 0
    ? `Đã loại chuỗi ≤ ${message.provedThrough} nước` : 'Đang so với các chuỗi ngắn hơn';
}

function finish(stopped = false) {
  worker?.terminate();
  worker = undefined;
  setLocked(false);
  if (session.steps) {
    $('status').textContent = session.optimal ? 'Đã chứng minh số nước' : 'Chuỗi tốt nhất đã tìm';
    const count = session.routes?.length || 1;
    const shortest = session.optimal
      ? `Ít nhất ${session.shortestLength} nước.`
      : `Ít nhất trong các chuỗi tìm được là ${session.shortestLength} nước.`;
    const ranking = count > 1 ? ' Phương án 1 ưu tiên ít cull và ít xen cut với cull.' : '';
    const match = session.targetPositions?.length ? ` Khớp ${session.targetPositions.length} vị trí đã chọn.` : '';
    $('progress-message').textContent = `${stopped ? 'Đã dừng. ' : ''}Tìm được ${count} phương án.${match} ${shortest}${ranking}`;
    saveSolution();
  } else {
    $('status').textContent = stopped ? 'Đã dừng' : 'Chưa có chuỗi';
    $('progress-message').textContent = stopped
      ? 'Bạn đã dừng trước khi tìm được chuỗi.'
      : 'Chưa tìm được chuỗi từ tập nước đi đã chọn. Có thể thử bật Cut và Cull.';
  }
  if (session.provedThrough < 1) $('proof').textContent = session.optimal ? 'Stack đã khớp' : 'Chưa loại trừ hết chuỗi ngắn';
}

function restore(entry) {
  if (worker) return;
  session = { ...entry };
  $('start').value = findPreset(entry.startCards)?.id ?? 'custom';
  $('start-custom').value = entry.startCards.join(' ');
  updateStart();
  $('target-mode').value = entry.targetPositions ? 'partial' : 'full';
  updateTargetMode();
  if (entry.targetPositions) {
    $('target-positions').value = entry.targetPositions.map(([slot, card]) => `${slot + 1}=${card}`).join(', ');
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
  $('status').textContent = entry.optimal ? 'Đã chứng minh' : 'Đã lưu';
  const minimum = entry.shortestLength ?? entry.steps.length;
  $('progress-message').textContent = entry.optimal
    ? `Chuỗi đã lưu. Với luật lúc tìm, cần ít nhất ${minimum} nước.`
    : 'Chuỗi hợp lệ đã lưu để học lại.';
  $('saved-note').textContent = 'Đã lưu trên thiết bị này.';
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
    load.textContent = `${entry.name} · ${entry.steps.length} nước`;
    load.disabled = Boolean(worker);
    load.addEventListener('click', () => restore(entry));
    const remove = document.createElement('button');
    remove.className = 'quiet';
    remove.textContent = 'Xóa';
    remove.addEventListener('click', () => {
      writeHistory(readHistory().filter(record => record.key !== entry.key));
      renderHistory();
    });
    item.append(load, remove);
    return item;
  }));
  if (!entries.length) {
    const item = document.createElement('li');
    item.textContent = 'Chưa có chuỗi nào.';
    $('history-list').append(item);
  }
}

$('solver-form').addEventListener('submit', event => {
  event.preventDefault();
  if (worker) return;
  showError();
  try {
    const startPreset = getPreset($('start').value);
    const start = parseCards(startPreset ? startPreset.cards.join(' ') : $('start-custom').value);
    const partial = $('target-mode').value === 'partial';
    const target = partial ? parsePositions($('target-positions').value) : parseCards($('target').value);
    const options = { ...defaults };
    for (const family of families) options[family] = $(family).checked;
    for (const [id, key] of switches) options[key] = $(id).checked;
    for (const [id, key, min, max] of numeric) {
      const value = Number($(id).value);
      if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Giá trị cho phép từ ${min} đến ${max}.`);
      options[key] = value;
    }
    options.multiCutReorder = options.multiCut && $('multi-cut-reorder').checked;
    options.dealOrder = $('deal-order').value;
    if (!families.some(family => options[family]) && !extraFamilies.some(([, key]) => options[key])) {
      throw new Error('Bật ít nhất một loại nước đi.');
    }
    const seconds = Number($('seconds').value);
    const memory = navigator.deviceMemory || 4;
    const limits = { seconds, maxStates: memory <= 2 ? 85_000 : memory <= 4 ? 180_000 : 340_000 };
    session = { key: JSON.stringify([start, target, options]), name: $('name').value.trim() || 'Stack tự nhập',
      startCards: displayCards(start), targetCards: partial ? null : displayCards(target),
      targetPositions: partial ? target.map(([slot, card]) => [slot, displayCards(card)[0]]) : null,
      options, steps: null, optimal: false, provedThrough: 0, elapsed: 0 };
    currentStep = 0;
    currentRoute = 0;
    renderSolution();
    $('status').textContent = 'Đang tìm';
    $('progress-message').textContent = 'Đang tìm chuỗi và kiểm tra các đường đi ngắn.';
    $('progress-block').hidden = false;
    $('meter').max = seconds;
    $('meter').value = 0;
    $('elapsed').textContent = '0:00';
    $('proof').textContent = 'Chưa loại trừ lời giải ngắn hơn';
    worker = new Worker(new URL('./worker.mjs', import.meta.url), { type: 'module' });
    setLocked(true);
    if (matchMedia('(max-width: 814px)').matches) $('work').scrollIntoView({ block: 'start', behavior: 'smooth' });
    worker.onmessage = ({ data }) => {
      if (data.type === 'candidate') {
        receiveRoutes(data);
        $('progress-message').textContent = `Đã có ${session.routes.length} phương án. Chuỗi ít nước nhất hiện có ${session.shortestLength} nước.`;
        renderSolution();
        saveSolution();
      } else if (data.type === 'progress') {
        setProgress(data);
        $('status').textContent = { structured: 'Dò các cụm 13 lá', practical: 'Tìm chuỗi ít cull', exact: 'Kiểm tra chuỗi ngắn', improve: 'Đang rút gọn' }[data.phase];
      } else if (data.type === 'done') {
        setProgress(data);
        receiveRoutes(data);
        session.optimal = data.optimal;
        renderSolution();
        finish();
      } else if (data.type === 'error') {
        finish(true);
        $('progress-message').textContent = data.message;
      }
    };
    worker.onerror = () => {
      finish(true);
      $('progress-message').textContent = 'Trình duyệt chưa khởi động được solver. Hãy mở trang qua HTTPS hoặc localhost.';
    };
    worker.postMessage({ start, target, options, limits });
  } catch (error) {
    showError(error.message);
  }
});

$('target').addEventListener('input', () => { $('target-preset').value = ''; updateCount(); showError(); });
$('target-mode').addEventListener('change', updateTargetMode);
$('target-positions').addEventListener('input', () => showError());
$('start').addEventListener('change', updateStart);
$('multi-cut').addEventListener('change', updateMultiCut);
$('target-preset').addEventListener('change', () => {
  const preset = getPreset($('target-preset').value);
  if (preset) loadCards(preset.cards, preset.label);
});
$('demo').addEventListener('click', () => {
  $('start').value = 'ndo';
  updateStart();
  loadCards(demoStack().split(' '), 'Stack mẫu');
});
$('random').addEventListener('click', () => {
  const cards = [...ndo];
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  loadCards(cards, 'Stack ngẫu nhiên');
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
    const lines = steps.map((step, index) => [
      `${index + 1}. ${moveName(step, steps[index - 1]?.deck ?? session.startCards)}`,
      ...cullDescriptions(step, steps[index - 1]?.deck ?? session.startCards),
    ].join('\n'));
    await navigator.clipboard.writeText(lines.join('\n'));
    $('copy').textContent = 'Đã chép';
    setTimeout(() => { $('copy').textContent = 'Chép chuỗi'; }, 1300);
  } catch { $('saved-note').textContent = 'Trình duyệt chưa cho chép. Bạn vẫn có thể mở từng nước trong danh sách.'; }
});
$('history-button').addEventListener('click', () => { renderHistory(); $('history').showModal(); });
$('history-count').textContent = readHistory().length;
installPresetOptions();
updateStart();
updateTargetMode();
updateMultiCut();
updateCount();

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('./offline.js').catch(() => {});
}
