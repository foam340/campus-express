SET NAMES utf8mb4;
SET time_zone = '+00:00';

ALTER TABLE orders
  ADD COLUMN note VARCHAR(100) NOT NULL DEFAULT '' AFTER urgency;
