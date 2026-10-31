const CACHE_TTL = {
  static: 7 * 24 * 60 * 60 * 1000,
  dictionary: 24 * 60 * 60 * 1000,
  list: 5 * 60 * 1000,
  session: 30 * 60 * 1000
}

const APP_VERSION = '5.4.4'
const DORM_BUILDINGS = ['1栋','2栋','3栋','4栋','5栋','6栋','7栋','8栋','9栋','25号楼','教师公寓A座','教师公寓B座']
const DORM_BUILDING_LABELS = ['1栋（原A栋）','2栋（原B栋）','3栋（原C栋）','4栋（原D栋）','5栋（原E栋）','6栋（原F栋）','7栋（原G栋）','8栋（原H栋）','9栋（新宿舍楼）','25号楼','教师公寓A座','教师公寓B座']
// 石牌宿舍楼：32 栋（「中区」「东19栋南」都是独立一栋）。石牌不标性别。
const SHIPAI_DORM_BUILDINGS = ['东2栋','东3栋','东4栋','东5栋','东9栋','东10栋','东11栋','东12栋','东13栋','东14栋','东19栋','东19栋南','西1栋','西2栋','西3栋','西4栋','西5栋','西6栋','中区','中区20栋','中区22栋','中区23栋','中区34栋','中区35栋','研究生公寓A座','研究生公寓B座','研究生公寓C座','陶北','陶南','沁园','星河楼','留学生公寓']
// 广轻工南海北区宿舍楼：1–48栋及东1栋、东2栋（均为男生宿舍）。
const GQG_DORM_BUILDINGS = [...Array.from({ length: 48 }, (_, i) => `${i + 1}栋`), '东1栋', '东2栋']
function getDormBuildings(campus) { return campus === 'shipai' ? SHIPAI_DORM_BUILDINGS : (campus === 'gqg' ? GQG_DORM_BUILDINGS : DORM_BUILDINGS) }
function getDormBuildingLabels(campus) { return campus === 'shipai' ? SHIPAI_DORM_BUILDINGS : (campus === 'gqg' ? GQG_DORM_BUILDINGS : DORM_BUILDING_LABELS) }
const DORM_BUILDING_GENDER = {
  '1栋': 'female', '2栋': 'male', '3栋': 'male', '4栋': 'female', '5栋': 'male',
  '6栋': 'female', '7栋': 'mixed', '8栋': 'male', '9栋': 'mixed', '25号楼': 'mixed'
}
// 广轻工南海北区：9–24栋女生，其余及东1栋、东2栋男生（无混宿、无楼层细分）。
const GQG_BUILDING_GENDER = GQG_DORM_BUILDINGS.reduce((map, label, i) => {
  const n = i + 1
  map[label] = (n >= 9 && n <= 24) ? 'female' : 'male'
  return map
}, {})
const BUILDING_GENDER_TEXT = { male: '男', female: '女', mixed: '混宿' }
GQG_BUILDING_GENDER['东一栋'] = 'male' // 兼容已有资料缓存

// 校区：nanhai=南海、shipai=石牌；注册时二选一，老用户默认南海。
const CAMPUSES = ['nanhai', 'shipai', 'gqg']
const CAMPUS_LABELS = ['华师南海校区', '华师石牌校区', '广轻工南海北区']
// 石牌取件驿站（两站同价，不参与计价，仅告知骑手去哪取件）。
const SHIPAI_STATIONS = [
  { value: 'south', label: '南区菜鸟驿站' },
  { value: 'west', label: '西区菜鸟驿站' }
]
// 客服微信：按校区区分（二维码图 + 微信号）。
const CAMPUS_SERVICE = {
  nanhai: {
    wechat: '19129191802', qr: '/packages/account/assets/admin-wechat.jpg',
    additionalContacts: [
      { label: '客服 2', wechat: '13502782984', qr: '/packages/account/assets/admin-wechat-nanhai-2.jpg' }
    ]
  },
  shipai: {
    wechat: '15889237520', qr: '/packages/account/assets/admin-wechat-shipai.png',
    additionalContacts: [
      { label: '客服 2', wechat: '19927171589', qr: '/packages/account/assets/admin-wechat-shipai-2.jpg' }
    ]
  },
  gqg: {
    wechat: '13829692581', qr: '/packages/account/assets/admin-wechat-gqg.jpg',
    additionalContacts: [
      { label: '客服 2', wechat: '15089147976', qr: '/packages/account/assets/admin-wechat-gqg-2.jpg' },
      { label: '客服 3', wechat: '13240383539', qr: '/packages/account/assets/admin-wechat-gqg-3.jpg' }
    ]
  }
}

