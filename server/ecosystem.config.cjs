const app = {
  name: 'campus-express-api',
  script: './src/app.js',
  cwd: __dirname,
  instances: 1,
  exec_mode: 'fork',
  autorestart: true,
  max_memory_restart: '300M',
  kill_timeout: 10000,
  listen_timeout: 10000,
  env: { NODE_ENV: 'production' }
}

if (process.platform !== 'win32') {
  app.uid = process.env.API_RUN_USER || 'campusapi'
  app.gid = process.env.API_RUN_GROUP || 'campusapi'
  app.interpreter = process.env.NODE_BIN || '/www/server/nodejs/v20.13.1/bin/node'
}

module.exports = { apps: [app] }
