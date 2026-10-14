-- 骑手性别：客服在管理台填写（男/女），空白=未填。
-- 用于南海校区「送上楼的单只有同性才能接」的限制：异性骑手大厅看不到、accept 也会拦。
ALTER TABLE riders ADD COLUMN gender ENUM('male','female') NULL AFTER name_note;
