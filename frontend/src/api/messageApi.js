import { apiFetch } from "./http.js";

export async function getMessages(roomId) {
  const res = await apiFetch(`/api/messages/${roomId}?limit=500`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to get messages (${res.status})`);
  }

  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error("Invalid messages response");
  }

  return data;
}

export async function sendMessage(roomId, text) {
  const res = await apiFetch(`/api/messages/${roomId}`, {
    method: "POST",
    body: JSON.stringify({ text })
  });

  if (!res.ok) throw new Error("Failed to send message");
  return res.json();
}

export async function clearMessages(roomId) {
  const res = await apiFetch(`/api/messages/${roomId}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to clear messages");
  return res.json();
}
