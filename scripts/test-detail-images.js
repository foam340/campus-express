const assert = require('assert/strict')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const root = path.resolve(__dirname, '..')
function load(file, dependencies, globals) {
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), {
    module, exports: module.exports, console, clearTimeout, ...globals,
    require(name) {
      return Object.hasOwn(dependencies, name) ? dependencies[name] : require(path.resolve(root, path.dirname(file), name))
    }
  }, { filename: file })
  return module.exports
}
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const tick = () => new Promise(resolve => setImmediate(resolve))
function harness({ reviewMode = false, role = 'rider' } = {}) {
  let definition, cached = null, requestCount = 0, now = Date.now()
  let serverOrder = {
    id: 'IMAGE-TEST', status: 'accepted', accepted: true, campus: 'shipai',
    screenshots: ['/mini/orders/IMAGE-TEST/attachments/pickup'], deliveryImages: [],
    observationHours: 24, phone: 'test-phone', room: '101', contactName: '测试'
  }
  let fetchOrder = () => Promise.resolve({ order: serverOrder })
  const files = new Set(), downloads = [], toasts = [], timers = new Map()
  const token = crypto.randomBytes(24).toString('hex')
  const wx = {
    downloadFile(options) { downloads.push(options) },
    getFileSystemManager: () => ({
      accessSync(file) { if (!files.has(file)) throw new Error('File missing') },
      unlink({ filePath }) { files.delete(filePath) }
    }),
    showToast(value) { toasts.push(value.title) }
  }
  const privateFiles = load('utils/private-file.js', {
    '../config/index': { apiBaseUrl: 'https://example.invalid' }, './session': { getAccessToken: () => token }
  }, { wx })
  const store = {
    getSettings: () => ({ reviewMode, observationHours: 24 }), getOrder: () => cached,
    getOrders: () => cached ? [cached] : [], saveOrders(orders) { cached = orders[0] || null }
  }
  class TestDate extends Date { static now() { return now } }
  load('packages/order/detail/detail.js', {
    '../../../utils/page': source => { definition = source }, '../../../utils/store': store,
    '../../../utils/private-file': privateFiles,
    '../../../utils/order-api': { getOrder() { requestCount++; return fetchOrder() } }
  }, { wx, Date: TestDate, clearTimeout(timer) { timers.delete(timer) } })
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)), writes: 0,
    setData(patch) { this.writes++; Object.assign(this.data, patch) },
    $setTimeout(callback) { const timer = {}; timers.set(timer, callback); return timer }
  })
  page.onLoad({ id: serverOrder.id, role })
  function finish(index, status = 200) {
    const request = downloads[index]
    assert(request, `Download ${index} should exist`)
    if (status === 0) request.fail({ errMsg: 'Network timeout' })
    else {
      const file = `wxfile://image-test-${index}`
      if (status >= 200 && status < 300) files.add(file)
      request.success({ statusCode: status, tempFilePath: file })
    }
  }
  return {
    page, downloads, toasts, finish, get requests() { return requestCount }, get cached() { return cached },
    setOrder(value) { serverOrder = { ...serverOrder, ...value } },
    setFetch(value) { fetchOrder = value },
    expirePrivacy() {
      now += 2000
      for (const [timer, callback] of [...timers]) { timers.delete(timer); callback() }
    },
    soonCompleted() { serverOrder = { ...serverOrder, status: 'completed', observationEndsAt: now + 1000 } }
  }
}

