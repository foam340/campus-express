-- 订单预订送达时间：用于「超时未接单自动退款」判断
-- urgent=下单后1小时、today=当天22:00、tomorrow=次日22:00（均为北京时间，存储为 UTC）
ALTER TABLE orders
  ADD COLUMN deadline_at DATETIME NULL AFTER urgency;
