// Widget page. Talks to the main process only through window.taskboard (see preload.cjs).
// All user text is set with textContent; nothing is ever parsed as HTML.

const api = window.taskboard;
const content = document.getElementById('content');
const notice = document.getElementById('notice');

let state = null;
let pendingState = null; // a refresh that arrived while a slider was being dragged
let dragging = false;
const expanded = new Set();
// Which inline form or confirmation is open: { kind, taskId?, stepId? } or null.
let open = null;

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'key') { if (value) node.dataset.key = value; }
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value !== false && value !== null && value !== undefined) node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children) if (child) node.append(child);
  return node;
}

const button = (text, cls, onclick, key) => el('button', { type: 'button', class: `btn ${cls}`, text, onclick, key });

function isOpen(kind, taskId, stepId) {
  return open !== null && open.kind === kind && open.taskId === taskId && open.stepId === stepId;
}

function focusKey(key) {
  content.querySelector(`[data-key="${key}"]`)?.focus();
}

function setOpen(next, key) {
  open = next;
  render();
  if (key) focusKey(key);
}

function showNotice(message) {
  notice.textContent = message ? `操作失败：${message}` : '';
  notice.hidden = !message;
}

// What the undo bar says after each action that can be reversed.
const UNDO_TEXT = {
  removeTask: '已删除任务',
  removeStep: '已删除步骤',
  dismissSuggestion: '已忽略建议',
  acceptSuggestion: '已采纳建议',
};
const UNDO_SECONDS = 8;
let undoTimer = null;

function showUndo(text) {
  const bar = document.getElementById('undo');
  clearTimeout(undoTimer);
  document.getElementById('undo-text').textContent = text ?? '';
  bar.hidden = !text;
  if (text) undoTimer = setTimeout(() => showUndo(null), UNDO_SECONDS * 1000);
}

// name: what was acted on, shown in the undo bar.
async function act(method, payload, name) {
  const result = await api.call(method, payload);
  showNotice(result.ok ? '' : result.error);
  // Any successful action replaces the previous chance to undo; an undo that failed has used it up.
  if (result.ok || method === 'undo') showUndo(result.undoable ? `${UNDO_TEXT[method]}「${name}」` : null);
  applyState(result.state);
  return result.ok;
}

// Tells screen readers when the background organize run starts and ends. The card itself is
// rebuilt on every refresh, so it cannot serve as the live region.
function announceOrganize(before, after) {
  if (!after || before?.phase === after.phase) return;
  const text = {
    running: '正在从最近的对话里整理任务。',
    done: `整理完成，更新了 ${(after.updated ?? []).length} 个已有任务，新增了 ${after.added} 条建议。`,
    failed: '整理没有完成。',
  }[after.phase];
  if (text) document.getElementById('status').textContent = text;
}

function applyState(next) {
  if (dragging) {
    pendingState = next;
    return;
  }
  announceOrganize(state?.organize, next.organize);
  state = next;
  render();
}

// ---- text helpers ----

// Just the urgency, without the date: for the collapsed strip.
function remainingText(task) {
  if (task.state === 'none') return '无截止日期';
  if (task.state === 'overdue') return task.days < 0 ? `已过期 ${-task.days} 天` : '已过期';
  if (task.days === 0) return '今天截止';
  if (task.days === 1) return '明天截止';
  return `还剩 ${task.days} 天`;
}

function dueText(task) {
  if (task.state === 'done') return '已完成';
  if (task.state === 'none') return '无截止日期';
  let remaining;
  if (task.state === 'overdue') remaining = task.days < 0 ? `已过期 ${-task.days} 天` : '已过期';
  else if (task.days === 0) remaining = '今天截止';
  else if (task.days === 1) remaining = '明天截止';
  else remaining = `还剩 ${task.days} 天`;
  return `${task.due} · ${remaining}`;
}

