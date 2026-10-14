const config = require('../config/index')
const logger = require('./logger')

let state = {
  user: null,
  settings: null,
  network: { isConnected: true, isWeak: false, networkType: 'unknown' },
  environment: config.name
}
const listeners = new Set()

function getState() { return state }

function setState(patch) {
  if (!patch || typeof patch !== 'object') return state
  const changed = Object.keys(patch).some(key => state[key] !== patch[key])
  if (!changed) return state
  state = Object.assign({}, state, patch)
  listeners.forEach(subscription => {
    try {
      const selected = subscription.selector(state)
      if (!subscription.equals(selected, subscription.current)) {
        subscription.current = selected
        subscription.listener(selected, state)
      }
    } catch (error) {
      logger.warn('state listener failed', error)
    }
  })
  return state
}

function subscribe(listener, selector, equals) {
  if (typeof listener !== 'function') return () => {}
  const select = typeof selector === 'function' ? selector : value => value
  const subscription = {
    listener,
    selector: select,
    equals: typeof equals === 'function' ? equals : Object.is,
    current: select(state)
  }
  listeners.add(subscription)
  return () => listeners.delete(subscription)
}

module.exports = { getState, setState, subscribe }
