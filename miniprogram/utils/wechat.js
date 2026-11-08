function call(name, args) { return new Promise((resolve, reject) => wx[name](Object.assign({}, args, { success: resolve, fail: reject }))); }
const fs = () => wx.getFileSystemManager();
function sizeOf(path) { return new Promise((resolve, reject) => fs().getFileInfo({ filePath: path, success: r => resolve(r.size), fail: reject })); }
function unlink(path) { if (path) fs().unlink({ filePath: path, fail() {} }); }
function formatSize(bytes) { return bytes < 1048576 ? (bytes / 1024).toFixed(1) + ' KB' : (bytes / 1048576).toFixed(2) + ' MB'; }
async function albumPermission() {
  const settings = await call('getSetting');
  if (settings.authSetting['scope.writePhotosAlbum'] === false) {
    const answer = await call('showModal', { title: '允许保存图片', content: '请在设置中开启“保存到相册”，然后再次点击保存。', confirmText: '前往设置' });
    if (answer.confirm) await call('openSetting');
    return false;
  }
  return true;
}
module.exports = { call, sizeOf, unlink, formatSize, albumPermission };
