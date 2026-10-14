const { processPendingRefunds } = require('./payment-refunds')

// 退款重试引擎：每 60 秒扫描一次 pending/retryable 的退款流水，调 XorPay 打款。
// 2026-09-15 起不再自动取消「20:30 无人接单」的 waiting 单（用户拍板：过期单继续挂着，骑手可接、用户可自退）。
// 接单超时取消那段已移除，只保留退款重试——用户取消/管理台取消/未支付超时取消产生的退款仍靠这里周期重试。
async function runRefundSweep() {
  await processPendingRefunds(20)
}

module.exports = { runRefundSweep }
