-- 服务状态开关：管理员在管理台切换「停止服务」，小程序端显示停服提示，并停止接收新订单/新抢单
ALTER TABLE platform_settings
  ADD COLUMN service_status ENUM('open','closed') NOT NULL DEFAULT 'open' AFTER payment_qr_url,
  ADD COLUMN service_notice VARCHAR(200) NOT NULL DEFAULT '节假日小程序暂停服务，恢复时间另行通知' AFTER service_status;
