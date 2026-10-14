-- 移除已废弃的「线下收款码图片链接」字段：支付已统一由 XorPay 二维码完成，小程序端不再展示该收款码
ALTER TABLE platform_settings DROP COLUMN payment_qr_url;
