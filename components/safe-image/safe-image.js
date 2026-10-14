const FALLBACK = '/assets/image-placeholder.png'
const { reportError } = require('../../utils/errors')

Component({
  externalClasses: ['custom-class'],
  properties: {
    src: {
      type: String,
      value: '',
      observer(value) {
        const displaySrc = value || FALLBACK
        if (displaySrc !== this.data.displaySrc || this.data.failed) {
          this.setData({ displaySrc, failed: false })
          clearTimeout(this._retryTimer)
          this._retries = 0
        }
      }
    },
    mode: { type: String, value: 'aspectFill' },
    lazyLoad: { type: Boolean, value: true },
    showMenuByLongpress: { type: Boolean, value: false }
  },
  data: { displaySrc: FALLBACK, failed: false },
  lifetimes: {
    detached() {
      clearTimeout(this._retryTimer)
    }
  },
  methods: {
    handleError(event) {
      if (this._retries >= 2) {
        if (!this.data.failed) this.setData({ displaySrc: FALLBACK, failed: true })
        reportError(new Error(`IMAGE_LOAD_FAILED:${this.data.src || 'empty'}`), 'safe-image', { silent: true })
        this.triggerEvent('error', event.detail || {})
        return
      }
      this._retries = (this._retries || 0) + 1
      // 分包资源可能尚未就绪，延迟后重试
      this._retryTimer = setTimeout(() => {
        const src = this.data.src
        if (!src || this.data.failed) return
        if (/^(https?:\/\/|cloud:\/\/)/i.test(src)) {
          // 远程图片：追加查询串做缓存穿透
          this.setData({ displaySrc: src + '?retry=' + this._retries })
        } else {
          // 本地/分包/临时文件：查询串会破坏本地路径解析，切回占位图再切回原图强制重载
          this.setData({ displaySrc: FALLBACK }, () => {
            if (!this.data.failed) this.setData({ displaySrc: src })
          })
        }
      }, 400 * this._retries)
    },
    handleLoad(event) { this.triggerEvent('load', event.detail || {}) },
    handleTap() { this.triggerEvent('tap', { src: this.data.src }) }
  }
})
