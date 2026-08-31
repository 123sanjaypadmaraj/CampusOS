import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  HiChatBubbleLeftRight, HiMagnifyingGlass, HiPhoto, HiPaperAirplane, HiTrash, HiNoSymbol,
  HiXMark, HiUserGroup, HiPlus, HiPencilSquare, HiArrowUturnLeft, HiFaceSmile, HiStar,
  HiCheck, HiArrowLeft, HiFlag, HiMegaphone,
} from "react-icons/hi2";
import { LoadingState, EmptyState } from "../../components/ui/States";
import { useModalA11y } from "../../hooks/useModalA11y";
import { reportContent } from "../../services/mvpService";
import {
  sendMessage,
  markConversationRead,
  listConversations,
  getConversationMessages,
  subscribeToConversationList,
  subscribeToConversationMessages,
  uploadMessageAttachment,
  getMessageAttachmentUrl,
  blockUser,
  unblockUser,
  listBlockedUsers,
  deleteMessage,
  startConversation,
  createGroupConversation,
  addGroupMember,
  removeGroupMember,
  leaveGroupConversation,
  renameGroupConversation,
  getConversationParticipants,
  toggleMessageReaction,
  listConversationReactions,
  starMessage,
  unstarMessage,
  listStarredMessages,
  sendTypingSignal,
  subscribeToTyping,
} from "../../services/messagingService";

const REACTION_EMOJI = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
const TYPING_EXPIRY_MS = 3000;
const TYPING_SEND_THROTTLE_MS = 1500;

/* =========================================================
   Small shared pieces
========================================================= */

function PageHeader({ kicker, title, text, action }) {
  return (
    <div className="section-head large">
      <div>
        <span className="section-kicker">{kicker}</span>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      {action}
    </div>
  );
}

function Modal({ title, kicker, onClose, children, wide }) {
  const titleId = useId();
  const dialogRef = useModalA11y(onClose);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className={`feature-modal${wide ? " wide" : ""}`}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button className="modal-close" onClick={onClose} aria-label="Close"><HiXMark /></button>
        {kicker && <span className="section-kicker">{kicker}</span>}
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function dayLabel(dateStr) {
  const d = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

function timeLabel(dateStr) {
  return new Date(dateStr).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function Avatar({ name, small }) {
  return <div className={`big-avatar${small ? " small" : ""}`}>{name?.[0]?.toUpperCase() || "?"}</div>;
}

function MessageAttachmentImage({ path }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let mounted = true;
    getMessageAttachmentUrl(path).then((u) => { if (mounted) setUrl(u); }).catch(() => {});
    return () => { mounted = false; };
  }, [path]);
  if (!url) return <div className="message-attachment-img loading" />;
  return <img className="message-attachment-img" src={url} alt="Attachment" onClick={() => window.open(url, "_blank")} />;
}

/* =========================================================
   Member picker -- shared by "New chat", "New group" and "Add member"
========================================================= */

function MemberPicker({ title, people, excludeIds = [], multi, onPick, onClose }) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState(new Set());
  const excluded = useMemo(() => new Set(excludeIds), [excludeIds]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return people.filter((p) => {
      if (excluded.has(p.id)) return false;
      if (!query) return true;
      return `${p.name} ${p.course || ""}`.toLowerCase().includes(query);
    });
  }, [people, q, excluded]);

  const toggle = (id) => {
    if (!multi) { onPick([id]); return; }
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <Modal kicker="MESSAGES" title={title} onClose={onClose}>
      <div className="messages-search modal-search">
        <HiMagnifyingGlass />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search classmates…" aria-label="Search classmates" autoFocus />
      </div>
      <div className="member-picker-list">
        {filtered.length === 0 && <EmptyState title="No matches" text="Try a different name." />}
        {filtered.map((p) => (
          <button key={p.id} type="button" className={`member-picker-row${selected.has(p.id) ? " selected" : ""}`} onClick={() => toggle(p.id)}>
            <Avatar name={p.name} small />
            <div>
              <b>{p.name}</b>
              <small>{p.course}{p.year ? ` · ${p.year}` : ""}</small>
            </div>
            {multi && <span className="member-picker-check">{selected.has(p.id) ? <HiCheck /> : null}</span>}
          </button>
        ))}
      </div>
      {multi && (
        <button
          className="primary"
          disabled={selected.size === 0}
          onClick={() => onPick(Array.from(selected))}
          style={{ width: "100%", marginTop: 12 }}
        >
          Continue{selected.size > 0 ? ` (${selected.size})` : ""}
        </button>
      )}
    </Modal>
  );
}