async function testFailureAndRetry() {
  for (const role of ['user', 'rider']) for (const status of [0, 403, 500]) {
    const h = harness({ role })
    const first = h.page.refresh(); await tick(); h.finish(0, status); await first
    assert.equal(h.page.data.failedScreenshotCount, 1)
    assert.equal(h.page.data.imageLoading, false)
    assert.equal(h.page.data.order.screenshots.length, 0)
    assert.equal(h.cached.screenshots[0], '/mini/orders/IMAGE-TEST/attachments/pickup', 'Keep server URLs for retry')
    assert.equal(h.page.data.failedDeliveryCount, 0)
    const retry = h.page.retryImages()
    assert.equal(h.page.data.retryingImages, true)
    assert.equal(h.page.retryImages(), undefined, 'Double taps must not create another request')
    await tick()
    assert.equal(h.requests, 2, 'Retry revalidates order permissions')
    h.finish(1); await retry
    assert.equal(h.page.data.failedScreenshotCount, 0)
    assert.equal(h.page.data.order.screenshots.length, 1)
    assert.equal(h.page.data.retryingImages, false)
  }
}
async function testPartialSuccessAndSourceChanges() {
  const h = harness()
  h.setOrder({ screenshots: ['/pickup-one', '/pickup-two'], deliveryImages: ['/delivery'] })
  const first = h.page.refresh(); await tick()
  h.finish(0); h.finish(1, 0); await tick()
  assert.equal(h.page.data.order.screenshots.length, 1, 'Pickup renders before a slow delivery image')
  assert.equal(h.page.data.failedScreenshotCount, 1)
  h.finish(2, 404); await first
  assert.equal(h.page.data.failedDeliveryCount, 1)
  h.page.setData({ pendingDeliveryImages: ['wxfile://pending-upload'] })
  const retry = h.page.retryImages(); await tick()
  assert.equal(h.page.data.order.screenshots.length, 1, 'Keep successful images visible during retry')
  assert.equal(h.downloads.length, 5, 'Cached successful image must not be downloaded again')
  h.finish(3); h.finish(4); await retry
  assert.equal(h.page.data.order.screenshots.length, 2)
  assert.equal(h.page.data.order.deliveryImages.length, 1)
  assert.equal(h.page.data.pendingDeliveryImages[0], 'wxfile://pending-upload', 'Retry must preserve unsent rider photos')
  const reload = h.page.refresh(); await reload
  assert.equal(h.downloads.length, 5)

  const changed = harness()
  changed.setOrder({ deliveryImages: ['/delivery'] })
  const initial = changed.page.refresh(); await tick()
  changed.finish(0); changed.finish(1, 0); await initial
  changed.setOrder({ screenshots: ['/new-pickup'], deliveryImages: [] })
  const next = changed.page.retryImages(); await tick()
  assert.equal(changed.page.data.order.screenshots.length, 0, 'Changed server list must discard old thumbnails')
  assert.equal(changed.page.data.failedDeliveryCount, 0, 'Removed server image is not a failed download')
  changed.finish(2); await next
}
async function testPermissionAndNetworkFailures() {
  for (const status of [401, 403, 404]) {
    const h = harness()
    h.setOrder({ screenshots: ['/one', '/two'] })
    const first = h.page.refresh(); await tick()
    h.finish(0); h.finish(1, 0); await first
    h.setFetch(() => Promise.reject(Object.assign(new Error('No permission'), { statusCode: status })))
    await h.page.retryImages()
    assert.equal(h.downloads.length, 2, 'Do not download after order access is revoked')
    assert.equal(h.page.data.order, null)
    assert.equal(h.cached, null)
    assert.equal(h.page.data.failedScreenshotCount, 0)
    assert.equal(h.page.data.retryingImages, false)
  }
  const h = harness()
  const first = h.page.refresh(); await tick(); h.finish(0, 0); await first
  h.setFetch(() => Promise.reject(new Error('NETWORK_OFFLINE')))
  await h.page.retryImages()
  assert.equal(h.page.data.failedScreenshotCount, 1, 'Network failure must leave retry available')
  assert.equal(h.page.data.retryingImages, false)
  assert.equal(h.toasts.at(-1), '重新加载失败，请稍后重试')
}
async function testStaleLoadsAndPrivacy() {
  const h = harness()
  const old = h.page.refresh(); await tick()
  h.setOrder({ screenshots: ['/new'] })
  const next = h.page.refresh(); await tick()
  h.finish(1); await next
  const current = h.page.data.order.screenshots[0]
  h.finish(0, 0); await old
  assert.equal(h.page.data.order.screenshots[0], current)
  assert.equal(h.page.data.failedScreenshotCount, 0, 'Stale download failure must not overwrite the new order')
  const stale = deferred()
  h.setFetch(() => stale.promise)
  const oldRequest = h.page.refresh(); await tick()
  h.setFetch(() => Promise.resolve({ order: { id: 'IMAGE-TEST', status: 'accepted', screenshots: [], deliveryImages: [] } }))
  await h.page.refresh()
  const writes = h.page.writes
  stale.reject(Object.assign(new Error('Old permission error'), { statusCode: 403 })); await oldRequest
  assert.equal(h.page.writes, writes, 'Stale order error cannot clear a newer response')

  for (const expires of [false, true]) {
    const hidden = harness()
    if (expires) hidden.soonCompleted()
    const loadTask = hidden.page.refresh(); await tick()
    if (expires) hidden.expirePrivacy()
    else { hidden.page.__pageUnloaded = true; hidden.page.onUnload() }
    const writesBeforeLateImage = hidden.page.writes
    hidden.finish(0); await loadTask
    assert.equal(hidden.page.writes, writesBeforeLateImage, 'Late image callback must not update an expired or unloaded page')
    assert.equal(hidden.page.data.order.screenshots.length, 0)
    assert.equal(hidden.page.imageSourceOrder, null)
    if (expires) {
      assert.equal(hidden.page.data.sensitiveVisible, false)
      assert.equal(hidden.page.data.failedScreenshotCount, 0)
      assert.equal(hidden.page.data.imageLoading, false)
      assert.equal(hidden.page.retryImages(), undefined)
    }
  }
  const expired = harness()
  expired.setOrder({ status: 'completed', observationEndsAt: Date.now() - 10000 })
  await expired.page.refresh()
  assert.equal(expired.downloads.length, 0, 'Already-expired rider details must never download images')
}
async function testEmptyAndReview() {
  const empty = harness()
  empty.setOrder({ screenshots: [], deliveryImages: [] }); await empty.page.refresh()
  assert.equal(empty.page.data.failedScreenshotCount, 0)
  assert.equal(empty.page.data.failedDeliveryCount, 0)
  assert.equal(empty.page.retryImages(), undefined)
  const review = harness({ reviewMode: true })
  const task = review.page.refresh(); await tick(); review.finish(0, 0); await task
  assert.equal(review.page.retryImages(), undefined, 'No new retry action in review mode')
  assert.equal(review.requests, 1)
}
async function main() {
  await testFailureAndRetry()
  await testPartialSuccessAndSourceChanges()
  await testPermissionAndNetworkFailures()
  await testStaleLoadsAndPrivacy()
  await testEmptyAndReview()
  console.log('Order image retries passed: partial failures, cached successes, permissions, stale responses, privacy expiry and review guards')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
