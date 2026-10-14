SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- 校内/校外取件地点 + 2×2 计价（Phase 1：纯增量列，不改变现有下单计费行为）。
-- pickup_scope 仅由 Phase 2 上线后的新订单写入，历史订单保持 NULL（前端显示「—」）。
-- 4 个新价格列仅由 Phase 2 的 mini 端计价读取，Phase 1 期间不参与任何计费。

ALTER TABLE orders
  ADD COLUMN pickup_scope ENUM('campus','off_campus') NULL DEFAULT NULL AFTER urgency;

ALTER TABLE platform_settings
  ADD COLUMN campus_price        DECIMAL(10,2) NOT NULL DEFAULT 1.00 AFTER tomorrow_price,
  ADD COLUMN off_campus_price    DECIMAL(10,2) NOT NULL DEFAULT 2.00 AFTER campus_price,
  ADD COLUMN campus_urgent_price DECIMAL(10,2) NOT NULL DEFAULT 8.00 AFTER off_campus_price,
  ADD COLUMN off_campus_urgent_price DECIMAL(10,2) NOT NULL DEFAULT 9.00 AFTER campus_urgent_price;
