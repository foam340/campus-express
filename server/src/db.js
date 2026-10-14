const mysql = require('mysql2/promise')
const config = require('./config')

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
  waitForConnections: true,
  connectionLimit: config.db.connectionLimit,
  queueLimit: 100,
  charset: 'utf8mb4',
  timezone: 'Z',
  decimalNumbers: true,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000
})

async function transaction(handler) {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const result = await handler(connection)
    await connection.commit()
    return result
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

module.exports = { pool, transaction }
