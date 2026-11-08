const { call, sizeOf, unlink, formatSize, albumPermission } = require('../../utils/wechat');
const { createRenderer } = require('../../utils/canvas');
const { isAnimatedPng } = require('../../utils/png');
const { PHOTO_SIZES, RATIOS, validateSize, ratioSize, centered, constrain, sourceCrop } = require('../../utils/resize');
function touches(event) {
  return Array.from(event.touches || []).map(t => ({ x: t.clientX, y: t.clientY }));
}
function midpoint(points) { return points.length > 1 ? { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 } : points[0]; }
function distance(points) { return points.length > 1 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : 0; }
Page({
  data: {
    photos: PHOTO_SIZES, ratios: RATIOS, mode: 'custom', preset: '', ratioKey: 'original',
    image: null, width: '', height: '', locked: true, choosing: false, busy: false, saving: false,
    notice: '', output: null, saved: false, frameW: 500, frameH: 400, imageStyle: '', zoom: 100,
    mm: '', cropReady: false, stage: 'settings', scaleOptions: [25, 50, 75, 100]
  },
  onLoad(options) {
    this._alive = true;
    this._frameVersion = 0;
    this._scrollTop = 0;
    if (options && options.preset) this.applyPreset(options.preset);
    else if (options && options.mode === 'photo') this.applyPreset('inch1');
  },
  onPageScroll(e) { this._scrollTop = e.scrollTop; },
  onUnload() { this._alive = false; this._frameVersion++; this.clearOutput(); },
  update(patch, callback) { if (this._alive) this.setData(patch, callback); },
  clearOutput() { if (this.data.output) unlink(this.data.output.path); },
  invalidate() { this.clearOutput(); this.update({ output: null, saved: false, notice: '', stage: 'settings' }); },
  blocked() { return this.data.busy || this.data.saving || this.data.choosing; },
  async choose() {
    if (this.blocked()) return;
    this.update({ choosing: true, notice: '' });
    try {
      const result = await call('chooseMedia', { count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['original'] });
      const file = result.tempFiles[0];
      if (!file) return;
      const path = file.tempFilePath, size = file.size || await sizeOf(path);
      if (size > 30 * 1048576) throw new Error('请选择不超过 30MB 的图片。');
      const info = await call('getImageInfo', { src: path });
      const type = String(info.type || '').toLowerCase();
      if (!['jpg', 'jpeg', 'png'].includes(type)) throw new Error('仅支持 JPG、PNG 静态图片。');
      if (type === 'png' && await isAnimatedPng(path, size)) throw new Error('暂不支持 APNG 动图。');
      if (info.width * info.height > 40000000) throw new Error('原图不能超过 4000 万像素。');
      if (!this._alive) return;
      this.invalidate();
      this.update({ image: { path, width: info.width, height: info.height, type: type === 'jpeg' ? 'jpg' : type, sizeText: formatSize(size) } }, () => {
        if (this.data.mode === 'photo') this.applyPreset(this.data.preset);
        else if (this.data.mode === 'ratio') this.applyRatio(this.data.ratioKey);
        else { this._lockRatio = info.width / info.height; this.update({ width: String(info.width), height: String(info.height) }); this.setupFrame(); }
      });
    } catch (error) {
      if (!/cancel/i.test(error.errMsg || '')) this.update({ notice: error.errno === 112 || /privacy agreement/i.test(error.errMsg || '') ? '请先在小程序后台的隐私保护指引中声明“选中的照片或视频信息”，更新后重新编译。' : error.message || '无法选择图片，请稍后重试。' });
    } finally { this.update({ choosing: false }); }
  },
  selectMode(e) {
    if (this.blocked()) return;
    const mode = e.currentTarget.dataset.mode;
    this.invalidate();
    if (mode !== 'photo') wx.setNavigationBarTitle({ title: '调整图片大小' });
    if (mode === 'photo') this.applyPreset(this.data.preset || 'inch1');
    else if (mode === 'ratio') this.applyRatio(this.data.ratioKey);
    else {
      this.update({ mode: 'custom', mm: '' });
      const image = this.data.image;
      if (image) { this._lockRatio = image.width / image.height; this.update({ width: String(image.width), height: String(image.height), locked: true }); }
      this.setupFrame();
    }
  },
  selectPreset(e) { if (!this.blocked()) { this.invalidate(); this.applyPreset(e.currentTarget.dataset.key); } },
  applyPreset(key) {
    const item = PHOTO_SIZES.find(p => p.key === key) || PHOTO_SIZES[0];
    this.update({ mode: 'photo', preset: item.key, mm: item.mm, width: String(item.width), height: String(item.height) });
    wx.setNavigationBarTitle({ title: '证件照尺寸' });
    this.setupFrame();
  },
  selectRatio(e) { if (!this.blocked()) { this.invalidate(); this.applyRatio(e.currentTarget.dataset.key); } },
  applyRatio(key) {
    const ratio = RATIOS.find(r => r.key === key) || RATIOS[0];
    const size = this.data.image ? ratioSize(this.data.image, ratio.a, ratio.b) : null;
    this._lockRatio = ratio.a ? ratio.a / ratio.b : this.data.image ? this.data.image.width / this.data.image.height : 1;
    this.update(Object.assign({ mode: 'ratio', ratioKey: ratio.key, mm: '' }, size ? { width: String(size.width), height: String(size.height) } : {}));
    this.setupFrame();
  },
  inputSize(e) {
    if (this.blocked() || this.data.mode === 'photo') return;
    const field = e.currentTarget.dataset.field, value = e.detail.value;
    this.invalidate();
    const patch = { [field]: value };
    const n = Number(value), ratio = this._lockRatio || 1;
    if ((this.data.mode === 'ratio' || this.data.locked) && Number.isInteger(n) && n > 0) patch[field === 'width' ? 'height' : 'width'] = String(Math.max(1, Math.round(field === 'width' ? n / ratio : n * ratio)));
    this.update(patch);
    this.setupFrame();
  },
  toggleLock(e) {
    if (this.blocked()) return;
    this.invalidate();
    const w = Number(this.data.width), h = Number(this.data.height);
    this._lockRatio = w > 0 && h > 0 ? w / h : this.data.image ? this.data.image.width / this.data.image.height : 1;
    this.update({ locked: e.detail.value });
  },
  quickScale(e) {
    if (this.blocked() || !this.data.image) return;
    this.invalidate();
    const image = this.data.image, factor = Number(e.currentTarget.dataset.percent) / 100;
    this._lockRatio = image.width / image.height;
    this.update({ mode: 'custom', locked: true, mm: '', width: String(Math.max(1, Math.round(image.width * factor))), height: String(Math.max(1, Math.round(image.height * factor))) });
    this.setupFrame();
  },
  setupFrame() {
    const version = ++this._frameVersion;
    this.update({ cropReady: false });
    if (!this.data.image) return;
    const w = Number(this.data.width), h = Number(this.data.height);
    if (!(w > 0 && h > 0)) return;
    const ratio = w / h;
    const frameW = Math.min(560, 500 * ratio), frameH = frameW / ratio;
    this.update({ frameW, frameH }, () => {
      wx.nextTick(() => {
        if (!this._alive || version !== this._frameVersion) return;
        this.createSelectorQuery().select('.crop-window').boundingClientRect(rect => {
          if (!this._alive || version !== this._frameVersion || !rect || !rect.width || !rect.height) return;
          this._frame = { width: rect.width, height: rect.height, left: rect.left, top: rect.top, documentTop: rect.top + this._scrollTop };
          this._transform = centered(this._frame, this.data.image);
          this.renderTransform();
          this.update({ cropReady: true, zoom: 100 });
        }).exec();
      });
    });
  },
  renderTransform() {
    if (!this._transform || !this.data.image) return;
    const t = this._transform, image = this.data.image;
    this.update({ imageStyle: 'width:' + image.width * t.scale + 'px;height:' + image.height * t.scale + 'px;left:' + t.x + 'px;top:' + t.y + 'px;' });
  },
  touchStart(e) {
    if (this.blocked() || !this.data.cropReady || this.data.mode === 'custom') return;
    const points = touches(e);
    if (!points.length) return;
    this._frame.top = this._frame.documentTop - this._scrollTop;
    this._gesture = { points, t: Object.assign({}, this._transform) };
  },
  touchMove(e) {
    if (!this._gesture || this.blocked()) return;
    const points = touches(e), g = this._gesture;
    if (!points.length) return;
    if (points.length !== g.points.length) { this.touchStart(e); return; }
    this.invalidate();
    const start = midpoint(g.points), current = midpoint(points);
    const oldDistance = distance(g.points), newDistance = distance(points);
    const base = centered(this._frame, this.data.image).scale;
    const scale = Math.max(base, Math.min(base * 4, oldDistance > 0 ? g.t.scale * newDistance / oldDistance : g.t.scale));
    const factor = scale / g.t.scale;
    this._transform = constrain(this._frame, this.data.image, {
      scale,
      x: current.x - this._frame.left - (start.x - this._frame.left - g.t.x) * factor,
      y: current.y - this._frame.top - (start.y - this._frame.top - g.t.y) * factor
    });
    this.update({ zoom: Math.round(scale / base * 100) });
    this.renderTransform();
  },
  touchEnd(e) { this._gesture = null; if (e.touches && e.touches.length) this.touchStart(e); },
  changeZoom(e) {
    if (this.blocked() || !this.data.cropReady) return;
    this.invalidate();
    const frame = this._frame, image = this.data.image, old = this._transform;
    const scale = centered(frame, image).scale * Number(e.detail.value) / 100, factor = scale / old.scale;
    this._transform = constrain(frame, image, { scale, x: frame.width / 2 - (frame.width / 2 - old.x) * factor, y: frame.height / 2 - (frame.height / 2 - old.y) * factor });
    this.update({ zoom: Number(e.detail.value) }); this.renderTransform();
  },
  resetCrop() { if (!this.blocked()) { this.invalidate(); this.setupFrame(); } },
  async generate() {
    if (this.blocked()) return;
    let renderer, output;
    try {
      if (!this.data.image) throw new Error('请先选择图片。');
      const dimensions = validateSize(Number(this.data.width), Number(this.data.height));
      const cropMode = this.data.mode !== 'custom';
      if (cropMode && !this.data.cropReady) throw new Error('请等待预览加载完成。');
      const crop = cropMode ? sourceCrop(this._frame, this.data.image, this._transform) : null;
      this.update({ busy: true, notice: '' });
      renderer = createRenderer(this, this.data.image, () => !this._alive);
      output = await renderer.encode(Object.assign({}, dimensions, { fileType: this.data.image.type, quality: .95, crop }));
      if (!this._alive) return;
      this.clearOutput();
      this.update({ output: Object.assign({}, output, { sizeText: formatSize(output.size) }), saved: false, stage: 'result' });
      wx.pageScrollTo({ scrollTop: 0, duration: 200 });
    } catch (error) { this.update({ notice: error.message || '图片处理失败，请重试或换一张图片。' }); }
    finally { if (renderer) renderer.dispose(output && this._alive ? output.path : null); this.update({ busy: false }); }
  },
  editAgain() { if (!this.blocked()) { this.update({ stage: 'settings' }, () => this.setupFrame()); } },
  preview() { if (this.data.output) wx.previewImage({ urls: [this.data.output.path] }); },
  async save() {
    if (this.blocked() || !this.data.output) return;
    this.update({ saving: true, notice: '' });
    try {
      if (!await albumPermission()) return;
      await call('saveImageToPhotosAlbum', { filePath: this.data.output.path });
      this.update({ saved: true, notice: '已保存到相册。' });
    } catch (_) { this.update({ notice: '保存失败，请检查相册权限或存储空间后重试。' }); }
    finally { this.update({ saving: false }); }
  }
});
