/**
 * 清理孤儿上传：传成功了、却从没挂到任何订单上的图片。
 *
 * 默认只做 dry run（只统计不删）。要真删必须显式加 --apply。
 * 用法:
 *   node scripts/cleanup-orphan-uploads.js                # dry run，打印待删条数与体积
 *   node scripts/cleanup-orphan-uploads.js --days 30      # 保留期改成 30 天
 *   node scripts/cleanup-orphan-uploads.js --apply        # 真删（DB 行 + 磁盘文件）
 *
 * 判定条件与删除逻辑见 src/order-cleanup.js 的 cleanupOrphanUploads。
 * 线上定时任务已经在每天跑一次 --apply 等价的动作，这个脚本用于手工查看和一次性清存量。
 */
const { pool } = require('../src/db')
const { cleanupOrphanUploads } = require('../src/order-cleanup')

function readOption(name) {
  const index = process.argv.indexOf(name)
  return index > -1 ? process.argv[index + 1] : ''
}

async function main() {
  const apply = process.argv.includes('--apply')
  const days = Number(readOption('--days')) || 7
  const result = await cleanupOrphanUploads({ retentionDays: days, dryRun: !apply })

  const mb = Math.round(result.reclaimedBytes / 1048576 * 10) / 10
  if (result.dryRun) {
    console.log(`\n[dry run] 保留期 ${days} 天，待删 ${result.deleted} 条，可回收 ${mb} MB。`)
    if (result.oldest) console.log(`最老 ${result.oldest}，最新 ${result.newest}`)
    console.log('确认无误后加 --apply 真删。')
  } else {
    console.log(`\n已删除 ${result.deleted} 条，回收 ${mb} MB。`)
  }
  await pool.end()
}

main().catch(error => {
  console.error('清理失败:', error.message)
  process.exit(1)
})
