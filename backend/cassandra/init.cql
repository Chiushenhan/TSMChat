-- TSMChat Cassandra Schema

CREATE KEYSPACE IF NOT EXISTS tsmchat
WITH replication = {
  'class': 'SimpleStrategy',
  'replication_factor': 1
};

USE tsmchat;

CREATE TABLE IF NOT EXISTS messages (
  room_id       TEXT,
  created_at    TIMESTAMP,
  message_id    TIMEUUID,
  sender_id     TEXT,
  sender_name   TEXT,
  sender_avatar_text TEXT,
  sender_avatar_url  TEXT,
  text          TEXT,
  PRIMARY KEY (room_id, created_at, message_id)
) WITH CLUSTERING ORDER BY (created_at DESC, message_id DESC);
