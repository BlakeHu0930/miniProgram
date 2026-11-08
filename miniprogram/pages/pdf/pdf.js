const { call, sizeOf, unlink, formatSize } = require('../../utils/wechat');
const { createRenderer } = require('../../utils/canvas');
const { isAnimatedPng } = require('../../utils/png');
const { writePdf, safeName } = require('../../utils/pdf');
function fsCall(name, options) { return new Promise((resolve, reject) => wx.getFileSystemManager()[name](Object.assign({}, options, { success: resolve, fail: reject }))); }
Page({
  data: { items: [], mode: 'a4', filename: '图片合集', choosing: false, busy: false, opening: false, sharing: false, notice: '', progress: '', output: null, stage: 'settings' },
  onLoad() { this._alive = true; this._seq = 0; },
  onUnload() { this._alive = false; this.clearOutput(); if (this._dir) fsCall('rmdir', { dirPath: this._dir, recursive: true }).catch(() => {}); },
  update(patch) { if (this._alive) this.setData(patch); },
  blocked() { return this.data.busy || this.data.choosing || this.data.opening || this.data.sharing; },
  clearOutput() { if (this.data.output) unlink(this.data.output.path); },
  invalidate() { this.clearOutput(); this.update({ output: null, stage: 'settings', notice: '' }); },
  async choose() {
    if (this.blocked()) return;
    const count = 9 - this.data.items.length;
    if (!count) { this.update({ notice: '每份 PDF 最多 9 张，请先移除图片。' }); return; }
    this.update({ choosing: true, notice: '' });
    try {
      const selected = await call('chooseMedia', { count, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['original'] });
      const added = [], errors = [];
      for (const file of selected.tempFiles.slice(0, count)) {
        try {
          const path = file.tempFilePath, size = file.size || await sizeOf(path);
          if (size > 30 * 1048576) throw new Error('单张图片不能超过 30MB');
          const info = await call('getImageInfo', { src: path });
          const type = String(info.type || '').toLowerCase();
          if (!['jpg', 'jpeg', 'png'].includes(type)) throw new Error('仅支持 JPG、PNG 静态图片');
          if (type === 'png' && await isAnimatedPng(path, size)) throw new Error('不支持 APNG 动图');
          if (info.width * info.height > 40000000) throw new Error('图片不能超过 4000 万像素');
          added.push({ id: ++this._seq, path, width: info.width, height: info.height, sizeText: formatSize(size) });
        } catch (error) { errors.push(error.message || '图片读取失败'); }
      }
      if (!this._alive) return;
      if (added.length) this.invalidate();
      this.update({ items: this.data.items.concat(added), notice: errors.length ? errors.length + ' 张未添加：' + errors.join('；') : '' });
    } catch (error) {
      if (!/cancel/i.test(error.errMsg || '')) this.update({ notice: error.errno === 112 || /privacy agreement/i.test(error.errMsg || '') ? '请先在小程序后台的隐私保护指引中声明“选中的照片或视频信息”，更新后重新编译。' : '无法选择图片，请稍后重试。' });
    } finally { this.update({ choosing: false }); }
  },
  move(e) {
    if (this.blocked()) return;
    const index = this.data.items.findIndex(item => item.id === Number(e.currentTarget.dataset.id));
    const target = index + Number(e.currentTarget.dataset.step);
    if (index < 0 || target < 0 || target >= this.data.items.length) return;
    const items = this.data.items.slice(); [items[index], items[target]] = [items[target], items[index]];
    this.invalidate(); this.update({ items });
  },
  remove(e) { if (!this.blocked()) { this.invalidate(); this.update({ items: this.data.items.filter(item => item.id !== Number(e.currentTarget.dataset.id)) }); } },
  previewImage(e) { const item = this.data.items.find(i => i.id === Number(e.currentTarget.dataset.id)); if (item) wx.previewImage({ current: item.path, urls: this.data.items.map(i => i.path) }); },
  setMode(e) { if (!this.blocked()) { this.invalidate(); this.update({ mode: e.currentTarget.dataset.mode }); } },
  nameInput(e) { if (!this.blocked()) { this.invalidate(); this.update({ filename: e.detail.value }); } },
  async generate() {
    if (this.blocked()) return;
    if (!this.data.items.length) { this.update({ notice: '请先选择图片。' }); return; }
    const filename = safeName(this.data.filename), items = this.data.items.slice(), mode = this.data.mode;
    this.update({ busy: true, notice: '', progress: '准备生成…' });
    let path;
    try {
      if (!this._dir) {
        this._dir = wx.env.USER_DATA_PATH + '/sds-pdf-' + Date.now() + '-' + Math.floor(Math.random() * 1000000);
      }
      await fsCall('access', { path: this._dir }).catch(() => fsCall('mkdir', { dirPath: this._dir, recursive: true }));
      path = this._dir + '/' + filename;
      this.clearOutput(); this.update({ output: null });
      let first = true;
      const bytes = await writePdf(items.length, async index => {
        this.update({ progress: '正在生成第 ' + (index + 1) + '／' + items.length + ' 页' });
        const item = items[index];
        const scale = Math.min(1, 2048 / Math.max(item.width, item.height), Math.sqrt(3000000 / (item.width * item.height)));
        const renderer = createRenderer(this, item, () => !this._alive);
        try {
          const encoded = await renderer.encode({ width: Math.max(1, Math.round(item.width * scale)), height: Math.max(1, Math.round(item.height * scale)), fileType: 'jpg', quality: .9 });
          const result = await fsCall('readFile', { filePath: encoded.path });
          return { bytes: result.data, width: encoded.width, height: encoded.height, release: () => renderer.dispose() };
        } catch (error) { renderer.dispose(); throw new Error('第 ' + (index + 1) + ' 张处理失败，请重试或更换图片。'); }
      }, async data => {
        const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        await fsCall(first ? 'writeFile' : 'appendFile', { filePath: path, data: buffer }); first = false;
      }, mode, () => !this._alive);
      if (!this._alive) { unlink(path); return; }
      this.update({ output: { path, filename, pages: items.length, sizeText: formatSize(bytes), modeText: mode === 'a4' ? 'A4 · 完整显示' : '跟随图片尺寸' }, stage: 'result', filename: filename.replace(/\.pdf$/i, ''), progress: '' });
      wx.pageScrollTo({ scrollTop: 0, duration: 200 });
    } catch (error) {
      if (path) unlink(path);
      this.update({ notice: error.message || 'PDF 生成失败，请检查存储空间后重试。', progress: '' });
    } finally { this.update({ busy: false }); }
  },
  async open() {
    if (this.blocked() || !this.data.output) return;
    this.update({ opening: true, notice: '' });
    try { await call('openDocument', { filePath: this.data.output.path, fileType: 'pdf', showMenu: true }); }
    catch (_) { this.update({ notice: '无法打开预览，请尝试分享 PDF，或在手机微信中打开。' }); }
    finally { this.update({ opening: false }); }
  },
  async share() {
    if (this.blocked() || !this.data.output) return;
    if (typeof wx.shareFileMessage !== 'function') { await this.open(); this.update({ notice: '当前微信不支持直接分享，请在 PDF 预览右上角菜单中操作。' }); return; }
    this.update({ sharing: true, notice: '' });
    try { await call('shareFileMessage', { filePath: this.data.output.path, fileName: this.data.output.filename }); }
    catch (error) { if (!/cancel/i.test(error.errMsg || '')) this.update({ notice: '未能分享，请尝试在 PDF 预览右上角菜单中操作。' }); }
    finally { this.update({ sharing: false }); }
  },
  editAgain() { if (!this.blocked()) this.update({ stage: 'settings', notice: '' }); }
});
