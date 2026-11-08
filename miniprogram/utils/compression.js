// Policy only: encode({width,height,quality,fileType}) supplies measured files.
function dimensions(width, height) {
  const ratio = Math.min(1, 4096 / Math.max(width, height), Math.sqrt(8000000 / (width * height)));
  return { width: Math.max(1, Math.floor(width * ratio)), height: Math.max(1, Math.floor(height * ratio)) };
}
async function compress(original, options, encode) {
  const target = options.mode === 'target' ? options.targetBytes : null;
  if (target && original.size <= target) return Object.assign({}, original, { metTarget: true, keptOriginal: true });
  let best = original;
  let d = dimensions(original.width, original.height);
  const fileType = options.format === 'jpg' ? 'jpg' : original.type === 'png' ? 'png' : 'jpg';
  for (let pass = 0; pass < 9; pass++) {
    let low = .15, high = .92;
    let fitting = null, smallest = null;
    const rounds = fileType === 'png' || !target ? 1 : 7;
    for (let round = 0; round < rounds; round++) {
      const quality = !target ? .78 : round === 0 ? high : round === 1 ? low : (low + high) / 2;
      const output = await encode({ width: d.width, height: d.height, quality, fileType });
      if (!smallest || output.size < smallest.size) smallest = output;
      if (output.size < best.size) best = output;
      if (target && output.size <= target) {
        if (!fitting || quality > fitting.quality) fitting = Object.assign({}, output, { quality });
        low = quality;
        if (round === 0 || fileType === 'png') break;
      } else { high = quality; }
      // Second sample must be the lower bound; remaining samples bisect.
      if (round === 0 && rounds > 1) { low = .15; high = .92; }
      if (round === 1) { if (output.size <= target) high = .92; }
    }
    if (fitting) { best = fitting.size < original.size ? fitting : original; break; }
    if (!target) break;
    const ratio = Math.min(.82, Math.sqrt(target / smallest.size) * .92);
    const next = { width: Math.max(1, Math.floor(d.width * ratio)), height: Math.max(1, Math.floor(d.height * ratio)) };
    if (next.width === d.width && next.height === d.height) break;
    d = next;
  }
  return Object.assign({}, best, { metTarget: target ? best.size <= target : null, keptOriginal: best.path === original.path });
}
module.exports = { compress, dimensions };
