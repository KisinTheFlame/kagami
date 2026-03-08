import { useState } from "react";

type UseMobileDetailStateParams = {
  isMobile: boolean;
};

export function useMobileDetailState({ isMobile }: UseMobileDetailStateParams) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [isMobileDetailOpen, setIsMobileDetailOpen] = useState(false);

  function handleSelectItem(id: number) {
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
