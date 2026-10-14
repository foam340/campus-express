-- 逐件计价 V2：只增加版本和费用快照，不回填、不重算任何历史订单金额。
-- 迁移默认仍是 V1 价格；部署兼容代码并核验后，再单独事务切换为 V2。

ALTER TABLE orders
  ADD COLUMN pricing_version INT UNSIGNED NOT NULL DEFAULT 1 AFTER pricing_model,
  ADD COLUMN building_fee DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER door_fee;

ALTER TABLE platform_settings
  ADD COLUMN item_pricing_version INT UNSIGNED NOT NULL DEFAULT 1 AFTER large_price,
  ADD COLUMN item_building_9_fee DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER item_door_fee,
  ADD COLUMN item_upper_floor_door_fee DECIMAL(10,2) NOT NULL DEFAULT 1.50 AFTER item_building_9_fee,
  ADD COLUMN bundle_tier0_threshold DECIMAL(10,2) NOT NULL DEFAULT 5.00 AFTER item_upper_floor_door_fee,
  ADD COLUMN bundle_tier0_discount DECIMAL(10,2) NOT NULL DEFAULT 0.50 AFTER bundle_tier0_threshold;
