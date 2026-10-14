const { ROUTES } = require('../config/constants')

function createShareMessage(options) {
  const source = options && typeof options === 'object' ? options : {}
  const result = {
    title: source.title || '校园快递代拿',
    path: source.path || ROUTES.home
  }
  if (source.imageUrl) result.imageUrl = source.imageUrl
  return result
}

module.exports = { createShareMessage }
