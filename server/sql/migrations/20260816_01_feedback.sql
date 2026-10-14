-- 意见反馈表：用户在小程序「我的-意见反馈」提交建议/问题，管理员在管理台查看处理
CREATE TABLE IF NOT EXISTS feedbacks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NULL,
  category ENUM('suggestion','problem','other') NOT NULL,
  content VARCHAR(500) NOT NULL,
  status ENUM('unread','read','resolved') NOT NULL DEFAULT 'unread',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_feedbacks_status_created (status, created_at),
  KEY idx_feedbacks_user_created (user_id, created_at),
  CONSTRAINT fk_feedbacks_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
