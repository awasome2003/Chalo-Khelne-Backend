// Chat membership — the single source of truth for "may this principal see
// this chat?".
//
// This used to live only in routes/groupChatRoutes.js, which meant the HTTP
// layer enforced it and the socket layer did not: any authenticated user could
// emit join:gchat with a chat id and receive every subsequent message live,
// while the same user was refused by the API. Both layers now call these
// helpers, so a membership rule can only be changed in one place.

const GroupChat = require("../src/modules/social/models/GroupChat");
const Conversation = require("../src/modules/social/models/Conversation");

// Synchronous predicate over an already-loaded GroupChat document.
// createdBy and members[].userId are Strings on this schema (cross-model
// compat), so compare stringified on both sides.
function isMember(chat, userId) {
  if (!chat || !userId) return false;
  return (
    String(chat.createdBy) === String(userId) ||
    (chat.members || []).some((m) => String(m.userId) === String(userId))
  );
}

// Async gate for the socket layer, which has no loaded document in hand.
// Returns false on a malformed id or a missing chat rather than throwing —
// the caller turns that into a join:denied.
async function canJoinGroupChat(userId, chatId) {
  if (!userId || !chatId) return false;
  try {
    const chat = await GroupChat.findById(chatId)
      .select("createdBy members.userId")
      .lean();
    return isMember(chat, userId);
  } catch (_) {
    return false;
  }
}

// Direct conversations store participants as ObjectId refs.
async function canJoinConversation(userId, conversationId) {
  if (!userId || !conversationId) return false;
  try {
    const convo = await Conversation.findById(conversationId)
      .select("participants")
      .lean();
    if (!convo) return false;
    return (convo.participants || []).some(
      (p) => String(p) === String(userId)
    );
  } catch (_) {
    return false;
  }
}

module.exports = { isMember, canJoinGroupChat, canJoinConversation };
