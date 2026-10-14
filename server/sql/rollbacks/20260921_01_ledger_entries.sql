-- 回滚 20260921_01_ledger_entries.sql。
--
-- ⚠️ 会连同表内所有手工登记的额外收支一起删除，且不可恢复。
--    这张表里存的是账，不是缓存——执行前先导出：
--      SELECT * FROM ledger_entries;
--    「净收入明细」页的「实际净收入」列会在回滚后立刻少掉这部分金额。
DROP TABLE IF EXISTS ledger_entries;
