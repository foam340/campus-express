const { HttpError } = require('./http')

function string(value, name, options = {}) {
  const min = Number.isInteger(options.min) ? options.min : 0
  const max = Number.isInteger(options.max) ? options.max : 255
  const result = String(value == null ? '' : value).trim()
  if (result.length < min || result.length > max) {
    throw new HttpError(400, `${name}长度应为${min}至${max}个字符`, 'INVALID_INPUT')
  }
  return result
}

function numeric(value, name, options = {}) {
  const result = Number(value)
  const min = Number.isFinite(options.min) ? options.min : Number.MIN_SAFE_INTEGER
  const max = Number.isFinite(options.max) ? options.max : Number.MAX_SAFE_INTEGER
  if (!Number.isFinite(result) || result < min || result > max) {
    throw new HttpError(400, `${name}必须在${min}至${max}之间`, 'INVALID_INPUT')
  }
  return result
}

function integer(value, name, options = {}) {
  const result = numeric(value, name, options)
  if (!Number.isInteger(result)) throw new HttpError(400, `${name}必须是整数`, 'INVALID_INPUT')
  return result
}

function boolean(value, name) {
  if (typeof value !== 'boolean') throw new HttpError(400, `${name}必须为布尔值`, 'INVALID_INPUT')
  return value
}

function phone(value, required = true) {
  const result = String(value == null ? '' : value).trim()
  if (!result && !required) return ''
  // 11 位且第二位 3-9（12x 等号段不存在）；与前端 utils/validators.js 的 isPhone 保持一致
  if (!/^1[3-9]\d{9}$/.test(result)) throw new HttpError(400, '请输入正确的11位手机号', 'INVALID_PHONE')
  return result
}

function time(value, name) {
  const result = String(value || '').trim()
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(result)) {
    throw new HttpError(400, `${name}格式应为HH:mm`, 'INVALID_TIME')
  }
  return result
}

function oneOf(value, name, values) {
  const result = String(value || '')
  if (!values.includes(result)) throw new HttpError(400, `${name}取值无效`, 'INVALID_INPUT')
  return result
}

module.exports = { boolean, integer, numeric, oneOf, phone, string, time }
