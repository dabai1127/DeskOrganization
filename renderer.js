const api = window.desktopOrganizer;
const icons = { documents: 'file', images: 'image', videos: 'video', music: 'music', archives: 'archive', installers: 'install', shortcuts: 'link', folders: 'folder', others: 'more' };
const shortNames = { documents: '文档', images: '图片', videos: '视频', music: '音乐', archives: '压缩包', installers: '安装包', shortcuts: '快捷方式', folders: '文件夹', others: '其他' };
const state = { data: null, busy: false, busyKind: null, drawerCategory: null, gusting: false };
const $ = id => document.getElementById(id);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function icon(name, className = '') { return `<svg class="${className}" aria-hidden="true"><use href="#i-${name}"></use></svg>`; }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]); }
function toast(message, kind = 'success') {
  const element = $('toast');
  element.textContent = message;
  element.className = `toast visible ${kind}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove('visible'), 4200);
}
function prettyPath(value) { return value || '尚未选择文件夹'; }
function itemIcon(item) { return item.isDirectory ? 'folder' : icons[item.categoryId] || 'file'; }

function renderFolder(category, index) {
  const samples = category.items.slice(0, 2);
  const count = category.items.length;
  const label = count ? `${count} 件物品` : '空空的，等你来';
  return `<button class="hanging-item" type="button" data-category="${category.id}" style="--index:${index};--sway:${index % 2 ? '1.5deg' : '-1.3deg'}" aria-label="查看${category.name}，${label}">
    <span class="hanger-string"></span><span class="clothespin"><i></i></span>
    <span class="folder-card ${category.color}">
      <span class="folder-tab"></span><span class="folder-shape"><span class="folder-shine"></span></span>
      <span class="peek-paper peek-paper-one"></span><span class="peek-paper peek-paper-two"></span>
      <span class="folder-content">
        <span class="folder-topline"><span class="folder-number">${String(index + 1).padStart(2, '0')}</span><span class="folder-sigil">✳</span></span>
        <span class="folder-icon">${icon(icons[category.id])}</span>
        <span class="folder-title">${escapeHtml(shortNames[category.id])}</span>
        <span class="folder-count">${escapeHtml(label)}</span>
        <span class="folder-files">${samples.length ? samples.map(item => `<span>${escapeHtml(item.name)}</span>`).join('') : '<span>还没有文件，先留点空白</span>'}</span>
      </span>
    </span>
    <span class="hanger-label">${escapeHtml(category.name)} <span>↗</span></span>
  </button>`;
}

function renderPendingItem(item, index) {
  return `<button class="pending-row" type="button" data-pending-index="${index}" aria-label="打开${escapeHtml(item.name)}">
    <span class="pending-icon ${item.categoryId}">${icon(itemIcon(item))}</span>
    <span class="pending-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
    <span class="pending-category">将归入 · ${escapeHtml(shortNames[item.categoryId])}</span>
    <span class="pending-row-arrow">${icon('chevron')}</span>
  </button>`;
}

function render() {
  const data = state.data;
  if (!data) return;
  const rail = $('folderRail');
  const previousScroll = rail.scrollLeft;
  $('rootPath').textContent = prettyPath(data.root);
  $('rootPath').title = data.root;
  $('totalCount').textContent = data.total;
  $('pendingCount').textContent = data.pending.length;
  $('pendingBadge').textContent = data.pending.length;
  $('categoryCount').textContent = `/ ${String(data.categories.length).padStart(2, '0')}`;
  rail.innerHTML = data.categories.map(renderFolder).join('');
  rail.scrollLeft = previousScroll;
  $('pendingList').innerHTML = data.pending.length
    ? data.pending.slice(0, 4).map(renderPendingItem).join('')
    : `<div class="empty-state"><span class="empty-spark">✳</span><div><strong>桌面已经很清爽啦</strong><span>没有等待整理的文件，喝杯茶吧。</span></div></div>`;
  $('organizeButton').disabled = state.busy || !data.pending.length;
  $('organizeButton').querySelector('span').textContent = state.busyKind === 'organize' ? '正在把文件挂起来…' : data.pending.length ? `一键整理 ${data.pending.length} 件物品` : '桌面已整理好';
  $('organizeButton').classList.toggle('is-sorting', state.busyKind === 'organize');
  $('undoButton').disabled = state.busy || !data.canUndo;
  $('windButton').disabled = state.busy || state.gusting;
  $('openManagedButton').disabled = !data.categories.some(category => category.organizedCount);
  $('viewAllButton').disabled = !data.pending.length;
  updateRailPosition();
  if (state.drawerCategory) renderDrawer(state.drawerCategory);
}

function updateRailPosition() {
  const rail = $('folderRail');
  const first = Math.min(9, Math.max(1, Math.round(rail.scrollLeft / 254) + 1));
  $('railPosition').textContent = `${String(first).padStart(2, '0')} — 09`;
  $('scrollLeft').disabled = rail.scrollLeft < 10;
  $('scrollRight').disabled = rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 10;
}

function renderDrawer(categoryId) {
  const data = state.data;
  const category = data.categories.find(entry => entry.id === categoryId);
  const isAll = categoryId === 'all';
  const items = isAll ? data.pending : category?.items || [];
  $('drawerKicker').textContent = isAll ? 'WAITING TO BE SORTED' : 'FOLDER DETAILS';
  $('drawerTitle').textContent = isAll ? '等待归位' : category.name;
  $('drawerSubtitle').textContent = isAll ? `${items.length} 件物品还在当前文件夹` : `${category.pendingCount} 件待整理 · ${category.organizedCount} 件已归档 · ${category.sharedCount || 0} 件公用`;
  $('drawerBody').innerHTML = items.length ? items.map((item, index) => `<div class="drawer-file" data-item-index="${index}" style="--row-index:${Math.min(index, 12)}">
    <span class="drawer-file-icon ${item.categoryId}">${icon(itemIcon(item))}</span>
    <span class="drawer-file-info"><strong title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</strong><small>${item.location === 'organized' ? '已归档' : item.location === 'shared' ? '公用桌面' : '待整理'} · ${escapeHtml(shortNames[item.categoryId])}</small></span>
    <button type="button" class="drawer-reveal" data-reveal-index="${index}" aria-label="在文件夹中显示${escapeHtml(item.name)}">${icon('external')}</button>
  </div>`).join('') : `<div class="drawer-empty"><span>✳</span><h3>这里暂时空着</h3><p>下次整理时，属于这里的文件会自动挂上来。</p></div>`;
  $('drawerBody')._items = items;
}

function openDrawer(categoryId) {
  state.drawerCategory = categoryId;
  renderDrawer(categoryId);
  $('drawerBackdrop').hidden = false;
  $('detailDrawer').classList.add('open');
  $('detailDrawer').setAttribute('aria-hidden', 'false');
  $('drawerClose').focus();
}
function closeDrawer() {
  state.drawerCategory = null;
  $('detailDrawer').classList.remove('open');
  $('detailDrawer').setAttribute('aria-hidden', 'true');
  $('drawerBackdrop').hidden = true;
}

async function refresh() {
  try { state.data = await api.state(); render(); }
  catch (error) { toast(`读取文件夹失败：${error.message}`, 'error'); }
}
function blowWind() {
  if (state.gusting) return;
  state.gusting = true;
  const scene = document.querySelector('.clothesline-scene');
  const button = $('windButton');
  scene.classList.add('gusting');
  button.classList.add('blowing');
  button.disabled = true;
  if (!reducedMotion.matches) {
    document.querySelectorAll('.hanging-item').forEach((card, index) => {
      card.animate([
        { rotate: '0deg', offset: 0 },
        { rotate: `${index % 2 ? -8 : 8}deg`, offset: .27 },
        { rotate: `${index % 2 ? 5 : -5}deg`, offset: .58 },
        { rotate: `${index % 2 ? -2 : 2}deg`, offset: .8 },
        { rotate: '0deg', offset: 1 }
      ], { duration: 1300, delay: index * 55, easing: 'ease-in-out' });
    });
  }
  setTimeout(() => { scene.classList.remove('gusting'); button.classList.remove('blowing'); button.disabled = false; state.gusting = false; }, reducedMotion.matches ? 300 : 1800);
}

async function flySortedFiles(previous, result) {
  if (reducedMotion.matches || !result.moved.length) return;
  const moved = new Set(result.moved.map(move => move.from));
  const picked = [];
  for (const item of previous.pending) {
    if (!moved.has(item.path) || picked.some(entry => entry.categoryId === item.categoryId)) continue;
    const card = Array.from(document.querySelectorAll('.hanging-item')).find(element => element.dataset.category === item.categoryId);
    const target = card?.querySelector('.folder-icon').getBoundingClientRect();
    if (target && target.right > 0 && target.left < innerWidth) picked.push(item);
    if (picked.length === 5) break;
  }
  const launchRect = $('organizeButton').getBoundingClientRect();
  const launches = picked.map((item, index) => {
    const card = Array.from(document.querySelectorAll('.hanging-item')).find(element => element.dataset.category === item.categoryId);
    if (!card) return Promise.resolve();
    const target = card.querySelector('.folder-icon').getBoundingClientRect();
    if (target.right < 0 || target.left > innerWidth) return Promise.resolve();
    const startX = launchRect.left + launchRect.width * .75 + index * 5;
    const startY = launchRect.top + launchRect.height / 2;
    const endX = target.left + target.width / 2;
    const endY = target.top + target.height / 2;
    const paper = document.createElement('span');
    paper.className = `flying-paper flying-${item.categoryId}`;
    paper.style.left = `${startX}px`;
    paper.style.top = `${startY}px`;
    paper.innerHTML = icon(itemIcon(item));
    document.body.appendChild(paper);
    const x = endX - startX;
    const y = endY - startY;
    const animation = paper.animate([
      { transform: 'translate(-50%, -50%) scale(.45) rotate(-20deg)', opacity: 0, offset: 0 },
      { transform: `translate(calc(-50% + ${x * .4}px), calc(-50% + ${Math.min(y, -90) - 95}px)) scale(1.2) rotate(18deg)`, opacity: 1, offset: .45 },
      { transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(.35) rotate(-9deg)`, opacity: 0, offset: 1 }
    ], { duration: 1050, delay: index * 115, easing: 'cubic-bezier(.3,.6,.22,1)', fill: 'forwards' });
    return animation.finished.catch(() => {}).finally(() => paper.remove());
  });
  await Promise.all(launches);
}

