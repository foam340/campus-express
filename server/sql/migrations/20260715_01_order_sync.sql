SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS order_uploads (
  id CHAR(32) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  kind ENUM('pickup','delivery') NOT NULL,
  storage_path VARCHAR(600) NOT NULL,
  mime_type VARCHAR(64) NOT NULL,
  file_size INT UNSIGNED NOT NULL,
  status ENUM('uploaded','attached','deleted') NOT NULL DEFAULT 'uploaded',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_order_uploads_user_status (user_id, status, created_at),
  CONSTRAINT fk_order_uploads_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_attachments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id VARCHAR(32) NOT NULL,
  upload_id CHAR(32) NOT NULL,
  kind ENUM('pickup','delivery') NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_order_attachments_upload (upload_id),
  KEY idx_order_attachments_order_kind (order_id, kind),
  CONSTRAINT fk_order_attachments_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_order_attachments_upload FOREIGN KEY (upload_id) REFERENCES order_uploads(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
