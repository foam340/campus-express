-- 回滚 20260923_01_campus_expansion.sql。
--
-- ⚠️ 会删除石牌 platform_settings 行 id=2，并 DROP users.campus / users.address /
--    platform_settings.campus 三列。列上的数据（校区归属、自由地址）一并丢失，不可恢复。
--    执行前先导出：
--      SELECT id, campus, address FROM users WHERE campus = 'shipai' OR address <> '';
--      SELECT * FROM platform_settings WHERE campus = 'shipai';
--    ⚠️ 若此后已有石牌订单/骑手依赖这些列，回滚会破坏它们（2026-09-23 尚无，但不保证）。

DELETE FROM platform_settings WHERE id = 2;
ALTER TABLE platform_settings DROP COLUMN campus;
ALTER TABLE users DROP COLUMN address, DROP COLUMN campus;
