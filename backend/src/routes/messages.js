import { Router } from "express";
import cassandraClient from "../config/cassandra.js";
import pool from "../config/db.js";
import { authMiddleware } from "../middleware/auth.js";
import { messagesSentTotal, errorsTotal } from "../metrics/prometheus.js";
import { broadcastNewMessage } from "../socket/broadcast.js";
import { invalidateMessageCountCache } from "../utils/metricsSync.js";
import { formatTime } from "../utils/time.js";
import { isRoomMember } from "../utils/roomAccess.js";
import { v1 as uuidv1 } from "uuid";

const router = Router();

router.get("/:roomId", authMiddleware, async (req, res) => {
  try {
    const { roomId } = req.params;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 500);
    const userId = req.user.id;

    if (!(await isRoomMember(userId, roomId))) {
      return res.status(403).json({ error: "Not a member of this room" });
    }

    // Read the full room partition and sort in memory so history is reliable
    // regardless of Cassandra clustering order (ASC vs DESC in different deploys).
    const result = await cassandraClient.execute(
      `SELECT message_id, room_id, sender_id, sender_name, sender_avatar_text,
              sender_avatar_url, text, created_at
       FROM messages
       WHERE room_id = ?`,
      [roomId],
      { prepare: true }
    );

    const messages = result.rows
      .map((row) => {
        const createdAt = new Date(row.created_at);
        return {
          id: row.message_id.toString(),
          senderId: row.sender_id,
          senderName: row.sender_name,
          senderAvatarText: row.sender_avatar_text || "",
          senderAvatarUrl: row.sender_avatar_url || "",
          text: row.text,
          createdAt: formatTime(createdAt),
          createdAtMs: createdAt.getTime()
        };
      })
      .sort((a, b) => {
        const diff = a.createdAtMs - b.createdAtMs;
        if (diff !== 0) return diff;
        return a.id.localeCompare(b.id);
      });

    const recent =
      messages.length > limit ? messages.slice(messages.length - limit) : messages;

    res.json(recent);
  } catch (err) {
    console.error("Get messages error:", err);
    errorsTotal.labels("messages_get").inc();
    res.status(500).json({ error: "Failed to get messages" });
  }
});

router.post("/:roomId", authMiddleware, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { text } = req.body;
    const userId = req.user.id;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: "Message text is required" });
    }

    if (!(await isRoomMember(userId, roomId))) {
      return res.status(403).json({ error: "Not a member of this room" });
    }

    const userResult = await pool.query(
      `SELECT name, avatar_text, avatar_url FROM users WHERE id = $1`,
      [userId]
    );

    const user = userResult.rows[0] || { name: userId, avatar_text: "??", avatar_url: "" };
    const now = new Date();
    const messageId = uuidv1();

    await cassandraClient.execute(
      `INSERT INTO messages (room_id, created_at, message_id, sender_id, sender_name,
                             sender_avatar_text, sender_avatar_url, text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [roomId, now, messageId, userId, user.name, user.avatar_text, user.avatar_url, text.trim()],
      { prepare: true }
    );

    await pool.query(
      `UPDATE chatrooms SET last_message = $1, updated_at = NOW() WHERE id = $2`,
      [text.trim(), roomId]
    );

    messagesSentTotal.inc();
    invalidateMessageCountCache();

    const message = {
      id: messageId,
      senderId: userId,
      senderName: user.name,
      senderAvatarText: user.avatar_text || "",
      senderAvatarUrl: user.avatar_url || "",
      text: text.trim(),
      createdAt: formatTime(now),
      createdAtMs: now.getTime()
    };

    broadcastNewMessage(roomId, message);

    res.status(201).json(message);
  } catch (err) {
    console.error("Send message error:", err);
    errorsTotal.labels("message_send").inc();
    res.status(500).json({ error: "Failed to send message" });
  }
});

router.delete("/:roomId", authMiddleware, async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;

    if (!(await isRoomMember(userId, roomId))) {
      return res.status(403).json({ error: "Not a member of this room" });
    }

    await cassandraClient.execute(
      `DELETE FROM messages WHERE room_id = ?`,
      [roomId],
      { prepare: true }
    );

    const clearedAt = new Date();
    const systemMsg = {
      id: uuidv1(),
      senderId: "system",
      senderName: "System",
      senderAvatarText: "S",
      senderAvatarUrl: "",
      text: "聊天紀錄已被清除。",
      createdAt: formatTime(clearedAt),
      createdAtMs: clearedAt.getTime()
    };

    await cassandraClient.execute(
      `INSERT INTO messages (room_id, created_at, message_id, sender_id, sender_name,
                             sender_avatar_text, sender_avatar_url, text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [roomId, new Date(), systemMsg.id, "system", "System", "S", "", systemMsg.text],
      { prepare: true }
    );

    await pool.query(
      `UPDATE chatrooms SET last_message = $1, updated_at = NOW() WHERE id = $2`,
      ["聊天紀錄已被清除", roomId]
    );

    invalidateMessageCountCache();

    res.json([systemMsg]);
  } catch (err) {
    console.error("Clear messages error:", err);
    errorsTotal.labels("messages_clear").inc();
    res.status(500).json({ error: "Failed to clear messages" });
  }
});

export default router;
