const api = window.desktopOrganizer;
const $ = id => document.getElementById(id);
const iconNames = { documents: 'file', images: 'image', videos: 'video', music: 'music', archives: 'archive', installers: 'install', shortcuts: 'link', folders: 'folder', others: 'more' };
const cardMarks = ['✦', '✿', '◌', '♫', '✧', '↟', '♡', '❀', '✳'];
const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
const ui = { data: null, selected: null, busy: false, wind: false };
const icon = name => `<svg aria-hidden="true"><use href="#${name}"></use></svg>`;
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function toast(message, error = false) {
  const element = $('deskToast');
  element.textContent = message;
  element.className = `desk-toast visible${error ? ' error' : ''}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove('visible'), 3600);
}

function renderCard(category, index) {
  const count = category.items.length;
  return `<button class="desk-card" data-category="${category.id}" type="button" style="--i:${index};--tilt:${[-2, 1, -1, 2, -2, 1, -1, 2, -1][index % 9]}deg" aria-label="打开${escapeHtml(category.name)}，${count}件物品">
    <span class="hang-thread"></span><span class="hang-pin"></span>
    <span class="desk-folder ${category.color}"><span class="desk-folder-tab"></span><span class="card-top"><small>NO. ${String(index + 1).padStart(2, '0')}</small><span>${cardMarks[index % cardMarks.length]}</span></span><span class="category-icon">${icon(iconNames[category.id])}</span><strong>${escapeHtml(category.name)}</strong><em>${count ? `${count} 件小物品` : '还没有文件'}</em><span class="card-preview">${count ? escapeHtml(category.items[0].name) : '等你来填满'}</span></span>
  </button>`;
}

function render() {
  if (!ui.data) return;
  const rail = $('deskRail');
  const scroll = rail.scrollLeft;
  rail.innerHTML = ui.data.categories.map(renderCard).join('');
  rail.scrollLeft = scroll;
  $('deskSummary').textContent = `${ui.data.total} 件物品 · ${ui.data.pending.length} 件待归位 · ${ui.data.shared?.length || 0} 件公用桌面`;
  $('deskPending').textContent = ui.data.pending.length;
  $('deskOrganize').disabled = ui.busy;
  $('deskOrganize').dataset.empty = ui.data.pending.length === 0 ? 'true' : 'false';
  $('deskOrganize').querySelector('span').textContent = ui.busy ? '整理中…' : ui.data.pending.length ? '整理桌面' : '已经整理好';
  $('deskUndo').disabled = ui.busy;
  $('deskUndo').dataset.empty = ui.data.canUndo ? 'false' : 'true';
  $('deskUndo').title = ui.data.canUndo ? '撤销上次整理' : '还没有可撤销的整理记录';
  if (ui.selected) showPopover(ui.selected, false);
  updateRailButtons();
}

function updateRailButtons() {
  const rail = $('deskRail');
  $('deskLeft').disabled = rail.scrollLeft < 8;
  $('deskRight').disabled = rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 8;
}

function showPopover(id, reposition = true) {
  if (!ui.data) return;
  const category = ui.data.categories.find(entry => entry.id === id);
  if (!category) return;
  ui.selected = id;
  const index = ui.data.categories.indexOf(category);
  $('popoverKicker').textContent = `HANGING FOLDER / ${String(index + 1).padStart(2, '0')}`;
  $('popoverTitle').textContent = category.name;
  $('popoverSummary').textContent = `${category.pendingCount} 件待整理 · ${category.organizedCount} 件已归档 · ${category.sharedCount || 0} 件公用`;
  $('popoverList').innerHTML = category.items.length ? category.items.map((item, itemIndex) => `<button class="popover-item" type="button" data-item="${itemIndex}" title="双击打开 ${escapeHtml(item.name)}"><span class="item-icon">${icon(item.isDirectory ? 'folder' : iconNames[item.categoryId])}</span><span class="item-name">${escapeHtml(item.name)}</span><small>${item.location === 'organized' ? '已归档' : item.location === 'shared' ? '公用桌面' : '待整理'}</small></button>`).join('') : `<p class="popover-empty">这里还空着。下次整理时，文件会挂进来。</p>`;
  $('popoverList')._items = category.items;
  const popover = $('deskPopover');
  popover.hidden = false;
  api.setPopoverOpen(true);
  if (reposition) {
    const card = Array.from(document.querySelectorAll('.desk-card')).find(element => element.dataset.category === id);
    const rect = card?.getBoundingClientRect();
    const left = Math.min(Math.max(20, rect?.left || 20), innerWidth - 395);
    popover.style.left = `${left}px`;
  }
}

function hidePopover() { ui.selected = null; $('deskPopover').hidden = true; api.setPopoverOpen(false); }

async function refresh(quiet = false) {
  if (ui.busy) return;
  try {
    const next = await api.state();
    const fingerprint = JSON.stringify(next.categories.map(category => [category.pendingCount, category.organizedCount, category.sharedCount, category.items.map(item => item.name)]));
    if (fingerprint !== refresh.lastFingerprint) { refresh.lastFingerprint = fingerprint; ui.data = next; render(); }
    else {
      ui.data = next;
      $('deskUndo').dataset.empty = next.canUndo ? 'false' : 'true';
      $('deskUndo').title = next.canUndo ? '撤销上次整理' : '还没有可撤销的整理记录';
    }
  } catch (error) { if (!quiet) toast(`读取桌面失败：${error.message}`, true); }
}

async function organize() {
  if (ui.busy) return;
  if (!ui.data?.pending.length) { toast('桌面已经整理好了，暂无待归位的文件'); return; }
  ui.busy = true; render();
  try {
    const { result, state } = await api.organize();
    if (!motion.matches && result.moved.length) {
      const cards = Array.from(document.querySelectorAll('.desk-card'));
      cards.filter(card => result.moved.some(move => ui.data.pending.find(item => item.path === move.from)?.categoryId === card.dataset.category)).slice(0, 5).forEach((card, index) => {
        card.animate([{ transform: 'rotate(0deg)' }, { transform: `rotate(${index % 2 ? -8 : 8}deg)` }, { transform: 'rotate(0deg)' }], { duration: 900, delay: index * 90 });
      });
    }
    ui.data = state; refresh.lastFingerprint = null;
    toast(result.errors.length ? `整理了 ${result.moved.length} 件，${result.errors.length} 件未能移动` : `已整理 ${result.moved.length} 件物品 ✳`, !!result.errors.length);
  } catch (error) { toast(`整理失败：${error.message}`, true); }
  finally { ui.busy = false; render(); }
}

async function undo() {
  if (ui.busy) return;
  if (!ui.data?.canUndo) { toast('还没有可撤销的整理记录'); return; }
  ui.busy = true; render();
  try {
    const { result, state } = await api.undo();
    ui.data = state; refresh.lastFingerprint = null;
    toast(result.errors.length ? `恢复 ${result.restored.length} 件，${result.errors.length} 件需手动处理` : `已放回 ${result.restored.length} 件物品`, !!result.errors.length);
  } catch (error) { toast(`撤销失败：${error.message}`, true); }
  finally { ui.busy = false; render(); }
}

function blowWind() {
  if (ui.wind || motion.matches) return;
  ui.wind = true;
  const scene = document.querySelector('.line-scene');
  scene.classList.add('gusting');
  document.querySelectorAll('.desk-card').forEach((card, index) => card.animate([
    { rotate: '0deg' }, { rotate: `${index % 2 ? -8 : 8}deg` }, { rotate: `${index % 2 ? 4 : -4}deg` }, { rotate: '0deg' }
  ], { duration: 1300, delay: index * 55, easing: 'ease-in-out' }));
  setTimeout(() => { scene.classList.remove('gusting'); ui.wind = false; }, 1700);
}

$('deskRail').addEventListener('click', event => {
  const card = event.target.closest('[data-category]');
  if (card) showPopover(card.dataset.category);
});
$('deskRail').addEventListener('scroll', updateRailButtons, { passive: true });
$('deskOrganize').addEventListener('click', organize);
$('deskUndo').addEventListener('click', undo);
$('deskWind').addEventListener('click', blowWind);
$('deskManage').addEventListener('click', () => api.openPanel());
$('deskLeft').addEventListener('click', () => $('deskRail').scrollBy({ left: -660, behavior: motion.matches ? 'instant' : 'smooth' }));
$('deskRight').addEventListener('click', () => $('deskRail').scrollBy({ left: 660, behavior: motion.matches ? 'instant' : 'smooth' }));
$('popoverClose').addEventListener('click', hidePopover);
$('popoverManaged').addEventListener('click', () => api.openFolder('managed').catch(error => toast(error.message, true)));
$('popoverList').addEventListener('dblclick', event => {
  const row = event.target.closest('[data-item]');
  if (!row) return;
  const item = $('popoverList')._items[Number(row.dataset.item)];
  api.open(item.path).catch(error => toast(error.message, true));
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') hidePopover(); });
api.onUpdated(() => refresh());
api.onDesktopWarning(message => toast(message, true));
refresh();
setInterval(() => refresh(true), 8000);
setInterval(blowWind, 14000);
