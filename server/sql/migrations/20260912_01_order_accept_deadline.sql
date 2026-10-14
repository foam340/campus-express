-- 「接单截止」时间：每天 20:30（北京）仍无人接单的订单自动原路退款。
-- 与 deadline_at（预订送达时间，today/tomorrow 档 = 当天 close_time，现为 23:00）是两回事：
-- deadline_at 继续给管理台「最晚交付」列显示，accept_deadline_at 只驱动 refund-sweep 的超时退款。
-- urgent 档两者一致，都是下单后 1 小时。均为北京时间，存储为 UTC。
-- 存量 waiting 单该列为 NULL，扫描侧用 COALESCE(accept_deadline_at, deadline_at) 兜底，无需回填。
ALTER TABLE orders
  ADD COLUMN accept_deadline_at DATETIME NULL AFTER deadline_at;

ALTER TABLE orders
  ADD INDEX idx_orders_status_accept_deadline (status, accept_deadline_at);
