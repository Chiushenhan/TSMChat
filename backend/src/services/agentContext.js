import cassandraClient from "../config/cassandra.js";
import pool from "../config/db.js";
import { formatTime } from "../utils/time.js";

const MAX_CONTEXT_CHARS = parseInt(process.env.AGENT_MAX_CONTEXT_CHARS || "48000", 10);
const MAX_CONTEXT_CHARS_FULL = parseInt(process.env.AGENT_MAX_CONTEXT_CHARS_FULL || "120000", 10);
const MESSAGES_PER_ROOM = parseInt(process.env.AGENT_MESSAGES_PER_ROOM || "50", 10);
const MESSAGES_FOCUS_ROOM = parseInt(process.env.AGENT_MESSAGES_FOCUS_ROOM || "80", 10);

function mapMessageRow(row) {
  const createdAt = new Date(row.created_at);
  return {
    id: row.message_id.toString(),
    senderId: row.sender_id,
    senderName: row.sender_name,
    text: row.text,
    createdAt: formatTime(createdAt),
    createdAtMs: createdAt.getTime()
  };
}

function sortMessages(messages) {
  return messages.sort((a, b) => {
    const diff = a.createdAtMs - b.createdAtMs;
    if (diff !== 0) return diff;
    return a.id.localeCompare(b.id);
  });
}

async function fetchRecentRoomMessages(roomId, limit) {
  const all = await fetchAllRoomMessages(roomId);
  if (all.length <= limit) return all;
  return all.slice(-limit);
}

async function fetchAllRoomMessages(roomId) {
  const query = `SELECT message_id, sender_id, sender_name, text, created_at
     FROM messages WHERE room_id = ?`;

  const messages = [];
  let pageState = null;

  do {
    const result = await cassandraClient.execute(query, [roomId], {
      prepare: true,
      fetchSize: 500,
      pageState
    });

    for (const row of result.rows) {
      messages.push(mapMessageRow(row));
    }

    pageState = result.pageState;
  } while (pageState);

  return sortMessages(messages);
}

async function getUserRooms(userId) {
  const result = await pool.query(
    `SELECT c.id, c.type, c.name, c.last_message, c.updated_at
     FROM chatrooms c
     INNER JOIN chatroom_members cm ON c.id = cm.room_id
     WHERE cm.user_id = $1
     ORDER BY c.updated_at DESC`,
    [userId]
  );
  return result.rows;
}

async function getRoomMemberNames(roomId) {
  const result = await pool.query(
    `SELECT u.name
     FROM users u
     INNER JOIN chatroom_members cm ON u.id = cm.user_id
     WHERE cm.room_id = $1
     ORDER BY u.name`,
    [roomId]
  );
  return result.rows.map((row) => row.name);
}

function formatRoomSection(room, memberNames, messages, totalFetched, { isFocus = false } = {}) {
  const members = memberNames.join(", ") || "(none)";
  const roomLabel = room.type === "direct" ? "1v1 chat" : "group";
  const focusTag = isFocus ? " [Currently open]" : "";
  const roomUpdated = room.updated_at ? formatTime(new Date(room.updated_at)) : "unknown";
  const lastPreview = room.last_message
    ? `\nLatest preview (DB): "${room.last_message}" @ ${roomUpdated}`
    : "";

  const header = `## ${room.name} (${roomLabel})${focusTag} | members: ${members}${lastPreview}`;

  if (messages.length === 0) {
    return `${header}\n(no messages in store)\n`;
  }

  const omitted =
    totalFetched > messages.length
      ? ` [showing latest ${messages.length} of ${totalFetched}]`
      : "";

  const lines = messages.map((m, index) => {
    const latestTag = index === messages.length - 1 ? " [LATEST]" : "";
    return `${m.createdAt} ${m.senderName}: ${m.text}${latestTag}`;
  });

  return `${header}${omitted}\n${lines.join("\n")}\n`;
}

function buildLatestActivityBlock(rooms, roomMessages) {
  const latest = [];

  for (const room of rooms) {
    const messages = roomMessages.get(room.id) || [];
    const last = messages[messages.length - 1];
    if (!last) continue;

    latest.push({
      roomName: room.name,
      roomType: room.type,
      ...last
    });
  }

  latest.sort((a, b) => b.createdAtMs - a.createdAtMs);

  if (latest.length === 0) {
    return "No messages yet across your rooms.";
  }

  return latest
    .slice(0, 15)
    .map(
      (m, index) =>
        `${index === 0 ? "[NEWEST] " : ""}${m.createdAt} | ${m.roomName} (${m.roomType}) | ${m.senderName}: ${m.text}`
    )
    .join("\n");
}

function trimRoomSections(headerLines, sections, maxChars) {
  const header = headerLines.join("\n");
  const kept = [header];
  let used = header.length;
  let droppedMessages = 0;
  let truncated = false;

  for (const section of sections) {
    if (used + section.length + 1 <= maxChars) {
      kept.push(section);
      used += section.length + 1;
      continue;
    }

    const remaining = Math.max(0, maxChars - used - 20);
    if (remaining > 0) {
      kept.push(`${section.slice(0, remaining)}\n[truncated]`);
      used = maxChars;
    }

    droppedMessages += (section.match(/\n/g) || []).length;
    truncated = true;
  }

  return { text: kept.join("\n"), truncated, droppedMessages };
}

