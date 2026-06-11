import { useEffect, useRef, useState } from "react";
import {
  X,
  Send,
  Sparkles,
  Loader2,
  Languages,
  FileText,
  HelpCircle
} from "lucide-react";
import { fetchAgentSnapshot, fetchAgentStatus, sendAgentMessage } from "../api/agentApi.js";

const QUICK_PROMPTS = [
  {
    id: "summarize-all",
    icon: FileText,
    label: "摘要所有聊天",
    labelEn: "Summarize all",
    prompt: "請摘要我所有聊天室（包含 1 對 1 與群組）的對話重點，用繁體中文條列說明。"
  },
  {
    id: "summarize-room",
    icon: FileText,
    label: "摘要目前聊天",
    labelEn: "This chat",
    prompt: "請摘要目前開啟的聊天室對話重點，用繁體中文條列說明。"
  },
  {
    id: "translate-en",
    icon: Languages,
    label: "翻譯成英文",
    labelEn: "To English",
    prompt: "Please translate the recent messages from all my chats to English."
  },
  {
    id: "tsmchat-help",
    icon: HelpCircle,
    label: "TSMChat 說明",
    labelEn: "TSMChat help",
    prompt: "What can TSMChat do? Explain the main features in Traditional Chinese."
  }
];

function ChatAgentPanel({
  open,
  onClose,
  currentUser,
  selectedRoom
}) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [agentEnabled, setAgentEnabled] = useState(true);
  const [agentModel, setAgentModel] = useState("");
  const [liveSyncedAt, setLiveSyncedAt] = useState("");
  const [liveRoomCount, setLiveRoomCount] = useState(0);
  const [error, setError] = useState("");

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    fetchAgentStatus().then((status) => {
      if (cancelled) return;
      setAgentEnabled(status.enabled);
      setAgentModel(status.model || "");
    });

    const syncLiveSnapshot = async () => {
      try {
        const snapshot = await fetchAgentSnapshot();
        if (cancelled) return;
        setLiveSyncedAt(snapshot.fetchedAt || "");
        setLiveRoomCount(snapshot.roomCount || 0);
      } catch (err) {
        console.debug("Agent live snapshot skipped:", err.message);
      }
    };

    syncLiveSnapshot();
    const timer = setInterval(syncLiveSnapshot, 1000);
    setTimeout(() => inputRef.current?.focus(), 200);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [open]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const handleSend = async (text) => {
    const trimmed = text?.trim();
    if (!trimmed || loading) return;

    setError("");
    const userMessage = { id: crypto.randomUUID(), role: "user", content: trimmed };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    try {
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      const result = await sendAgentMessage({
        message: trimmed,
        history,
        roomId: selectedRoom?.id
      });

      setMessages([
        ...nextMessages,
        { id: crypto.randomUUID(), role: "assistant", content: result.reply }
      ]);
    } catch (err) {
      setError(err.message);
      setMessages(messages);
      setInput(trimmed);
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setMessages([]);
    setError("");
  };

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/20 z-40 md:bg-transparent md:pointer-events-none"
        onClick={onClose}
        aria-hidden="true"
      />

      <aside className="fixed top-0 right-0 h-full w-full sm:w-[400px] bg-white border-l border-gray-200 shadow-2xl z-50 flex flex-col">
        <header className="shrink-0 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center shrink-0">
                <Sparkles size={16} className="text-white" />
              </div>
              <div className="min-w-0">
                <h2 className="font-bold text-gray-900 text-sm">Chat Agent</h2>
                <p className="text-[10px] text-gray-500 truncate">
                  {agentModel || "gpt-4.1-nano"} · Live · {liveRoomCount} 聊天室
                  {liveSyncedAt ? ` · synced ${new Date(liveSyncedAt).toLocaleTimeString()}` : ""}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={handleClear}
                className="text-xs px-2 py-1 rounded-md text-gray-500 hover:bg-white/80"
                title="Clear conversation"
              >
                Clear
              </button>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-white/80 text-gray-500"
                title="Close Chat Agent"
              >
                <X size={18} />
              </button>
            </div>
          </div>
        </header>

        {!agentEnabled && (
          <div className="mx-4 mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
            請在後端設定 <code className="bg-amber-100 px-1 rounded">OPENAI_API_KEY</code> 以啟用 Chat Agent。
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-8">
              <div className="w-12 h-12 rounded-2xl bg-blue-100 flex items-center justify-center mx-auto mb-3">
                <Sparkles size={22} className="text-blue-600" />
              </div>
              <p className="text-sm font-medium text-gray-700 mb-1">
                你好，{currentUser.name?.split(" ")[0] || "there"}！
              </p>
              <p className="text-xs text-gray-400 mb-4 px-4">
                即時讀取你所有的 1 對 1 與群組聊天（每秒同步），可摘要、翻譯或回答最新訊息相關問題。
                {selectedRoom ? ` 目前開啟：${selectedRoom.name}` : ""}
              </p>

              <div className="grid grid-cols-2 gap-2">
                {QUICK_PROMPTS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleSend(item.prompt)}
                      disabled={loading || !agentEnabled}
                      className="flex items-center gap-2 p-2.5 rounded-xl border border-gray-200 hover:border-blue-300 hover:bg-blue-50 text-left transition disabled:opacity-40"
                    >
                      <Icon size={14} className="text-blue-600 shrink-0" />
                      <span className="text-xs font-medium text-gray-700">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id || `${msg.role}-${msg.content.slice(0, 24)}`}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[90%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                  msg.role === "user"
                    ? "bg-blue-600 text-white rounded-br-md"
                    : "bg-gray-100 text-gray-800 rounded-bl-md"
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-gray-100 rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-2 text-sm text-gray-500">
                <Loader2 size={16} className="animate-spin" />
                思考中…
              </div>
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
              {error}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <footer className="shrink-0 border-t border-gray-200 p-3 bg-white">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend(input);
                }
              }}
              placeholder="詢問所有聊天室、摘要、翻譯… / Ask about any chat"
              rows={2}
              disabled={loading || !agentEnabled}
              className="flex-1 resize-none bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent disabled:opacity-50"
            />
            <button
              onClick={() => handleSend(input)}
              disabled={!input.trim() || loading || !agentEnabled}
              className="w-10 h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center transition disabled:opacity-40 shrink-0"
            >
              <Send size={18} />
            </button>
          </div>
        </footer>
      </aside>
    </>
  );
}

