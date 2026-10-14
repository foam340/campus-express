-- 只允许在尚未创建 pricing_version=2 的订单时执行。
-- 已产生 V2 订单后必须保留价格快照列，不能用本脚本回滚。

ALTER TABLE orders
  DROP COLUMN building_fee,
  DROP COLUMN pricing_version;

ALTER TABLE platform_settings
  DROP COLUMN bundle_tier0_discount,
  DROP COLUMN bundle_tier0_threshold,
  DROP COLUMN item_upper_floor_door_fee,
  DROP COLUMN item_building_9_fee,
  DROP COLUMN item_pricing_version;