function updatedText(item) {
  if (!item.updatedBy) return '尚未更新';
  const d = new Date(item.updatedAt);
  const pad = (n) => String(n).padStart(2, '0');
  return `${item.updatedBy} · ${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function dueFromForm(form) {
  const date = form.elements.date.value;
  const time = form.elements.time.value;
  if (!date) return null;
  return time ? `${date} ${time}` : date;
}

// ---- pieces ----

function taskForm({ key, task, submitLabel, onSubmit, onCancel }) {
  const [date = '', time = ''] = (task?.due ?? '').split(' ');
  const form = el('form', {
    class: 'card-form',
    onsubmit: (event) => {
      event.preventDefault();
      const name = form.elements.name.value.trim();
      if (name) onSubmit({ name, due: dueFromForm(form) });
    },
    onkeydown: (event) => { if (event.key === 'Escape') onCancel(); },
  }, [
    el('input', { type: 'text', name: 'name', key: `${key}-name`, value: task?.name ?? '', placeholder: '任务名称', 'aria-label': '任务名称', required: true, pattern: '.*[^ 　].*', title: '名称不能只有空格', maxlength: 200 }),
    el('input', {
      type: 'date',
      name: 'date',
      key: `${key}-date`,
      value: date,
      'aria-label': '截止日期（可不填）',
      oninput: () => { form.elements.time.disabled = !form.elements.date.value; },
    }),
    el('input', { type: 'time', name: 'time', key: `${key}-time`, value: time, disabled: !date, 'aria-label': '截止时间（可不填，需先选日期）' }),
    el('button', { type: 'submit', class: 'btn primary', text: submitLabel }),
    button('取消', '', onCancel),
  ]);
  return form;
}

function slider({ key, label, percent, onCommit, pct }) {
  return el('input', {
    type: 'range',
    min: 0,
    max: 100,
    step: 1,
    value: percent,
    key,
    'aria-label': label,
    'aria-valuetext': `${percent}%`,
    onpointerdown: () => { dragging = true; },
    oninput: (event) => {
      pct.textContent = `${event.target.value}%`;
      event.target.setAttribute('aria-valuetext', `${event.target.value}%`);
    },
    onchange: (event) => {
      dragging = false;
      pendingState = null; // the result of this commit is newer
      onCommit(Number(event.target.value));
    },
  });
}

function confirmRow(question, onConfirm, onCancel) {
  return el('div', { class: 'row' }, [
    el('span', { class: 'meta', text: question }),
    button('删除', 'small danger', onConfirm),
    button('取消', 'small', onCancel, 'confirm-no'),
  ]);
}

function stepItem(task, step) {
  const ids = { taskId: task.id, stepId: step.id };
  const base = `step-${task.id}-${step.id}`;
  const pct = el('span', { class: 'pct', text: `${step.percent}%` });
  const item = el('li', { class: `step${step.percent === 100 ? ' finished' : ''}` });

  if (isOpen('rename-step', task.id, step.id)) {
    const form = el('form', {
      onsubmit: async (event) => {
        event.preventDefault();
        const name = form.elements.name.value.trim();
        if (name && await act('renameStep', { ...ids, name })) setOpen(null, `${base}-rename`);
      },
      onkeydown: (event) => { if (event.key === 'Escape') setOpen(null, `${base}-rename`); },
    }, [
      el('input', { type: 'text', name: 'name', key: `${base}-name`, value: step.name, 'aria-label': '步骤名称', required: true, pattern: '.*[^ 　].*', title: '名称不能只有空格', maxlength: 200 }),
      el('button', { type: 'submit', class: 'btn small primary', text: '保存' }),
      button('取消', 'small', () => setOpen(null, `${base}-rename`)),
    ]);
    item.append(form);
    return item;
  }

  item.append(
    el('div', { class: 'step-top' }, [
      el('span', { class: 'step-number', title: `步骤编号 ${step.id}`, text: String(step.id) }),
      el('span', { class: 'name', text: step.name }),
      pct,
    ]),
    slider({
      key: `${base}-range`,
      label: `「${step.name}」的进度`,
      percent: step.percent,
      pct,
      onCommit: (percent) => act('setStepProgress', { ...ids, percent }),
    }),
  );

  if (isOpen('confirm-step', task.id, step.id)) {
    item.append(confirmRow(`删除步骤「${step.name}」？`, async () => {
      open = null;
      await act('removeStep', ids, step.name);
      focusKey(`task-${task.id}-head`);
    }, () => setOpen(null, `${base}-rm`)));
  } else {
    item.append(el('div', { class: 'row' }, [
      el('span', { class: 'meta', text: updatedText(step) }),
      step.percent < 100 && button('完成', 'small', () => act('setStepProgress', { ...ids, percent: 100 }), `${base}-done`),
      button('改名', 'small', () => setOpen({ kind: 'rename-step', ...ids }, `${base}-name`), `${base}-rename`),
      button('删除', 'small', () => setOpen({ kind: 'confirm-step', ...ids }, 'confirm-no'), `${base}-rm`),
    ]));
  }
  return item;
}

function taskBody(task) {
  const base = `task-${task.id}`;
  const body = el('div', { class: 'task-body' });

  if (task.steps.length > 0) {
    const finished = task.steps.filter((step) => step.percent === 100).length;
    body.append(
      el('div', { class: 'steps-label', text: `步骤 · 已完成 ${finished} / ${task.steps.length}` }),
      el('ul', { class: 'steps' }, task.steps.map((step) => stepItem(task, step))),
    );
  } else {
    const pct = el('span', { class: 'pct', text: `${task.progress}%` });
    body.append(
      el('div', { class: 'step-top' }, [el('span', { class: 'hint', text: '没有步骤，可直接设置任务进度' }), pct]),
      slider({
        key: `${base}-range`,
        label: `「${task.name}」的进度`,
        percent: task.progress,
        pct,
        onCommit: (percent) => act('setTaskProgress', { taskId: task.id, percent }),
      }),
      el('div', { class: 'row' }, [el('span', { class: 'meta', text: updatedText(task) })]),
    );
  }

  const stepForm = el('form', {
    onsubmit: async (event) => {
      event.preventDefault();
      const input = stepForm.elements.name;
      const name = input.value.trim();
      if (!name) return;
      input.value = '';
      await act('addStep', { taskId: task.id, name });
      focusKey(`${base}-newstep`);
    },
  }, [
    el('input', { type: 'text', name: 'name', key: `${base}-newstep`, placeholder: '添加步骤…', 'aria-label': `为「${task.name}」添加步骤`, pattern: '.*[^ 　].*', title: '名称不能只有空格', maxlength: 200 }),
    el('button', { type: 'submit', class: 'btn', text: '添加' }),
  ]);
  body.append(stepForm);

  if (isOpen('edit-task', task.id)) {
    body.append(taskForm({
      key: `${base}-edit`,
      task,
      submitLabel: '保存',
      onSubmit: async (changes) => {
        if (await act('editTask', { taskId: task.id, ...changes })) setOpen(null, `${base}-editbtn`);
      },
      onCancel: () => setOpen(null, `${base}-editbtn`),
    }));
  } else if (isOpen('confirm-task', task.id)) {
    body.append(confirmRow(`删除任务「${task.name}」及其全部步骤？`, async () => {
      open = null;
      expanded.delete(task.id);
      await act('removeTask', { taskId: task.id }, task.name);
      document.getElementById('add-task').focus();
    }, () => setOpen(null, `${base}-rm`)));
  } else {
    body.append(el('div', { class: 'row task-actions' }, [
      button('编辑', 'small', () => setOpen({ kind: 'edit-task', taskId: task.id }, `${base}-edit-name`), `${base}-editbtn`),
      button('删除任务', 'small', () => setOpen({ kind: 'confirm-task', taskId: task.id }, 'confirm-no'), `${base}-rm`),
    ]));
  }
  return body;
}

function taskCard(task) {
  const isExpanded = expanded.has(task.id);
  const fill = el('span');
  fill.style.width = `${task.progress}%`;
  const head = el('button', {
    type: 'button',
    class: 'task-head',
    key: `task-${task.id}-head`,
    'aria-expanded': String(isExpanded),
    onclick: () => {
      // Only one task is open at a time, so the list stays short.
      expanded.clear();
      if (!isExpanded) expanded.add(task.id);
      open = null; // an inline form in the task that just closed goes with it
      render();
      // Closing a task above this one moves it; keep it in view.
      content.querySelector(`[data-key="task-${task.id}-head"]`)?.scrollIntoView({ block: 'nearest' });
    },
  }, [
    el('span', { class: 'name' }, [
      el('span', { class: 'task-id', title: `任务编号 ${task.id}`, text: `#${task.id}` }),
      document.createTextNode(task.name),
    ]),
    el('span', { class: 'pct', text: `${task.progress}%` }),
    el('span', { class: 'meter', 'aria-hidden': 'true' }, [fill]),
    el('span', { class: 'due', text: dueText(task) }),
  ]);
  return el('section', { class: `task ${task.state}${isExpanded ? ' open' : ''}` }, [head, isExpanded && taskBody(task)]);
}

