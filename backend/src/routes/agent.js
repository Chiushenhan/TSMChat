import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { errorsTotal } from "../metrics/prometheus.js";
import { buildChatContext, buildLiveSnapshot } from "../services/agentContext.js";
import {
  assertAgentWithinLimits,
  getAgentLimitStatus,
  recordAgentUsage
} from "../services/agentLimits.js";
import { chatWithOpenAI } from "../services/openai.js";
import { buildAgentSystemPrompt } from "../utils/agentPrompt.js";

const router = Router();

router.post("/chat", authMiddleware, async (req, res) => {
  try {
    const { message, history = [], roomId, fullHistory = false } = req.body;

    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: "Message is required" });
    }

    const userMessage = String(message).trim();

    await assertAgentWithinLimits(req.user.id);

    const {
      context,
      roomCount,
      messageCount,
      truncated,
      droppedMessages,
      mode,
      fetchedAt
    } = await buildChatContext(req.user.id, {
      roomId,
      userMessage,
      fullHistory: Boolean(fullHistory)
    });

    const chatMessages = [];

    for (const entry of history.slice(-6)) {
      if (!entry?.role || !entry?.content) continue;
      if (entry.role !== "user" && entry.role !== "assistant") continue;
      chatMessages.push({
        role: entry.role,
        content: String(entry.content).trim()
      });
    }

    chatMessages.push({ role: "user", content: userMessage });

    const system = buildAgentSystemPrompt(req.user, context, userMessage);
    const result = await chatWithOpenAI({
      system,
      messages: chatMessages,
      maxTokens: 512
    });

    const { costUsd } = await recordAgentUsage(req.user.id, result.usage);
    const limits = await getAgentLimitStatus(req.user.id);

    res.json({
      reply: result.reply,
      model: result.model,
      usage: {
        tokens: result.usage,
        estimatedCostUsd: costUsd
      },
      limits: limits.limits,
      limitUsage: limits.usage,
      context: { roomCount, messageCount, truncated, droppedMessages, mode, fetchedAt }
    });
  } catch (err) {
    console.error("Agent chat error:", err);
    errorsTotal.labels("agent_chat").inc();

    if (err.message.includes("OPENAI_API_KEY")) {
      return res.status(503).json({ error: err.message });
    }

    if (err.message.includes("Not a member")) {
      return res.status(403).json({ error: err.message });
    }

    if (
      err.message.includes("daily budget") ||
      err.message.includes("monthly budget") ||
      err.message.includes("request limit")
    ) {
      return res.status(429).json({ error: err.message });
    }

    res.status(500).json({ error: err.message || "Agent request failed" });
  }
});

router.get("/snapshot", authMiddleware, async (req, res) => {
  try {
    const snapshot = await buildLiveSnapshot(req.user.id);
    res.json(snapshot);
  } catch (err) {
    console.error("Agent snapshot error:", err);
    errorsTotal.labels("agent_snapshot").inc();
    res.status(500).json({ error: "Failed to load live chat snapshot" });
  }
});

router.get("/status", authMiddleware, async (req, res) => {
  const limitStatus = await getAgentLimitStatus(req.user.id);

  res.json({
    enabled: Boolean(process.env.OPENAI_API_KEY),
    model: process.env.OPENAI_MODEL || "gpt-4.1-nano",
    provider: "openai",
    ...limitStatus
  });
});

export default router;
