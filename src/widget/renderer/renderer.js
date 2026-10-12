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
    else if (key === 'key') node.dataset.key = value;
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

function setOpen(next, focusKey) {
  open = next;
  render();
  if (focusKey) content.querySelector(`[data-key="${focusKey}"]`)?.focus();
}

function showNotice(message) {
  notice.textContent = message ? `操作失败：${message}` : '';
  notice.hidden = !message;
}

async function act(method, payload) {
  const result = await api.call(method, payload);
  showNotice(result.ok ? '' : result.error);
  applyState(result.state);
  return result.ok;
}

function applyState(next) {
  if (dragging) {
    pendingState = next;
    return;
  }
  state = next;
  render();
}

// ---- text helpers ----

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
    el('input', { type: 'text', name: 'name', key: `${key}-name`, value: task?.name ?? '', placeholder: '任务名称', 'aria-label': '任务名称', required: true, maxlength: 200 }),
    el('input', { type: 'date', name: 'date', key: `${key}-date`, value: date, 'aria-label': '截止日期（可不填）' }),
    el('input', { type: 'time', name: 'time', key: `${key}-time`, value: time, 'aria-label': '截止时间（可不填）' }),
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
    step: 5,
    value: percent,
    key,
    'aria-label': label,
    'aria-valuetext': `${percent}%`,
    onpointerdown: () => { dragging = true; },
    oninput: (event) => { pct.textContent = `${event.target.value}%`; },
    onchange: (event) => {
      dragging = false;
      pendingState = null; // the result of this commit is newer
      onCommit(Number(event.target.value));
    },
  });
}

function confirmRow(question, onConfirm) {
  return el('div', { class: 'row' }, [
    el('span', { class: 'meta', text: question }),
    button('删除', 'small danger', onConfirm, 'confirm-yes'),
    button('取消', 'small', () => setOpen(null)),
  ]);
}

function stepItem(task, step) {
  const ids = { taskId: task.id, stepId: step.id };
  const base = `step-${task.id}-${step.id}`;
  const pct = el('span', { class: 'pct', text: `${step.percent}%` });
  const item = el('li', { class: 'step' });

  if (isOpen('rename-step', task.id, step.id)) {
    const form = el('form', {
      onsubmit: async (event) => {
        event.preventDefault();
        const name = form.elements.name.value.trim();
        if (name && await act('renameStep', { ...ids, name })) setOpen(null, `${base}-rename`);
      },
      onkeydown: (event) => { if (event.key === 'Escape') setOpen(null, `${base}-rename`); },
    }, [
      el('input', { type: 'text', name: 'name', key: `${base}-name`, value: step.name, 'aria-label': '步骤名称', required: true, maxlength: 200 }),
      el('button', { type: 'submit', class: 'btn small primary', text: '保存' }),
      button('取消', 'small', () => setOpen(null, `${base}-rename`)),
    ]);
    item.append(form);
    return item;
  }

  item.append(
    el('div', { class: 'step-top' }, [el('span', { class: 'name', text: step.name }), pct]),
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
      await act('removeStep', ids);
    }));
  } else {
    item.append(el('div', { class: 'row' }, [
      el('span', { class: 'meta', text: updatedText(step) }),
      step.percent < 100 && button('完成', 'small', () => act('setStepProgress', { ...ids, percent: 100 }), `${base}-done`),
      button('改名', 'small', () => setOpen({ kind: 'rename-step', ...ids }, `${base}-name`), `${base}-rename`),
      button('删除', 'small', () => setOpen({ kind: 'confirm-step', ...ids }, 'confirm-yes'), `${base}-rm`),
    ]));
  }
  return item;
}

function taskBody(task) {
  const base = `task-${task.id}`;
  const body = el('div', { class: 'task-body' });

  if (task.steps.length > 0) {
    body.append(el('ul', { class: 'steps' }, task.steps.map((step) => stepItem(task, step))));
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
      content.querySelector(`[data-key="${base}-newstep"]`)?.focus();
    },
  }, [
    el('input', { type: 'text', name: 'name', key: `${base}-newstep`, placeholder: '添加步骤…', 'aria-label': `为「${task.name}」添加步骤`, maxlength: 200 }),
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
      await act('removeTask', { taskId: task.id });
    }));
  } else {
    body.append(el('div', { class: 'row task-actions' }, [
      button('编辑', 'small', () => setOpen({ kind: 'edit-task', taskId: task.id }, `${base}-edit-name`), `${base}-editbtn`),
      button('删除任务', 'small', () => setOpen({ kind: 'confirm-task', taskId: task.id }, 'confirm-yes'), `${base}-rm`),
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
      if (isExpanded) expanded.delete(task.id);
      else expanded.add(task.id);
      render();
    },
  }, [
    el('span', { class: 'name', text: task.name }),
    el('span', { class: 'pct', text: `${task.progress}%` }),
    el('span', { class: 'meter', 'aria-hidden': 'true' }, [fill]),
    el('span', { class: 'due', text: dueText(task) }),
  ]);
  return el('section', { class: `task ${task.state}` }, [head, isExpanded && taskBody(task)]);
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
  }
  content.scrollTop = scrollTop;
  if (!focusKey) return;
  const target = content.querySelector(`[data-key="${focusKey}"]`);
  if (!target) return;
  target.focus();
  if (selection && target.type === 'text') target.setSelectionRange(...selection);
}

function render() {
  if (!state) return;
  const before = snapshot();
  const broken = state.status !== 'ok';
  document.getElementById('add-task').disabled = broken;

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
    if (state.tasks.length === 0 && !isOpen('add-task')) {
      nodes.push(el('div', { class: 'panel' }, [
        el('p', { text: '还没有任务。' }),
        button('添加第一个任务', 'primary', openAddForm, 'empty-add'),
      ]));
    }
    nodes.push(...state.tasks.map(taskCard));
  }
  content.replaceChildren(...nodes);
  restore(before);
}

// ---- wiring ----

document.getElementById('add-task').addEventListener('click', openAddForm);
document.getElementById('hide-window').addEventListener('click', () => api.hide());

// A drag can end outside the slider without a change event.
window.addEventListener('pointerup', () => {
  if (!dragging) return;
  dragging = false;
  // Wait a tick: if this drag committed a value, its change event clears pendingState first.
  setTimeout(() => {
    if (!pendingState) return;
    const next = pendingState;
    pendingState = null;
    applyState(next);
  }, 0);
});

api.onState(applyState);
api.read().then(applyState);