// ---- suggestions and the one-time organize card ----

const settling = new Set();

function suggestionItem(suggestion, index) {
  const base = `sug-${suggestion.id}`;
  // After this suggestion is gone, focus moves to the next one, or to "add task".
  const next = state.suggestions[index + 1] ?? state.suggestions[index - 1];
  const settle = async (method) => {
    if (settling.has(suggestion.id)) return; // a second click while the first is being saved
    settling.add(suggestion.id);
    await act(method, { suggestionId: suggestion.id }, suggestion.name);
    settling.delete(suggestion.id);
    if (next) focusKey(`sug-${next.id}-accept`);
    else document.getElementById('add-task').focus();
  };
  const doneCount = suggestion.steps.filter((step) => step.done).length;
  const facts = [
    suggestion.due && `截止 ${suggestion.due}`,
    suggestion.steps.length > 0 && (doneCount > 0
      ? `${suggestion.steps.length} 个步骤，已完成 ${doneCount} 个`
      : `${suggestion.steps.length} 个步骤`),
  ].filter(Boolean).join(' · ');
  return el('li', { class: 'suggestion' }, [
    el('div', { class: 'name', text: suggestion.name }),
    facts && el('div', { class: 'hint', text: facts }),
    suggestion.steps.length > 0 && el('ul', { class: 'suggested-steps' }, suggestion.steps.map((step) => el('li', {
      class: step.done ? 'done' : '',
      text: `${step.done ? '✓' : '○'} ${step.name}${step.done ? '（已完成）' : ''}`,
    }))),
    el('div', { class: 'hint', text: suggestion.source ? `${suggestion.by} · ${suggestion.source}` : `由 ${suggestion.by} 提出` }),
    el('div', { class: 'row' }, [
      button('采纳', 'small primary', () => settle('acceptSuggestion'), `${base}-accept`),
      button('忽略', 'small', () => settle('dismissSuggestion'), `${base}-dismiss`),
    ]),
  ]);
}

