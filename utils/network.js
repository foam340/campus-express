const state = require('./state')
const logger = require('./logger')

let started = false
let handler = null

function updateNetwork(networkType, isConnected) {
  const type = networkType || 'unknown'
  state.setState({
    network: {
      networkType: type,
      isConnected: isConnected !== false && type !== 'none',
      isWeak: ['2g', '3g'].includes(String(type).toLowerCase())
    }
  })
}

function initNetworkMonitoring() {
  if (started) return
  started = true
  wx.getNetworkType({
    success: result => updateNetwork(result.networkType, result.networkType !== 'none'),
    fail: error => logger.warn('getNetworkType failed', error)
  })
  handler = result => updateNetwork(result.networkType, result.isConnected)
  wx.onNetworkStatusChange(handler)
}

function stopNetworkMonitoring() {
  if (!started) return
  if (handler && wx.offNetworkStatusChange) wx.offNetworkStatusChange(handler)
  handler = null
  started = false
}

function isOnline() { return state.getState().network.isConnected !== false }

module.exports = { initNetworkMonitoring, stopNetworkMonitoring, isOnline }
