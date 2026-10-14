-- 骑手「姓名备注」：客服给骑手标注的真实姓名/备注，用于区分昵称重复的骑手。
-- 展示位置：管理台「骑手管理 → 骑手名单」列 + 「提现审核」姓名列。
ALTER TABLE riders ADD COLUMN name_note VARCHAR(40) NULL AFTER name;
