const { compress } = require('../../utils/compression');
const { call, sizeOf, unlink, formatSize, albumPermission } = require('../../utils/wechat');
const { createRenderer } = require('../../utils/canvas');
const { isAnimatedPng } = require('../../utils/png');
Page({
  data: { items: [], mode: 'target', targetKB: 500, customKB: '', useCustom: false, convertJpg: false, advanced: false, busy: false, saving: false, choosing: false, stage: 'settings', progress: '', notice: '', totalBefore: '0 KB', totalAfter: '0 KB', reduction: '0', successCount: 0 },
  onLoad() { this._alive = true; this._seq = 0; },
  onUnload() { this._alive = false; this.data.items.forEach(item => this.release(item)); },
  update(patch) { if (this._alive) this.setData(patch); },
  release(item) { if (item.output && item.output.path !== item.path) unlink(item.output.path); },
  async choose() {
    if (this.data.busy || this.data.saving || this.data.choosing) return;
    const remaining = 9 - this.data.items.length;
    if (!remaining) { this.update({ notice: '每批最多 9 张，请先移除部分图片。' }); return; }
    this.update({ choosing: true, notice: '' });
    try {
      const result = await call('chooseMedia', { count: remaining, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['original'] });
      const added = [], errors = [];
      for (const file of result.tempFiles.slice(0, remaining)) {
        try {
          const path = file.tempFilePath;
          const size = file.size || await sizeOf(path);
          if (size > 30 * 1048576) throw new Error('单张图片不能超过 30MB');
          const info = await call('getImageInfo', { src: path });
          const type = String(info.type || '').toLowerCase();
          if (!['jpg', 'jpeg', 'png'].includes(type)) throw new Error(type === 'gif' ? '暂不支持 GIF 动图' : '暂仅支持 JPG、PNG，请先转换格式');
          if (type === 'png' && await isAnimatedPng(path, size)) throw new Error('暂不支持 APNG 动图');
          if (info.width * info.height > 40000000) throw new Error('图片超过 4000 万像素，请先缩小尺寸');
          added.push({ id: ++this._seq, path, size, type, width: info.width, height: info.height, sizeText: formatSize(size), dimensionsText: info.width + ' × ' + info.height, status: 'ready', output: null, saved: false });
        } catch (error) { errors.push(error.message || '图片读取失败'); }
      }
      this.update({ items: this.data.items.concat(added), notice: errors.length ? '有 ' + errors.length + ' 张未添加：' + errors.join('；') : '' });
    } catch (error) { if (!/cancel/i.test(error.errMsg || '')) this.update({ notice: error.errno === 112 || /privacy agreement/i.test(error.errMsg || '') ? '当前版本尚未完成图片选择接口的隐私声明，请联系开发者配置后重试。' : '无法选择图片，请稍后重试。' }); }
    finally { this.update({ choosing: false }); }
  },
  remove(e) { if (this.data.busy || this.data.saving || this.data.choosing) return; const id = Number(e.currentTarget.dataset.id); const item = this.data.items.find(i => i.id === id); if (item) this.release(item); this.update({ items: this.data.items.filter(i => i.id !== id) }); this.summarize(); },
  setMode(e) { if (!this.data.busy) this.update({ mode: e.currentTarget.dataset.mode, notice: '' }); },
  setTarget(e) { if (!this.data.busy) this.update({ targetKB: Number(e.currentTarget.dataset.size), useCustom: false, customKB: '' }); },
  customInput(e) { this.update({ customKB: e.detail.value, useCustom: true }); },
  toggleAdvanced() { this.update({ advanced: !this.data.advanced }); },
  async toggleJpg(e) {
    if (!e.detail.value) { this.update({ convertJpg: false }); return; }
    const answer = await call('showModal', { title: '允许转成 JPG？', content: 'PNG 的透明区域会变成白色。图片本来就符合要求或转换后更大时，仍保留原图。', confirmText: '允许转换' });
    this.update({ convertJpg: answer.confirm });
  },
  async run() { await this.process(false); },
  async retry() { await this.process(true); },
  async process(onlyFailed) {
    if (this.data.busy || this.data.saving || this.data.choosing) return;
    if (!this.data.items.length) { this.update({ notice: '请先选择图片。' }); return; }
    const kb = this.data.useCustom ? Number(this.data.customKB) : this.data.targetKB;
    if (this.data.mode === 'target' && (!Number.isFinite(kb) || kb < 1 || kb > 102400 || !Number.isInteger(kb))) { this.update({ notice: '请输入 1—102400 之间的整数 KB。' }); return; }
    const options = { mode: this.data.mode, targetBytes: kb * 1024, format: this.data.convertJpg ? 'jpg' : 'auto' };
    const items = this.data.items.slice();
    const indices = items.map((item, i) => i).filter(i => !onlyFailed || items[i].status === 'failed');
    if (!indices.length) return;
    this.update({ busy: true, notice: '', stage: 'results' });
    for (let count = 0; count < indices.length; count++) {
      if (!this._alive) break;
      const index = indices[count], original = items[index];
      this.release(original);
      items[index] = Object.assign({}, original, { output: null, status: 'processing', saved: false, error: '' });
      this.update({ items: items.slice(), progress: '正在处理第 ' + (count + 1) + '／' + indices.length + ' 张' });
      const renderer = createRenderer(this, original, () => !this._alive);
      let output;
      try {
        output = await compress(original, options, renderer.encode);
        if (!this._alive) { renderer.dispose(); break; }
        const statusText = output.keptOriginal ? (this.data.mode === 'target' && original.size <= options.targetBytes ? '原图已符合要求' : '无需压缩，保留原图') : output.metTarget === false ? '未达标，可调整设置' : this.data.mode === 'target' ? '已达到目标大小' : '均衡压缩完成';
        items[index] = Object.assign({}, items[index], { output, status: 'done', statusText, outputSize: formatSize(output.size), outputDimensions: output.width + ' × ' + output.height, unmet: output.metTarget === false });
      } catch (error) {
        items[index] = Object.assign({}, items[index], { status: 'failed', error: error.message || '图片处理失败，请重试或更换图片。' });
      } finally { renderer.dispose(output && this._alive ? output.path : null); }
      this.update({ items: items.slice() });
      this.summarize();
    }
    this.update({ busy: false, progress: '' });
  },
  summarize() {
    const done = this.data.items.filter(i => i.status === 'done');
    const before = done.reduce((sum, i) => sum + i.size, 0);
    const after = done.reduce((sum, i) => sum + i.output.size, 0);
    this.update({ successCount: done.length, totalBefore: formatSize(before), totalAfter: formatSize(after), reduction: before ? Math.max(0, (1 - after / before) * 100).toFixed(0) : '0' });
  },
  adjust() { if (!this.data.busy && !this.data.saving) this.update({ stage: 'settings', notice: '' }); },
  async preview(e) {
    const item = this.data.items.find(i => i.id === Number(e.currentTarget.dataset.id));
    if (!item) return;
    if (!item.output || item.output.path === item.path) { wx.previewImage({ urls: [item.path] }); return; }
    try { const choice = await call('showActionSheet', { itemList: ['查看原图 · ' + item.sizeText, '查看输出图 · ' + item.outputSize] }); wx.previewImage({ current: choice.tapIndex === 0 ? item.path : item.output.path, urls: [item.path, item.output.path] }); } catch (_) {}
  },
  async saveOne(e) { await this.save([Number(e.currentTarget.dataset.id)]); },
  async saveAll() { await this.save(this.data.items.filter(i => i.output && !i.saved).map(i => i.id)); },
  async save(ids) {
    if (this.data.busy || this.data.saving || !ids.length) return;
    this.update({ saving: true, notice: '' });
    let successes = 0, failures = 0;
    try {
      if (!await albumPermission()) return;
      for (const id of ids) {
        if (!this._alive) break;
        const item = this.data.items.find(i => i.id === id && i.output);
        if (!item) continue;
        try {
          await call('saveImageToPhotosAlbum', { filePath: item.output.path });
          successes++;
          this.update({ items: this.data.items.map(i => i.id === id ? Object.assign({}, i, { saved: true }) : i) });
        } catch (error) {
          failures++;
          if (/auth|deny|denied|cancel/i.test(error.errMsg || '')) { failures += ids.length - successes - failures; break; }
        }
      }
      this.update({ notice: '已保存 ' + successes + ' 张' + (failures ? '，' + failures + ' 张未保存。请检查相册权限或存储空间后重试。' : '。') });
    } catch (_) { this.update({ notice: '无法读取相册权限，请稍后重试。' }); }
    finally { this.update({ saving: false }); }
  },
  privacyInfo() { wx.showModal({ title: '本地处理与使用说明', content: '本工具不上传图片、不要求登录。处理生成临时文件，退出页面会清理输出。为控制内存，输出最长边不超过4096像素且不超过800万像素；PNG保留透明时可能需要较大幅度缩小。保存的照片由你自行管理。', showCancel: false }); }
});
