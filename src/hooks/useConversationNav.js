function useConversationNav({ go, setOpenConversationId }) {
  const goToConversation = (conversationId) => {
      setOpenConversationId(conversationId);
      go("messages");
    };

  return { goToConversation };
}

export { useConversationNav };
