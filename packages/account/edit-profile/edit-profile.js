const createPage = require('../../../utils/page')
const store = require('../../../utils/store')
const validators = require('../../../utils/validators')
const miniAuth = require('../../../utils/mini-auth')
const { DORM_BUILDINGS, DORM_BUILDING_LABELS, getDormBuildings, getDormBuildingLabels, getCampusConfig } = require('../../../config/constants')

createPage({
  data: { user:{}, buildings:DORM_BUILDINGS, buildingLabels:DORM_BUILDING_LABELS, buildingIndex:6, buildingSelected:false, normalBuildingLabels:[], normalBuildingIndex:0, roomRule:'numeric', saving:false },
  onLoad() {
    const user = store.getUser() || {}
    const buildings = getDormBuildings(user.campus)
    const buildingLabels = getDormBuildingLabels(user.campus)
    this.form = Object.assign({},user)
    const buildingIndex = buildings.indexOf(user.building)
    this.setData({ user, buildings, buildingLabels, buildingIndex:Math.max(0,buildingIndex), buildingSelected:buildingIndex >= 0, normalBuildingLabels:['请选择宿舍楼', ...buildingLabels], normalBuildingIndex:buildingIndex >= 0 ? buildingIndex + 1 : 0, roomRule:getCampusConfig(user.campus).roomRule })
  },
  inputName(event) { this.form.name = String(event.detail.value || '') },
  inputPhone(event) { this.form.phone = String(event.detail.value || '') },
  inputRoom(event) { this.form.room = String(event.detail.value || '') },
  inputAddress(event) { this.form.address = String(event.detail.value || '') },
  chooseBuilding(event) {
    const selectedIndex = Number(event.detail.value) || 0
    const buildingIndex = this.data.reviewMode ? selectedIndex : selectedIndex - 1
    this.form.building = this.data.buildings[buildingIndex] || ''
    this.setData({ buildingIndex:Math.max(0,buildingIndex), normalBuildingIndex:this.data.reviewMode ? buildingIndex + 1 : selectedIndex, buildingSelected:Boolean(this.form.building), 'user.building':this.form.building })
  },
  save() {
    if (this.data.saving) return
    const user = Object.assign({},this.form,{ name:String(this.form.name || '').trim(), phone:String(this.form.phone || '').trim(), building:String(this.form.building || '').trim(), room:String(this.form.room || '').trim(), address:'' })
    const error = validators.validateRegistration(user)
    if (error) { wx.showToast({ title:error, icon:'none' }); return }
    this.setData({ saving:true })
    miniAuth.updateProfile(user).then(remoteUser => {
      store.setUser(Object.assign({},user,remoteUser || {},{ profileUpdatedAt:Date.now() }))
      wx.showToast({ title:'保存成功', icon:'success' })
      this.$setTimeout(() => wx.navigateBack(),500)
    }).catch(error => {
      wx.showToast({ title:String(error && error.message || '保存失败，请重试').slice(0,20), icon:'none' })
    }).finally(() => this.setData({ saving:false }))
  }
})
