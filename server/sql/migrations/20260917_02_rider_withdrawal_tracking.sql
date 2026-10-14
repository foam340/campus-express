SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- 骑手「提现后隐藏已提现订单」：orders 加「已提现」标记。
-- 钱包收支明细只显示 withdrawn_at IS NULL 的订单；提现审核通过时打标（admin.js /withdrawals/:id/review）。
ALTER TABLE orders
  ADD COLUMN withdrawn_at DATETIME NULL AFTER settled_at;