function suggestionsSection() {
  if (state.suggestions.length === 0) return null;
  return el('section', { class: 'suggestions', 'aria-label': '任务建议' }, [
    el('h2', { text: `建议（${state.suggestions.length}）` }),
    el('p', { class: 'hint', text: '采纳后成为正式任务；忽略后不会再次提出。' }),
    el('ul', { class: 'steps' }, state.suggestions.map(suggestionItem)),
  ]);
}

function organizeCard() {
  const { organize } = state;
  if (!organize) return null;
  const card = (children) => el('section', { class: 'card-form organize' }, children);
  const dismiss = (action, key) => el('div', { class: 'row' }, [button('知道了', 'small', () => api.organize(action), key)]);

  if (organize.phase === 'running') {
    return card([
      el('p', {}, [el('strong', { text: '正在从最近的对话里整理任务…' })]),
      el('p', { class: 'hint', text: '可能需要一两分钟，窗口可以照常使用。' }),
    ]);
  }
  if (organize.phase === 'done') {
    const updated = organize.updated ?? [];
    const parts = [];
    if (updated.length > 0) {
      parts.push(
        el('p', {}, [el('strong', { text: `更新了 ${updated.length} 个已有任务` })]),
        el('ul', { class: 'suggested-steps' }, updated.map((task) => el('li', {
          text: `${task.name}：${[
            task.advancedSteps > 0 && `${task.advancedSteps} 个步骤有进展`,
            task.addedSteps > 0 && `新增 ${task.addedSteps} 个步骤`,
          ].filter(Boolean).join('，')}`,
        }))),
      );
    }
    if (organize.added > 0) parts.push(el('p', { text: `新增了 ${organize.added} 条建议，请在下方逐条采纳或忽略。` }));
    if (parts.length === 0) parts.push(el('p', { text: '最近的对话里没有需要更新或新增的内容。' }));
    return card([...parts, dismiss('close', 'organize-close')]);
  }
  if (organize.phase === 'failed') {
    return card([
      el('p', {}, [el('strong', { text: '整理没有完成。' })]),
      el('p', { class: 'hint', text: organize.reason ?? '' }),
      el('p', { class: 'hint', text: '任务和建议没有受影响。你也可以在自己的 Agent 里说“整理一下任务”。' }),
      dismiss('close', 'organize-close'),
    ]);
  }
  if (!organize.offer) return null;
  if (!organize.available) {
    return card([
      el('p', {}, [el('strong', { text: '从最近的对话里整理任务' })]),
      el('p', { class: 'hint', text: '没有找到 Claude Code，无法在后台整理。你可以在自己的 Agent 里说“整理一下任务”，它会读取最近的对话并把建议列在这里。' }),
      dismiss('later', 'organize-later'),
    ]);
  }
  return card([
    el('p', {}, [el('strong', { text: '从最近的对话里整理任务' })]),
    el('p', { class: 'hint', text: '让 Claude Code 读一遍你最近 7 天对 Claude Code 和 DeepSeek Harness 说过的话。列表里已有的任务会直接更新步骤和进度；新的项目列成建议，由你决定是否采纳。' }),
    el('p', { class: 'hint', text: '这些话的摘要会发送给 Claude 的模型，每次整理都会消耗你的额度。' }),
    el('div', { class: 'row' }, [
      button('开始整理', 'primary', () => api.organize('start'), 'organize-start'),
      button(organize.firstTime ? '以后再说' : '取消', '', () => api.organize('later'), 'organize-later'),
    ]),
  ]);
}

