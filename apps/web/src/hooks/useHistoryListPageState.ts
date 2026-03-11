import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useSearchParams } from "react-router-dom";
import { areSearchParamsEqual, parsePositivePage } from "@/lib/search-params";
import { useIsMobile } from "./useIsMobile";
import { useMobileDetailState } from "./useMobileDetailState";

type UseHistoryListPageStateParams<TFilters, TFormState> = {
  parseFilters: (params: URLSearchParams) => TFilters;
  toFormState: (params: URLSearchParams) => TFormState;
  buildSearchParams: (formState: TFormState) => URLSearchParams;
  createEmptyFormState: () => TFormState;
  onSameParamsSubmit?: () => void;
};

type UseHistoryListPageStateResult<TFilters, TFormState> = {
  isMobile: boolean;
  page: number;
  filters: TFilters;
  formState: TFormState;
  setFormState: Dispatch<SetStateAction<TFormState>>;
  selectedId: number | null;
  showMobileDetail: boolean;
  handleSelectItem: (id: number) => void;
  handleBackToList: () => void;
  submitFilters: () => void;
  resetFilters: () => void;
  goToPage: (next: number) => void;
};

export function useHistoryListPageState<TFilters, TFormState>({
  parseFilters,
  toFormState,
  buildSearchParams,
  createEmptyFormState,
  onSameParamsSubmit,
}: UseHistoryListPageStateParams<TFilters, TFormState>): UseHistoryListPageStateResult<
  TFilters,
  TFormState
> {
  const [params, setParams] = useSearchParams();
  const isMobile = useIsMobile();
  const { selectedId, showMobileDetail, handleSelectItem, handleBackToList, resetDetailState } =
    useMobileDetailState({ isMobile });

  const page = useMemo(() => parsePositivePage(params.get("page")), [params]);
  const filters = useMemo(() => parseFilters(params), [params, parseFilters]);
  const [formState, setFormState] = useState<TFormState>(() => toFormState(params));

  useEffect(() => {
    setFormState(toFormState(params));
  }, [params, toFormState]);

  function submitFilters() {
    const nextParams = buildSearchParams(formState);
    nextParams.set("page", "1");

    resetDetailState();
    if (areSearchParamsEqual(params, nextParams)) {
      onSameParamsSubmit?.();
      return;
    }

    setParams(nextParams);
  }

  function resetFilters() {
    const nextFormState = createEmptyFormState();
    const nextParams = buildSearchParams(nextFormState);
    nextParams.set("page", "1");

    setFormState(nextFormState);
    resetDetailState();
    if (areSearchParamsEqual(params, nextParams)) {
      onSameParamsSubmit?.();
      return;
    }

    setParams(nextParams);
  }

  function goToPage(next: number) {
    const nextParams = new URLSearchParams(params);
    nextParams.set("page", String(next));
    resetDetailState();
    setParams(nextParams);
  }

  return {
    isMobile,
    page,
    filters,
    formState,
    setFormState,
    selectedId,
    showMobileDetail,
    handleSelectItem,
    handleBackToList,
    submitFilters,
    resetFilters,
    goToPage,
  };
}
