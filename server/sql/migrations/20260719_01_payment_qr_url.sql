-- Add payment_qr_url column for offline QR code payment
ALTER TABLE platform_settings
  ADD COLUMN payment_qr_url VARCHAR(500) NOT NULL DEFAULT '' AFTER admin_wechat;
