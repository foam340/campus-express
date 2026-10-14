SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- 额外收支记账：管理台「净收入明细」页手工登记的订单外收支（骑手补贴、传单印刷、物料采购等）。
-- 只影响管理台展示：不参与订单计价、不进入骑手结算、不回填任何历史数据。
--
-- entry_date 故意用 DATE（纯日期）而不是 DATETIME：要记的是「归到哪一天」，不是「哪一刻」。
-- 存纯日期可以彻底绕开 UTC↔北京换算——本项目已经在这一类换算上反复踩坑。
-- 读写约定：写入传 'YYYY-MM-DD' 字符串；读取用 DATE_FORMAT(entry_date, '%Y-%m-%d')。
-- ⚠️ 不要直接 SELECT entry_date：mysql2（timezone:'Z'）会把它返回成 JS Date 对象，
--    再当成日期键用会让同一天裂成两条。
--
-- amount 恒为正数，收入/支出由 direction 决定，避免出现「负的支出」这种双重否定。
-- created_at / updated_at 与全库一致存 UTC；写入时显式传 UTC_TIMESTAMP()，不要依赖列默认值
-- （默认值走的是 MySQL 会话时区，服务器上不一定是 UTC）。
CREATE TABLE IF NOT EXISTS ledger_entries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  entry_date DATE NOT NULL,
  direction ENUM('income','expense') NOT NULL,
  category VARCHAR(32) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  note VARCHAR(200) NOT NULL DEFAULT '',
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ledger_entries_date (entry_date, id),
  KEY idx_ledger_entries_created (created_at),
  CONSTRAINT fk_ledger_entries_created_by FOREIGN KEY (created_by) REFERENCES admin_users(id),
  CONSTRAINT fk_ledger_entries_updated_by FOREIGN KEY (updated_by) REFERENCES admin_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