function NewGroupFlow({ people, authUser, notify, onClose, onCreated }) {
  const [step, setStep] = useState("pick"); // 'pick' | 'name'
  const [memberIds, setMemberIds] = useState([]);
  const [groupTitle, setGroupTitle] = useState("");
  const [creating, setCreating] = useState(false);

  if (step === "pick") {
    return (
      <MemberPicker
        title="Add group members"
        people={people}
        excludeIds={[authUser?.id]}
        multi
        onClose={onClose}
        onPick={(ids) => { setMemberIds(ids); setStep("name"); }}
      />
    );
  }

  return (
    <Modal kicker="NEW GROUP" title="Name this group" onClose={onClose}>
      <input
        value={groupTitle}
        onChange={(e) => setGroupTitle(e.target.value)}
        placeholder="e.g. Hostel Block C"
        aria-label="Group name"
        autoFocus
        style={{ width: "100%", marginBottom: 14 }}
      />
      <div style={{ display: "flex", gap: 10 }}>
        <button className="ghost" onClick={() => setStep("pick")} disabled={creating}>Back</button>
        <button
          className="primary"
          disabled={creating || !groupTitle.trim()}
          onClick={async () => {
            setCreating(true);
            try {
              const conversationId = await createGroupConversation(groupTitle.trim(), memberIds);
              onCreated(conversationId);
            } catch (error) {
              notify(error.message || "Could not create the group");
            } finally {
              setCreating(false);
            }
          }}
          style={{ flex: 1 }}
        >
          {creating ? "Creating…" : "Create group"}
        </button>
      </div>
    </Modal>
  );
}

/* =========================================================
   Group info panel
========================================================= */

