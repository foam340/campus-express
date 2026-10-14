const state = require('../../utils/state')

Component({
  data: { visible:false, offline:false, text:'' },
  lifetimes: {
    attached() { this.connect() },
    detached() { this.disconnect() }
  },
  pageLifetimes: {
    show() { this.connect() },
    hide() { this.disconnect() }
  },
  methods: {
    connect() {
      if (this.unsubscribe) return
      this.update(state.getState().network)
      this.unsubscribe = state.subscribe(
        network => this.update(network),
        next => next.network
      )
    },
    disconnect() {
      if (this.unsubscribe) this.unsubscribe()
      this.unsubscribe = null
    },
    update(network) {
      const offline = !!(network && network.isConnected === false)
      const weak = !offline && !!(network && network.isWeak)
      const text = offline ? '网络连接不可用，当前展示本地缓存数据' : weak ? '当前网络较慢，已为你减少重复请求' : ''
      const visible = offline || weak
      if (visible !== this.data.visible || offline !== this.data.offline || text !== this.data.text) {
        this.setData({ visible, offline, text })
      }
    }
  }
})
