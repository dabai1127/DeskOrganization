const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { MANAGED_DIR, categoryFor, scan, organize, undo } = require('./organizer');

test('recognizes common desktop file types', () => {
  assert.equal(categoryFor('报告.PDF', false).id, 'documents');
  assert.equal(categoryFor('照片.JPG', false).id, 'images');
  assert.equal(categoryFor('项目', true).id, 'folders');
  assert.equal(categoryFor('未知.foo', false).id, 'others');
});

test('previews, sorts, resolves name conflicts, and restores files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'liang-yiliang-test-'));
  try {
    await fs.writeFile(path.join(root, '报告.pdf'), 'new');
    await fs.writeFile(path.join(root, '照片.jpg'), 'image');
    await fs.mkdir(path.join(root, '旧文件夹'));
    await fs.mkdir(path.join(root, MANAGED_DIR, '文档资料'), { recursive: true });
    await fs.writeFile(path.join(root, MANAGED_DIR, '文档资料', '报告.pdf'), 'old');
    const before = await scan(root);
    assert.equal(before.pending.length, 3);
    assert.equal(before.categories.find(category => category.id === 'documents').organizedCount, 1);

    const result = await organize(root);
    assert.equal(result.errors.length, 0);
    assert.equal(result.moved.length, 3);
    assert.equal(await fs.readFile(path.join(root, MANAGED_DIR, '文档资料', '报告.pdf'), 'utf8'), 'old');
    assert.equal(await fs.readFile(path.join(root, MANAGED_DIR, '文档资料', '报告 (2).pdf'), 'utf8'), 'new');
    assert.equal((await scan(root)).pending.length, 0);

    const reversed = await undo(result);
    assert.equal(reversed.errors.length, 0);
    assert.equal(reversed.restored.length, 3);
    assert.equal((await scan(root)).pending.length, 3);
  } finally {
    const absolute = path.resolve(root);
    if (!absolute.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected test directory');
    await fs.rm(absolute, { recursive: true, force: true });
  }
});

test('undo never overwrites a new file at the original path', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'liang-yiliang-test-'));
  try {
    await fs.writeFile(path.join(root, 'notes.txt'), 'original');
    const operation = await organize(root);
    await fs.writeFile(path.join(root, 'notes.txt'), 'replacement');
    const result = await undo(operation);
    assert.equal(result.restored.length, 0);
    assert.equal(result.errors.length, 1);
    assert.equal(await fs.readFile(path.join(root, 'notes.txt'), 'utf8'), 'replacement');
    assert.equal(await fs.readFile(path.join(root, MANAGED_DIR, '文档资料', 'notes.txt'), 'utf8'), 'original');
  } finally {
    const absolute = path.resolve(root);
    if (!absolute.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected test directory');
    await fs.rm(absolute, { recursive: true, force: true });
  }
});

test('shows public desktop shortcuts without moving them for every Windows user', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'liang-yiliang-test-'));
  const personal = path.join(base, 'personal');
  const shared = path.join(base, 'public');
  try {
    await fs.mkdir(personal);
    await fs.mkdir(shared);
    await fs.writeFile(path.join(personal, '笔记.txt'), 'personal');
    await fs.writeFile(path.join(shared, '应用.lnk'), 'public');
    const before = await scan(personal, null, shared);
    assert.equal(before.pending.length, 1);
    assert.equal(before.shared.length, 1);
    assert.equal(before.categories.find(category => category.id === 'shortcuts').sharedCount, 1);
    const result = await organize(personal);
    assert.equal(result.moved.length, 1);
    assert.equal(await fs.readFile(path.join(shared, '应用.lnk'), 'utf8'), 'public');
  } finally {
    const absolute = path.resolve(base);
    if (!absolute.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected test directory');
    await fs.rm(absolute, { recursive: true, force: true });
  }
});
