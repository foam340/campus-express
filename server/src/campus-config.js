/**
 * 多校区单一权威配置（server 侧）。
 *
 * 目标：新校区接入 = 在此新增一份对象 + 前端 config/constants.js 加镜像 + platform_settings 加价格行，
 *      不改一行业务逻辑（估 1–2 小时）。
 *
 * 本文件只含「校区静态特征」：楼栋白名单、门牌规则、驿站、楼栋性别、接单规则、邮件地址策略、展示名。
 * 价格 / 抽成 / 服务开关 / 审核模式仍在 platform_settings 表（按 campus 一行），由各路由实时查询。
 *
 * 严格等价约束：对现有 nanhai / shipai 的一切行为必须与重构前完全一致。
 * 依赖方向：本模块不依赖任何业务模块（business-rules / mini / admin / rider-notify 均可依赖本模块）。
 */

// 有序数组：第 0 项是「默认/兜底」校区（管理台切换器缺省、容忍归一化的回落目标）。
const CAMPUSES = Object.freeze(['nanhai', 'shipai', 'gqg'])
const DEFAULT_CAMPUS = CAMPUSES[0]

// —— 南海宿舍楼（数字键1–9、25，教师公寓保留完整名称）——
const NANHAI_BUILDING_KEYS = Object.freeze(['1', '2', '3', '4', '5', '6', '7', '8', '9', '25', '教师公寓A座', '教师公寓B座'])
// —— 石牌宿舍楼（原始键：完整中文楼栋名，32 栋）——
const SHIPAI_BUILDING_KEYS = Object.freeze([
  '东2栋', '东3栋', '东4栋', '东5栋', '东9栋', '东10栋', '东11栋', '东12栋', '东13栋', '东14栋',
  '东19栋', '东19栋南',
  '西1栋', '西2栋', '西3栋', '西4栋', '西5栋', '西6栋',
  '中区', '中区20栋', '中区22栋', '中区23栋', '中区34栋', '中区35栋',
  '研究生公寓A座', '研究生公寓B座', '研究生公寓C座',
  '陶北', '陶南', '沁园', '星河楼', '留学生公寓'
])

// 南海楼栋性别 base 表（key 为展示名；value ∈ male/female/mixed）。
// 混宿楼栋（7栋/9栋/25号楼）的「按楼层细分」在 buildingGender() 内处理（见 business-rules.js / mini.js）。
const NANHAI_BUILDING_GENDER = Object.freeze({
  '1栋': 'female', '2栋': 'male', '3栋': 'male', '4栋': 'female', '5栋': 'male',
  '6栋': 'female', '7栋': 'mixed', '8栋': 'male', '9栋': 'mixed', '25号楼': 'mixed'
})

// —— 广轻工南海北区宿舍楼（归一化键：1–48、东一（东1栋历史键）及东2）——
const GQG_BUILDING_KEYS = Object.freeze([...Array.from({ length: 48 }, (_, i) => String(i + 1)), '东一', '东2'])
// 楼栋性别：9–24栋女生，其余及东1栋、东2栋男生（无混宿、无楼层细分）。
const GQG_BUILDING_GENDER = Object.freeze(
  GQG_BUILDING_KEYS.reduce((acc, key) => {
    acc[`${key}栋`] = (Number(key) >= 9 && Number(key) <= 24) ? 'female' : 'male'
    return acc
  }, {})
)

