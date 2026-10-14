SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- 手机号是配送联系方式，不作为账户身份。账户身份以微信 openid 为准。
SET @has_unique_phone = (
  SELECT COUNT(*)
    FROM information_schema.statistics
   WHERE table_schema = DATABASE()
     AND table_name = 'users'
     AND index_name = 'uk_users_phone'
);
SET @drop_unique_phone_sql = IF(
  @has_unique_phone > 0,
  'ALTER TABLE users DROP INDEX uk_users_phone',
  'SELECT 1'
);
PREPARE drop_unique_phone_statement FROM @drop_unique_phone_sql;
EXECUTE drop_unique_phone_statement;
DEALLOCATE PREPARE drop_unique_phone_statement;

SET @has_phone_index = (
  SELECT COUNT(*)
    FROM information_schema.statistics
   WHERE table_schema = DATABASE()
     AND table_name = 'users'
     AND index_name = 'idx_users_phone'
);
SET @add_phone_index_sql = IF(
  @has_phone_index = 0,
  'ALTER TABLE users ADD INDEX idx_users_phone (phone)',
  'SELECT 1'
);
PREPARE add_phone_index_statement FROM @add_phone_index_sql;
EXECUTE add_phone_index_statement;
DEALLOCATE PREPARE add_phone_index_statement;
