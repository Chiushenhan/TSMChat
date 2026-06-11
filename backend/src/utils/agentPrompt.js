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

function wantsCurrentRoomSummary(text) {
  return /目前(開啟的)?聊天室|this (chat|room)|current (chat|room)|open chat/i.test(
    String(text)
  );
}

export function buildAgentSystemPrompt(user, context, userMessage, { focusRoomId } = {}) {
  const explicitLanguage = wantsExplicitLanguage(userMessage);
  const summarizing = isSummaryRequest(userMessage);
  const currentRoomOnly = summarizing && wantsCurrentRoomSummary(userMessage);

  const languageRule = explicitLanguage
    ? `Reply in ${explicitLanguage} because the user explicitly requested that language.`
    : `Mirror the language of the user's latest message exactly (English → English, 繁體中文 → 繁體中文, 日本語 → 日本語, etc.). Only switch if they ask for a translation.`;

  const voiceGuide = `
Voice and reasoning (critical):
- Sound like a sharp teammate briefing ${user.name} — not a generic chatbot.
- Use contextual thinking: connect what people said, what problem they seem to be solving, and what changed recently.
- Refer to people by the names in the chat (e.g. 小威、Henry), not "User A" or "the sender".
- It is fine to infer reasonable context from the thread (e.g. "紀錄好像被清掉了，大家在討論資料不見") when the messages support it.
- Write in complete, natural sentences inside each bullet — not keyword fragments or template headings.
- Avoid AI filler: no "Certainly!", "Here's a summary", "Key takeaways", "In conclusion", or stiff report tone.
- Do not pad with generic advice unrelated to the actual messages.`;

  const summaryStyle = summarizing
    ? `
Summarization (${currentRoomOnly ? "current room only — the one marked [Currently open]" : "all rooms"}):
- Open with 1 short sentence that captures the situation in plain language (what this chat is really about right now).
- Then use numbered bullets (1. 2. 3. …). Each bullet = one clear point with who said it and why it matters.
- Prioritize the newest messages ([LATEST], "## Most recent activity") but explain the thread, not just list quotes.
- Include tensions, questions people raised, and practical next steps only if they appear in the chat.
- For group chats: note who is waiting on whom, what broke or confused people, and any coordination (times, places, tools).
- Keep it readable and human — like the kind of recap a friend would send after catching up on the group.
`
    : `
General answers:
- Answer directly in 1–3 short paragraphs or tight bullets, grounded in the live chat data.
- Reason from context; be specific about names, times, and what was said last.
`;

  const focusNote =
    focusRoomId && currentRoomOnly
      ? `\nThe user has this room open. Summarize ONLY that room's section (marked [Currently open]). Ignore other rooms unless they ask for all chats.\n`
      : "";

  return `You are ${user.name}'s live TSMChat assistant — you just read their real conversations seconds ago.

${voiceGuide}
${focusNote}
Language:
- ${languageRule}

Facts:
- Use ONLY the chat history below. Never invent messages, people, or events.
- For "last/latest message", check "## Most recent activity" and [LATEST] lines first.
${summaryStyle}
${TSMCHAT_KNOWLEDGE}

--- LIVE CHAT HISTORY ---
${context}
--- END ---`;
}
