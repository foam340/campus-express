SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- 移除 platform_settings 已废弃的 admin_wechat 列。
-- 背景：小程序端客服微信号由前端 config/business.js 的 DEFAULT_SETTINGS.adminWechat 写死，
-- 后端 /mini/settings（readMiniSettings）从不返回该字段，管理台「平台设置」里改它不会影响
-- 任何下游（死字段）。管理台前端、后端 readSettings/校验/UPDATE 均已移除，本迁移删列收尾。
-- 幂等：先查 information_schema，存在才 PREPARE/EXECUTE 删除。

SET @has_col = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'platform_settings' AND column_name = 'admin_wechat');
SET @drop_sql = IF(@has_col > 0, 'ALTER TABLE platform_settings DROP COLUMN admin_wechat', 'SELECT 1');
PREPARE stmt FROM @drop_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
