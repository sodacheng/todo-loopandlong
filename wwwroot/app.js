/* =========================================================
   TODO · DAILY LOOP — 渲染层逻辑（原生 JS，无框架）
   ========================================================= */
'use strict';

/* ---------- WebView2 消息桥（浏览器调试时降级为 localStorage） ---------- */
const bridge = (() => {
  const wv = window.chrome && window.chrome.webview;
  return {
    isShell: !!wv,
    send(msg) { if (wv) wv.postMessage(msg); },
    onMessage(fn) {
      if (wv) wv.addEventListener('message', e => fn(e.data));
      else { // 浏览器降级：直接从 localStorage 读
        const raw = localStorage.getItem('todo-data');
        setTimeout(() => fn({ type: 'init', data: raw ? JSON.parse(raw) : null,
          settings: { topmost: false, clickThrough: false, autostart: false, wideMode: false } }), 0);
      }
    },
    save(state) {
      if (wv) this.send({ type: 'save', data: state });
      else { localStorage.setItem('todo-data', JSON.stringify(state));
        setTimeout(() => this._fakeSaved && this._fakeSaved(), 0); }
    }
  };
})();

/* ---------- 日期工具 ---------- */
const DAY = 86400000;
const pad2 = n => String(n).padStart(2, '0');
const dateKey = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const todayKey = () => dateKey(new Date());
function parseKey(key) { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];

/* ---------- 状态 ---------- */
let state = { tasks: [], lastCelebrated: null };
let settings = { topmost: false, clickThrough: false, autostart: false, wideMode: false };
// 三态视图：today（今日待办）/ manage（任务管理）/ mini（迷你列表）
// 切换入口：btnMode 仅 today 显示、直达 mini；标题区点击 today ⇄ manage；mini 热区按钮回 today
let mode = 'today';

function persist() { bridge.save(state); }

/* ---------- 循环任务调度 ---------- */
// 月末兜底：选了 31 号但当月只有 30 天，则最后一天触发
function isScheduledOn(task, date) {
  if (task.type !== 'recurring' || !task.recur) return false;
  const r = task.recur;
  switch (r.kind) {
    case 'daily': return true;
    case 'workdays': { const w = date.getDay(); return w >= 1 && w <= 5; }
    case 'weekly': return Array.isArray(r.weekdays) && r.weekdays.includes(date.getDay());
    case 'monthly': {
      if (!Array.isArray(r.monthdays) || !r.monthdays.length) return false;
      const last = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
      return r.monthdays.includes(date.getDate()) ||
        (date.getDate() === last && r.monthdays.some(md => md > last));
    }
  }
  return false;
}

// 任务在创建日之后才开始参与调度
function createdDate(task) { return parseKey(dateKey(new Date(task.createdAt))); }

function isTodayTask(task) {
  if (task.type === 'longterm') return !task.done;
  return isScheduledOn(task, new Date()) && createdDate(task) <= new Date();
}

function isDoneToday(task) {
  if (task.type === 'longterm') return !!task.done;
  return !!task.completions[todayKey()];
}

// 漏做检测：只检查创建日期之后的周期，找最近一次应做未做的日期
function findMissedDate(task) {
  if (task.type !== 'recurring') return null;
  let d = addDays(new Date(), -1); // 从昨天往前找
  const created = createdDate(task);
  for (let i = 0; i < 370 && d >= created; i++, d = addDays(d, -1)) {
    if (isScheduledOn(task, d) && !task.completions[dateKey(d)]) return d;
  }
  return null;
}

function recurTag(task) {
  const r = task.recur;
  if (!r) return '';
  if (r.kind === 'daily') return '每日';
  if (r.kind === 'workdays') return '工作日';
  if (r.kind === 'weekly')
    return (r.weekdays || []).slice().sort().map(w => '周' + WEEK_CN[w]).join('/');
  if (r.kind === 'monthly')
    return (r.monthdays || []).slice().sort((a, b) => a - b).map(d => d + '号').join('/');
  return '';
}