function wantsFullHistory(userMessage, fullHistory) {
  if (fullHistory) return true;
  const text = String(userMessage || "").toLowerCase();
  return /full history|完整歷史|全部訊息|all messages|entire chat|所有聊天|全部聊天/i.test(text);
}

function orderRooms(rooms, focusRoomId) {
  if (!focusRoomId) return rooms;

  const focus = rooms.find((room) => room.id === focusRoomId);
  if (!focus) return rooms;

  return [focus, ...rooms.filter((room) => room.id !== focusRoomId)];
}

async function buildRoomSection(room, messageLimit, useFullHistory, isFocus) {
  const memberNames = await getRoomMemberNames(room.id);
  const stored = await fetchAllRoomMessages(room.id);
  const messages = useFullHistory
    ? stored
    : stored.length > messageLimit
      ? stored.slice(-messageLimit)
      : stored;

  return {
    section: formatRoomSection(room, memberNames, messages, stored.length, { isFocus }),
    messageCount: messages.length,
    messages
  };
}

export async function buildChatContext(
  userId,
  { roomId, userMessage = "", fullHistory = false } = {}
) {
  const rooms = await getUserRooms(userId);
  if (rooms.length === 0) {
    return {
      context: "(User has no chat rooms yet.)",
      roomCount: 0,
      messageCount: 0,
      truncated: false,
      mode: "empty"
    };
  }

  if (roomId && !rooms.some((room) => room.id === roomId)) {
    throw new Error("Not a member of this room");
  }

  const useFullHistory = wantsFullHistory(userMessage, fullHistory);
  const orderedRooms = orderRooms(rooms, roomId);
  const directCount = rooms.filter((room) => room.type === "direct").length;
  const groupCount = rooms.length - directCount;

  const headerLines = [
    useFullHistory
      ? "TSMChat context: full message history from all of your conversations"
      : `TSMChat context: recent messages from all of your conversations (${MESSAGES_PER_ROOM} per room)`,
    `Rooms included: ${rooms.length} total (${directCount} direct / 1v1, ${groupCount} group)`,
    roomId ? `Currently open room is listed first for priority.` : "",
    ""
  ].filter(Boolean);

  const sections = [];
  const roomMessages = new Map();
  let messageCount = 0;
  const fetchedAt = new Date().toISOString();

  for (const room of orderedRooms) {
    const isFocus = room.id === roomId;
    const limit = useFullHistory
      ? Number.MAX_SAFE_INTEGER
      : isFocus
        ? MESSAGES_FOCUS_ROOM
        : MESSAGES_PER_ROOM;

    const { section, messageCount: count, messages } = await buildRoomSection(
      room,
      limit,
      useFullHistory,
      isFocus
    );

    sections.push(section);
    roomMessages.set(room.id, messages);
    messageCount += count;
  }

  const latestActivity = buildLatestActivityBlock(rooms, roomMessages);
  const charLimit = useFullHistory ? MAX_CONTEXT_CHARS_FULL : MAX_CONTEXT_CHARS;
  const { text, truncated, droppedMessages } = trimRoomSections(
    [
      ...headerLines,
      `Context fetched live at: ${fetchedAt} (Asia/Taipei server time)`,
      "",
      "## Most recent activity (newest first)",
      latestActivity,
      ""
    ],
    sections,
    charLimit
  );

  return {
    context: text,
    roomCount: rooms.length,
    messageCount,
    truncated,
    droppedMessages,
    mode: useFullHistory ? "full" : "all_rooms",
    fetchedAt
  };
}

const LIVE_SNAPSHOT_MESSAGES = parseInt(process.env.AGENT_LIVE_SNAPSHOT_MESSAGES || "8", 10);

export async function buildLiveSnapshot(userId) {
  const rooms = await getUserRooms(userId);
  const fetchedAt = new Date().toISOString();

  const roomSnapshots = await Promise.all(
    rooms.map(async (room) => {
      const [memberNames, messages] = await Promise.all([
        getRoomMemberNames(room.id),
        fetchRecentRoomMessages(room.id, LIVE_SNAPSHOT_MESSAGES)
      ]);

      const latest = messages[messages.length - 1] || null;

      return {
        id: room.id,
        name: room.name,
        type: room.type,
        lastMessage: room.last_message || "",
        updatedAt: room.updated_at ? formatTime(new Date(room.updated_at)) : "",
        members: memberNames,
        messageCount: messages.length,
        latestMessage: latest,
        recentMessages: messages
      };
    })
  );

  return {
    fetchedAt,
    roomCount: roomSnapshots.length,
    rooms: roomSnapshots
  };
}

export const TSMCHAT_KNOWLEDGE = `TSMChat: real-time chat app with Google login, direct (1v1) and group rooms, Socket.IO, online presence (green = actively on tab), PostgreSQL + Cassandra + Redis.`;
