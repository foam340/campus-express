-- 新版“一件一张卡片”订单模型。
-- 历史订单保持 pricing_model='legacy' 且 item_details_json=NULL，不做回填或重算。

ALTER TABLE orders
  ADD COLUMN pricing_model VARCHAR(20) NOT NULL DEFAULT 'legacy' AFTER no_upstairs,
  ADD COLUMN item_details_json LONGTEXT NULL AFTER pricing_model,
  ADD COLUMN item_subtotal DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER item_details_json,
  ADD COLUMN bundle_discount DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER item_subtotal,
  ADD COLUMN urgency_fee DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER bundle_discount,
  ADD COLUMN door_fee DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER urgency_fee;

ALTER TABLE platform_settings
  ADD COLUMN item_small_campus_price DECIMAL(10,2) NOT NULL DEFAULT 1.00 AFTER large_price,
  ADD COLUMN item_small_off_campus_price DECIMAL(10,2) NOT NULL DEFAULT 2.00 AFTER item_small_campus_price,
  ADD COLUMN item_medium_campus_price DECIMAL(10,2) NOT NULL DEFAULT 3.00 AFTER item_small_off_campus_price,
  ADD COLUMN item_medium_off_campus_price DECIMAL(10,2) NOT NULL DEFAULT 4.00 AFTER item_medium_campus_price,
  ADD COLUMN item_large_campus_price DECIMAL(10,2) NOT NULL DEFAULT 5.00 AFTER item_medium_off_campus_price,
  ADD COLUMN item_large_off_campus_price DECIMAL(10,2) NOT NULL DEFAULT 6.00 AFTER item_large_campus_price,
  ADD COLUMN item_urgent_fee DECIMAL(10,2) NOT NULL DEFAULT 5.00 AFTER item_large_off_campus_price,
  ADD COLUMN item_door_fee DECIMAL(10,2) NOT NULL DEFAULT 1.00 AFTER item_urgent_fee,
  ADD COLUMN bundle_tier1_threshold DECIMAL(10,2) NOT NULL DEFAULT 10.00 AFTER item_door_fee,
  ADD COLUMN bundle_tier1_discount DECIMAL(10,2) NOT NULL DEFAULT 1.00 AFTER bundle_tier1_threshold,
  ADD COLUMN bundle_tier2_threshold DECIMAL(10,2) NOT NULL DEFAULT 20.00 AFTER bundle_tier1_discount,
  ADD COLUMN bundle_tier2_discount DECIMAL(10,2) NOT NULL DEFAULT 3.00 AFTER bundle_tier2_threshold;
