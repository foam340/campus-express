async function writeAudit(connection, request, action, targetType, targetId, detail = {}) {
  const executor = connection && typeof connection.execute === 'function' ? connection : null
  if (!executor) throw new TypeError('审计日志写入器无效')
  await executor.execute(
    `INSERT INTO admin_audit_logs
       (admin_id, action, target_type, target_id, detail_json, request_id, ip_address, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
    [
      request.admin ? request.admin.id : null,
      String(action).slice(0, 64),
      String(targetType).slice(0, 40),
      String(targetId || '').slice(0, 64),
      JSON.stringify({ ...(detail || {}), userAgent: String(request.get('User-Agent') || '').slice(0, 300) }),
      String(request.id || '').slice(0, 64),
      String(request.ip || '').slice(0, 64)
    ]
  )
}

module.exports = { writeAudit }
