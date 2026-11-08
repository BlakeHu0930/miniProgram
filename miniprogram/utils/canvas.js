const { sizeOf, unlink } = require('./wechat');
function createRenderer(page, original, isCancelled) {
  let canvas, img;
  const temps = [];
  async function initialize() {
    canvas = await new Promise((resolve, reject) => {
      page.createSelectorQuery().select('#compression-canvas').fields({ node: true, size: true }).exec(results => {
        if (!results[0] || !results[0].node) reject(new Error('当前环境不支持 Canvas 2D，请更新微信。'));
        else resolve(results[0].node);
      });
    });
    img = canvas.createImage();
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('图片解码失败，请更换图片。')); img.src = original.path; });
  }
  async function encode(opts) {
    if (isCancelled()) throw new Error('任务已取消');
    if (!canvas) await initialize();
    canvas.width = opts.width; canvas.height = opts.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, opts.width, opts.height);
    if (opts.fileType === 'jpg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, opts.width, opts.height); }
    if (opts.crop) {
      const c = opts.crop;
      ctx.drawImage(img, c.x, c.y, c.width, c.height, 0, 0, opts.width, opts.height);
    } else {
      ctx.drawImage(img, 0, 0, opts.width, opts.height);
    }
    const path = await new Promise((resolve, reject) => wx.canvasToTempFilePath({ canvas, x: 0, y: 0, width: opts.width, height: opts.height, destWidth: opts.width, destHeight: opts.height, fileType: opts.fileType, quality: opts.quality, success: r => resolve(r.tempFilePath), fail: reject }, page));
    temps.push(path);
    const size = await sizeOf(path);
    return { path, size, width: opts.width, height: opts.height, type: opts.fileType };
  }
  function dispose(keepPath) { temps.forEach(p => { if (p !== keepPath && p !== original.path) unlink(p); }); if (canvas) { canvas.width = 1; canvas.height = 1; } img = null; canvas = null; }
  return { encode, dispose };
}
module.exports = { createRenderer };
