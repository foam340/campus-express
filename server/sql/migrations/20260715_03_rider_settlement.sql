SET NAMES utf8mb4;
SET time_zone = '+00:00';

ALTER TABLE orders
  ADD COLUMN income_frozen_at DATETIME NULL AFTER completed_at,
  ADD COLUMN settled_at DATETIME NULL AFTER income_frozen_at;