// 多校区配置镜像（对齐后端 server/src/campus-config.js；新增校区时两端同步改）。
// 仅含「前端渲染所需」的静态特征；价格/抽成/服务开关以后端 /mini/settings 返回为准。
const CAMPUS_CONFIG = Object.freeze({
  nanhai: Object.freeze({
    id: 'nanhai',
    label: '华师南海校区',
    hasOffCampus: true,             // 有校内/校外件（下单页显示 scope 选择器）
    roomRule: 'numeric',            // 门牌：numeric(3-4位) | free(自由填写)
    stations: Object.freeze([]),    // 驿站；空 = 无驿站概念
    scopeStations: Object.freeze([
      Object.freeze({ value: 'campus', title: '校内', label: '菜鸟驿站', priceScope: 'campus' }),
      Object.freeze({ value: 'campus_7', title: '校内', label: '7栋后门\n（多多买菜寄存点）', priceScope: 'campus' }),
      Object.freeze({ value: 'off_campus', title: '校外', label: '国赛艺术村5号', priceScope: 'off_campus' })
    ]),
    buildingGender: DORM_BUILDING_GENDER,
    building9Fee: true             // 9栋特殊规则（南海特有）
  }),
  shipai: Object.freeze({
    id: 'shipai',
    label: '华师石牌校区',
    hasOffCampus: false,
    roomRule: 'free',
    stations: SHIPAI_STATIONS,
    buildingGender: null,            // 不标性别
    building9Fee: false
  }),
  gqg: Object.freeze({
    id: 'gqg',
    label: '广轻工南海北区',
    distanceFeeBuildings: Object.freeze(['东一', '东1', '东2']),
    distanceFee: 0.5,
    hasOffCampus: true,
    roomRule: 'numeric',
    stations: Object.freeze([]),
    scopeStations: Object.freeze([
      Object.freeze({ value: 'campus', title: '校内', label: '三号门A区快递站', priceScope: 'campus' }),
      Object.freeze({ value: 'off_campus', title: '校外', label: '一号门妈妈驿站', priceScope: 'off_campus' })
    ]),
    buildingGender: GQG_BUILDING_GENDER,
    building9Fee: false
  })
})

function getCampusConfig(campus) {
  return CAMPUS_CONFIG[campus] || CAMPUS_CONFIG.nanhai
}

function dormFloor(room) {
  return Number(String(room || '').trim().charAt(0)) || 0
}

// 楼栋性别（按楼层细分）：混宿楼栋按「宿舍号首位」判定楼层性别。
// 7栋：1-3层男、4层混、5-6层女；9栋：1-6层男、7-8层女；25号楼：整体混宿。
function buildingGender(building, room, genderTable) {
  const base = (genderTable || DORM_BUILDING_GENDER)[building] || ''
  if (base !== 'mixed') return base
  const floor = dormFloor(room)
  if (building === '7栋') {
    if (floor >= 1 && floor <= 3) return 'male'
    if (floor >= 5 && floor <= 6) return 'female'
    return 'mixed' // 4层 或未知楼层
  }
  if (building === '9栋') {
    if (floor >= 1 && floor <= 6) return 'male'
    if (floor >= 7 && floor <= 8) return 'female'
    return 'mixed' // 未知楼层
  }
  return 'mixed' // 25号楼
}

const ROUTES = {
  welcome: '/pages/auth/welcome/welcome',
  home: '/pages/user/home/home',
  orders: '/pages/user/orders/orders',
  profile: '/pages/user/profile/profile',
  riderHall: '/pages/rider/hall/hall',
  riderTasks: '/pages/rider/tasks/tasks',
  createOrder: '/packages/order/create/create',
  orderDetail: '/packages/order/detail/detail',
  samplePickup: '/packages/order/sample/sample',
  sizeGuide: '/packages/order/size-guide/size-guide',
  editProfile: '/packages/account/edit-profile/edit-profile',
  riderApply: '/packages/account/rider-apply/rider-apply',
  wallet: '/packages/account/wallet/wallet',
  coupons: '/packages/account/coupons/coupons',
  service: '/packages/account/service/service',
  feedback: '/packages/account/feedback/feedback',
  campusChange: '/packages/account/campus-change/campus-change'
}

const BUSINESS = {
  maxActiveRiderOrders: 3,
  maxOrderPieces: 20,
  maxUploadImages: 9
}

module.exports = { APP_VERSION, CACHE_TTL, CAMPUSES, CAMPUS_LABELS, CAMPUS_CONFIG, getCampusConfig, SHIPAI_STATIONS, CAMPUS_SERVICE, DORM_BUILDINGS, DORM_BUILDING_LABELS, SHIPAI_DORM_BUILDINGS, GQG_DORM_BUILDINGS, getDormBuildings, getDormBuildingLabels, DORM_BUILDING_GENDER, GQG_BUILDING_GENDER, BUILDING_GENDER_TEXT, dormFloor, buildingGender, ROUTES, BUSINESS }
