-- 优惠券分校区改造：三张券表加 campus 列 + users 补 (campus) 索引 + 方案 A 精确回填。
-- 背景：优惠券原不按校区隔离（§61），现改为分校区运营；NULL = 全校区通用，'nanhai'/'shipai'/'gqg' = 仅该校区。
-- 存量核验（2026-10-09）：coupon_campaigns 43 个全 scope='single'（南海运营期）；coupon_codes 2 条均 redeemed；
--   user_coupons 871 张，按持有者 campus：nanhai 869 / shipai 2。
-- 回填（方案 A）：user_coupons 按持有者 users.campus 精确回填（2 张石牌券归石牌）；campaigns/codes 回填 nanhai。
-- ⚠️ 一次性迁移，别重复跑。已备份三表（shared/backups/coupons-pre-campus-20261009.sql）。

SET NAMES utf8mb4;
SET time_zone = '+00:00';

ALTER TABLE coupon_campaigns ADD COLUMN campus VARCHAR(16) NULL COMMENT '券活动所属校区，NULL=全校区通用' AFTER scope;
ALTER TABLE coupon_codes     ADD COLUMN campus VARCHAR(16) NULL COMMENT '兑换码所属校区，NULL=全校区通用' AFTER status;
ALTER TABLE user_coupons     ADD COLUMN campus VARCHAR(16) NULL COMMENT '用户券校区（领券时快照），NULL=全校区通用' AFTER status;

ALTER TABLE users ADD KEY idx_users_campus (campus);

-- 方案 A 精确回填
UPDATE user_coupons uc JOIN users u ON u.id = uc.user_id SET uc.campus = u.campus;
UPDATE coupon_campaigns SET campus = 'nanhai' WHERE campus IS NULL;
UPDATE coupon_codes SET campus = 'nanhai' WHERE campus IS NULL;
