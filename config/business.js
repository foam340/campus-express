const { APP_VERSION } = require('./constants')

const DEFAULT_SETTINGS = {
  version: APP_VERSION,
  pricingVersion: 2026102001,
  openTime: '08:00',
  closeTime: '23:00',
  cutoffHour: 20,
  campusPrice: 1,
  offCampusPrice: 2,
  campusUrgentPrice: 8,
  offCampusUrgentPrice: 9,
  extraPiecePrice: 1.5,
  largePrice: 7,
  toDoorFee: 1,
  building9Surcharge: 1,   // 9栋上门费（送上门时，2026-09-16 起与其他楼统一 +1）
  buildingSurcharge: 0.5,    // 9栋固定附加费（一律加收，与是否上门无关）
  observationHours: 24,
  adminWechat: '19129191802',
  serviceStatus: 'open',
  serviceNotice: '节假日小程序暂停服务，恢复时间另行通知',
  reviewMode: true
}

const REVIEW_REGISTRATION_PROFILE = Object.freeze({
  name: '审核用户',
  phone: '13800000000',
  building: '1栋',
  room: '111'
})

module.exports = { DEFAULT_SETTINGS, REVIEW_REGISTRATION_PROFILE }
