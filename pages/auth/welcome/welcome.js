const createPage = require('../../../utils/page')
const store = require('../../../utils/store')
const validators = require('../../../utils/validators')
const miniAuth = require('../../../utils/mini-auth')
const modeStore = require('../../../utils/mode')
const { ROUTES, DORM_BUILDINGS, DORM_BUILDING_LABELS, CAMPUSES, CAMPUS_LABELS, getDormBuildings, getDormBuildingLabels, getCampusConfig } = require('../../../config/constants')

createPage({
  data: {
    name: '',
    phone: '',
    room: '',
    agreed: false,
    submitting: false,
    authenticating: true,
    reviewMode: true,
    buildings: DORM_BUILDINGS,
    buildingLabels: DORM_BUILDING_LABELS,
    buildingIndex: 0,
    campuses: ['', ...CAMPUSES],
    campusLabels: ['请选择校区', ...CAMPUS_LABELS],
    campusIndex: 0,
    campus: '',
    roomRule: 'numeric'
  },
  onLoad() {
    this.form = { name:'', phone:'', room:'', address:'' }
    // 预填已缓存用户的校区：老用户重新注册时默认显示自己的校区，避免被默认「南海」误改
    const cachedUser = store.getUser()
    if (cachedUser && cachedUser.campus) {
      const idx = this.data.campuses.indexOf(cachedUser.campus)
      if (idx >= 0) this.setData({
        campusIndex: idx,
        campus: cachedUser.campus,
        buildings: getDormBuildings(cachedUser.campus),
        buildingLabels: getDormBuildingLabels(cachedUser.campus),
        buildingIndex: 0,
        roomRule: getCampusConfig(cachedUser.campus).roomRule
      })
    }
    this.setData({ reviewMode: store.getSettings().reviewMode !== false })
    const app = getApp()
    const authentication = app && app.authReady ? app.authReady : miniAuth.bootstrap(null)
    Promise.resolve(authentication).then(result => {
      this.setData({ reviewMode: store.getSettings().reviewMode !== false })
      if (result && result.registered && result.user) {
        const user = store.completeRegistration(result.user)
        // 冷启动落点跟随上次模式：骑手且资格仍有效则直接回骑手大厅，否则回用户首页。
        // result.user 来自 /mini/auth/login，riderApproved 是服务端最新值，被撤资格的骑手此处为 false。
        const resumeRider = modeStore.getMode() === 'rider' && !!(user && user.riderApproved)
        modeStore.setMode(resumeRider ? 'rider' : 'user')
        wx.switchTab({ url: resumeRider ? ROUTES.riderHall : ROUTES.home })
        return
      }
      this.setData({ authenticating:false })
    }).catch(() => this.setData({ authenticating:false, reviewMode:store.getSettings().reviewMode !== false }))
  },
  inputName(event) { this.form.name = String(event.detail.value || '') },
  inputPhone(event) { this.form.phone = String(event.detail.value || '') },
  inputRoom(event) { this.form.room = String(event.detail.value || '') },
  chooseBuilding(event) { this.setData({ buildingIndex:Number(event.detail.value) || 0 }) },
  inputAddress(event) { this.form.address = String(event.detail.value || '') },
  chooseCampus(event) {
    const index = Number(event.detail.value) || 0
    const campus = this.data.campuses[index] || ''
    this.setData({
      campusIndex: index,
      campus,
      buildings: getDormBuildings(campus),
      buildingLabels: getDormBuildingLabels(campus),
      buildingIndex: 0,
      roomRule: getCampusConfig(campus).roomRule
    })
  },
  toggleAgree() { this.setData({ agreed:!this.data.agreed }) },
  noop() {},
  showRulesTip() { wx.showToast({ title: '请在「我的」中查看服务规则与隐私说明', icon: 'none', duration: 2000 }) },
  enter() {
    if (this.data.submitting || this.data.authenticating) return
    const campus = this.data.campuses[this.data.campusIndex] || ''
    if (!campus) { wx.showToast({ title: '请选择校区', icon: 'none' }); return }
    const profile = {
      name: String(this.form.name || '').trim(),
      phone: String(this.form.phone || '').trim(),
      campus,
      building: this.data.buildings[this.data.buildingIndex] || '',
      room: String(this.form.room || '').trim(),
      address: ''
    }
    const error = validators.validateRegistration(profile)
    if (error) { wx.showToast({ title:error, icon:'none' }); return }
    if (!this.data.agreed) { wx.showToast({ title:'请先同意服务规则和隐私说明', icon:'none' }); return }
    this.setData({ submitting:true })
    miniAuth.register(profile).then(result => {
      const user = store.completeRegistration(result && result.user ? result.user : profile)
      if (!user) throw new Error('registration failed')
      this.setData({ submitting:false })
      modeStore.setMode('user')
      wx.switchTab({ url:ROUTES.home })
    }).catch(error => {
      this.setData({ submitting:false })
      wx.showToast({ title:String(error && error.message || '注册失败，请重试').slice(0,20), icon:'none' })
    })
  }
})
