-- 骑手申请补充申报身份字段（2026-10-05）：真实姓名/性别由申请人自报，
-- 审核通过时写入 riders.name_note / riders.gender（见 admin.js review 路由），客服后续仍可在管理台修改。
-- 纯新增、可空列，历史申请行为 NULL；回滚 = 删除这两列。
ALTER TABLE rider_applications
  ADD COLUMN real_name VARCHAR(40) NULL AFTER name,
  ADD COLUMN gender ENUM('male','female') NULL AFTER student_id;
