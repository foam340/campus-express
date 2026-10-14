SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- 移除 platform_settings 已废弃的 5 个列：营业开放时间 open_time、当天截止小时 cutoff_hour、
-- 以及旧「单轴计价」三列 urgent_price / today_price / tomorrow_price。
-- 背景：计价已切换为「校内/校外 × 加急/非加急」2×2 模型（campus_price / off_campus_price /
-- campus_urgent_price / off_campus_urgent_price），旧三列不再被任何后端读取；营业时间小程序端
-- 写死 09:00–20:00。关闭时间 close_time 仍由 mini 端截止时间逻辑读取，予以保留。
-- 幂等：每列先查 information_schema，存在才 PREPARE/EXECUTE 删除。

SET @has_col = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'platform_settings' AND column_name = 'open_time');
SET @drop_sql = IF(@has_col > 0, 'ALTER TABLE platform_settings DROP COLUMN open_time', 'SELECT 1');
PREPARE stmt FROM @drop_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'platform_settings' AND column_name = 'cutoff_hour');
SET @drop_sql = IF(@has_col > 0, 'ALTER TABLE platform_settings DROP COLUMN cutoff_hour', 'SELECT 1');
PREPARE stmt FROM @drop_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'platform_settings' AND column_name = 'urgent_price');
SET @drop_sql = IF(@has_col > 0, 'ALTER TABLE platform_settings DROP COLUMN urgent_price', 'SELECT 1');
PREPARE stmt FROM @drop_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'platform_settings' AND column_name = 'today_price');
SET @drop_sql = IF(@has_col > 0, 'ALTER TABLE platform_settings DROP COLUMN today_price', 'SELECT 1');
PREPARE stmt FROM @drop_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'platform_settings' AND column_name = 'tomorrow_price');
SET @drop_sql = IF(@has_col > 0, 'ALTER TABLE platform_settings DROP COLUMN tomorrow_price', 'SELECT 1');
PREPARE stmt FROM @drop_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