// D-DAY 徽章信息
function ddayInfo(task) {
  if (task.type !== 'longterm' || !task.due) return null;
  const days = Math.round((parseKey(task.due) - parseKey(todayKey())) / DAY);
  if (days < 0) return { text: `逾期${-days}D`, cls: 'overdue' };
  if (days === 0) return { text: 'D-DAY', cls: 'soon' };
  if (days <= 2) return { text: `${days}D`, cls: 'soon' };
  return { text: `${days}D`, cls: '' };
}

/* ---------- DOM ---------- */
const $ = id => document.getElementById(id);
const els = {
  app: $('app'), hero: $('hero'), heroTitle: $('heroTitle'), dateLabel: $('dateLabel'),
  todayView: $('todayView'), manageView: $('manageView'),
  pixelProgress: $('pixelProgress'), progNum: $('progNum'),
  missedBar: $('missedBar'), missedText: $('missedText'), missedGo: $('missedGo'),
  taskList: $('taskList'), emptyState: $('emptyState'),
  pendingList: $('pendingList'), doneList: $('doneList'),
  pendingCount: $('pendingCount'), doneCount: $('doneCount'), clearArchived: $('clearArchived'),
  saveState: $('saveState'),
  sheetOverlay: $('sheetOverlay'), sheetTitle: $('sheetTitle'), fTitle: $('fTitle'), fNote: $('fNote'),
  segType: $('segType'), recurFields: $('recurFields'), dueFields: $('dueFields'),
  fRecurKind: $('fRecurKind'), weekdayChips: $('weekdayChips'), monthdayChips: $('monthdayChips'),
  fDue: $('fDue'), btnCreate: $('btnCreate'), btnCancel: $('btnCancel'),
  toast: $('toast'), confetti: $('confetti'), burstFx: $('burstFx'),
  btnMode: $('btnMode'), btnMiniMode: $('btnMiniMode'), miniHotzone: $('miniHotzone'),
};

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- 渲染：小窗（今日待办） ---------- */
function renderToday() {
  const tasks = state.tasks.filter(isTodayTask);
  const done = tasks.filter(isDoneToday).length;

  // 日期标签
  const now = new Date();
  els.dateLabel.textContent = `${dateKey(now)} · 周${WEEK_CN[now.getDay()]}`;

  // 像素格进度条：22 格
  const total = tasks.length;
  const filled = total === 0 ? 0 : Math.round((done / total) * 22);
  if (els.pixelProgress.childElementCount !== 22) {
    els.pixelProgress.innerHTML = '';
    for (let i = 0; i < 22; i++) {
      const px = document.createElement('span');
      px.className = 'px';
      els.pixelProgress.appendChild(px);
    }
  }
  const prevFilled = +els.pixelProgress.dataset.filled || 0;
  [...els.pixelProgress.children].forEach((px, i) => {
    const on = i < filled;
    if (on && i >= prevFilled && i === filled - 1 && filled > prevFilled) {
      px.classList.remove('pop'); void px.offsetWidth; // 重新触发动画
      px.classList.add('pop');
    }
    px.classList.toggle('on', on);
  });
  els.pixelProgress.dataset.filled = filled;
  els.progNum.textContent = `${done}/${total}`;

  // 漏做提醒条
  const missed = state.tasks
    .map(t => ({ t, d: findMissedDate(t) }))
    .filter(x => x.d);
  if (missed.length) {
    const latest = missed.reduce((a, b) => (a.d > b.d ? a : b)).d;
    els.missedText.textContent =
      `${missed.length} 个循环任务上个周期（${latest.getMonth() + 1}月${latest.getDate()}日）未完成`;
    els.missedBar.classList.remove('hidden');
  } else {
    els.missedBar.classList.add('hidden');
  }

  // 任务行：循环任务在上、长期任务在下，两组都非空时用虚线标签分隔
  els.taskList.innerHTML = '';
  const visible = tasks.filter(t => !isDoneToday(t) || t.type === 'longterm');
  els.emptyState.classList.toggle('hidden', visible.length > 0);
  const loops = visible.filter(t => t.type === 'recurring');
  const longs = visible.filter(t => t.type === 'longterm');
  const grouped = loops.length > 0 && longs.length > 0;
  if (grouped) els.taskList.appendChild(buildGroupTag('LOOP'));
  for (const t of loops) els.taskList.appendChild(buildRow(t, { manage: false }));
  if (grouped) els.taskList.appendChild(buildGroupTag('LONG'));
  for (const t of longs) els.taskList.appendChild(buildRow(t, { manage: false }));

  updatePixelFieldTarget(total === 0 ? 0 : done / total);
}