const AGENT_TOGGLE_POS_KEY = "tsmchat-agent-toggle-pos";
const DRAG_THRESHOLD_PX = 6;

function loadTogglePosition() {
  try {
    const saved = localStorage.getItem(AGENT_TOGGLE_POS_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (typeof parsed?.x === "number" && typeof parsed?.y === "number") {
        return parsed;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

function clampTogglePosition(x, y, width, height) {
  const maxX = Math.max(8, window.innerWidth - width - 8);
  const maxY = Math.max(8, window.innerHeight - height - 8);
  return {
    x: Math.min(Math.max(8, x), maxX),
    y: Math.min(Math.max(8, y), maxY)
  };
}

export function ChatAgentToggle({ open, onToggle }) {
  const buttonRef = useRef(null);
  const positionRef = useRef(loadTogglePosition());
  const dragRef = useRef({
    dragging: false,
    moved: false,
    startX: 0,
    startY: 0,
    origX: 0,
    origY: 0
  });

  const [position, setPosition] = useState(() => positionRef.current);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (position !== null) return;

    const el = buttonRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const next = clampTogglePosition(
      window.innerWidth - rect.width - 12,
      12,
      rect.width,
      rect.height
    );
    positionRef.current = next;
    setPosition(next);
  }, [position]);

  useEffect(() => {
    const handleResize = () => {
      const el = buttonRef.current;
      if (!el || !positionRef.current) return;

      const next = clampTogglePosition(
        positionRef.current.x,
        positionRef.current.y,
        el.offsetWidth,
        el.offsetHeight
      );
      positionRef.current = next;
      setPosition(next);
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const updatePosition = (x, y) => {
    const el = buttonRef.current;
    const width = el?.offsetWidth || 72;
    const height = el?.offsetHeight || 40;
    const next = clampTogglePosition(x, y, width, height);
    positionRef.current = next;
    setPosition(next);
    return next;
  };

  const handlePointerDown = (event) => {
    if (event.button !== 0 || positionRef.current === null) return;

    dragRef.current = {
      dragging: true,
      moved: false,
      startX: event.clientX,
      startY: event.clientY,
      origX: positionRef.current.x,
      origY: positionRef.current.y
    };
    setIsDragging(true);
    buttonRef.current?.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const handlePointerMove = (event) => {
    if (!dragRef.current.dragging) return;

    const dx = event.clientX - dragRef.current.startX;
    const dy = event.clientY - dragRef.current.startY;

    if (!dragRef.current.moved) {
      if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) {
        return;
      }
      dragRef.current.moved = true;
    }

    updatePosition(dragRef.current.origX + dx, dragRef.current.origY + dy);
    event.preventDefault();
  };

  const finishPointer = (event) => {
    if (!dragRef.current.dragging) return;

    const { moved } = dragRef.current;
    dragRef.current.dragging = false;
    setIsDragging(false);
    buttonRef.current?.releasePointerCapture(event.pointerId);

    if (moved && positionRef.current) {
      localStorage.setItem(AGENT_TOGGLE_POS_KEY, JSON.stringify(positionRef.current));
      return;
    }

    onToggle();
  };

  const style = position
    ? { left: position.x, top: position.y }
    : { top: 12, right: 12 };

  return (
    <button
      ref={buttonRef}
      type="button"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointer}
      onPointerCancel={finishPointer}
      style={style}
      className={`fixed z-30 flex items-center gap-1.5 px-2.5 py-2 rounded-xl shadow-lg border select-none touch-none transition-colors ${
        isDragging ? "cursor-grabbing scale-[1.02]" : "cursor-grab"
      } ${
        open
          ? "bg-blue-600 border-blue-700 text-white"
          : "bg-white border-gray-200 text-gray-600 hover:border-blue-300 hover:text-blue-600"
      }`}
      title={open ? "拖曳移動 · 點擊關閉 Agent" : "拖曳移動 · 點擊開啟 Agent"}
      aria-label={open ? "Close Chat Agent" : "Open Chat Agent"}
    >
      <Sparkles size={18} />
      <span className="text-xs font-semibold hidden sm:inline">Agent</span>
    </button>
  );
}

export default ChatAgentPanel;
