-- 石牌楼栋名列溢出修复：users/orders 的 building 从 VARCHAR(4) 放宽为 VARCHAR(16)、room 从 VARCHAR(12) 放宽为 VARCHAR(50)。
-- 根因：石牌扩展（§68）引入 32 栋中文楼栋名，但 building 列仍为南海时代 VARCHAR(4)（最长「25号楼」=4 字符），
--       10 栋楼栋名超 4 字符（研究生公寓A/B/C座、东19栋南、中区20/22/23/34/35栋、留学生公寓）注册/下单时溢出 500。
-- 放宽覆盖最长楼栋名 7 字符并为未来新校区留余量；room 对齐自由房号上限 50。
-- ⚠️ 一次性迁移，别重复跑。已备份 users+orders（shared/backups/users-orders-pre-building-varchar-20261009.sql）。

SET NAMES utf8mb4;
SET time_zone = '+00:00';

ALTER TABLE users MODIFY building VARCHAR(16) NOT NULL DEFAULT '1';
ALTER TABLE users MODIFY room VARCHAR(50) NOT NULL DEFAULT '';
ALTER TABLE orders MODIFY building VARCHAR(16) NOT NULL;
ALTER TABLE orders MODIFY room VARCHAR(50) NOT NULL;