function openAddForm() {
  setOpen({ kind: 'add-task' }, 'add-name');
}

function errorPanel() {
  return el('div', { class: 'panel error' }, [
    el('p', {}, [el('strong', { text: '无法读取任务数据，已停用所有修改。' })]),
    el('p', { class: 'path', text: state.file }),
    el('p', { text: state.message }),
    el('p', { text: '修复或移走该文件后点击重试。' }),
    button('重试', 'primary', async () => applyState(await api.read()), 'retry'),
  ]);
}

// ---- render ----

// Remembers focus and half-typed input so a refresh from disk does not interrupt the user.
function snapshot() {
  const values = new Map();
  for (const input of content.querySelectorAll('input[data-key]:not([type="range"])')) {
    values.set(input.dataset.key, input.value);
  }
  const active = document.activeElement;
  return {
    values,
    focusKey: content.contains(active) ? active.dataset.key : null,
    selection: active?.type === 'text' ? [active.selectionStart, active.selectionEnd] : null,
    scrollTop: content.scrollTop,
  };
}

function restore({ values, focusKey, selection, scrollTop }) {
  for (const input of content.querySelectorAll('input[data-key]:not([type="range"])')) {
    if (values.has(input.dataset.key)) input.value = values.get(input.dataset.key);
    if (input.type === 'time') input.disabled = !input.form.elements.date.value;
  }
  content.scrollTop = scrollTop;
  if (!focusKey) return;
  const target = content.querySelector(`[data-key="${focusKey}"]`);
  if (!target) return;
  target.focus();
  if (selection && target.type === 'text') target.setSelectionRange(...selection);
}