function buildGroupTag(text) {
  const li = document.createElement('li');
  li.className = 'group-tag';
  li.textContent = text;
  return li;
}

function buildRow(task, { manage }) {
  const li = document.createElement('li');
  // 两种视图都以「今天是否已完成」为准：循环看 completions[今天]，长期看 done
  const doneNow = isDoneToday(task);
  li.className = (manage ? 'manage-row' : 'task-row') + (doneNow ? ' done' : '');

  // 复选框：未完成→完成；管理页 DONE 栏已完成→取消完成
  const cb = document.createElement('button');
  cb.className = 'cb' + (doneNow ? ' checked' : '');
  cb.setAttribute('aria-label', doneNow ? '取消完成' : '完成');
  cb.innerHTML = '<svg viewBox="0 0 12 12"><path d="M2.2 6.4 4.8 9 9.8 3.4"/></svg>';
  cb.addEventListener('click', () => {
    if (manage && doneNow) uncompleteTask(task);
    else completeTask(task, li, manage ? null : cb);
  });
  li.appendChild(cb);

  // 标题
  const title = document.createElement('span');
  title.className = 'task-title';
  title.textContent = task.title;
  if (task.note) title.title = task.note;
  li.appendChild(title);

  // 循环 tag / D-DAY 徽章
  if (task.type === 'recurring') {
    const tag = document.createElement('span');
    tag.className = 'recur-tag';
    tag.textContent = recurTag(task);
    li.appendChild(tag);
  } else {
    const dd = ddayInfo(task);
    if (dd && !task.done) {
      const badge = document.createElement('span');
      badge.className = 'dday' + (dd.cls ? ' ' + dd.cls : '');
      badge.textContent = dd.text;
      li.appendChild(badge);
    }
  }

  // 管理页：删除按钮（二次确认）；点击行其余区域打开编辑
  if (manage) {
    li.appendChild(buildDeleteButton(task));
    li.addEventListener('click', e => {
      if (e.target.closest('.cb') || e.target.closest('.del-btn')) return;
      sheet.open(task);
    });
  }
  return li;
}

