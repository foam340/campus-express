-- 仅用于上线后尚未产生 itemized_v1 订单时的紧急回滚。
-- 若已产生新版订单，必须先保留 item_details_json 价格快照，禁止直接执行本脚本。

ALTER TABLE orders
  DROP COLUMN door_fee,
  DROP COLUMN urgency_fee,
  DROP COLUMN bundle_discount,
  DROP COLUMN item_subtotal,
  DROP COLUMN item_details_json,
  DROP COLUMN pricing_model;

ALTER TABLE platform_settings
  DROP COLUMN bundle_tier2_discount,
  DROP COLUMN bundle_tier2_threshold,
  DROP COLUMN bundle_tier1_discount,
  DROP COLUMN bundle_tier1_threshold,
  DROP COLUMN item_door_fee,
  DROP COLUMN item_urgent_fee,
  DROP COLUMN item_large_off_campus_price,
  DROP COLUMN item_large_campus_price,
  DROP COLUMN item_medium_off_campus_price,
  DROP COLUMN item_medium_campus_price,
  DROP COLUMN item_small_off_campus_price,
  DROP COLUMN item_small_campus_price;
