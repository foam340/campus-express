const { reportError } = require('./errors')

function serializeList(list) {
  try { return JSON.stringify(Array.isArray(list) ? list : []) } catch (error) { return '' }
}

function sameValue(left, right) {
  if (left === right) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  try { return JSON.stringify(left) === JSON.stringify(right) } catch (error) { return false }
}

function createRecycleList(options) {
  const source = options && typeof options === 'object' ? options : {}
  const page = source.page
  if (!page || !source.id || !source.dataKey) return null

  let createRecycleContext
  try {
    createRecycleContext = require('../miniprogram_npm/miniprogram-recycle-view/index')
  } catch (error) {
    reportError(error, 'recycle-list:load', { userMessage: '列表组件加载失败，请重新进入页面' })
    return null
  }

  const context = createRecycleContext({
    id: source.id,
    dataKey: source.dataKey,
    page,
    // 函数式 itemSize 逐项返回 {width,height}，用于变高行；不传则退回固定宽高
    itemSize: typeof source.itemSize === 'function' ? source.itemSize : {
      width: Math.max(1, Number(source.width) || 1),
      height: Math.max(1, Number(source.itemHeight) || 1)
    }
  })

  if (typeof page.$addUnloadDisposer === 'function') {
    page.$addUnloadDisposer(() => context.destroy())
  }
  return context
}

function replaceRecycleData(context, list) {
  if (!context) return false
  const next = Array.isArray(list) ? list : []
  const signature = serializeList(next)
  if (signature && context.__campusListSignature === signature) return false
  try {
    const current = typeof context.getList === 'function' ? context.getList() : []
    context.splice(0, Array.isArray(current) ? current.length : 0, next)
    context.__campusListSignature = signature
    return true
  } catch (error) {
    reportError(error, 'recycle-list:replace', { userMessage: '列表刷新失败，请下拉重试' })
    return false
  }
}

function renderRecycleData(page, context, list, patch) {
  if (!page || typeof page.setData !== 'function') return false
  const next = Array.isArray(list) ? list : []
  const sourcePatch = patch && typeof patch === 'object' ? patch : {}
  const changedPatch = {}
  Object.keys(sourcePatch).forEach(key => {
    if (!sameValue(page.data && page.data[key], sourcePatch[key])) changedPatch[key] = sourcePatch[key]
  })
  const signature = context ? serializeList(next) : ''
  const listChanged = Boolean(context) && (!signature || context.__campusListSignature !== signature)
  const renderList = () => { if (listChanged) replaceRecycleData(context, next) }
  if (Object.keys(changedPatch).length) page.setData(changedPatch, renderList)
  else renderList()
  if (!Object.keys(changedPatch).length && !listChanged) return false
  return true
}

module.exports = { createRecycleList, replaceRecycleData, renderRecycleData }
