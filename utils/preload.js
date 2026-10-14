const storage = require('./storage')

function primeSettings(settings) { storage.set('settings', settings || {}, { level: 'static' }) }

module.exports = { primeSettings }