function buildDeleteButton(task) {
  const btn = document.createElement('button');
  btn.className = 'del-btn';
  btn.title = '删除';
  btn.innerHTML = '<svg viewBox="0 0 12 12" width="12" height="12"><path d="M2.5 3.5h7M5 3V2h2v1M4 3.5l.4 6h3.2l.4-6M5.2 5.2v3M6.8 5.2v3" stroke="currentColor" stroke-width="1.1" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  let timer = null;
  btn.addEventListener('click', () => {
    if (btn.classList.contains('confirm')) {
      clearTimeout(timer);
      state.tasks = state.tasks.filter(t => t.id !== task.id);
      persist();
      renderAll();
    } else {
      btn.classList.add('confirm');
      btn.textContent = '确认删除';
      timer = setTimeout(() => { // 2.6 秒无操作恢复垃圾桶图标
        btn.classList.remove('confirm');
        btn.innerHTML = '<svg viewBox="0 0 12 12" width="12" height="12"><path d="M2.5 3.5h7M5 3V2h2v1M4 3.5l.4 6h3.2l.4-6M5.2 5.2v3M6.8 5.2v3" stroke="currentColor" stroke-width="1.1" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      }, 2600);
    }
  });
  return btn;
}

/* ---------- 完成 / 取消完成任务 ---------- */
function completeTask(task, rowEl, cbEl) {
  if (cbEl) burstAt(cbEl); // 小窗勾选：复选框处迸发粒子
  const finish = () => {
    if (task.type === 'recurring') {
      task.completions[todayKey()] = Date.now();
    } else {
      task.done = true;
      task.doneAt = Date.now();
    }
    persist();
    renderAll();
    maybeCelebrate();
  };
  if (mode !== 'manage' && !reduceMotion && rowEl) {
    // 小窗 / Mini 模式：行向右滑出后重渲染
    rowEl.classList.add('leaving');
    setTimeout(finish, 300);
  } else {
    finish();
  }
}

// 管理页 DONE 栏取消完成：循环任务清除今天的 completion，长期任务清 done 标志
function uncompleteTask(task) {
  if (task.type === 'recurring') {
    delete task.completions[todayKey()];
  } else {
    task.done = false;
    task.doneAt = null;
  }
  persist();
  renderAll();
}

// 勾选粒子迸发：8-14 个 accent 蓝色系小方块/圆点，重力下落 + 淡出，约 500ms
// 用独立的 #burstFx 画布，避免与全屏撒花共用画布时互相清屏/隐藏
function burstAt(el) {
  if (reduceMotion) return;
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
  const cv = els.burstFx;
  const ctx = cv.getContext('2d');
  cv.width = innerWidth * devicePixelRatio;
  cv.height = innerHeight * devicePixelRatio;
  cv.classList.remove('hidden');
  const colors = ['#5EA8FF', '#9CC8FF', '#D6E8FF'];
  const parts = [];
  const n = 8 + Math.floor(Math.random() * 7);
  for (let i = 0; i < n; i++) {
    const ang = Math.random() * Math.PI * 2;
    const speed = (1.2 + Math.random() * 2.4) * devicePixelRatio;
    parts.push({
      x: cx * devicePixelRatio, y: cy * devicePixelRatio,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed - 1.6 * devicePixelRatio, // 初始略向上
      size: (2.5 + Math.random() * 3) * devicePixelRatio,
      round: Math.random() < .5,                          // 方块 / 圆点各半
      color: colors[i % colors.length],
    });
  }
  const start = performance.now();
  (function frame(now) {
    const t = now - start;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.globalAlpha = Math.max(0, 1 - t / 500);
    for (const p of parts) {
      p.vy += .12 * devicePixelRatio; // 重力
      p.x += p.vx;
      p.y += p.vy;
      ctx.fillStyle = p.color;
      if (p.round) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
    }
    if (t < 550) requestAnimationFrame(frame);
    else { ctx.clearRect(0, 0, cv.width, cv.height); cv.classList.add('hidden'); }
  })(start);
}

/* ---------- 渲染：大窗（任务管理） ---------- */
function renderManage() {
  // 分类以「今天是否已完成」为准：循环任务看 completions[今天]，长期任务看 done
  const pending = state.tasks.filter(t => !isDoneToday(t));
  const done = state.tasks.filter(isDoneToday);

  els.pendingCount.textContent = `×${pending.length}`;
  els.doneCount.textContent = `×${done.length}`;

  els.pendingList.innerHTML = '';
  for (const t of pending) els.pendingList.appendChild(buildRow(t, { manage: true }));

  els.doneList.innerHTML = '';
  for (const t of done) els.doneList.appendChild(buildRow(t, { manage: true }));

  // 清除已归档长期任务（仅统计已完成的长期任务）
  const archived = state.tasks.filter(t => t.type === 'longterm' && t.done);
  if (archived.length) {
    els.clearArchived.textContent = `清除已归档长期任务 ×${archived.length}`;
    els.clearArchived.classList.remove('hidden');
  } else {
    els.clearArchived.classList.add('hidden');
  }
}

function renderAll() {
  renderToday();
  if (mode === 'manage') renderManage();
  // Mini 模式：每次内容变化后把新的列表高度报给外壳，同步收缩窗口
  if (mode === 'mini') bridge.send({ type: 'miniHeight', height: miniDesiredHeight() });
}

/* ---------- 模式切换（today / manage / mini） ---------- */

// Mini 模式下窗口应贴合的内容高度（CSS 像素）：main 上下 padding + 列表/空态高度
function miniDesiredHeight() {
  const st = getComputedStyle(els.todayView);
  const padY = parseFloat(st.paddingTop) + parseFloat(st.paddingBottom);
  const content = els.emptyState.classList.contains('hidden')
    ? els.taskList.offsetHeight
    : els.emptyState.offsetHeight;
  const maxH = Math.max(200, (window.screen.availHeight || 800) - 120);
  return Math.min(Math.ceil(padY + content + 4), maxH); // +4：卡片边框余量
}

function setMode(next, notify = true) {
  const prev = mode;
  mode = next;
  els.app.classList.toggle('wide', next === 'manage');
  els.app.classList.toggle('mini', next === 'mini');
  els.heroTitle.innerHTML = next === 'manage' ? '任务<span class="accent">管理</span>' : '今日<span class="accent">待办</span>';
  els.todayView.classList.toggle('hidden', next === 'manage');
  els.manageView.classList.toggle('hidden', next !== 'manage');
  els.miniHotzone.classList.toggle('hidden', next !== 'mini');
  // btnMode（进入 Mini）只在今日待办页显示；任务管理页隐藏
  els.btnMode.classList.toggle('hidden', next === 'manage');
  renderAll();
  if (notify) {
    // 仅向外壳同步管理页偏好（持久化），窗口尺寸由用户拖拽决定，切换不改尺寸
    bridge.send({ type: 'setWideMode', value: next === 'manage' });
    if (next === 'mini') bridge.send({ type: 'enterMini', height: miniDesiredHeight() });
    else if (prev === 'mini') bridge.send({ type: 'exitMini' });
  }
}

/* ---------- 庆祝：全部完成 ---------- */
// 每次「完成」动作导致今日任务全清时都撒花（不限每天一次）；
// 但启动时不触发（见 init 处理，不调用本函数），避免打开 app 就撒
function maybeCelebrate() {
  const tasks = state.tasks.filter(isTodayTask);
  const allDone = tasks.length > 0 && tasks.every(isDoneToday) &&
    state.tasks.every(t => t.type !== 'longterm' || t.done);
  if (!allDone) return;
  launchConfetti();
  showToast('今日任务全部完成，太棒了！');
}

function showToast(text) {
  els.toast.textContent = text;
  els.toast.classList.remove('hidden', 'out');
  setTimeout(() => {
    els.toast.classList.add('out');
    setTimeout(() => els.toast.classList.add('hidden'), 300);
  }, 2600);
}

// 全屏 Canvas 撒花：130 片蓝白色系 + 少量 #FFD98E
function launchConfetti() {
  if (reduceMotion) return;
  const cv = els.confetti;
  const ctx = cv.getContext('2d');
  cv.width = innerWidth * devicePixelRatio;
  cv.height = innerHeight * devicePixelRatio;
  cv.classList.remove('hidden');
  const colors = ['#5EA8FF', '#9CC8FF', '#FFFFFF', '#D6E8FF'];
  const parts = [];
  for (let i = 0; i < 130; i++) {
    // 约 1/8 的纸屑用琥珀色 #FFD98E
    const color = i % 8 === 0 ? '#FFD98E' : colors[i % colors.length];
    parts.push({
      x: Math.random() * cv.width,
      y: -20 - Math.random() * cv.height * .3,
      w: (4 + Math.random() * 5) * devicePixelRatio,
      h: (6 + Math.random() * 7) * devicePixelRatio,
      vy: (1.6 + Math.random() * 2.4) * devicePixelRatio,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - .5) * .18,
      sway: Math.random() * Math.PI * 2,      // 左右摇摆相位
      swayAmp: (0.6 + Math.random() * 1.2) * devicePixelRatio,
      color,
    });
  }
  const start = performance.now();
  (function frame(now) {
    const t = now - start;
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const p of parts) {
      p.y += p.vy;
      p.rot += p.vr;
      p.sway += .05;
      const x = p.x + Math.sin(p.sway) * p.swayAmp * 8;
      ctx.save();
      ctx.translate(x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = Math.max(0, Math.min(1, 1.4 - t / 2600));
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (t < 3600) requestAnimationFrame(frame);
    else { ctx.clearRect(0, 0, cv.width, cv.height); cv.classList.add('hidden'); }
  })(start);
}

/* ---------- 像素字符场 ---------- */
// 字符集 .:+*#K▲，13px 网格，密度左疏右密，完成度越高越整齐越清晰
const pixelField = (() => {
  const cv = $('pixelField');
  const ctx = cv.getContext('2d');
  const CHARS = ['.', ':', '+', '*', '#', 'K', '▲'];
  const GRID = 13;
  let cells = [];
  let targetRatio = 0;   // 完成度（驱动 variance / opacity）
  let ratio = 0;         // 平滑过渡后的当前值
  let mouse = null;
  let raf = null;

  function rebuild() {
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    cv.width = w * devicePixelRatio;
    cv.height = h * devicePixelRatio;
    cells = [];
    const cols = Math.ceil(w / GRID), rows = Math.ceil(h / GRID);
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const density = c / Math.max(1, cols - 1);          // 从左到右递增
        if (Math.random() > .12 + density * .83) continue;  // 左疏右密
        cells.push({
          x: c * GRID + GRID / 2,
          y: r * GRID + GRID / 2,
          ch: CHARS[Math.floor(Math.random() * CHARS.length)],
          size: 7 + density * 4,                            // 7-11px 随密度变化
          density,
          jx: (Math.random() - .5), jy: (Math.random() - .5), // 固定随机抖动方向
          ox: 0, oy: 0,                                     // 鼠标排斥位移
        });
      }
    }
  }

  function draw() {
    // variance 0.85→0.17，opacity 0.3→0.52 随完成度变化
    const variance = .85 + (.17 - .85) * ratio;
    const alpha = .3 + (.52 - .3) * ratio;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const cell of cells) {
      // 鼠标排斥：半径 90px、力度 13px
      let tx = 0, ty = 0;
      if (mouse) {
        const dx = cell.x - mouse.x, dy = cell.y - mouse.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 90 && dist > 0) {
          const f = (1 - dist / 90) * 13;
          tx = (dx / dist) * f;
          ty = (dy / dist) * f;
        }
      }
      cell.ox += (tx - cell.ox) * .18;
      cell.oy += (ty - cell.oy) * .18;

      const x = (cell.x + cell.jx * GRID * variance + cell.ox) * devicePixelRatio;
      const y = (cell.y + cell.jy * GRID * variance + cell.oy) * devicePixelRatio;
      ctx.font = `${cell.size * devicePixelRatio}px Consolas, monospace`;
      ctx.fillStyle = `rgba(94,168,255,${(alpha * (0.5 + cell.density * 0.5)).toFixed(3)})`;
      ctx.fillText(cell.ch, x, y);
    }
  }

  function loop() {
    // 完成度平滑过渡
    ratio += (targetRatio - ratio) * .06;
    draw();
    // 鼠标在场内或完成度还在过渡时持续刷新
    if (mouse || Math.abs(targetRatio - ratio) > .002) raf = requestAnimationFrame(loop);
    else raf = null;
  }
  function kick() { if (!raf && !reduceMotion) raf = requestAnimationFrame(loop); }

  cv.addEventListener('mousemove', e => {
    const rect = cv.getBoundingClientRect();
    mouse = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    kick();
  });
  cv.addEventListener('mouseleave', () => { mouse = null; kick(); });
  new ResizeObserver(() => { rebuild(); draw(); }).observe(cv);

  rebuild(); draw();
  return { setRatio(r) { targetRatio = r; if (reduceMotion) { ratio = r; draw(); } else kick(); } };
})();

