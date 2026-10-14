-- 回滚 20260921_02_mini_idempotency.sql。
--
-- 只丢幂等键本身，不丢任何业务数据：表里存的全是「这个请求已经处理过、结果是这个」的缓存。
-- 删掉之后，客户端如果重发同一个 Idempotency-Key，会被当成新请求重新执行一遍。
-- 幂等键的保留期本来就只有 24 小时，所以影响面限于回滚当下正在重试的那几个请求。
DROP TABLE IF EXISTS mini_idempotency_keys;
