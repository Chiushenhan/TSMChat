import { TSMCHAT_KNOWLEDGE } from "../services/agentContext.js";

export function wantsExplicitLanguage(text) {
  const trimmed = String(text).trim();
  if (!trimmed) return null;

  if (/\b(in english|to english|translate(?:.*)?english|reply in english)\b/i.test(trimmed)) {
    return "English";
  }
  if (/\b(用英文|翻譯成英文|以英文)\b/.test(trimmed)) {
    return "English";
  }
  if (
    /\b(in traditional chinese|to traditional chinese|translate(?:.*)?chinese|reply in chinese)\b/i.test(
      trimmed
    )
  ) {
    return "Traditional Chinese (繁體中文)";
  }
  if (/\b(用繁體中文|翻譯成中文|以繁體中文|用中文回覆)\b/.test(trimmed)) {
    return "Traditional Chinese (繁體中文)";
  }

  return null;
}

export function isSummaryRequest(text) {
  return /摘要|總結|总结|summarize|summary|recap|overview|重點|重点/i.test(String(text));
}

export function buildAgentSystemPrompt(user, context, userMessage) {
  const explicitLanguage = wantsExplicitLanguage(userMessage);
  const summarizing = isSummaryRequest(userMessage);

  const languageRule = explicitLanguage
    ? `Reply in ${explicitLanguage} because the user explicitly requested that language.`
    : `Mirror the language of the user's latest message exactly:
  - English question → English answer
  - 繁體中文 → 繁體中文
  - 日本語 → 日本語
  - 한국어 → 한국어
  - Any other language → reply in that same language
  Do not switch languages unless the user clearly asks for a translation or another language.`;

  const summaryStyle = summarizing
    ? `
Summarization style (important):
- Write a constructive, well-organized briefing — not a raw copy of messages.
- Use clear bullet points, grouped by chat room (separate 1v1 and group chats).
- Start with the newest updates from "## Most recent activity" and [LATEST] lines.
- For each room include: main topics, latest developments, who said what (names), open questions, and suggested follow-ups if any.
- Be concise, helpful, and easy to scan — like a thoughtful assistant recap.
`
    : "";

  return `You are the live TSMChat assistant for ${user.name}.

You have real-time access to the user's 1v1 and group chats. Context below was just fetched from TSMChat.

Language:
- ${languageRule}

Accuracy:
- Use ONLY the chat history below. Never invent messages, senders, or rooms.
- For "last message", "latest", or "most recent", check "## Most recent activity" first, then [LATEST] in each room.
- "Latest preview (DB)" is the stored newest summary for that room.
${summaryStyle}
${TSMCHAT_KNOWLEDGE}

--- LIVE CHAT HISTORY ---
${context}
--- END ---`;
}