function updatePixelFieldTarget(r) { pixelField.setRatio(r); }

/* ---------- 创建 / 编辑任务弹层 ---------- */
const sheet = (() => {
  let type = 'recurring';
  let editId = null; // null = 创建模式；否则为被编辑任务 id
  const weekdays = new Set();
  const monthdays = new Set();

  function buildChips(container, values, labelFn, set) {
    container.innerHTML = '';
    for (const v of values) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip' + (set.has(v) ? ' on' : '');
      chip.textContent = labelFn(v);
      chip.addEventListener('click', () => {
        set.has(v) ? set.delete(v) : set.add(v);
        chip.classList.toggle('on');
      });
      container.appendChild(chip);
    }
  }

  function syncKindFields() {
    const kind = els.fRecurKind.value;
    els.weekdayChips.classList.toggle('hidden', kind !== 'weekly');
    els.monthdayChips.classList.toggle('hidden', kind !== 'monthly');
  }

  function syncTypeFields() {
    [...els.segType.children].forEach(b => b.classList.toggle('active', b.dataset.type === type));
    els.recurFields.classList.toggle('hidden', type !== 'recurring');
    els.dueFields.classList.toggle('hidden', type !== 'longterm');
  }

  // 不传 task 为创建模式；传 task 进入编辑模式并预填
  function open(task) {
    editId = task ? task.id : null;
    type = task ? task.type : 'recurring';
    els.sheetTitle.textContent = task ? '编辑任务' : '创建任务';
    els.btnCreate.textContent = task ? '保存' : '创建';
    els.fTitle.value = task ? task.title : '';
    els.fNote.value = task && task.note ? task.note : '';
    weekdays.clear(); monthdays.clear();
    if (task && task.recur) {
      (task.recur.weekdays || []).forEach(w => weekdays.add(w));
      (task.recur.monthdays || []).forEach(d => monthdays.add(d));
    }
    buildChips(els.weekdayChips, [1, 2, 3, 4, 5, 6, 0], v => WEEK_CN[v], weekdays);
    buildChips(els.monthdayChips, Array.from({ length: 31 }, (_, i) => i + 1), v => v, monthdays);
    els.fRecurKind.value = task && task.recur ? task.recur.kind : 'daily';
    syncKindFields();
    syncTypeFields();
    els.fDue.value = task && task.due ? task.due : '';
    els.sheetOverlay.classList.remove('hidden');
    setTimeout(() => els.fTitle.focus(), 60);
  }
  function close() { els.sheetOverlay.classList.add('hidden'); editId = null; }

  els.segType.addEventListener('click', e => {
    const btn = e.target.closest('.seg');
    if (!btn) return;
    type = btn.dataset.type;
    syncTypeFields();
  });
  els.fRecurKind.addEventListener('change', syncKindFields);
  els.btnCancel.addEventListener('click', close);
  els.sheetOverlay.addEventListener('click', e => { if (e.target === els.sheetOverlay) close(); });

  els.btnCreate.addEventListener('click', () => {
    const title = els.fTitle.value.trim();
    if (!title) { els.fTitle.focus(); return; }
    const note = els.fNote.value.trim();
    const kind = els.fRecurKind.value;
    let recur = null, due = null;
    if (type === 'recurring') {
      recur = {
        kind,
        weekdays: kind === 'weekly' ? [...weekdays] : undefined,
        monthdays: kind === 'monthly' ? [...monthdays] : undefined,
      };
      if (kind === 'weekly' && !weekdays.size) recur.weekdays = [new Date().getDay()];
      if (kind === 'monthly' && !monthdays.size) recur.monthdays = [new Date().getDate()];
    } else {
      due = els.fDue.value || null;
    }

    if (editId) {
      // 编辑模式：更新原任务，保留 id / completions / done / doneAt / createdAt
      const task = state.tasks.find(t => t.id === editId);
      if (task) {
        task.type = type;
        task.title = title;
        task.note = note;
        task.recur = recur;
        task.due = due;
      }
    } else {
      state.tasks.push({
        id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        type,
        title,
        note,
        recur,
        due,
        completions: {},
        done: false,
        doneAt: null,
        createdAt: Date.now(),
      });
    }
    persist();
    close();
    renderAll();
  });

  return { open };
})();

