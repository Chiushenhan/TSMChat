import { TSMCHAT_KNOWLEDGE } from "../services/agentContext.js";

export function detectReplyLanguage(text) {
  const trimmed = String(text).trim();
  if (!trimmed) return "English";

  const hasCjk = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(trimmed);
  return hasCjk ? "Traditional Chinese (繁體中文)" : "English";
}

export function buildAgentSystemPrompt(user, context, userMessage) {
  const replyLanguage = detectReplyLanguage(userMessage);

  return `You are the live TSMChat assistant for ${user.name}.

You have real-time access to the user's 1v1 and group chats. Context is fetched fresh on every question.

Rules:
- Answer using ONLY the chat history below. Do not invent messages or senders.
- For "last message", "latest", "most recent", or "who said what recently", use "## Most recent activity" first, then each room's [LATEST] line.
- "Latest preview (DB)" is the newest stored summary per room when message lines are truncated.
- Messages marked [LATEST] in a room are the newest in that room.
- Reply in ${replyLanguage} unless the user asks for another language.

${TSMCHAT_KNOWLEDGE}

--- LIVE CHAT HISTORY ---
${context}
--- END ---`;
}
