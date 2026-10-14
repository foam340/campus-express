SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- 石牌校区扩展（第一部分）：测试账号转石牌 + /mini/settings 按校区返回 所需的最小改动。
--
-- 这是 2026-09-23 已上生产的那次变更的忠实记录（当时直接执行、没落成迁移文件，现补上）。
-- 范围刻意收窄：不含设计文档 BACKEND-CAMPUS-EXPANSION-PLAN-2026-09-23.md §1 的完整改动
-- （orders / riders / rider_applications / admin_users 的 campus 列、campus_change_requests 表等）。
-- 那些属于「后端改造」的后续部分，尚未实施；落地时另开迁移文件，不要混进本文件。
--
-- 三件事：
--   1) users 加 campus / address 两列（老用户默认 nanhai、南海零感知）；
--   2) platform_settings 加 campus 列；
--   3) 插入石牌 platform_settings 行 id=2（照南海 id=1 整行复制，改 item_* 石牌价）。
--
-- campus 取值 VARCHAR(16) + 应用层白名单 nanhai|shipai（见 server/src/routes/mini.js）。
-- ⚠️ 本文件是一次性迁移：ALTER ADD COLUMN 与固定 id=2 的 INSERT 都不可重入，且已在生产执行过，别重复跑。

ALTER TABLE users
  ADD COLUMN campus VARCHAR(16) NOT NULL DEFAULT 'nanhai',
  ADD COLUMN address VARCHAR(200) NOT NULL DEFAULT '';

ALTER TABLE platform_settings
  ADD COLUMN campus VARCHAR(16) NOT NULL DEFAULT 'nanhai';

INSERT INTO platform_settings
  (campus, id, close_time,
   campus_price, off_campus_price, campus_urgent_price, off_campus_urgent_price,
   extra_piece_price, large_price, item_pricing_version,
   item_small_campus_price, item_small_off_campus_price,
   item_medium_campus_price, item_medium_off_campus_price,
   item_large_campus_price, item_large_off_campus_price,
   item_urgent_fee, item_door_fee, item_building_9_fee, item_upper_floor_door_fee,
   bundle_tier0_threshold, bundle_tier0_discount,
   bundle_tier1_threshold, bundle_tier1_discount, bundle_tier2_threshold, bundle_tier2_discount,
   auto_confirm_hours, observation_hours, claim_limit,
   commission_rate, service_status, service_notice, review_mode,
   rider_experience_started_at, updated_by, created_at, updated_at)
SELECT 'shipai', 2, close_time,
       campus_price, off_campus_price, campus_urgent_price, off_campus_urgent_price,
       extra_piece_price, large_price, 2,
       2.00, 2.00, 4.00, 4.00, 7.00, 7.00,
       4.00, 2.00, 0.00, 2.00,
       bundle_tier0_threshold, bundle_tier0_discount,
       bundle_tier1_threshold, bundle_tier1_discount, bundle_tier2_threshold, bundle_tier2_discount,
       auto_confirm_hours, observation_hours, claim_limit,
       commission_rate, service_status, service_notice, review_mode,
       rider_experience_started_at, updated_by, created_at, updated_at
  FROM platform_settings WHERE id = 1;
