-- 仅用于「提现后隐藏已提现订单」功能回退。
-- 若已有多笔订单被打上 withdrawn_at，执行后这些订单会重新出现在骑手明细里（不涉及金额，仅显示回退）。
ALTER TABLE orders
  DROP COLUMN withdrawn_at;
