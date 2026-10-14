SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- 小程序侧的幂等键表：给 mini 写路由查重用。
--
-- 为什么不复用 idempotency_keys：那张表的 admin_id 有指向 admin_users(id) 的外键，
-- 装不下 mini 用户 id。硬塞要么违反外键，要么和真实管理员 id 撞号——后者会让一个用户的
-- 幂等键命中另一个管理员的响应，属于越权。所以另起一张结构相同的平表。
--
-- 记录生命周期与 admin 侧一致：
--   INSERT 时 response_status = 0（占位）、expires_at = +5 分钟；
--   处理成功后 sendIdempotent 回填响应体、expires_at = +24 小时。
-- 命中一张 response_status 仍为 0 的占位行说明「同一操作正在处理中」，返回 409 而不是重复执行。
--
-- key_hash 的算法与 admin 侧相同（sha256），但参与哈希的主体是 mini 用户 id 而不是管理员 id。
CREATE TABLE IF NOT EXISTS mini_idempotency_keys (
  key_hash CHAR(64) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  method VARCHAR(10) NOT NULL,
  request_path VARCHAR(255) NOT NULL,
  response_status SMALLINT UNSIGNED NOT NULL,
  response_body MEDIUMTEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (key_hash),
  KEY idx_mini_idempotency_expiry (expires_at),
  CONSTRAINT fk_mini_idempotency_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
