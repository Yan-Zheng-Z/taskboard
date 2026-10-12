// Widget page. Talks to the main process only through window.taskboard (see preload.cjs).
// All user text is set with textContent; nothing is ever parsed as HTML.

const api = window.taskboard;
const content = document.getElementById('content');
const notice = document.getElementById('notice');

let state = null;
// Which page is showing: 'tasks' (the open ones), 'archive' (recently finished) or 'settings'.
let page = 'tasks';
const expanded = new Set();
// Which inline form or confirmation is open: { kind, taskId?, stepId? } or null.
let open = null;
// What the settings page says after instructions were copied for another agent.
let copyNote = '';

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

// A name must contain something other than spaces (ordinary or full-width).
const nameRule = { pattern: '.*[^ 　].*', title: '名称不能只有空格', maxlength: 200 };

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
  setStepDone: '已完成并归档',
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
  announceOrganize(state?.organize, next.organize);
  state = next;
  render();
}

// ---- text helpers ----

const pad = (n) => String(n).padStart(2, '0');
const monthDay = (iso) => {
  const d = new Date(iso);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// Just the urgency, without the date: for the collapsed strip.
function remainingText(task) {
  if (task.state === 'none') return '无截止日期';
  if (task.state === 'overdue') return task.days < 0 ? `已过期 ${-task.days} 天` : '已过期';
  if (task.days === 0) return '今天截止';
  if (task.days === 1) return '明天截止';
  return `还剩 ${task.days} 天`;
}

function dueText(task) {
  if (task.state === 'done') return `${monthDay(task.completedAt)} 完成`;
  if (task.state === 'none') return '无截止日期';
  return `${task.due} · ${remainingText(task)}`;
}

function updatedText(step) {
  if (!step.updatedBy) return step.done ? '已完成' : '未开始';
  const d = new Date(step.updatedAt);
  return `${step.updatedBy} · ${monthDay(step.updatedAt)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function dueFromForm(form) {
  const date = form.elements.date.value;
  const time = form.elements.time.value;
  if (!date) return null;
  return time ? `${date} ${time}` : date;
}

// ---- pieces ----

// withFirstStep: a new task needs its first step; editing an existing task does not ask for one.
function taskForm({ key, task, submitLabel, withFirstStep, onSubmit, onCancel }) {
  const [date = '', time = ''] = (task?.due ?? '').split(' ');
  const form = el('form', {
    class: 'card-form',
    onsubmit: (event) => {
      event.preventDefault();
      const name = form.elements.name.value.trim();
      const firstStep = withFirstStep ? form.elements.step.value.trim() : null;
      if (!name || (withFirstStep && !firstStep)) return;
      onSubmit({ name, due: dueFromForm(form), ...(withFirstStep ? { steps: [firstStep] } : {}) });
    },
    onkeydown: (event) => { if (event.key === 'Escape') onCancel(); },
  }, [
    el('input', { type: 'text', name: 'name', key: `${key}-name`, value: task?.name ?? '', placeholder: '任务名称', 'aria-label': '任务名称', required: true, ...nameRule }),
    withFirstStep && el('input', { type: 'text', name: 'step', key: `${key}-step`, placeholder: '第一个步骤（之后可以再加）', 'aria-label': '第一个步骤', required: true, ...nameRule }),
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
  const item = el('li', { class: `step${step.done ? ' finished' : ''}` });

  if (isOpen('rename-step', task.id, step.id)) {
    const form = el('form', {
      onsubmit: async (event) => {
        event.preventDefault();
        const name = form.elements.name.value.trim();
        if (name && await act('renameStep', { ...ids, name })) setOpen(null, `${base}-rename`);
      },
      onkeydown: (event) => { if (event.key === 'Escape') setOpen(null, `${base}-rename`); },
    }, [
      el('input', { type: 'text', name: 'name', key: `${base}-name`, value: step.name, 'aria-label': '步骤名称', required: true, ...nameRule }),
      el('button', { type: 'submit', class: 'btn small primary', text: '保存' }),
      button('取消', 'small', () => setOpen(null, `${base}-rename`)),
    ]);
    item.append(form);
    return item;
  }

  // Ticking the last unfinished step finishes the task, which then moves to the archive.
  const check = el('input', {
    type: 'checkbox',
    class: 'step-check',
    key: `${base}-check`,
    checked: step.done,
    'aria-label': `步骤 ${step.id}「${step.name}」已完成`,
    onchange: (event) => act('setStepDone', { ...ids, done: event.target.checked }, task.name),
  });
  item.append(el('label', { class: 'step-top' }, [
    check,
    el('span', { class: 'step-number', title: `步骤编号 ${step.id}`, text: String(step.id) }),
    el('span', { class: 'name', text: step.name }),
  ]));

  if (isOpen('confirm-step', task.id, step.id)) {
    item.append(confirmRow(`删除步骤「${step.name}」？`, async () => {
      open = null;
      await act('removeStep', ids, step.name);
      focusKey(`task-${task.id}-head`);
    }, () => setOpen(null, `${base}-rm`)));
  } else {
    item.append(el('div', { class: 'row step-meta' }, [
      el('span', { class: 'meta', text: updatedText(step) }),
      button('改名', 'small', () => setOpen({ kind: 'rename-step', ...ids }, `${base}-name`), `${base}-rename`),
      // A task keeps at least one step; to drop the task, delete the task.
      task.steps.length > 1 && button('删除', 'small', () => setOpen({ kind: 'confirm-step', ...ids }, 'confirm-no'), `${base}-rm`),
    ]));
  }
  return item;
}

function taskBody(task) {
  const base = `task-${task.id}`;
  const body = el('div', { class: 'task-body' });
  const finished = task.steps.filter((step) => step.done).length;
  body.append(
    el('div', { class: 'steps-label', text: `步骤 · 已完成 ${finished} / ${task.steps.length}` }),
    el('ul', { class: 'steps' }, task.steps.map((step) => stepItem(task, step))),
  );

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
    el('input', { type: 'text', name: 'name', key: `${base}-newstep`, placeholder: '添加步骤…', 'aria-label': `为「${task.name}」添加步骤`, ...nameRule }),
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

// ---- suggestions and the organize card ----

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
            task.advancedSteps > 0 && `完成了 ${task.advancedSteps} 个步骤`,
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
    el('p', { class: 'hint', text: '让 Claude Code 读一遍你最近 7 天对 Claude Code 和 DeepSeek Harness 说过的话。列表里已有的任务会直接勾掉做完的步骤、补上缺少的步骤；新的项目列成建议，由你决定是否采纳。' }),
    el('p', { class: 'hint', text: '这些话的摘要会发送给 Claude 的模型，每次整理都会消耗你的额度。' }),
    el('div', { class: 'row' }, [
      button('开始整理', 'primary', () => api.organize('start'), 'organize-start'),
      button(organize.firstTime ? '以后再说' : '取消', '', () => api.organize('later'), 'organize-later'),
    ]),
  ]);
}

function showPage(next) {
  page = next;
  copyNote = '';
  expanded.clear();
  open = null;
  content.scrollTop = 0;
  render();
}

function openAddForm() {
  page = 'tasks';
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

// The open tasks, with the organize card, the add form and pending suggestions above them.
function tasksPage() {
  const nodes = [organizeCard()];
  if (isOpen('add-task')) {
    nodes.push(taskForm({
      key: 'add',
      submitLabel: '添加',
      withFirstStep: true,
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
  nodes.push(suggestionsSection());
  if (state.tasks.length === 0 && nodes.every((node) => !node)) {
    nodes.push(el('div', { class: 'panel' }, [
      el('p', { text: state.archive.length > 0 ? '没有待办任务，都做完了。' : '还没有任务。' }),
      button(state.archive.length > 0 ? '添加任务' : '添加第一个任务', 'primary', openAddForm, 'empty-add'),
    ]));
  }
  nodes.push(...state.tasks.map(taskCard));
  return nodes;
}

// Tasks finished in the last week. Unticking a step, or adding one, sends a task back to the list.
function archivePage() {
  const days = state.archiveDays;
  const nodes = [el('h2', { class: 'page-title', text: `最近 ${days} 天完成的任务` })];
  if (state.archive.length === 0) {
    nodes.push(el('div', { class: 'panel' }, [el('p', { text: `最近 ${days} 天没有完成的任务。` })]));
  } else {
    nodes.push(...state.archive.map(taskCard));
  }
  nodes.push(el('p', { class: 'hint page-note', text: '任务的所有步骤完成后自动归档。更早完成的任务仍保存着，可用 task list --archived 查看；显示多少天可以在设置里改。' }));
  return nodes;
}

// ---- settings ----

// Sends one change and redraws; a refused change shows why and keeps the old value.
async function change(request) {
  const result = await request;
  showNotice(result.ok ? '' : result.error);
  applyState(result.state);
}

// A row of mutually exclusive choices, e.g. the theme.
function choices(label, key, options, current) {
  return el('div', { class: 'setting', role: 'group', 'aria-label': label }, [
    el('span', { class: 'setting-label', text: label }),
    el('span', { class: 'segmented' }, options.map(([value, text]) => el('button', {
      type: 'button',
      class: `btn small${value === current ? ' chosen' : ''}`,
      'aria-pressed': String(value === current),
      key: `set-${key}-${value}`,
      text,
      onclick: () => change(api.setSetting(key, value)),
    }))),
  ]);
}

function toggle(label, key, checked, onchange, { disabled = false, hint } = {}) {
  return el('label', { class: 'setting' }, [
    el('span', { class: 'setting-label' }, [
      document.createTextNode(label),
      hint && el('span', { class: 'hint setting-hint', text: hint }),
    ]),
    el('input', { type: 'checkbox', class: 'step-check', key: `set-${key}`, checked, disabled, onchange: (event) => onchange(event.target.checked) }),
  ]);
}

async function copySkillFor(input) {
  const name = input.value.trim();
  if (!name) {
    copyNote = '';
    showNotice('请先填写这个 Agent 的署名，例如 codex');
    render();
    focusKey('other-agent-name');
    return;
  }
  const result = await api.copySkill(name);
  showNotice(result.ok ? '' : result.error);
  copyNote = result.ok ? `已复制署名为 ${name} 的接入说明。把它粘贴到该 Agent 的指令文件里（多数是 AGENTS.md）。` : '';
  applyState(result.state);
}

// Any agent that can run shell commands can use taskboard; only these two have one-click install.
function otherAgentRow() {
  const input = el('input', { type: 'text', key: 'other-agent-name', placeholder: '署名，例如 codex', 'aria-label': '其他 Agent 的署名', maxlength: 50 });
  return el('div', { class: 'setting other-agent' }, [
    el('span', { class: 'setting-label' }, [
      document.createTextNode('其他 Agent'),
      el('span', { class: 'hint setting-hint', text: '能执行命令行的 Agent 都可以接入' }),
    ]),
    el('span', { class: 'other-agent-form' }, [
      input,
      button('复制接入说明', 'small', () => copySkillFor(input), 'other-agent-copy'),
    ]),
  ]);
}

const SKILL_TEXT = { missing: '接入说明未安装', current: '接入说明已安装', outdated: '接入说明需要更新' };

function agentRow(agent) {
  return el('div', { class: 'setting' }, [
    el('span', { class: 'setting-label' }, [
      document.createTextNode(agent.name),
      el('span', { class: 'hint setting-hint', text: `${agent.detected ? '已检测到' : '未检测到'} · ${SKILL_TEXT[agent.skill]}` }),
    ]),
    agent.skill === 'current'
      ? el('span', { class: 'hint', text: '已是最新' })
      : button(agent.skill === 'missing' ? '安装' : '更新', 'small primary', () => change(api.installSkill(agent.id)), `agent-${agent.id}-install`),
  ]);
}

function settingsPage() {
  const { values, autostart, agents, dataDir, version, repo } = state.settings;
  const section = (title, rows) => el('section', { class: 'settings-section' }, [
    el('h2', { class: 'page-title', text: title }),
    el('div', { class: 'card-form settings-card' }, rows),
  ]);
  // "Organize" must read at least one agent's conversations: the last one ticked cannot be unticked.
  const reads = (id) => values.digestAgents.includes(id);
  const setReads = (id, on) => change(api.setSetting(
    'digestAgents',
    on ? [...values.digestAgents, id] : values.digestAgents.filter((agent) => agent !== id),
  ));
  const onlyOne = values.digestAgents.length === 1;

  return [
    section('外观', [
      choices('主题', 'theme', [['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']], values.theme),
    ]),
    section('窗口', [
      toggle('始终置顶', 'alwaysOnTop', values.alwaysOnTop, (on) => change(api.setSetting('alwaysOnTop', on))),
      toggle('开机自动启动', 'autostart', autostart, (on) => change(api.setAutostart(on))),
      choices('归档显示', 'archiveDays', [[7, '7 天'], [14, '14 天'], [30, '30 天']], values.archiveDays),
    ]),
    section('Agent 接入', [
      ...agents.map(agentRow),
      otherAgentRow(),
      copyNote && el('p', { class: 'hint settings-note', role: 'status', text: copyNote }),
      el('p', { class: 'hint settings-note', text: '点“安装”会把 taskboard 的接入说明复制到该 Agent 自己的目录，它才知道怎么更新你的任务。不点就不会改动它的任何文件。' }),
    ]),
    section('整理', [
      toggle('读取 Claude Code 的对话', 'reads-claude', reads('claude'), (on) => setReads('claude', on), { disabled: onlyOne && reads('claude') }),
      toggle('读取 DeepSeek Harness 的对话', 'reads-deepseek', reads('deepseek'), (on) => setReads('deepseek', on), { disabled: onlyOne && reads('deepseek') }),
      choices('读取最近', 'digestDays', [[3, '3 天'], [7, '7 天'], [14, '14 天']], values.digestDays),
      el('p', { class: 'hint settings-note', text: '整理时，这些对话里你说过的话会发送给执行整理的 Agent 的模型服务商。窗口里的后台整理使用 Claude Code。' }),
    ]),
    section('数据', [
      el('div', { class: 'setting' }, [
        el('span', { class: 'setting-label' }, [
          document.createTextNode('数据位置'),
          el('span', { class: 'hint setting-hint path', text: dataDir }),
        ]),
        button('打开文件夹', 'small', () => api.openDataFolder(), 'open-data-folder'),
      ]),
    ]),
    section('关于', [
      el('div', { class: 'setting' }, [
        el('span', { class: 'setting-label' }, [
          document.createTextNode(`taskboard ${version}`),
          el('span', { class: 'hint setting-hint path', text: repo }),
        ]),
        button('项目主页', 'small', () => api.openRepo(), 'open-repo'),
      ]),
    ]),
  ];
}

// ---- render ----

// Remembers focus and half-typed input so a refresh from disk does not interrupt the user.
const TEXT_INPUTS = 'input[data-key]:not([type="checkbox"])';

function snapshot() {
  const values = new Map();
  for (const input of content.querySelectorAll(TEXT_INPUTS)) values.set(input.dataset.key, input.value);
  const active = document.activeElement;
  return {
    values,
    focusKey: content.contains(active) ? active.dataset.key : null,
    selection: active?.type === 'text' ? [active.selectionStart, active.selectionEnd] : null,
    scrollTop: content.scrollTop,
  };
}

function restore({ values, focusKey: key, selection, scrollTop }) {
  for (const input of content.querySelectorAll(TEXT_INPUTS)) {
    if (values.has(input.dataset.key)) input.value = values.get(input.dataset.key);
    if (input.type === 'time') input.disabled = !input.form.elements.date.value;
  }
  content.scrollTop = scrollTop;
  if (!key) return;
  const target = content.querySelector(`[data-key="${key}"]`);
  if (!target) return;
  target.focus();
  if (selection && target.type === 'text') target.setSelectionRange(...selection);
}

// The collapsed window: one line about the next task.
function renderStrip(broken) {
  const strip = document.getElementById('strip');
  const fill = document.getElementById('strip-fill');
  const parts = [];
  let percent = 0;
  if (broken) {
    parts.push(el('span', { class: 'strip-name', text: '无法读取任务数据' }));
  } else {
    const [next] = state.tasks;
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
  const archive = page === 'archive';
  const settings = page === 'settings';
  document.body.classList.toggle('compact', compact);
  document.querySelector('.bar h1').hidden = compact;
  document.querySelector('.bar h1').textContent = { tasks: '任务', archive: '归档', settings: '设置' }[page];
  document.getElementById('strip').hidden = !compact;
  for (const id of ['toggle-archive', 'organize', 'add-task', 'toggle-settings']) document.getElementById(id).hidden = compact;
  const settingsButton = document.getElementById('toggle-settings');
  settingsButton.setAttribute('aria-pressed', String(settings));
  settingsButton.title = settings ? '返回任务' : '设置';
  settingsButton.setAttribute('aria-label', settingsButton.title);
  document.getElementById('add-task').disabled = broken;
  document.getElementById('organize').disabled = broken || state.organize?.phase === 'running';
  const archiveButton = document.getElementById('toggle-archive');
  archiveButton.disabled = broken;
  archiveButton.textContent = archive ? '返回任务' : '归档';
  archiveButton.title = archive ? '返回未完成的任务' : '最近完成的任务';
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
  let nodes;
  if (broken) nodes = [errorPanel()];
  else nodes = { tasks: tasksPage, archive: archivePage, settings: settingsPage }[page]();
  content.replaceChildren(...nodes.filter(Boolean));
  restore(before);
}

// ---- wiring ----

document.getElementById('add-task').addEventListener('click', openAddForm);
document.getElementById('hide-window').addEventListener('click', () => api.hide());
document.getElementById('toggle-compact').addEventListener('click', () => api.setCompact(!state?.compact));
document.getElementById('toggle-archive').addEventListener('click', () => showPage(page === 'archive' ? 'tasks' : 'archive'));
document.getElementById('toggle-settings').addEventListener('click', () => showPage(page === 'settings' ? 'tasks' : 'settings'));
document.getElementById('undo-button').addEventListener('click', () => act('undo'));
// Shows the organize card; nothing runs until the user confirms there.
document.getElementById('organize').addEventListener('click', () => {
  if (page !== 'tasks') showPage('tasks');
  api.organize('open');
  content.scrollTop = 0;
});

api.onState(applyState);
api.read().then(applyState);
