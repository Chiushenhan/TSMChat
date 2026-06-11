import { useCallback, useEffect, useRef, useState } from "react";
import Sidebar from "../components/Sidebar.jsx";
import ChatPanel from "../components/ChatPanel.jsx";
import NewRoomModal from "../components/NewRoomModal.jsx";
import RoomInfoModal from "../components/RoomInfoModal.jsx";
import {
  createChatroom,
  createGroupChatroom,
  deleteRoom,
  getChatrooms,
  leaveGroup
} from "../api/chatroomApi.js";
import {
  clearMessages,
  getMessages,
  sendMessage
} from "../api/messageApi.js";
import {
  requestNotificationPermission,
  showMessageNotification
} from "../utils/notification.js";
import { getSocket, onSocketConnect } from "../socket/socket.js";
import { mergeMessages, mergeWithServerMessages, normalizeMessage, remapMessagesForUserId, sortMessages } from "../utils/room.js";
import { formatTaipeiClock } from "../utils/time.js";
import ChatAgentPanel, { ChatAgentToggle } from "../components/ChatAgentPanel.jsx";

function ChatPage({ currentUser, onLogout, onOpenAdmin, onUpdateUserId }) {
  const [user, setUser] = useState(currentUser);

  const [rooms, setRooms] = useState([]);
  const [messages, setMessages] = useState({});

  const [selectedRoomId, setSelectedRoomId] = useState("");
  const [searchText, setSearchText] = useState("");
  const [inputText, setInputText] = useState("");

  const [showNewRoomModal, setShowNewRoomModal] = useState(false);
  const [showRoomInfoModal, setShowRoomInfoModal] = useState(false);

  const [newRoomType, setNewRoomType] = useState("direct");
  const [selectedDirectUser, setSelectedDirectUser] = useState(null);

  const [newGroupName, setNewGroupName] = useState("");
  const [selectedGroupMembers, setSelectedGroupMembers] = useState([]);
  const [unreadCounts, setUnreadCounts] = useState({});
  const [agentOpen, setAgentOpen] = useState(false);

  const messagesEndRef = useRef(null);
  const messageLoadSeqRef = useRef(0);
  const selectedRoomIdRef = useRef(selectedRoomId);
  const userIdRef = useRef(user.id);
  const previousUserIdRef = useRef(currentUser.id);
  const roomsRef = useRef(rooms);

  useEffect(() => {
    selectedRoomIdRef.current = selectedRoomId;
  }, [selectedRoomId]);

  useEffect(() => {
    userIdRef.current = user.id;
  }, [user.id]);

  useEffect(() => {
    roomsRef.current = rooms;
  }, [rooms]);

  useEffect(() => {
    const oldId = previousUserIdRef.current;

    if (oldId === currentUser.id) {
      setUser(currentUser);
      return;
    }

    setMessages((prev) => remapMessagesForUserId(prev, oldId, currentUser.id));
    previousUserIdRef.current = currentUser.id;
    setUser(currentUser);

    async function refreshAfterUserIdChange() {
      try {
        const roomList = await getChatrooms();
        setRooms(roomList);

        const socket = getSocket();
        if (socket) {
          roomList.forEach((room) => socket.emit("join_room", room.id));
        }
      } catch (err) {
        console.error("Failed to refresh rooms after user ID change:", err);
      }
    }

    refreshAfterUserIdChange();
  }, [currentUser]);

  const totalUnread = Object.values(unreadCounts).reduce((sum, count) => sum + count, 0);

  const selectedRoom = rooms.find((room) => room.id === selectedRoomId);
  const selectedMessages = messages[selectedRoomId] || [];

  const filteredRooms = rooms.filter((room) => {
    const keyword = searchText.toLowerCase();
    return (
      room.name.toLowerCase().includes(keyword) ||
      room.userId.toLowerCase().includes(keyword)
    );
  });

  const loadRoomMessages = useCallback(async (roomId) => {
    if (!roomId) return;

    const loadSeq = ++messageLoadSeqRef.current;

    try {
      const roomMessages = await getMessages(roomId);
      if (loadSeq !== messageLoadSeqRef.current) return;

      setMessages((prev) => ({
        ...prev,
        [roomId]: mergeWithServerMessages(prev[roomId] || [], roomMessages)
      }));
    } catch (err) {
      console.error("Failed to load messages:", err);
    }
  }, []);

  useEffect(() => {
    async function init() {
      await requestNotificationPermission();

      try {
        const roomList = await getChatrooms();
        setRooms(roomList);

        if (roomList.length > 0) {
          setSelectedRoomId(roomList[0].id);
        }
      } catch (err) {
        console.error("Failed to initialize chat:", err);
      }
    }

    init();
  }, []);

  useEffect(() => {
    async function refreshOnReturn() {
      if (document.visibilityState !== "visible") return;

      try {
        const roomList = await getChatrooms();
        setRooms(roomList);

        const roomId = selectedRoomIdRef.current;
        if (roomId) {
          await loadRoomMessages(roomId);
        }
      } catch (err) {
        console.error("Failed to refresh chat state:", err);
      }
    }

    document.addEventListener("visibilitychange", refreshOnReturn);
    return () => document.removeEventListener("visibilitychange", refreshOnReturn);
  }, [loadRoomMessages]);

  useEffect(() => {
    const joinAllRooms = () => {
      const socket = getSocket();
      if (!socket?.connected) return;

      for (const room of roomsRef.current) {
        socket.emit("join_room", room.id);
      }
    };

    joinAllRooms();
    return onSocketConnect(() => {
      joinAllRooms();
      const roomId = selectedRoomIdRef.current;
      if (roomId) {
        loadRoomMessages(roomId);
      }
    });
  }, [rooms, loadRoomMessages]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleNewMessage = (data) => {
      const { roomId, message } = data;
      if (!roomId || !message) return;

      const normalized = normalizeMessage(message);
      let isDuplicate = false;

      setMessages((prev) => {
        const existing = prev[roomId] || [];
        if (existing.some((item) => item.id === normalized.id)) {
          isDuplicate = true;
          return prev;
        }

        return {
          ...prev,
          [roomId]: mergeMessages(existing, [normalized])
        };
      });

      if (isDuplicate) return;

      const isOwnMessage = message.senderId === userIdRef.current;
      const isViewingRoom =
        roomId === selectedRoomIdRef.current && !document.hidden;

      if (!isOwnMessage && !isViewingRoom) {
        setUnreadCounts((prev) => ({
          ...prev,
          [roomId]: (prev[roomId] || 0) + 1
        }));
      }

      setRooms((prev) => {
        const target = prev.find((room) => room.id === roomId);
        if (!target) return prev;

        const updated = {
          ...target,
          lastMessage: message.text,
          updatedAt: message.createdAt || target.updatedAt
        };

        return [updated, ...prev.filter((room) => room.id !== roomId)];
      });

      if (!isOwnMessage && (roomId !== selectedRoomIdRef.current || document.hidden)) {
        showMessageNotification({
          title: `TSMChat - ${message.senderName}`,
          body: message.text
        });
      }
    };

    const handleRoomUpdated = (data) => {
      setRooms((prev) => {
        const target = prev.find((room) => room.id === data.roomId);
        if (!target) return prev;

        const updated = {
          ...target,
          lastMessage: data.lastMessage,
          updatedAt: data.updatedAt
        };

        return [updated, ...prev.filter((room) => room.id !== data.roomId)];
      });
    };

    const handleUserOnline = (data) => {
      setRooms((prev) =>
        prev.map((room) => {
          if (!room.members?.includes(data.userId)) return room;
          const onlineUsers = room.onlineUsers || [];
          if (onlineUsers.includes(data.userId)) return room;
          return { ...room, onlineUsers: [...onlineUsers, data.userId] };
        })
      );
    };

    const handleUserOffline = (data) => {
      setRooms((prev) =>
        prev.map((room) => ({
          ...room,
          onlineUsers: (room.onlineUsers || []).filter((id) => id !== data.userId)
        }))
      );
    };

    socket.on("new_message", handleNewMessage);
    socket.on("room_updated", handleRoomUpdated);
    socket.on("user_online", handleUserOnline);
    socket.on("user_offline", handleUserOffline);

    return () => {
      socket.off("new_message", handleNewMessage);
      socket.off("room_updated", handleRoomUpdated);
      socket.off("user_online", handleUserOnline);
      socket.off("user_offline", handleUserOffline);
    };
  }, []);

  useEffect(() => {
    loadRoomMessages(selectedRoomId);
  }, [selectedRoomId, loadRoomMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [selectedRoomId, messages]);

  const handleSelectRoom = (roomId) => {
    setSelectedRoomId(roomId);
    setUnreadCounts((prev) => ({ ...prev, [roomId]: 0 }));
  };

  const handleCreateRoom = async () => {
    if (newRoomType === "direct") {
      if (!selectedDirectUser) {
        alert("請先選擇一位使用者。");
        return;
      }

      const room = await createChatroom(selectedDirectUser.id, selectedDirectUser.name);
      await refreshAfterCreateRoom(room.id, room);
      return;
    }

    const groupName = newGroupName.trim();

    if (!groupName) {
      alert("請輸入群組名稱。");
      return;
    }

    if (selectedGroupMembers.length === 0) {
      alert("請至少選擇一位群組成員。");
      return;
    }

    const memberIds = selectedGroupMembers.map((m) => m.id);
    const room = await createGroupChatroom(groupName, memberIds);
    await refreshAfterCreateRoom(room.id, room);
  };

  const refreshAfterCreateRoom = async (roomId, createdRoom = null) => {
    const roomList = await getChatrooms();
    const roomMessages = await getMessages(roomId);
    const hasRoom = roomList.some((room) => room.id === roomId);
    const nextRooms =
      hasRoom || !createdRoom ? roomList : [createdRoom, ...roomList];

    setSearchText("");
    setRooms(nextRooms);
    setMessages((prev) => ({ ...prev, [roomId]: sortMessages(roomMessages) }));
    setSelectedRoomId(roomId);
    setUnreadCounts((prev) => ({ ...prev, [roomId]: 0 }));
    resetNewRoomModal();

    const socket = getSocket();
    if (socket) {
      socket.emit("join_room", roomId);
    }
  };

  const resetNewRoomModal = () => {
    setShowNewRoomModal(false);
    setNewRoomType("direct");
    setSelectedDirectUser(null);
    setNewGroupName("");
    setSelectedGroupMembers([]);
  };

  const handleSendMessage = async () => {
    const text = inputText.trim();
    if (!text || !selectedRoomId) return;

    const sentAtMs = Date.now();
    const pendingId = `pending-${sentAtMs}`;
    const optimisticMessage = normalizeMessage({
      id: pendingId,
      senderId: user.id,
      senderName: user.name,
      senderAvatarText: user.avatarText || "",
      senderAvatarUrl: user.avatarUrl || "",
      text,
      createdAt: formatTaipeiClock(sentAtMs),
      createdAtMs: sentAtMs
    });

    setMessages((prev) => ({
      ...prev,
      [selectedRoomId]: mergeMessages(prev[selectedRoomId] || [], [optimisticMessage])
    }));
    setInputText("");

    try {
      const newMessage = await sendMessage(selectedRoomId, text);
      const enrichedMessage = normalizeMessage({
        ...newMessage,
        senderAvatarUrl: newMessage.senderAvatarUrl || user.avatarUrl || "",
        senderAvatarText: newMessage.senderAvatarText || user.avatarText || ""
      });

      setMessages((prev) => {
        const withoutPending = (prev[selectedRoomId] || []).filter(
          (message) => message.id !== pendingId
        );
        return {
          ...prev,
          [selectedRoomId]: mergeMessages(withoutPending, [enrichedMessage])
        };
      });

      const roomList = await getChatrooms();
      setRooms(roomList);
    } catch (err) {
      setMessages((prev) => ({
        ...prev,
        [selectedRoomId]: (prev[selectedRoomId] || []).filter(
          (message) => message.id !== pendingId
        )
      }));
      console.error("Failed to send message:", err);
      alert("訊息傳送失敗，請稍後再試。");
    }
  };

  const handleClearHistory = async () => {
    if (!selectedRoomId) return;

    const confirmed = window.confirm("確定要刪除此聊天室的聊天紀錄嗎？");
    if (!confirmed) return;

    const nextMessages = await clearMessages(selectedRoomId);
    const roomList = await getChatrooms();

    setMessages((prev) => ({ ...prev, [selectedRoomId]: nextMessages }));
    setRooms(roomList);
    setShowRoomInfoModal(false);
  };

  const handleLeaveGroup = async () => {
    if (!selectedRoomId || !selectedRoom) return;

    const confirmed = window.confirm(`確定要退出群組「${selectedRoom.name}」嗎？`);
    if (!confirmed) return;

    const nextRooms = await leaveGroup(selectedRoomId);

    setRooms(nextRooms);
    setMessages((prev) => {
      const next = { ...prev };
      delete next[selectedRoomId];
      return next;
    });
    setUnreadCounts((prev) => {
      const next = { ...prev };
      delete next[selectedRoomId];
      return next;
    });

    setSelectedRoomId(nextRooms[0]?.id || "");
    setShowRoomInfoModal(false);
  };

  const handleDeleteRoom = async () => {
    if (!selectedRoomId || !selectedRoom) return;

    const confirmed = window.confirm(
      selectedRoom.type === "group"
        ? `確定要刪除群組「${selectedRoom.name}」嗎？`
        : `確定要解除與「${selectedRoom.name}」的 1 對 1 聊天室嗎？`
    );
    if (!confirmed) return;

    const nextRooms = await deleteRoom(selectedRoomId);

    setRooms(nextRooms);
    setMessages((prev) => {
      const next = { ...prev };
      delete next[selectedRoomId];
      return next;
    });
    setUnreadCounts((prev) => {
      const next = { ...prev };
      delete next[selectedRoomId];
      return next;
    });

    setSelectedRoomId(nextRooms[0]?.id || "");
    setShowRoomInfoModal(false);
  };

  return (
    <div className="h-screen w-screen bg-gray-100 flex items-center justify-center">
      <ChatAgentToggle open={agentOpen} onToggle={() => setAgentOpen((v) => !v)} />

      <ChatAgentPanel
        open={agentOpen}
        onClose={() => setAgentOpen(false)}
        currentUser={user}
        selectedRoom={selectedRoom}
      />

      <div className="w-full h-full bg-white flex overflow-hidden">
        <div
          className={`${
            selectedRoomId ? "hidden md:flex" : "flex"
          } w-full md:w-[380px] shrink-0`}
        >
          <Sidebar
            currentUser={user}
            rooms={filteredRooms}
            selectedRoomId={selectedRoomId}
            unreadCounts={unreadCounts}
            totalUnread={totalUnread}
            searchText={searchText}
            onSearchTextChange={setSearchText}
            onSelectRoom={handleSelectRoom}
            onOpenNewRoom={() => setShowNewRoomModal(true)}
            onLogout={onLogout}
            onOpenAdmin={onOpenAdmin}
            onUpdateUserId={onUpdateUserId}
          />
        </div>

        <div
          className={`${
            selectedRoomId ? "flex" : "hidden md:flex"
          } flex-1 min-w-0`}
        >
          <ChatPanel
            currentUser={user}
            selectedRoom={selectedRoom}
            messages={selectedMessages}
            inputText={inputText}
            onInputTextChange={setInputText}
            onSendMessage={handleSendMessage}
            messagesEndRef={messagesEndRef}
            onBackToList={() => setSelectedRoomId("")}
            onOpenRoomInfo={() => setShowRoomInfoModal(true)}
          />
        </div>
      </div>

      {showNewRoomModal && (
        <NewRoomModal
          currentUserId={user.id}
          roomType={newRoomType}
          onRoomTypeChange={setNewRoomType}
          selectedDirectUser={selectedDirectUser}
          onSelectDirectUser={setSelectedDirectUser}
          groupName={newGroupName}
          onGroupNameChange={setNewGroupName}
          selectedGroupMembers={selectedGroupMembers}
          onSelectedGroupMembersChange={setSelectedGroupMembers}
          onCreate={handleCreateRoom}
          onClose={resetNewRoomModal}
        />
      )}

      {showRoomInfoModal && selectedRoom && (
        <RoomInfoModal
          key={selectedRoom.id}
          room={selectedRoom}
          currentUser={user}
          onClose={() => setShowRoomInfoModal(false)}
          onClearHistory={handleClearHistory}
          onLeaveGroup={handleLeaveGroup}
          onDeleteRoom={handleDeleteRoom}
        />
      )}
    </div>
  );
}

export default ChatPage;