// 每校区声明式配置。
const CAMPUS_CONFIG = Object.freeze({
  nanhai: Object.freeze({
    id: 'nanhai',
    label: '华师南海',
    hasOffCampus: true,                 // 有「校内/校外」件（下单页 4/6 价）
    buildingKeys: NANHAI_BUILDING_KEYS, // 楼栋白名单（归一化键，纯数字）
    buildingKeysNumeric: true,          // 校验时需 strip「号楼/号栋/栋」后缀 + toUpperCase
    roomRule: 'numeric',                // 门牌：numeric(3–4 位数字) | free(石牌/新校区默认)
    stations: Object.freeze([]),        // 驿站列表；空 = 无驿站概念
    scopeStations: Object.freeze([
      Object.freeze({ value: 'campus', title: '校内', label: '菜鸟驿站', priceScope: 'campus' }),
      Object.freeze({ value: 'campus_7', title: '校内', label: '7栋后门\n（多多买菜寄存点）', priceScope: 'campus' }),
      Object.freeze({ value: 'off_campus', title: '校外', label: '国赛艺术村5号', priceScope: 'off_campus' })
    ]),
    buildingGender: NANHAI_BUILDING_GENDER, // 楼栋性别表；null = 不标性别
    grabRules: Object.freeze({
      // 送上楼时：南海 = 同性限制（9栋豁免，§71③-补）；石牌 = 仅本栋。
      genderRestriction: Object.freeze({ enabled: true, exemptBuildings: Object.freeze(['9', '教师公寓A座', '教师公寓B座']) }),
      ownBuildingOnly: false
    }),
    building9Fee: true,                  // 9栋特殊规则（+0.5、门口费不看楼层）——南海特有
    emailHideAddress: false             // 新单邮件是否隐藏详细地址（石牌 true）
  }),
  shipai: Object.freeze({
    id: 'shipai',
    label: '华师石牌',
    hasOffCampus: false,                // 石牌下单页无校内/校外之分，用「取件驿站」
    buildingKeys: SHIPAI_BUILDING_KEYS, // 楼栋白名单（原始键，完整中文名）
    buildingKeysNumeric: false,         // 精确匹配，不 strip
    roomRule: 'free',                   // 房号自由填
    stations: Object.freeze([
      { value: 'south', label: '南区菜鸟驿站' },
      { value: 'west', label: '西区菜鸟驿站' }
    ]),
    buildingGender: null,               // 不标性别
    grabRules: Object.freeze({
      genderRestriction: Object.freeze({ enabled: false, exemptBuildings: Object.freeze([]) }),
      ownBuildingOnly: true
    }),
    building9Fee: false,                 // 无 9栋特殊规则
    emailHideAddress: true              // 邮件不暴露楼栋/房号，仅「接单后查看详细地址」
  }),
  gqg: Object.freeze({
    id: 'gqg',
    label: '广轻工南海北区',
    distanceFeeBuildings: Object.freeze(['东一', '东1', '东2']),
    distanceFee: 0.5,
    hasOffCampus: true,                 // 有校内/校外件（定价同南海）
    buildingKeys: GQG_BUILDING_KEYS,    // 楼栋白名单（归一化键，1–48、东一、东2）
    buildingKeysNumeric: true,
    roomRule: 'numeric',                // 数字门牌（同南海）
    stations: Object.freeze([]),        // 无驿站选择器（走校内/校外）
    scopeStations: Object.freeze([
      Object.freeze({ value: 'campus', title: '校内', label: '三号门A区快递站', priceScope: 'campus' }),
      Object.freeze({ value: 'off_campus', title: '校外', label: '一号门妈妈驿站', priceScope: 'off_campus' })
    ]),
    buildingGender: Object.freeze({ ...GQG_BUILDING_GENDER, '东1栋': 'male' }), // 兼容旧名东一栋
    grabRules: Object.freeze({
      // 送上楼：同性限制（比南海更简单，无 9栋豁免、无混宿）。
      genderRestriction: Object.freeze({ enabled: true, exemptBuildings: Object.freeze([]) }),
      ownBuildingOnly: false
    }),
    building9Fee: false,                 // 无 9栋特殊规则（9栋加价是南海特有，与广轻工无关）
    emailHideAddress: false
  })
})

const CAMPUS_ID_SET = Object.freeze(new Set(CAMPUSES))

/** 是否已知校区 id（白名单内）。 */
function isKnownCampus(value) {
  return CAMPUS_ID_SET.has(String(value || '').trim())
}

/**
 * 严格归一化：白名单内返回原值；未知返回 null（调用方自行决定抛 400 或做兜底）。
 * 用于「用户输入路径」：注册 / 资料 / 下单 / 改校区的 campus、toCampus，以及 /mini/settings?campus=。
 */
function normalizeCampus(value) {
  const campus = String(value || '').trim()
  return isKnownCampus(campus) ? campus : null
}

/**
 * 容忍归一化：白名单内返回原值；未知回落默认校区（第一项）并打错误日志。
 * 用于「库值读取 / 展示路径」：读 users/orders/riders 的 campus 字段时，存量脏值不应打挂大厅/接单。
 */
function normalizeCampusLenient(value) {
  const campus = String(value || '').trim()
  if (isKnownCampus(campus)) return campus
  console.error(JSON.stringify({
    level: 'error',
    message: 'unknown campus value, fallback to default',
    campus: campus || '(empty)',
    fallback: DEFAULT_CAMPUS
  }))
  return DEFAULT_CAMPUS
}

/** 取某校区配置对象；未知返回 null。 */
function getCampusConfig(campus) {
  return CAMPUS_CONFIG[String(campus || '').trim()] || null
}

/** 校区展示名；未知返回原值或占位符。 */
function campusLabel(campus) {
  const cfg = getCampusConfig(campus)
  return cfg ? cfg.label : (String(campus || '') || '—')
}

/** 驿站 key → 展示文案；未知/无驿站返回空串。 */
function stationLabel(campus, station) {
  const cfg = getCampusConfig(campus)
  if (!cfg || !cfg.stations || !cfg.stations.length) return ''
  const item = cfg.stations.find(s => s.value === station)
  return item ? item.label : ''
}

/** 某校区是否配置了驿站概念（有驿站列表即视为有）。 */
function hasStations(campus) {
  const cfg = getCampusConfig(campus)
  return Boolean(cfg && cfg.stations && cfg.stations.length)
}

module.exports = {
  CAMPUSES,
  DEFAULT_CAMPUS,
  CAMPUS_CONFIG,
  isKnownCampus,
  normalizeCampus,
  normalizeCampusLenient,
  getCampusConfig,
  campusLabel,
  stationLabel,
  hasStations
}
