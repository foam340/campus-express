-- 多校区配置化重构（阶段3 唯一 DDL）：orders.pickup_station 从 ENUM('south','west') 放宽为 VARCHAR(16) NULL。
-- 目的：驿站枚举是石牌专属，新校区驿站无法用 ENUM 表达；放宽后由 campus-config 按校区解释，
--       'south'/'west' 原值保留（老订单零迁移），新校区可存任意驿站键或 NULL。
-- ⚠️ 一次性迁移，别重复跑。已备份 orders 表（shared/backups/orders-pre-ddl-20261009.sql）。

SET NAMES utf8mb4;
SET time_zone = '+00:00';

ALTER TABLE orders MODIFY pickup_station VARCHAR(16) NULL;
