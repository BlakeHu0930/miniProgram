// Minimal PDF 1.4 writer. JPEG bytes are streamed one page at a time.
function ascii(text) { const bytes = new Uint8Array(text.length); for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i); return bytes; }
function safeName(value) {
  const name = String(value || '').trim().replace(/\.pdf$/i, '').replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, '_').replace(/^\.+|\.+$/g, '').slice(0, 60).trim();
  return (name || '图片合集') + '.pdf';
}
function pageLayout(width, height, mode) {
  if (!(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width <= 4096 && height <= 4096)) throw new Error('图片页面尺寸无效。');
  if (mode === 'image') return { pageWidth: width * .75, pageHeight: height * .75, x: 0, y: 0, width: width * .75, height: height * .75 };
  const pageWidth = 595.2756, pageHeight = 841.8898, margin = 24;
  const scale = Math.min((pageWidth - margin * 2) / width, (pageHeight - margin * 2) / height);
  return { pageWidth, pageHeight, x: (pageWidth - width * scale) / 2, y: (pageHeight - height * scale) / 2, width: width * scale, height: height * scale };
}
function num(n) { return Number(n.toFixed(4)).toString(); }
async function writePdf(count, getPage, emit, mode, isCancelled = () => false) {
  if (!Number.isInteger(count) || count < 1 || count > 9) throw new Error('请选择 1—9 张图片。');
  if (!['a4', 'image'].includes(mode)) throw new Error('请选择有效的页面尺寸。');
  let position = 0;
  const offsets = [0];
  async function put(bytes) {
    if (isCancelled()) throw new Error('任务已取消');
    if (position + bytes.byteLength > 40 * 1048576) throw new Error('PDF 超过 40MB，请减少图片数量或先压缩图片。');
    await emit(bytes); position += bytes.byteLength;
  }
  async function text(value) { await put(ascii(value)); }
  async function object(id, body) { offsets[id] = position; await text(id + ' 0 obj\n' + body + '\nendobj\n'); }
  await text('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  await object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  await object(2, '<< /Type /Pages /Count ' + count + ' /Kids [' + Array.from({ length: count }, (_, i) => (3 + i * 3) + ' 0 R').join(' ') + '] >>');
  for (let i = 0; i < count; i++) {
    let page;
    try {
      if (isCancelled()) throw new Error('任务已取消');
      page = await getPage(i);
      const data = page.bytes instanceof Uint8Array ? page.bytes : new Uint8Array(page.bytes);
      if (data.length < 4 || data[0] !== 255 || data[1] !== 216 || data[data.length - 2] !== 255 || data[data.length - 1] !== 217) throw new Error('第 ' + (i + 1) + ' 张图片编码失败，请更换图片。');
      const l = pageLayout(page.width, page.height, mode), id = 3 + i * 3;
      await object(id, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + num(l.pageWidth) + ' ' + num(l.pageHeight) + '] /Resources << /XObject << /Im0 ' + (id + 2) + ' 0 R >> >> /Contents ' + (id + 1) + ' 0 R >>');
      const content = 'q\n' + [l.width, 0, 0, l.height, l.x, l.y].map(num).join(' ') + ' cm\n/Im0 Do\nQ\n';
      await object(id + 1, '<< /Length ' + content.length + ' >>\nstream\n' + content + 'endstream');
      offsets[id + 2] = position;
      await text((id + 2) + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + page.width + ' /Height ' + page.height + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + data.byteLength + ' >>\nstream\n');
      await put(data);
      await text('\nendstream\nendobj\n');
    } finally { if (page && page.release) page.release(); }
  }
  const start = position, size = 3 + count * 3;
  await text('xref\n0 ' + size + '\n0000000000 65535 f \n' + offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join(''));
  await text('trailer\n<< /Size ' + size + ' /Root 1 0 R >>\nstartxref\n' + start + '\n%%EOF\n');
  return position;
}
module.exports = { safeName, pageLayout, writePdf };