// The collapsed window: one line about the next task that is not finished.
function renderStrip(broken) {
  const strip = document.getElementById('strip');
  const fill = document.getElementById('strip-fill');
  const parts = [];
  let percent = 0;
  if (broken) {
    parts.push(el('span', { class: 'strip-name', text: '无法读取任务数据' }));
  } else {
    const next = state.tasks.find((task) => task.state !== 'done');
    if (next) {
      percent = next.progress;
      parts.push(
        el('span', { class: 'strip-name', text: `#${next.id} ${next.name}` }),
        el('span', { class: 'strip-pct', text: `${next.progress}%` }),
        el('span', { class: `strip-due ${next.state}`, text: remainingText(next) }),
      );
    } else {
      parts.push(el('span', { class: 'strip-name', text: '没有待办任务' }));
    }
    if (state.suggestions.length > 0) {
      parts.push(el('span', { class: 'strip-due', text: `建议 ${state.suggestions.length}` }));
    }
  }
  strip.replaceChildren(...parts);
  fill.style.width = `${percent}%`;
}

function renderChrome(broken) {
  const compact = state.compact === true;
  document.body.classList.toggle('compact', compact);
  document.querySelector('.bar h1').hidden = compact;
  document.getElementById('strip').hidden = !compact;
  document.getElementById('organize').hidden = compact;
  document.getElementById('add-task').hidden = compact;
  const toggle = document.getElementById('toggle-compact');
  const label = compact ? '展开窗口' : '收起为窄栏';
  toggle.classList.toggle('flipped', compact);
  toggle.title = label;
  toggle.setAttribute('aria-label', label);
  if (compact) renderStrip(broken);
}

function render() {
  if (!state) return;
  const before = snapshot();
  const broken = state.status !== 'ok';
  renderChrome(broken);
  document.getElementById('add-task').disabled = broken;
  document.getElementById('organize').disabled = broken || state.organize?.phase === 'running';

  const nodes = [];
  if (broken) {
    nodes.push(errorPanel());
  } else {
    if (isOpen('add-task')) {
      nodes.push(taskForm({
        key: 'add',
        submitLabel: '添加',
        onSubmit: async (task) => {
          if (await act('addTask', task)) {
            setOpen(null);
            document.getElementById('add-task').focus();
          }
        },
        onCancel: () => {
          setOpen(null);
          document.getElementById('add-task').focus();
        },
      }));
    }
    const card = organizeCard();
    const suggestions = suggestionsSection();
    nodes.unshift(card);
    nodes.push(suggestions);
    if (state.tasks.length === 0 && !card && !suggestions && !isOpen('add-task')) {
      nodes.push(el('div', { class: 'panel' }, [
        el('p', { text: '还没有任务。' }),
        button('添加第一个任务', 'primary', openAddForm, 'empty-add'),
      ]));
    }
    nodes.push(...state.tasks.map(taskCard));
  }
  content.replaceChildren(...nodes.filter(Boolean));
  restore(before);
  followOpenTask();
}

// Finishing a task moves it to the end of the list; without this it would vanish
// from under the user while still open.
// Only when the open task itself changed state: other tasks coming and going above it
// must not move the view.
let lastOpen = { id: null, done: false };

function followOpenTask() {
  const [id] = expanded;
  const task = state.status === 'ok' ? state.tasks.find((candidate) => candidate.id === id) : undefined;
  const done = task?.state === 'done';
  if (task && id === lastOpen.id && done !== lastOpen.done) {
    content.querySelector(`[data-key="task-${id}-head"]`)?.scrollIntoView({ block: 'start' });
  }
  lastOpen = { id: id ?? null, done };
}

// ---- wiring ----

document.getElementById('add-task').addEventListener('click', openAddForm);
document.getElementById('hide-window').addEventListener('click', () => api.hide());
document.getElementById('toggle-compact').addEventListener('click', () => api.setCompact(!state?.compact));
document.getElementById('undo-button').addEventListener('click', () => act('undo'));
// Shows the organize card; nothing runs until the user confirms there.
document.getElementById('organize').addEventListener('click', () => {
  api.organize('open');
  content.scrollTop = 0;
});

// A drag can end outside the slider without a change event.
function endDrag() {
  if (!dragging) return;
  dragging = false;
  // Wait a tick: if this drag committed a value, its change event clears pendingState first.
  setTimeout(() => {
    if (!pendingState) return;
    const next = pendingState;
    pendingState = null;
    applyState(next);
  }, 0);
}
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);
window.addEventListener('blur', endDrag);

api.onState(applyState);
api.read().then(applyState);
