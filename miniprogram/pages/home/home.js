Page({
  openCompressor() { wx.navigateTo({ url: '/pages/compress/compress' }); },
  openResize() { wx.navigateTo({ url: '/pages/resize/resize' }); },
  openPhoto() { wx.navigateTo({ url: '/pages/resize/resize?mode=photo' }); },
  openPdf() { wx.navigateTo({ url: '/pages/pdf/pdf' }); }
});