/* ---------- 事件绑定 ---------- */
$('btnAdd').addEventListener('click', () => sheet.open()); // 创建模式（不传 task）
// 今日待办页的模式按钮：直接进入 Mini 模式
els.btnMode.addEventListener('click', () => setMode('mini'));
// Mini 热区按钮：退出 Mini 回到今日待办
els.btnMiniMode.addEventListener('click', () => setMode('today'));
els.missedGo.addEventListener('click', () => setMode('manage')); // 「去处理 →」进入管理页
els.clearArchived.addEventListener('click', () => {
  state.tasks = state.tasks.filter(t => !(t.type === 'longterm' && t.done));
  persist();
  renderAll();
});

// Hero 区域拖动 + 标题区点击切换：
// mousedown 时先不拖动，移动超过 5px 才通知 C# 开始 Win32 模态拖动
// （模态拖窗后页面收不到后续事件，所以必须等确认是拖拽再交给 C#）；
// 原地松开（< 5px）且落在标题区 → 切换 今日待办 ⇄ 任务管理
const heroLeft = document.querySelector('.hero-left');
let pressPos = null;
let dragStarted = false;
els.hero.addEventListener('mousedown', e => {
  if (e.target.closest('button')) return;
  pressPos = { x: e.clientX, y: e.clientY, onTitle: !!e.target.closest('.hero-left') };
  dragStarted = false;
});
window.addEventListener('mousemove', e => {
  if (!pressPos || dragStarted) return;
  if (Math.hypot(e.clientX - pressPos.x, e.clientY - pressPos.y) >= 5) {
    dragStarted = true;
    bridge.send({ type: 'drag' });
  }
});
window.addEventListener('mouseup', e => {
  if (!pressPos) return;
  const wasTitleClick = pressPos.onTitle && !dragStarted;
  pressPos = null;
  if (wasTitleClick && (mode === 'today' || mode === 'manage')) {
    setMode(mode === 'today' ? 'manage' : 'today');
  }
});

// 保存确认时间
bridge.onMessage(msg => {
  if (!msg || typeof msg !== 'object') return;
  switch (msg.type) {
    case 'init':
      if (msg.data && Array.isArray(msg.data.tasks)) state = msg.data;
      settings = msg.settings || settings;
      setMode('today', false); // 启动始终落在今日待办页（不恢复管理页/mini）
      renderAll();
      // 注意：启动时不调用 maybeCelebrate()，避免任务早已全完时每次打开都撒花
      break;
    case 'saved':
      els.saveState.textContent = `✓ 已自动保存 ${msg.time}`;
      break;
    case 'settings':
      settings = msg.settings || settings;
      break;
  }
});

/* ---------- 启动 ---------- */
bridge.send({ type: 'ready' });
// 浏览器降级模式下 init 消息也会到达；兜底渲染一次
renderAll();
