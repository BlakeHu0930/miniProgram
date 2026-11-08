// APNG requires acTL before the first IDAT. Walk chunk headers, not image pixels.
async function isAnimatedPng(path, fileSize) {
  const fs = wx.getFileSystemManager();
  const fd = await new Promise((resolve, reject) => fs.open({ filePath: path, flag: 'r', success: r => resolve(r.fd), fail: reject }));
  try {
    let position = 8;
    for (let chunks = 0; chunks < 4096 && position + 8 <= fileSize; chunks++) {
      const buffer = new ArrayBuffer(8);
      const bytes = await new Promise((resolve, reject) => fs.read({ fd, arrayBuffer: buffer, offset: 0, length: 8, position, success: r => resolve(r.bytesRead), fail: reject }));
      if (bytes !== 8) throw new Error('PNG 文件不完整');
      const a = new Uint8Array(buffer);
      const length = new DataView(buffer).getUint32(0, false);
      const type = String.fromCharCode(a[4], a[5], a[6], a[7]);
      if (position + 12 + length > fileSize) throw new Error('PNG 文件结构异常');
      if (type === 'acTL') return true;
      if (type === 'IDAT' || type === 'IEND') return false;
      position += length + 12;
    }
    throw new Error('无法验证 PNG 是否为动图，请更换图片');
  } finally { await new Promise(resolve => fs.close({ fd, complete: resolve })); }
}
module.exports = { isAnimatedPng };
