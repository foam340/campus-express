function getWindowMetrics() {
  try {
    const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const windowWidth = Math.max(320, Number(info.windowWidth) || 375)
    const windowHeight = Math.max(480, Number(info.windowHeight) || 667)
    const safeBottom = info.safeArea && Number.isFinite(info.safeArea.bottom)
      ? Math.max(0, windowHeight - info.safeArea.bottom)
      : 0
    return { windowWidth, windowHeight, safeBottom }
  } catch (error) {
    return { windowWidth: 375, windowHeight: 667, safeBottom: 0 }
  }
}

function rpxToPx(rpx, windowWidth) {
  const width = Math.max(320, Number(windowWidth) || getWindowMetrics().windowWidth)
  return Math.max(0, Math.round((Number(rpx) || 0) * width / 750))
}

function getListViewport(offsetRpx, horizontalPaddingRpx) {
  const metrics = getWindowMetrics()
  const horizontal = Math.max(0, Number(horizontalPaddingRpx) || 48)
  return {
    width: Math.max(1, metrics.windowWidth - rpxToPx(horizontal, metrics.windowWidth)),
    height: Math.max(240, metrics.windowHeight - rpxToPx(offsetRpx, metrics.windowWidth) - metrics.safeBottom),
    windowWidth: metrics.windowWidth
  }
}

module.exports = { getWindowMetrics, rpxToPx, getListViewport }
