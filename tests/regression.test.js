const test = require('node:test');
const assert = require('node:assert/strict');
const { compress, dimensions } = require('../miniprogram/utils/compression');
const { isAnimatedPng } = require('../miniprogram/utils/png');
const original = { path: 'original', size: 2000000, width: 4000, height: 3000, type: 'jpg' };
test('already fitting originals skip encoding', async () => {
 const result = await compress({ ...original, size: 1000 }, { mode: 'target', targetBytes: 204800 }, () => { throw Error('unexpected encoding'); });
 assert.equal(result.keptOriginal, true); assert.equal(result.metTarget, true);
});
test('measured target reached with aspect ratio preserved', async () => {
 const result = await compress(original, { mode: 'target', targetBytes: 204800 }, async opts => ({ ...opts, path: 'encoded', size: Math.ceil(opts.width * opts.height * .08 * opts.quality) }));
 assert(result.size <= 204800); assert.equal(result.metTarget, true); assert(Math.abs(result.width / result.height - 4 / 3) < .02);
});
test('larger outputs retain original', async () => {
 const result = await compress(original, { mode: 'balanced' }, async opts => ({ ...opts, path: 'larger', size: 3000000 })); assert.equal(result.path, 'original');
});
test('unreachable target terminates honestly', async () => {
 let calls = 0;
 const result = await compress(original, { mode: 'target', targetBytes: 1 }, async opts => { calls++; return { ...opts, path: 'encoded', size: 100 }; });
 assert.equal(result.metTarget, false); assert(calls <= 63);
});
test('PNG stays PNG unless conversion explicitly enabled', async () => {
 const types = [];
 await compress({ ...original, type: 'png' }, { mode: 'target', targetBytes: 200000 }, async opts => { types.push(opts.fileType); return { ...opts, path: 'png', size: 100000 }; });
 assert.deepEqual(types, ['png']);
 types.length = 0;
 await compress({ ...original, type: 'png' }, { mode: 'balanced', format: 'jpg' }, async opts => { types.push(opts.fileType); return { ...opts, path: 'jpg', size: 100000 }; });
 assert.deepEqual(types, ['jpg']);
});
test('canvas dimension limits', () => {
 for (const [w, h] of [[8000, 6000], [20000, 100], [20, 10]]) { const d = dimensions(w, h); assert(Math.max(d.width, d.height) <= 4096); assert(d.width * d.height <= 8000000); assert(d.width <= w && d.height <= h); }
});
test('PNG scanner recognizes static and animated PNG and closes files', async () => {
 const fs = require('node:fs'); let closed = 0;
 global.wx = { getFileSystemManager: () => ({
  open(o) { o.success({ fd: fs.openSync(o.filePath, 'r') }); },
  read(o) { const bytesRead = fs.readSync(o.fd, Buffer.from(o.arrayBuffer), o.offset, o.length, o.position); o.success({ bytesRead }); },
  close(o) { fs.closeSync(o.fd); closed++; o.complete(); }
 }) };
 for (const [name, expected] of [['transparent.png', false], ['animated.png', true]]) { const path = __dirname + '/fixtures/' + name; assert.equal(await isAnimatedPng(path, fs.statSync(path).size), expected); }
 assert.equal(closed, 2);
});
let definition;
global.Page = value => { definition = value; };
require('../miniprogram/pages/compress/compress');
function page() { const p = Object.assign({}, definition); p.data = structuredClone(definition.data); p.setData = patch => Object.assign(p.data, patch); p.onLoad(); return p; }
test('nine image limit blocks picker', async () => {
 global.wx = { chooseMedia() { throw Error('picker must not run'); } };
 const p = page(); p.data.items = Array.from({ length: 9 }, () => ({})); await p.choose(); assert.match(p.data.notice, /最多 9/);
});
test('invalid custom target does not start processing', async () => {
 const p = page(); p.data.items = [original]; p.data.useCustom = true; p.data.customKB = '0'; await p.run(); assert.equal(p.data.busy, false); assert.match(p.data.notice, /1—102400/);
});
test('save retries only failed items and records actual successes', async () => {
 let calls = 0;
 global.wx = { getSetting(o) { o.success({ authSetting: { 'scope.writePhotosAlbum': true } }); }, saveImageToPhotosAlbum(o) { calls++; calls === 2 ? o.fail({ errMsg: 'storage full' }) : o.success({}); } };
 const p = page(); p.data.items = [1, 2, 3].map(id => ({ id, saved: false, output: { path: 'synthetic' } }));
 await p.saveAll(); assert.equal(p.data.items.filter(i => i.saved).length, 2); assert.match(p.data.notice, /已保存 2 张，1 张未保存/);
 await p.saveAll(); assert.equal(calls, 4); assert(p.data.items.every(i => i.saved));
});
test('denied album permission never writes images', async () => {
 global.wx = { getSetting(o) { o.success({ authSetting: { 'scope.writePhotosAlbum': false } }); }, showModal(o) { o.success({ confirm: false }); }, saveImageToPhotosAlbum() { throw Error('must not write'); } };
 const p = page(); p.data.items = [{ id: 1, output: { path: 'synthetic' } }]; await p.saveAll(); assert.equal(p.data.saving, false);
});
