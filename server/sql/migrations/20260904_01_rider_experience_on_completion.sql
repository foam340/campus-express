SET NAMES utf8mb4;
SET time_zone = '+00:00';

START TRANSACTION;

-- 内部事件类型沿用 order_settled，避免曾由旧版本奖励过的订单因事件改名重复加分。
-- 奖励条件改为订单已完成；收入是否结束售后观察期、是否已结算不参与经验判断。
INSERT INTO rider_experience_events (rider_id, order_id, event_type, points, created_at)
SELECT o.rider_id, o.id, 'order_settled', 10, UTC_TIMESTAMP()
  FROM orders o
  JOIN platform_settings settings ON settings.id = 1
 WHERE o.status = 'completed'
   AND o.completed_at IS NOT NULL
   AND o.rider_id IS NOT NULL
   AND settings.rider_experience_started_at IS NOT NULL
   AND o.created_at >= settings.rider_experience_started_at
   AND NOT EXISTS (
     SELECT 1
       FROM rider_experience_events existing
      WHERE existing.order_id = o.id
        AND existing.event_type = 'order_settled'
   )
ON DUPLICATE KEY UPDATE order_id = VALUES(order_id);

UPDATE riders r
JOIN (
  SELECT rider_id, SUM(points) AS total_points
    FROM rider_experience_events
   GROUP BY rider_id
) totals ON totals.rider_id = r.id
   SET r.experience_points = totals.total_points,
       r.updated_at = UTC_TIMESTAMP()
 WHERE r.experience_points <> totals.total_points;

COMMIT;
