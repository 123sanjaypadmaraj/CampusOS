function useToast({ setToast, toastTimer }) {
  const notify = (message) => {
      setToast(message);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(""), 2400);
    };

  return { notify };
}

export { useToast };
