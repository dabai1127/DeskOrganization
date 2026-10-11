const fs = require('node:fs/promises');
const path = require('node:path');

const MANAGED_DIR = '晾一晾-已整理';
const CATEGORIES = [
  { id: 'documents', name: '文档资料', folder: '文档资料', color: 'cream', extensions: ['.pdf', '.doc', '.docx', '.txt', '.rtf', '.md', '.odt', '.xls', '.xlsx', '.csv', '.ppt', '.pptx', '.pages', '.numbers', '.key'] },
  { id: 'images', name: '图片照片', folder: '图片照片', color: 'pink', extensions: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.heic', '.tif', '.tiff', '.svg', '.ico', '.raw', '.psd'] },
  { id: 'videos', name: '视频影像', folder: '视频影像', color: 'blue', extensions: ['.mp4', '.mov', '.avi', '.mkv', '.wmv', '.flv', '.webm', '.m4v'] },
  { id: 'music', name: '音乐音频', folder: '音乐音频', color: 'mint', extensions: ['.mp3', '.wav', '.flac', '.aac', '.m4a', '.ogg', '.wma', '.aiff'] },
  { id: 'archives', name: '压缩文件', folder: '压缩文件', color: 'lavender', extensions: ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz'] },
  { id: 'installers', name: '安装程序', folder: '安装程序', color: 'peach', extensions: ['.exe', '.msi', '.msix', '.dmg', '.pkg', '.apk', '.deb'] },
  { id: 'shortcuts', name: '快捷方式', folder: '快捷方式', color: 'yellow', extensions: ['.lnk', '.url', '.webloc'] },
  { id: 'folders', name: '原有文件夹', folder: '原有文件夹', color: 'sage', extensions: [] },
  { id: 'others', name: '其他文件', folder: '其他文件', color: 'stone', extensions: [] }
];

function isInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function categoryFor(name, isDirectory) {
  if (isDirectory) return CATEGORIES.find(category => category.id === 'folders');
  const extension = path.extname(name).toLowerCase();
  return CATEGORIES.find(category => category.extensions.includes(extension)) || CATEGORIES.find(category => category.id === 'others');
}

async function getEntries(folder) {
  try { return await fs.readdir(folder, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

async function scan(root, appRoot, sharedRoot) {
  const source = path.resolve(root);
  const managed = path.join(source, MANAGED_DIR);
  const pending = [];
  const shared = [];
  const categories = CATEGORIES.map(({ extensions, ...category }) => ({ ...category, items: [], pendingCount: 0, organizedCount: 0, sharedCount: 0 }));
  const lookup = Object.fromEntries(categories.map(category => [category.id, category]));
  const rootEntries = await getEntries(source);

  for (const entry of rootEntries) {
    if (entry.name === MANAGED_DIR || entry.name.toLowerCase() === 'desktop.ini' || entry.name.startsWith('.')) continue;
    const fullPath = path.join(source, entry.name);
    if (appRoot && isInside(fullPath, appRoot)) continue;
    if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) continue;
    const category = categoryFor(entry.name, entry.isDirectory());
    const item = { name: entry.name, path: fullPath, categoryId: category.id, isDirectory: entry.isDirectory(), location: 'pending' };
    pending.push(item);
    lookup[category.id].items.push(item);
    lookup[category.id].pendingCount++;
  }

  if (sharedRoot && path.resolve(sharedRoot) !== source) {
    for (const entry of await getEntries(path.resolve(sharedRoot))) {
      if (entry.name.toLowerCase() === 'desktop.ini' || entry.name.startsWith('.')) continue;
      if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) continue;
      const category = categoryFor(entry.name, entry.isDirectory());
      const item = { name: entry.name, path: path.join(sharedRoot, entry.name), categoryId: category.id, isDirectory: entry.isDirectory(), location: 'shared' };
      shared.push(item);
      lookup[category.id].items.push(item);
      lookup[category.id].sharedCount++;
    }
  }

  for (const category of categories) {
    const entries = await getEntries(path.join(managed, category.folder));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (!entry.isFile() && !entry.isDirectory()) continue;
      category.items.push({ name: entry.name, path: path.join(managed, category.folder, entry.name), categoryId: category.id, isDirectory: entry.isDirectory(), location: 'organized' });
      category.organizedCount++;
    }
    category.items.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }

  pending.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  return { root: source, managed, pending, shared, categories, total: pending.length + shared.length + categories.reduce((sum, category) => sum + category.organizedCount, 0) };
}

async function exists(filePath) {
  try { await fs.lstat(filePath); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function uniqueDestination(folder, name) {
  const extension = path.extname(name);
  const stem = path.basename(name, extension);
  let destination = path.join(folder, name);
  for (let index = 2; await exists(destination); index++) destination = path.join(folder, `${stem} (${index})${extension}`);
  return destination;
}

async function organize(root, appRoot) {
  const snapshot = await scan(root, appRoot);
  const moved = [];
  const errors = [];
  for (const item of snapshot.pending) {
    const category = CATEGORIES.find(entry => entry.id === item.categoryId);
    const folder = path.join(snapshot.managed, category.folder);
    try {
      const stat = await fs.lstat(item.path);
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) continue;
      await fs.mkdir(folder, { recursive: true });
      const destination = await uniqueDestination(folder, item.name);
      await fs.rename(item.path, destination);
      moved.push({ from: item.path, to: destination });
    } catch (error) {
      errors.push({ name: item.name, message: error.message });
    }
  }
  return { root: snapshot.root, moved, errors, timestamp: new Date().toISOString() };
}

async function undo(operation) {
  const restored = [];
  const errors = [];
  if (!operation || !Array.isArray(operation.moved)) return { restored, errors };
  const managed = path.join(operation.root, MANAGED_DIR);
  for (const move of [...operation.moved].reverse()) {
    try {
      if (!isInside(managed, move.to) || !isInside(operation.root, move.from) || isInside(managed, move.from)) throw new Error('文件路径无效');
      if (!(await exists(move.to))) throw new Error('整理后的文件已不存在');
      if (await exists(move.from)) throw new Error('桌面上已有同名文件，未覆盖');
      await fs.rename(move.to, move.from);
      restored.push(move);
    } catch (error) {
      errors.push({ name: path.basename(move.from), message: error.message });
    }
  }
  return { restored, errors };
}

module.exports = { MANAGED_DIR, CATEGORIES, categoryFor, isInside, scan, organize, undo };
