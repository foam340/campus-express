-- Append the new value to preserve the numeric indexes of historical ENUM values.
-- Metadata-only online change on MySQL 5.7; abort instead of falling back to a table copy.
ALTER TABLE orders
  MODIFY COLUMN urgency ENUM('urgent','today','tomorrow','soon') NOT NULL,
  ALGORITHM=INPLACE,
  LOCK=NONE;
