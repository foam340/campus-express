Component({
  properties: {
    icon: { type: String, value: '空' },
    title: { type: String, value: '暂无内容' },
    description: { type: String, value: '' },
    actionText: { type: String, value: '' },
    tone: { type: String, value: 'blue' }
  },
  methods: { handleAction() { this.triggerEvent('action') } }
})
