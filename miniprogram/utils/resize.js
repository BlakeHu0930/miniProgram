// Output dimensions are exact: reject unsupported sizes instead of silently shrinking.
const PHOTO_SIZES = [
  { key: 'inch1', label: '一寸', mm: '25 × 35 mm', width: 295, height: 413 },
  { key: 'inch2', label: '两寸', mm: '35 × 49 mm', width: 413, height: 579 },
  { key: 'small2', label: '小两寸', mm: '35 × 45 mm', width: 413, height: 531 }
];
const RATIOS = [
  { key: 'original', label: '原图', a: 0, b: 0 },
  { key: '3:2', label: '3:2', a: 3, b: 2 },
  { key: '16:9', label: '16:9', a: 16, b: 9 },
  { key: '9:16', label: '9:16', a: 9, b: 16 },
  { key: '1:1', label: '1:1', a: 1, b: 1 }
];
function validateSize(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error('宽度和高度请输入大于 0 的整数像素。');
  if (width > 4096 || height > 4096 || width * height > 8000000) throw new Error('输出最长边不能超过 4096 像素，总像素不能超过 800 万，请调整尺寸。');
  return { width, height };
}
function ratioSize(image, a, b) {
  if (!a || !b) return { width: image.width, height: image.height };
  const unit = Math.max(1, Math.floor(Math.min(image.width / a, image.height / b)));
  return { width: unit * a, height: unit * b };
}
function constrain(frame, image, transform) {
  const base = Math.max(frame.width / image.width, frame.height / image.height);
  const scale = Math.max(base, Math.min(base * 4, transform.scale));
  const width = image.width * scale, height = image.height * scale;
  return { scale, x: Math.max(frame.width - width, Math.min(0, transform.x)), y: Math.max(frame.height - height, Math.min(0, transform.y)) };
}
function centered(frame, image) {
  const scale = Math.max(frame.width / image.width, frame.height / image.height);
  return constrain(frame, image, { scale, x: (frame.width - image.width * scale) / 2, y: (frame.height - image.height * scale) / 2 });
}
function sourceCrop(frame, image, transform) {
  const t = constrain(frame, image, transform);
  const width = Math.min(image.width, frame.width / t.scale), height = Math.min(image.height, frame.height / t.scale);
  return { x: Math.max(0, Math.min(image.width - width, -t.x / t.scale)), y: Math.max(0, Math.min(image.height - height, -t.y / t.scale)), width, height };
}
module.exports = { PHOTO_SIZES, RATIOS, validateSize, ratioSize, constrain, centered, sourceCrop };