function GroupInfoPanel({ conversation, authUser, notify, onClose, onLeft, onRenamed, people }) {
  const [participants, setParticipants] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState(conversation.title || "");
  const [addingMember, setAddingMember] = useState(false);

  const reload = () => {
    getConversationParticipants(conversation.conversation_id).then(setParticipants).catch((err) => notify(err.message || "Could not load members"));
  };
  useEffect(() => { reload(); }, [conversation.conversation_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const me = participants?.find((p) => p.user_id === authUser?.id);
  const isAdmin = me?.role === "admin";

  return (
    <>
      <Modal kicker="GROUP INFO" title={conversation.title || "Group"} onClose={onClose}>
        {isAdmin && !renaming && (
          <button className="ghost" onClick={() => setRenaming(true)} style={{ marginBottom: 14 }}>
            <HiPencilSquare /> Rename group
          </button>
        )}
        {renaming && (
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <input value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} style={{ flex: 1 }} aria-label="Group name" autoFocus />
            <button
              className="primary"
              disabled={!titleDraft.trim()}
              onClick={async () => {
                try {
                  await renameGroupConversation(conversation.conversation_id, titleDraft.trim());
                  setRenaming(false);
                  onRenamed(titleDraft.trim());
                } catch (err) {
                  notify(err.message || "Could not rename the group");
                }
              }}
            >
              Save
            </button>
          </div>
        )}

        <p className="modal-subtext">{participants?.length || 0} members</p>

        {!participants && <LoadingState label="Loading members…" />}
        {participants && (
          <div className="member-picker-list">
            {participants.map((p) => (
              <div key={p.user_id} className="member-picker-row static">
                <Avatar name={p.name} small />
                <div>
                  <b>{p.name}{p.user_id === authUser?.id ? " (you)" : ""}</b>
                  <small>{p.role === "admin" ? "Admin" : "Member"}</small>
                </div>
                {isAdmin && p.user_id !== authUser?.id && (
                  <button
                    className="ghost small"
                    onClick={async () => {
                      if (!window.confirm(`Remove ${p.name} from the group?`)) return;
                      try {
                        await removeGroupMember(conversation.conversation_id, p.user_id);
                        reload();
                      } catch (err) {
                        notify(err.message || "Could not remove this member");
                      }
                    }}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button className="ghost" onClick={() => setAddingMember(true)}><HiPlus /> Add members</button>
          <button
            className="ghost danger"
            onClick={async () => {
              if (!window.confirm("Leave this group? You'll need to be added back to rejoin.")) return;
              try {
                await leaveGroupConversation(conversation.conversation_id);
                onLeft();
              } catch (err) {
                notify(err.message || "Could not leave the group");
              }
            }}
          >
            Leave group
          </button>
        </div>
      </Modal>

      {addingMember && (
        <MemberPicker
          title="Add members"
          people={people}
          excludeIds={(participants || []).map((p) => p.user_id)}
          multi
          onClose={() => setAddingMember(false)}
          onPick={async (ids) => {
            setAddingMember(false);
            try {
              for (const id of ids) await addGroupMember(conversation.conversation_id, id); // eslint-disable-line no-await-in-loop
              reload();
            } catch (err) {
              notify(err.message || "Could not add that member");
            }
          }}
        />
      )}
    </>
  );
}

/* =========================================================
   Starred messages
========================================================= */

function StarredMessagesModal({ notify, onClose, conversations }) {
  const [starred, setStarred] = useState(null);

  const reload = () => {
    listStarredMessages().then(setStarred).catch((err) => notify(err.message || "Could not load starred messages"));
  };
  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const conversationById = useMemo(() => {
    const map = {};
    conversations.forEach((c) => { map[c.conversation_id] = c; });
    return map;
  }, [conversations]);

  return (
    <Modal kicker="MESSAGES" title="Starred messages" onClose={onClose}>
      {!starred && <LoadingState label="Loading…" />}
      {starred && starred.length === 0 && <EmptyState icon={<HiStar />} title="No starred messages" text="Long-press or hover a message and tap the star to save it here." />}
      {starred && starred.map((m) => {
        const conv = conversationById[m.conversation_id];
        return (
          <div key={m.id} className="starred-message-row">
            <div>
              <b>{conv?.is_group ? conv.title : conv?.other_user_name || "Conversation"}</b>
              <p>{m.deleted_at ? "This message was deleted" : (m.body || (m.attachment_path ? "📷 Photo" : ""))}</p>
              <small>{timeLabel(m.created_at)}</small>
            </div>
            <button
              className="ghost"
              onClick={async () => {
                try {
                  await unstarMessage(m.id);
                  reload();
                } catch (err) {
                  notify(err.message || "Could not unstar this message");
                }
              }}
              aria-label="Unstar"
            >
              <HiStar className="starred" />
            </button>
          </div>
        );
      })}
    </Modal>
  );
}

/* =========================================================
   Blocked users
========================================================= */

function BlockedUsersModal({ onClose, notify }) {
  const [blocked, setBlocked] = useState([]);
  const [loading, setLoading] = useState(true);

  const reload = () => {
    setLoading(true);
    listBlockedUsers().then(setBlocked).catch((err) => notify(err.message || "Could not load blocked users")).finally(() => setLoading(false));
  };
  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal kicker="MESSAGES" title="Blocked users" onClose={onClose}>
      {loading && <LoadingState label="Loading…" />}
      {!loading && blocked.length === 0 && <EmptyState icon={<HiNoSymbol />} title="No one blocked" text="Users you block won't be able to message you." />}
      {!loading && blocked.map((b) => (
        <div key={b.user_id} className="blocked-user-row">
          <span>{b.name}</span>
          <button
            className="ghost"
            onClick={async () => {
              try {
                await unblockUser(b.user_id);
                notify(`Unblocked ${b.name}`);
                reload();
              } catch (err) {
                notify(err.message || "Could not unblock this user");
              }
            }}
          >
            Unblock
          </button>
        </div>
      ))}
    </Modal>
  );
}

/* =========================================================
   Reaction pills + picker
========================================================= */

function ReactionPills({ reactions, authUser, onToggle }) {
  if (!reactions || reactions.length === 0) return null;
  const byEmoji = {};
  reactions.forEach((r) => {
    byEmoji[r.emoji] = byEmoji[r.emoji] || [];
    byEmoji[r.emoji].push(r.user_id);
  });
  return (
    <div className="reaction-pills">
      {Object.entries(byEmoji).map(([emoji, userIds]) => (
        <button
          key={emoji}
          className={`reaction-pill${userIds.includes(authUser?.id) ? " mine" : ""}`}
          onClick={() => onToggle(emoji)}
        >
          {emoji} {userIds.length}
        </button>
      ))}
    </div>
  );
}

// Renders in place of the normal hover-action icons (not as a separate
// floating popover above them) -- a message near the top of the scrollable
// thread body has no room for anything positioned further above the bubble
// than the hover bar already is, so an extra floating layer above *that*
// clips against the container's edge for exactly the messages someone is
// most likely to react to first (the top of a thread).
function ReactionPicker({ onPick, onClose }) {
  return (
    <div className="reaction-picker" onMouseLeave={onClose}>
      {REACTION_EMOJI.map((emoji) => (
        <button key={emoji} onClick={() => onPick(emoji)} aria-label={`React ${emoji}`}>{emoji}</button>
      ))}
    </div>
  );
}

/* =========================================================
   Message bubble
========================================================= */

function MessageBubble({
  m, mine, showSender, senderName, authUser, isRead,
  onDelete, onReply, onStar, onUnstar, isStarred, onReact, reactionPickerOpen, onToggleReactionPicker,
  replySource, onJumpToReply, highlighted,
}) {
  if (m.message_type === "system") {
    return <div className="message-system-row"><span>{m.body}</span></div>;
  }

  return (
    <div id={`msg-${m.id}`} className={`message-bubble ${mine ? "mine" : "theirs"}${highlighted ? " highlighted" : ""}`}>
      {showSender && !mine && <small className="message-sender-name">{senderName}</small>}

      {m.reply_to_message_id && (
        <button type="button" className="message-reply-quote" onClick={() => onJumpToReply(m.reply_to_message_id)}>
          <b>{replySource?.senderName || "Message"}</b>
          <span>{replySource?.preview || "Original message"}</span>
        </button>
      )}

      {m.deleted_at ? (
        <p className="message-deleted">
          {m.deleted_by === m.sender_id ? "You deleted this message" : "This message was removed by a moderator"}
        </p>
      ) : (
        <>
          {m.attachment_path && <MessageAttachmentImage path={m.attachment_path} />}
          {m.body && <p>{m.body}</p>}
        </>
      )}

      <ReactionPills reactions={m.reactions} authUser={authUser} onToggle={(emoji) => onReact(m.id, emoji)} />

      <small>
        {timeLabel(m.created_at)}
        {mine && !m.deleted_at && (
          <span className="message-ticks" title={isRead ? "Read" : "Sent"}>
            <HiCheck className={isRead ? "read" : ""} />
            <HiCheck className={isRead ? "read" : ""} style={{ marginLeft: -9 }} />
          </span>
        )}
      </small>

      {!m.deleted_at && (
        <div className="message-hover-actions">
          {reactionPickerOpen ? (
            <ReactionPicker onPick={(emoji) => onReact(m.id, emoji)} onClose={() => onToggleReactionPicker(null)} />
          ) : (
            <>
              <button onClick={() => onToggleReactionPicker(m.id)} aria-label="React"><HiFaceSmile /></button>
              <button onClick={() => onReply(m)} aria-label="Reply"><HiArrowUturnLeft /></button>
              <button onClick={() => (isStarred ? onUnstar(m.id) : onStar(m.id))} aria-label={isStarred ? "Unstar" : "Star"}>
                <HiStar className={isStarred ? "starred" : ""} />
              </button>
              {mine && <button onClick={() => onDelete(m.id)} aria-label="Delete message"><HiTrash /></button>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* =========================================================
   Main Messages page
========================================================= */

export default function Messages({ notify, authUser, profile, openConversationId, onConversationOpened, onUnreadChange, people = [] }) {
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [reactionsByMessage, setReactionsByMessage] = useState({});
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState("");
  const [threadSearch, setThreadSearch] = useState("");
  const [threadSearchOpen, setThreadSearchOpen] = useState(false);
  const [blockedIds, setBlockedIds] = useState(new Set());
  const [starredIds, setStarredIds] = useState(new Set());
  const [managingBlocks, setManagingBlocks] = useState(false);
  const [showingStarred, setShowingStarred] = useState(false);
  const [showingGroupInfo, setShowingGroupInfo] = useState(false);
  const [composerModal, setComposerModal] = useState(null); // null | 'chat' | 'group'
  const [attaching, setAttaching] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [reactionPickerFor, setReactionPickerFor] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [typingName, setTypingName] = useState(null);
  const [highlightedId, setHighlightedId] = useState(null);
  const threadEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const lastTypingSentRef = useRef(0);
  const typingClearTimerRef = useRef(null);

  const reloadConversations = async () => {
    try {
      const rows = await listConversations();
      setConversations(rows);
      const total = rows.reduce((sum, r) => sum + Number(r.unread_count || 0), 0);
      onUnreadChange?.(total);
    } catch (error) {
      notify(error.message || "Could not load conversations");
    } finally {
      setLoading(false);
    }
  };

  const reloadBlocked = () => {
    listBlockedUsers().then((rows) => setBlockedIds(new Set(rows.map((r) => r.user_id)))).catch(() => {});
  };

  const reloadStarred = () => {
    listStarredMessages().then((rows) => setStarredIds(new Set(rows.map((r) => r.id)))).catch(() => {});
  };

  useEffect(() => {
    reloadConversations();
    reloadBlocked();
    reloadStarred();
    const unsub = subscribeToConversationList(() => reloadConversations());
    return () => unsub?.();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A "Message seller"/"Message" click or a tapped message notification
  // hands over a conversation id to jump straight into.
  useEffect(() => {
    if (openConversationId) {
      setActiveId(openConversationId);
      onConversationOpened?.();
    }
  }, [openConversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  const openThread = async (conversationId) => {
    setActiveId(conversationId);
    setReplyTo(null);
    setThreadSearchOpen(false);
    setThreadSearch("");
    try {
      await markConversationRead(conversationId);
      reloadConversations();
    } catch {
      // Non-fatal -- the thread still opens even if marking-read fails.
    }
  };

  // Reactions ride the same per-conversation realtime channel as messages
  // (see subscribeToConversationMessages) but aren't part of getConversationMessages'
  // own select -- refetched separately here and merged onto each message.
  const reloadReactions = async (conversationId) => {
    if (!conversationId) return;
    const rows = await listConversationReactions(conversationId).catch(() => []);
    const byMessage = {};
    rows.forEach((r) => {
      byMessage[r.message_id] = byMessage[r.message_id] || [];
      byMessage[r.message_id].push(r);
    });
    setReactionsByMessage(byMessage);
  };

  useEffect(() => {
    if (!activeId) { setMsgs([]); setParticipants([]); setReactionsByMessage({}); return; }
    let mounted = true;

    getConversationMessages(activeId).then((rows) => { if (mounted) setMsgs(rows); }).catch(() => {});
    reloadReactions(activeId);
    getConversationParticipants(activeId).then((rows) => { if (mounted) setParticipants(rows); }).catch(() => {});

    const unsub = subscribeToConversationMessages(activeId, () => {
      getConversationMessages(activeId).then((rows) => { if (mounted) setMsgs(rows); }).catch(() => {});
      reloadReactions(activeId);
      markConversationRead(activeId).then(reloadConversations).catch(() => {});
    });
    const unsubTyping = subscribeToTyping(activeId, (payload) => {
      if (payload?.name) {
        setTypingName(payload.name);
        clearTimeout(typingClearTimerRef.current);
        typingClearTimerRef.current = setTimeout(() => setTypingName(null), TYPING_EXPIRY_MS);
      }
    });

    return () => { mounted = false; unsub?.(); unsubTyping?.(); clearTimeout(typingClearTimerRef.current); };
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // A participant's last_read_at also changes on the realtime message event
  // above, but re-fetching participants specifically after *my own* sends
  // isn't needed -- read receipts are about the *other* side reading, which
  // only changes when they call markConversationRead, already covered by
  // the subscription's reloadConversations()/getConversationParticipants
  // refresh path above. Poll lightly instead so a read tick flips without
  // requiring the reader to send a message of their own.
  useEffect(() => {
    if (!activeId) return;
    const interval = setInterval(() => {
      getConversationParticipants(activeId).then(setParticipants).catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, [activeId]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs.length]);

  const activeConversation = conversations.find((c) => c.conversation_id === activeId);
  const isGroup = !!activeConversation?.is_group;
  const isChannel = !!activeConversation?.is_channel;
  const canPostHere = activeConversation ? activeConversation.can_post !== false : true;
  const activeIsBlocked = !isGroup && !isChannel && activeConversation && blockedIds.has(activeConversation.other_user_id);

  const participantsById = useMemo(() => {
    const map = {};
    participants.forEach((p) => { map[p.user_id] = p; });
    return map;
  }, [participants]);

  const msgsById = useMemo(() => {
    const map = {};
    msgs.forEach((m) => { map[m.id] = m; });
    return map;
  }, [msgs]);

  // For a DM this is the one other participant; for a group, "read" means
  // every other member has read up to that message (see get_conversation_participants()).
  const otherCount = participants.filter((p) => p.user_id !== authUser?.id).length;
  const isMessageRead = (createdAt) => {
    if (otherCount === 0) return false;
    return participants
      .filter((p) => p.user_id !== authUser?.id)
      .every((p) => p.last_read_at && new Date(p.last_read_at) >= new Date(createdAt));
  };

  const filteredConversations = search.trim()
    ? conversations.filter((c) => {
        const q = search.trim().toLowerCase();
        const name = (c.is_group || c.is_channel) ? c.title : c.other_user_name;
        return name?.toLowerCase().includes(q) || c.listing_title?.toLowerCase().includes(q);
      })
    : conversations;

  const visibleMsgs = threadSearch.trim()
    ? msgs.filter((m) => m.message_type === "system" || m.body?.toLowerCase().includes(threadSearch.trim().toLowerCase()))
    : msgs;

  const send = async () => {
    const body = draft.trim();
    if (!body || !activeId) return;
    setSending(true);
    setDraft("");
    const replyId = replyTo?.id || null;
    setReplyTo(null);
    try {
      await sendMessage(activeId, body, null, replyId);
      const rows = await getConversationMessages(activeId);
      setMsgs(rows);
    } catch (error) {
      // Restore the draft on failure (offline, rate-limited, blocked mid-
      // typing, ...) -- clearing it optimistically above and never putting
      // it back on error used to silently discard whatever the user typed,
      // leaving only a toast and nothing to retry with.
      setDraft(body);
      setReplyTo(replyId ? msgsById[replyId] : null);
      notify(error.message || "Could not send message");
    } finally {
      setSending(false);
    }
  };

  const onDraftChange = (value) => {
    setDraft(value);
    if (!activeId || !value.trim()) return;
    const now = Date.now();
    if (now - lastTypingSentRef.current > TYPING_SEND_THROTTLE_MS) {
      lastTypingSentRef.current = now;
      sendTypingSignal(activeId, profile?.name || authUser?.user_metadata?.name || "Someone");
    }
  };

  const removeMessage = async (messageId) => {
    if (!window.confirm("Delete this message? This can't be undone.")) return;
    try {
      await deleteMessage(messageId);
      const rows = await getConversationMessages(activeId);
      setMsgs(rows);
    } catch (error) {
      notify(error.message || "Could not delete this message");
    }
  };

  const sendAttachment = async (file) => {
    if (!file || !activeId) return;
    try {
      setAttaching(true);
      const path = await uploadMessageAttachment(activeId, file);
      await sendMessage(activeId, draft.trim(), path, replyTo?.id || null);
      setDraft("");
      setReplyTo(null);
      const rows = await getConversationMessages(activeId);
      setMsgs(rows);
    } catch (error) {
      notify(error.message || "Could not send this photo");
    } finally {
      setAttaching(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const react = async (messageId, emoji) => {
    setReactionPickerFor(null);
    try {
      await toggleMessageReaction(messageId, emoji);
      reloadReactions(activeId);
    } catch (err) {
      notify(err.message || "Could not react to this message");
    }
  };

  const star = async (messageId) => {
    try {
      await starMessage(messageId);
      reloadStarred();
    } catch (err) {
      notify(err.message || "Could not star this message");
    }
  };
  const unstar = async (messageId) => {
    try {
      await unstarMessage(messageId);
      reloadStarred();
    } catch (err) {
      notify(err.message || "Could not unstar this message");
    }
  };

  const jumpToReply = (messageId) => {
    const el = document.getElementById(`msg-${messageId}`);
    if (!el) { notify("That message isn't loaded here"); return; }
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedId(messageId);
    setTimeout(() => setHighlightedId(null), 1500);
  };

  const toggleBlock = async () => {
    if (!activeConversation) return;
    const { other_user_id: otherId, other_user_name: otherName } = activeConversation;
    if (activeIsBlocked) {
      try {
        await unblockUser(otherId);
        notify(`Unblocked ${otherName}`);
        reloadBlocked();
      } catch (err) {
        notify(err.message || "Could not unblock this user");
      }
      return;
    }
    if (!window.confirm(`Block ${otherName || "this user"}? They won't be able to message you anymore.`)) return;
    try {
      await blockUser(otherId);
      notify(`Blocked ${otherName}`);
      reloadBlocked();
    } catch (err) {
      notify(err.message || "Could not block this user");
    }
  };

  const reportConversation = async () => {
    if (!activeId) return;
    const reason = window.prompt("Why are you reporting this conversation? (harassment, spam, scam, etc.)");
    if (!reason?.trim()) return;
    try {
      await reportContent("conversation", activeId, reason.trim());
      notify("Reported to campus moderators");
    } catch (err) {
      notify(err.message || "Could not report this conversation");
    }
  };

  const startDm = async (personId) => {
    setComposerModal(null);
    try {
      const conversationId = await startConversation(personId);
      await reloadConversations();
      openThread(conversationId);
    } catch (err) {
      notify(err.message || "Could not start a conversation");
    }
  };

  if (loading) return <LoadingState label="Loading your messages…" />;

  // Renders one message row, wiring up all the per-message affordances
  // (reply lookups, read state, reaction picker) that would otherwise be
  // repeated at both call sites below.
  const renderMessage = (m) => {
    const mine = m.sender_id === authUser?.id;
    const senderName = participantsById[m.sender_id]?.name || (mine ? "You" : activeConversation?.other_user_name);
    const replySource = m.reply_to_message_id ? (() => {
      const src = msgsById[m.reply_to_message_id];
      if (!src) return null;
      return {
        senderName: src.sender_id === authUser?.id ? "You" : (participantsById[src.sender_id]?.name || activeConversation?.other_user_name || "Message"),
        preview: src.deleted_at ? "This message was deleted" : (src.body || (src.attachment_path ? "📷 Photo" : "")),
      };
    })() : null;

    return (
      <MessageBubble
        key={m.id}
        m={{ ...m, reactions: reactionsByMessage[m.id] }}
        mine={mine}
        showSender={isGroup}
        senderName={senderName}
        authUser={authUser}
        isRead={mine ? isMessageRead(m.created_at) : false}
        onDelete={removeMessage}
        onReply={setReplyTo}
        onStar={star}
        onUnstar={unstar}
        isStarred={starredIds.has(m.id)}
        onReact={react}
        reactionPickerOpen={reactionPickerFor === m.id}
        onToggleReactionPicker={setReactionPickerFor}
        replySource={replySource}
        onJumpToReply={jumpToReply}
        highlighted={highlightedId === m.id}
      />
    );
  };

  let lastDay = null;

  return (
    <section className="page-section">
      <PageHeader
        kicker="MESSAGES"
        title="Messages"
        text="Marketplace conversations, classmate DMs and group chats, in one place."
        action={
          <div style={{ display: "flex", gap: 8 }}>
            <button className="ghost" onClick={() => setShowingStarred(true)}><HiStar /> Starred</button>
            <button className="ghost" onClick={() => setManagingBlocks(true)}><HiNoSymbol /> Blocked</button>
          </div>
        }
      />

      {conversations.length === 0 && !activeId && (
        <EmptyState
          icon={<HiChatBubbleLeftRight />}
          title="No conversations yet"
          text="Message a seller from Marketplace or a classmate from Connect to start one."
        />
      )}

      <div className={`messages-layout${activeId ? " thread-open" : ""}`}>
        <div className="messages-list">
          <div className="messages-list-head">
            <div className="messages-search">
              <HiMagnifyingGlass />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search conversations…" aria-label="Search conversations" />
            </div>
            <div className="messages-new-actions">
              <button className="ghost small" onClick={() => setComposerModal("chat")}><HiPlus /> Chat</button>
              <button className="ghost small" onClick={() => setComposerModal("group")}><HiUserGroup /> Group</button>
            </div>
          </div>
          {filteredConversations.length === 0 && conversations.length > 0 && <EmptyState title="No matches" text="Try a different name or listing." />}
          {filteredConversations.map((c) => (
            <button
              key={c.conversation_id}
              className={`message-thread-row ${c.conversation_id === activeId ? "active" : ""}`}
              onClick={() => openThread(c.conversation_id)}
            >
              {c.is_channel ? <div className="big-avatar small channel"><HiMegaphone /></div> : c.is_group ? <div className="big-avatar small group"><HiUserGroup /></div> : <Avatar name={c.other_user_name} small />}
              <div>
                <b>
                  {(c.is_group || c.is_channel) ? c.title : (c.other_user_name || "Campus member")}
                  {!c.is_group && !c.is_channel && blockedIds.has(c.other_user_id) && <span className="blocked-tag"> · Blocked</span>}
                </b>
                {c.listing_title && <small className="listing-tag">Re: {c.listing_title}</small>}
                <small>
                  {c.is_group && c.last_message_sender_name ? `${c.last_message_sender_name}: ` : ""}
                  {c.last_message_body ? c.last_message_body.slice(0, 60) : c.is_channel ? "No broadcasts yet" : "Say hello…"}
                </small>
              </div>
              {Number(c.unread_count) > 0 && <i>{c.unread_count}</i>}
            </button>
          ))}
        </div>

        <div className="messages-thread">
          {!activeId && conversations.length > 0 && (
            <EmptyState icon={<HiChatBubbleLeftRight />} title="Select a conversation" text="Pick a thread on the left to read and reply." />
          )}

          {activeId && (
            <>
              <div className="messages-thread-head">
                <button className="thread-back-btn" onClick={() => setActiveId(null)} aria-label="Back to conversations"><HiArrowLeft /></button>
                <button
                  type="button"
                  className={`messages-thread-title${isGroup ? " clickable" : ""}`}
                  onClick={() => isGroup && setShowingGroupInfo(true)}
                >
                  {isChannel ? <div className="big-avatar small channel"><HiMegaphone /></div> : isGroup ? <div className="big-avatar small group"><HiUserGroup /></div> : <Avatar name={activeConversation?.other_user_name} small />}
                  <div>
                    <b>{(isGroup || isChannel) ? activeConversation?.title : (activeConversation?.other_user_name || "Conversation")}</b>
                    {isGroup && <small>{activeConversation?.member_count} members</small>}
                    {isChannel && <small>Broadcast channel · {activeConversation?.member_count} {activeConversation.member_count === 1 ? "recipient" : "recipients"}</small>}
                    {!isGroup && !isChannel && activeConversation?.listing_title && <small>About: {activeConversation.listing_title}</small>}
                    {!isGroup && !isChannel && activeConversation?.other_user_availability_status === "away" && (
                      <small className="availability-chip away">
                        Away{activeConversation.other_user_availability_message ? ` · ${activeConversation.other_user_availability_message}` : ""}
                      </small>
                    )}
                  </div>
                </button>
                <div className="messages-thread-actions">
                  <button className="ghost" onClick={() => setThreadSearchOpen((v) => !v)} aria-label="Search in conversation"><HiMagnifyingGlass /></button>
                  {!isGroup && !isChannel && <button className="ghost" onClick={toggleBlock}>{activeIsBlocked ? "Unblock" : "Block"}</button>}
                  <button className="ghost" onClick={reportConversation}><HiFlag /> Report</button>
                </div>
              </div>

              {threadSearchOpen && (
                <div className="messages-search thread-search">
                  <HiMagnifyingGlass />
                  <input value={threadSearch} onChange={(e) => setThreadSearch(e.target.value)} placeholder="Search in this conversation…" aria-label="Search in this conversation" autoFocus />
                  {threadSearch && <small>{visibleMsgs.filter((m) => m.message_type !== "system").length} match(es)</small>}
                </div>
              )}

              <div className="messages-thread-body">
                {visibleMsgs.map((m) => {
                  const day = dayLabel(m.created_at);
                  const showDivider = day !== lastDay;
                  lastDay = day;
                  return (
                    <React.Fragment key={m.id}>
                      {showDivider && <div className="message-date-divider"><span>{day}</span></div>}
                      {renderMessage(m)}
                    </React.Fragment>
                  );
                })}
                {typingName && (
                  <div className="typing-indicator-row"><span>{typingName} is typing…</span></div>
                )}
                <div ref={threadEndRef} />
              </div>

              {replyTo && (
                <div className="reply-preview-strip">
                  <div>
                    <b>{replyTo.sender_id === authUser?.id ? "You" : (participantsById[replyTo.sender_id]?.name || activeConversation?.other_user_name || "Message")}</b>
                    <span>{replyTo.body || (replyTo.attachment_path ? "📷 Photo" : "")}</span>
                  </div>
                  <button onClick={() => setReplyTo(null)} aria-label="Cancel reply"><HiXMark /></button>
                </div>
              )}

              {activeIsBlocked ? (
                <div className="messages-compose blocked">
                  <span>You&apos;ve blocked this person. Unblock them to send a message.</span>
                </div>
              ) : isChannel && !canPostHere ? (
                <div className="messages-compose blocked">
                  <span><HiMegaphone /> This is a broadcast channel — only {activeConversation?.title} can post here.</span>
                </div>
              ) : (
                <div className="messages-compose">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    ref={fileInputRef}
                    style={{ display: "none" }}
                    onChange={(e) => sendAttachment(e.target.files?.[0])}
                  />
                  <button className="attach-btn" disabled={sending || attaching} onClick={() => fileInputRef.current?.click()} aria-label="Attach photo">
                    <HiPhoto />
                  </button>
                  <input
                    value={draft}
                    onChange={(e) => onDraftChange(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                    placeholder={attaching ? "Sending photo…" : "Type a message…"}
                    aria-label="Message"
                    disabled={sending || attaching}
                  />
                  <button className="primary" disabled={sending || attaching || !draft.trim()} onClick={send} aria-label="Send message">
                    <HiPaperAirplane />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {managingBlocks && <BlockedUsersModal notify={notify} onClose={() => { setManagingBlocks(false); reloadBlocked(); }} />}
      {showingStarred && <StarredMessagesModal notify={notify} conversations={conversations} onClose={() => { setShowingStarred(false); reloadStarred(); }} />}
      {showingGroupInfo && activeConversation && (
        <GroupInfoPanel
          conversation={activeConversation}
          authUser={authUser}
          notify={notify}
          people={people}
          onClose={() => setShowingGroupInfo(false)}
          onRenamed={() => { setShowingGroupInfo(false); reloadConversations(); }}
          onLeft={() => { setShowingGroupInfo(false); setActiveId(null); reloadConversations(); }}
        />
      )}
      {composerModal === "chat" && (
        <MemberPicker
          title="New chat"
          people={people}
          excludeIds={[authUser?.id]}
          onClose={() => setComposerModal(null)}
          onPick={([id]) => startDm(id)}
        />
      )}
      {composerModal === "group" && (
        <NewGroupFlow
          people={people}
          authUser={authUser}
          notify={notify}
          onClose={() => setComposerModal(null)}
          onCreated={(conversationId) => { setComposerModal(null); reloadConversations().then(() => openThread(conversationId)); }}
        />
      )}
    </section>
  );
}
