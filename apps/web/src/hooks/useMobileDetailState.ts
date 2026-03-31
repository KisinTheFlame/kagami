import { useState } from "react";

type UseMobileDetailStateParams = {
  isMobile: boolean;
};

export function useMobileDetailState<TId extends string | number>({
  isMobile,
}: UseMobileDetailStateParams) {
  const [selectedId, setSelectedId] = useState<TId | null>(null);
  const [isMobileDetailOpen, setIsMobileDetailOpen] = useState(false);

  function handleSelectItem(id: TId) {
    setSelectedId(id);
    if (isMobile) {
      setIsMobileDetailOpen(true);
    }
  }

  function handleBackToList() {
    setIsMobileDetailOpen(false);
  }

  function resetDetailState() {
    setSelectedId(null);
    setIsMobileDetailOpen(false);
  }

  return {
    selectedId,
    showMobileDetail: isMobile && isMobileDetailOpen && selectedId !== null,
    handleSelectItem,
    handleBackToList,
    resetDetailState,
  };
}