async function doAction(action, success, kind = null) {
  if (state.busy) return;
  state.busy = true; state.busyKind = kind; render();
  try { await action(); if (success) toast(success); }
  catch (error) { toast(error.message, 'error'); }
  finally { state.busy = false; state.busyKind = null; render(); }
}

$('refreshButton').addEventListener('click', () => doAction(async () => { await refresh(); }, '已刷新桌面文件'));
$('showDesktopButton').addEventListener('click', () => api.showDesktop());
$('chooseButton').addEventListener('click', () => doAction(async () => { state.data = await api.choose(); closeDrawer(); }, '已切换工作区'));
$('organizeButton').addEventListener('click', () => doAction(async () => {
  const previous = state.data;
  const { result, state: next } = await api.organize();
  try { await flySortedFiles(previous, result); }
  catch (error) { console.warn('整理动画未完成:', error); }
  state.data = next;
  if (result.errors.length) toast(`整理了 ${result.moved.length} 件，${result.errors.length} 件未能移动`, 'error');
  else toast(`已整理 ${result.moved.length} 件物品，桌面轻松了 ✳`);
}, null, 'organize'));
$('undoButton').addEventListener('click', () => doAction(async () => {
  const { result, state: next } = await api.undo();
  state.data = next;
  if (result.errors.length) toast(`已恢复 ${result.restored.length} 件，${result.errors.length} 件需手动处理`, 'error');
  else toast(`已将 ${result.restored.length} 件物品放回原处`);
}));
$('openRootButton').addEventListener('click', () => doAction(() => api.openFolder('root')));
$('openManagedButton').addEventListener('click', () => doAction(() => api.openFolder('managed')));
$('drawerOpenManaged').addEventListener('click', () => doAction(() => api.openFolder('managed')));
$('viewAllButton').addEventListener('click', () => openDrawer('all'));
$('windButton').addEventListener('click', blowWind);
$('folderRail').addEventListener('click', event => { const card = event.target.closest('[data-category]'); if (card) openDrawer(card.dataset.category); });
$('folderRail').addEventListener('scroll', updateRailPosition, { passive: true });
$('scrollLeft').addEventListener('click', () => $('folderRail').scrollBy({ left: -510, behavior: 'smooth' }));
$('scrollRight').addEventListener('click', () => $('folderRail').scrollBy({ left: 510, behavior: 'smooth' }));
$('pendingList').addEventListener('click', event => {
  const row = event.target.closest('[data-pending-index]');
  if (row) openDrawer('all');
});
$('drawerBody').addEventListener('click', event => {
  const reveal = event.target.closest('[data-reveal-index]');
  if (reveal) { const item = $('drawerBody')._items[Number(reveal.dataset.revealIndex)]; doAction(() => api.reveal(item.path)); }
});
$('drawerBody').addEventListener('dblclick', event => {
  const row = event.target.closest('[data-item-index]');
  if (row) { const item = $('drawerBody')._items[Number(row.dataset.itemIndex)]; doAction(() => api.open(item.path)); }
});
$('drawerClose').addEventListener('click', closeDrawer);
$('drawerBackdrop').addEventListener('click', closeDrawer);
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeDrawer(); });
api.onUpdated(() => { if (!state.busy) refresh(); });
refresh();
