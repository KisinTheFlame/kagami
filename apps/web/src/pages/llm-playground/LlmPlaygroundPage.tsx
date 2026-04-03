import {
  LlmPlaygroundChatRequestSchema,
  LlmPlaygroundChatResponseSchema,
  LlmPlaygroundToolListResponseSchema,
  LlmProviderListResponseSchema,
  type LlmPlaygroundChatRequest,
  type LlmPlaygroundChatResponse,
  type LlmToolCallPayload,
  type LlmToolDefinition,
  type LlmProviderOption,
  type PlaygroundContentPart,
  type PlaygroundMessage,
} from "@kagami/shared/schemas/llm-chat";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  ImagePlus,
  Plus,
  RefreshCcw,
  SendHorizontal,
  Trash2,
} from "lucide-react";
import { useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  JsonPanelSection,
  type JsonPanelCopyStatus,
  type JsonPanelSectionItem,
} from "@/components/ui/json-panel-section";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError, apiPost, getApiErrorMessage, type ApiRequestResult } from "@/lib/api";
import { createSchemaQueryOptions, queryKeys } from "@/lib/query";
import {
  getPlaygroundImportDraftFromLocationState,
  resolvePlaygroundImportDraft,
} from "./playground-import";

type PlaygroundResult = {
  payload: LlmPlaygroundChatRequest;
  response: ApiRequestResult;
  parsedResponse: LlmPlaygroundChatResponse | null;
  responseSchemaError: string | null;
};

type ToolChoiceMode = "none" | "auto" | "required" | "tool";
type EditorRole = PlaygroundMessage["role"];
type EditorPropertyType = "string" | "number" | "integer" | "boolean" | "object" | "array";

type EditorTextPart = {
  id: string;
  type: "text";
  text: string;
};

type EditorImagePart = {
  id: string;
  type: "image";
  fileName: string;
  mimeType: string;
  dataUrl: string;
};

type EditorContentPart = EditorTextPart | EditorImagePart;

type EditorToolCall = {
  id: string;
  toolCallId: string;
  name: string;
  argumentsText: string;
};

type EditorUserMessage = {
  id: string;
  role: "user";
  parts: EditorContentPart[];
};

type EditorAssistantMessage = {
  id: string;
  role: "assistant";
  content: string;
  toolCalls: EditorToolCall[];
};

type EditorToolMessage = {
  id: string;
  role: "tool";
  toolCallId: string;
  content: string;
};

type EditorMessage = EditorUserMessage | EditorAssistantMessage | EditorToolMessage;

type EditorToolProperty = {
  id: string;
  name: string;
  type: EditorPropertyType;
  description: string;
  rawSchema: Record<string, unknown>;
};

type EditorTool = {
  id: string;
  name: string;
  description: string;
  properties: EditorToolProperty[];
};

const EMPTY_PROVIDERS: LlmProviderOption[] = [];
const EMPTY_TOOL_LIBRARY: LlmToolDefinition[] = [];

export function LlmPlaygroundPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [selectedProviderId, setSelectedProviderId] = useState<LlmProviderOption["id"] | "">("");
  const [model, setModel] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [messages, setMessages] = useState<EditorMessage[]>(createDefaultMessages);
  const [tools, setTools] = useState<EditorTool[]>([]);
  const [toolChoiceMode, setToolChoiceMode] = useState<ToolChoiceMode>("none");
  const [selectedToolNameForChoice, setSelectedToolNameForChoice] = useState("");
  const [editorError, setEditorError] = useState<string | null>(null);
  const [responseError, setResponseError] = useState<string | null>(null);
  const [lastPayload, setLastPayload] = useState<LlmPlaygroundChatRequest | null>(null);
  const [lastResponse, setLastResponse] = useState<ApiRequestResult | null>(null);
  const [lastParsedResponse, setLastParsedResponse] = useState<LlmPlaygroundChatResponse | null>(
    null,
  );
  const [activeNativePayloadPanelKey, setActiveNativePayloadPanelKey] = useState<string | null>(
    null,
  );
  const [nativePayloadCopyStatus, setNativePayloadCopyStatus] =
    useState<JsonPanelCopyStatus>("idle");
  const nativePayloadCopyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const providersQuery = useQuery({
    ...createSchemaQueryOptions({
      queryKey: queryKeys.llm.providers(),
      path: "/llm/providers",
      schema: LlmProviderListResponseSchema,
    }),
  });

  const toolLibraryQuery = useQuery({
    ...createSchemaQueryOptions({
      queryKey: queryKeys.llm.playgroundTools(),
      path: "/llm/playground-tools",
      schema: LlmPlaygroundToolListResponseSchema,
    }),
  });

  const providers = providersQuery.data?.providers ?? EMPTY_PROVIDERS;
  const toolLibrary = toolLibraryQuery.data?.tools ?? EMPTY_TOOL_LIBRARY;
  const incomingImportDraft = useMemo(
    () => getPlaygroundImportDraftFromLocationState(location.state),
    [location.state],
  );

  const effectiveProviderId = selectedProviderId || providers[0]?.id || "";
  const selectedProvider = useMemo(
    () => providers.find(provider => provider.id === effectiveProviderId) ?? null,
    [effectiveProviderId, providers],
  );

  const selectedModel = selectedProvider?.models.includes(model)
    ? model
    : (selectedProvider?.models[0] ?? "");

  const currentToolNames = useMemo(
    () =>
      tools
        .map(tool => tool.name.trim())
        .filter((toolName): toolName is string => toolName.length > 0),
    [tools],
  );

  const effectiveSelectedToolNameForChoice = currentToolNames.includes(selectedToolNameForChoice)
    ? selectedToolNameForChoice
    : (currentToolNames[0] ?? "");
  const nativePayloadItems = useMemo<JsonPanelSectionItem[]>(
    () =>
      lastParsedResponse?.nativeRequestPayload
        ? [
            {
              key: "nativeRequestPayload",
              title: "nativeRequestPayload",
              value: lastParsedResponse.nativeRequestPayload,
            },
          ]
        : [],
    [lastParsedResponse],
  );

  useEffect(() => {
    return () => {
      if (nativePayloadCopyTimeoutRef.current !== null) {
        clearTimeout(nativePayloadCopyTimeoutRef.current);
      }
    };
  }, []);

  const requestMutation = useMutation({
    mutationFn: async (payload: LlmPlaygroundChatRequest): Promise<PlaygroundResult> => {
      let response: ApiRequestResult;
      try {
        response = await apiPost("/llm/chat", payload);
      } catch (error) {
        if (error instanceof ApiError) {
          return {
            payload,
            response: error.result,
            parsedResponse: null,
            responseSchemaError: null,
          };
        }

        throw error;
      }

      const parsedResponse = LlmPlaygroundChatResponseSchema.safeParse(response.body);
      return {
        payload,
        response,
        parsedResponse: parsedResponse.success ? parsedResponse.data : null,
        responseSchemaError: parsedResponse.success
          ? null
          : formatSchemaIssues(parsedResponse.error.issues),
      };
    },
    onMutate: payload => {
      setEditorError(null);
      setResponseError(null);
      setLastPayload(payload);
      setLastResponse(null);
      setLastParsedResponse(null);
    },
    onSuccess: result => {
      setLastPayload(result.payload);
      setLastResponse(result.response);
      setLastParsedResponse(result.parsedResponse);

      if (!result.response.ok) {
        setResponseError(formatHttpError(result.response));
        return;
      }

      if (result.responseSchemaError) {
        setResponseError(`响应结构校验失败：${result.responseSchemaError}`);
      }
    },
    onError: error => {
      setResponseError(getApiErrorMessage(error));
    },
  });

  const applyImportedDraft = useEffectEvent(
    (draft: typeof incomingImportDraft, availableProviders: LlmProviderOption[]) => {
      if (draft === null) {
        return;
      }

      const resolvedImport = resolvePlaygroundImportDraft({
        draft,
        providers: availableProviders,
      });

      setSelectedProviderId(resolvedImport.selectedProviderId);
      setModel(resolvedImport.selectedModel);
      setSystemPrompt(resolvedImport.payload.system ?? "");
      setMessages(resolvedImport.payload.messages.map(playgroundMessageToEditor));
      setTools(resolvedImport.payload.tools.map(toolDefinitionToEditor));

      if (
        resolvedImport.payload.toolChoice === "auto" ||
        resolvedImport.payload.toolChoice === "none"
      ) {
        setToolChoiceMode(resolvedImport.payload.toolChoice);
        setSelectedToolNameForChoice("");
      } else if (resolvedImport.payload.toolChoice === "required") {
        setToolChoiceMode("required");
        setSelectedToolNameForChoice("");
      } else {
        setToolChoiceMode("tool");
        setSelectedToolNameForChoice(resolvedImport.payload.toolChoice.tool_name);
      }

      setEditorError(null);
      setResponseError(null);
      setLastPayload(null);
      setLastResponse(null);
      setLastParsedResponse(null);
    },
  );

  useEffect(() => {
    if (incomingImportDraft === null || providersQuery.isLoading) {
      return;
    }

    applyImportedDraft(incomingImportDraft, providers);

    void navigate(`${location.pathname}${location.search}`, {
      replace: true,
      state: null,
    });
  }, [
    incomingImportDraft,
    location.pathname,
    location.search,
    navigate,
    providers,
    providersQuery.isLoading,
  ]);

  function handleProviderChange(nextProviderId: string): void {
    setSelectedProviderId(nextProviderId as LlmProviderOption["id"]);
    const nextProvider = providers.find(provider => provider.id === nextProviderId);
    setModel(nextProvider?.models[0] ?? "");
  }

  function handleReset(): void {
    setSystemPrompt("");
    setMessages(createDefaultMessages());
    setTools([]);
    setToolChoiceMode("none");
    setSelectedToolNameForChoice("");
    setEditorError(null);
    setResponseError(null);
    setLastPayload(null);
    setLastResponse(null);
    setLastParsedResponse(null);
  }

  async function handleCopyNativePayload(panelKey: string, text: string): Promise<void> {
    if (nativePayloadCopyTimeoutRef.current !== null) {
      clearTimeout(nativePayloadCopyTimeoutRef.current);
    }

    if (!navigator.clipboard?.writeText) {
      console.error("Clipboard API is not available in this browser.");
      setActiveNativePayloadPanelKey(panelKey);
      setNativePayloadCopyStatus("error");
      scheduleNativePayloadCopyReset();
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      setActiveNativePayloadPanelKey(panelKey);
      setNativePayloadCopyStatus("success");
    } catch (error) {
      console.error("Failed to copy native request payload.", error);
      setActiveNativePayloadPanelKey(panelKey);
      setNativePayloadCopyStatus("error");
    }

    scheduleNativePayloadCopyReset();
  }

  function scheduleNativePayloadCopyReset(): void {
    nativePayloadCopyTimeoutRef.current = window.setTimeout(() => {
      setActiveNativePayloadPanelKey(null);
      setNativePayloadCopyStatus("idle");
      nativePayloadCopyTimeoutRef.current = null;
    }, 1800);
  }

  function handleAddMessage(role: EditorRole): void {
    setMessages(currentMessages => [...currentMessages, createMessage(role)]);
  }

  function handleMoveMessage(messageId: string, direction: "up" | "down"): void {
    setMessages(currentMessages => moveItem(currentMessages, messageId, direction));
  }

  function handleDeleteMessage(messageId: string): void {
    setMessages(currentMessages => currentMessages.filter(message => message.id !== messageId));
  }

  function handleMessageRoleChange(messageId: string, role: EditorRole): void {
    setMessages(currentMessages =>
      currentMessages.map(message =>
        message.id === messageId ? convertMessageRole(message, role) : message,
      ),
    );
  }

  function handleUserPartChange(
    messageId: string,
    partId: string,
    updater: (part: EditorContentPart) => EditorContentPart,
  ): void {
    setMessages(currentMessages =>
      currentMessages.map(message =>
        message.id !== messageId || message.role !== "user"
          ? message
          : {
              ...message,
              parts: message.parts.map(part => (part.id === partId ? updater(part) : part)),
            },
      ),
    );
  }

  function handleAddTextPart(messageId: string): void {
    setMessages(currentMessages =>
      currentMessages.map(message =>
        message.id !== messageId || message.role !== "user"
          ? message
          : {
              ...message,
              parts: [...message.parts, createTextPart("")],
            },
      ),
    );
  }

  async function handleAddImagePart(messageId: string, file: File | null): Promise<void> {
    if (!file) {
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      setMessages(currentMessages =>
        currentMessages.map(message =>
          message.id !== messageId || message.role !== "user"
            ? message
            : {
                ...message,
                parts: [
                  ...message.parts,
                  {
                    id: createEditorId(),
                    type: "image",
                    fileName: file.name,
                    mimeType: file.type || "image/png",
                    dataUrl,
                  },
                ],
              },
        ),
      );
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : "图片读取失败");
    }
  }

  function handleMovePart(messageId: string, partId: string, direction: "up" | "down"): void {
    setMessages(currentMessages =>
      currentMessages.map(message =>
        message.id !== messageId || message.role !== "user"
          ? message
          : {
              ...message,
              parts: moveItem(message.parts, partId, direction),
            },
      ),
    );
  }

  function handleDeletePart(messageId: string, partId: string): void {
    setMessages(currentMessages =>
      currentMessages.map(message =>
        message.id !== messageId || message.role !== "user"
          ? message
          : {
              ...message,
              parts: message.parts.filter(part => part.id !== partId),
            },
      ),
    );
  }

  function handleAssistantToolCallChange(
    messageId: string,
    toolCallId: string,
    updater: (toolCall: EditorToolCall) => EditorToolCall,
  ): void {
    setMessages(currentMessages =>
      currentMessages.map(message =>
        message.id !== messageId || message.role !== "assistant"
          ? message
          : {
              ...message,
              toolCalls: message.toolCalls.map(toolCall =>
                toolCall.id === toolCallId ? updater(toolCall) : toolCall,
              ),
            },
      ),
    );
  }

  function handleAddAssistantToolCall(messageId: string): void {
    setMessages(currentMessages =>
      currentMessages.map(message =>
        message.id !== messageId || message.role !== "assistant"
          ? message
          : {
              ...message,
              toolCalls: [...message.toolCalls, createToolCall()],
            },
      ),
    );
  }

  function handleDeleteAssistantToolCall(messageId: string, toolCallId: string): void {
    setMessages(currentMessages =>
      currentMessages.map(message =>
        message.id !== messageId || message.role !== "assistant"
          ? message
          : {
              ...message,
              toolCalls: message.toolCalls.filter(toolCall => toolCall.id !== toolCallId),
            },
      ),
    );
  }

  function handleTextMessageChange(messageId: string, nextValue: string): void {
    setMessages(currentMessages =>
      currentMessages.map(message => {
        if (message.id !== messageId || message.role === "user") {
          return message;
        }

        if (message.role === "assistant") {
          return {
            ...message,
            content: nextValue,
          };
        }

        return {
          ...message,
          content: nextValue,
        };
      }),
    );
  }

  function handleToolMessageCallIdChange(messageId: string, nextValue: string): void {
    setMessages(currentMessages =>
      currentMessages.map(message =>
        message.id !== messageId || message.role !== "tool"
          ? message
          : {
              ...message,
              toolCallId: nextValue,
            },
      ),
    );
  }

  function handleAddCustomTool(): void {
    setTools(currentTools => [...currentTools, createToolEditor()]);
  }

  function handleAddLibraryTool(definition: LlmToolDefinition): void {
    setTools(currentTools => [...currentTools, toolDefinitionToEditor(definition)]);
  }

  function handleMoveTool(toolId: string, direction: "up" | "down"): void {
    setTools(currentTools => moveItem(currentTools, toolId, direction));
  }

  function handleDeleteTool(toolId: string): void {
    setTools(currentTools => currentTools.filter(tool => tool.id !== toolId));
  }

  function handleToolChange(toolId: string, updater: (tool: EditorTool) => EditorTool): void {
    setTools(currentTools => currentTools.map(tool => (tool.id === toolId ? updater(tool) : tool)));
  }

  function handleAddToolProperty(toolId: string): void {
    handleToolChange(toolId, tool => ({
      ...tool,
      properties: [...tool.properties, createToolProperty()],
    }));
  }

  function handleToolPropertyChange(
    toolId: string,
    propertyId: string,
    updater: (property: EditorToolProperty) => EditorToolProperty,
  ): void {
    handleToolChange(toolId, tool => ({
      ...tool,
      properties: tool.properties.map(property =>
        property.id === propertyId ? updater(property) : property,
      ),
    }));
  }

  function handleMoveToolProperty(
    toolId: string,
    propertyId: string,
    direction: "up" | "down",
  ): void {
    handleToolChange(toolId, tool => ({
      ...tool,
      properties: moveItem(tool.properties, propertyId, direction),
    }));
  }

  function handleDeleteToolProperty(toolId: string, propertyId: string): void {
    handleToolChange(toolId, tool => ({
      ...tool,
      properties: tool.properties.filter(property => property.id !== propertyId),
    }));
  }

  function handleSubmit(): void {
    if (!selectedProvider) {
      setEditorError("当前没有可用的 provider，请先在服务端配置 LLM 凭证。");
      return;
    }

    const payload = parsePlaygroundPayload({
      provider: selectedProvider.id,
      model: selectedModel,
      availableModels: selectedProvider.models,
      systemPrompt,
      messages,
      tools,
      toolChoiceMode,
      selectedToolNameForChoice: effectiveSelectedToolNameForChoice,
    });

    if (!payload.success) {
      setEditorError(payload.error);
      return;
    }

    requestMutation.mutate(payload.data);
  }

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-auto bg-[radial-gradient(circle_at_top_left,_rgba(14,116,144,0.12),_transparent_28%),linear-gradient(180deg,_rgba(248,250,252,0.98),_rgba(226,232,240,0.92))] p-3 md:p-6 xl:overflow-hidden">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 xl:h-full xl:min-h-0 xl:flex-1">
        <div className="grid grid-cols-1 gap-4 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,1fr)_320px] xl:overflow-hidden">
          <section className="flex min-h-0 flex-col overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/75 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur">
            <div className="border-b border-slate-200/80 px-6 py-5">
              <p className="text-xs font-medium uppercase tracking-[0.24em] text-slate-500">
                Playground Canvas
              </p>
              <h2 className="mt-2 text-lg font-semibold text-slate-900">上下文编排区</h2>
              <p className="mt-1 text-sm text-slate-600">
                在一个连续工作台里组织 prompt、消息、工具定义和响应结果。
              </p>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 xl:p-5">
              <Panel title="System Prompt" description="单独控制系统提示词，不混入消息列表。">
                <textarea
                  value={systemPrompt}
                  onChange={event => setSystemPrompt(event.target.value)}
                  placeholder="可选，例如：你是一名严谨的代码评审助手。"
                  className="min-h-[120px] w-full resize-y rounded-2xl border bg-background p-4 text-sm outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                />
              </Panel>

              <Panel
                title="Messages"
                description="按消息角色组织上下文，user 消息支持文本和图片片段。"
              >
                {messages.length === 0 ? (
                  <StateHint text="当前还没有消息，先添加一条 user 消息开始实验。" />
                ) : (
                  <div className="space-y-4">
                    {messages.map((message, index) => (
                      <MessageEditorCard
                        key={message.id}
                        index={index}
                        message={message}
                        total={messages.length}
                        onDelete={() => handleDeleteMessage(message.id)}
                        onMoveUp={() => handleMoveMessage(message.id, "up")}
                        onMoveDown={() => handleMoveMessage(message.id, "down")}
                        onRoleChange={role => handleMessageRoleChange(message.id, role)}
                        onTextChange={value => handleTextMessageChange(message.id, value)}
                        onToolCallIdChange={value =>
                          handleToolMessageCallIdChange(message.id, value)
                        }
                        onAddTextPart={() => handleAddTextPart(message.id)}
                        onAddImagePart={file => handleAddImagePart(message.id, file)}
                        onPartChange={(partId, updater) =>
                          handleUserPartChange(message.id, partId, updater)
                        }
                        onPartMove={(partId, direction) =>
                          handleMovePart(message.id, partId, direction)
                        }
                        onPartDelete={partId => handleDeletePart(message.id, partId)}
                        onAddAssistantToolCall={() => handleAddAssistantToolCall(message.id)}
                        onAssistantToolCallChange={(toolCallId, updater) =>
                          handleAssistantToolCallChange(message.id, toolCallId, updater)
                        }
                        onAssistantToolCallDelete={toolCallId =>
                          handleDeleteAssistantToolCall(message.id, toolCallId)
                        }
                      />
                    ))}
                  </div>
                )}

                <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
                  <Button type="button" size="sm" onClick={() => handleAddMessage("user")}>
                    <Plus className="mr-2 h-4 w-4" />
                    新增 User
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => handleAddMessage("assistant")}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    新增 Assistant
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => handleAddMessage("tool")}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    新增 Tool
                  </Button>
                </div>
              </Panel>

              <Panel title="Tools" description="管理给模型看的工具定义，可快速插入后端已有工具。">
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" onClick={handleAddCustomTool}>
                      <Plus className="mr-2 h-4 w-4" />
                      新增自定义工具
                    </Button>
                  </div>

                  <section className="rounded-2xl border border-dashed bg-muted/20 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold">快速添加</h3>
                        <p className="text-xs text-muted-foreground">
                          使用后端已注册工具的 definition 作为起点。
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {toolLibraryQuery.isLoading ? (
                        <span className="text-sm text-muted-foreground">正在读取工具定义...</span>
                      ) : toolLibraryQuery.isError ? (
                        <span className="text-sm text-destructive">
                          {toolLibraryQuery.error.message}
                        </span>
                      ) : toolLibrary.length === 0 ? (
                        <span className="text-sm text-muted-foreground">
                          当前没有可插入的后端工具。
                        </span>
                      ) : (
                        toolLibrary.map(tool => (
                          <Button
                            key={tool.name}
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => handleAddLibraryTool(tool)}
                          >
                            <Plus className="mr-2 h-4 w-4" />
                            {tool.name}
                          </Button>
                        ))
                      )}
                    </div>
                  </section>

                  {tools.length === 0 ? (
                    <StateHint text="当前没有工具定义。toolChoice 可以先保持 none。" />
                  ) : (
                    <div className="space-y-4">
                      {tools.map((tool, index) => (
                        <ToolEditorCard
                          key={tool.id}
                          tool={tool}
                          index={index}
                          total={tools.length}
                          onMoveUp={() => handleMoveTool(tool.id, "up")}
                          onMoveDown={() => handleMoveTool(tool.id, "down")}
                          onDelete={() => handleDeleteTool(tool.id)}
                          onChange={updater => handleToolChange(tool.id, updater)}
                          onAddProperty={() => handleAddToolProperty(tool.id)}
                          onPropertyChange={(propertyId, updater) =>
                            handleToolPropertyChange(tool.id, propertyId, updater)
                          }
                          onPropertyMove={(propertyId, direction) =>
                            handleMoveToolProperty(tool.id, propertyId, direction)
                          }
                          onPropertyDelete={propertyId =>
                            handleDeleteToolProperty(tool.id, propertyId)
                          }
                        />
                      ))}
                    </div>
                  )}
                </div>
              </Panel>

              <Panel title="Response" description="查看结构化输出、错误信息和完整原始响应。">
                {requestMutation.isPending ? (
                  <StateHint text="请求已发出，正在等待模型返回..." />
                ) : lastResponse === null ? (
                  <StateHint text="还没有响应结果，发送一次请求后会显示在这里。" />
                ) : (
                  <div className="space-y-4">
                    {lastPayload ? (
                      <div className="grid grid-cols-1 gap-3 rounded-2xl border bg-muted/20 p-4 md:grid-cols-3">
                        <MetaItem label="Provider" value={lastPayload.provider} />
                        <MetaItem label="Model" value={lastPayload.model} />
                        <MetaItem
                          label="HTTP"
                          value={`${lastResponse.status} ${lastResponse.statusText}`.trim()}
                        />
                      </div>
                    ) : null}

                    {responseError ? (
                      <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                        {responseError}
                      </div>
                    ) : null}

                    {lastParsedResponse ? (
                      <>
                        <section className="rounded-2xl border bg-background/80 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <h2 className="text-sm font-semibold">Assistant Output</h2>
                            <span className="text-xs text-muted-foreground">
                              {lastParsedResponse.provider} · {lastParsedResponse.model}
                            </span>
                          </div>
                          <pre className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-muted/30 p-4 text-xs leading-6">
                            {lastParsedResponse.message.content || "模型未返回文本内容。"}
                          </pre>
                        </section>

                        <section className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                          <div className="rounded-2xl border bg-background/80 p-4">
                            <h2 className="text-sm font-semibold">Tool Calls</h2>
                            {lastParsedResponse.message.toolCalls.length === 0 ? (
                              <p className="mt-3 text-sm text-muted-foreground">
                                本次调用没有 tool calls。
                              </p>
                            ) : (
                              <div className="mt-3 space-y-3">
                                {lastParsedResponse.message.toolCalls.map(toolCall => (
                                  <ToolCallCard key={toolCall.id} toolCall={toolCall} />
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="rounded-2xl border bg-background/80 p-4">
                            <h2 className="text-sm font-semibold">Usage</h2>
                            {lastParsedResponse.usage ? (
                              <div className="mt-3 space-y-2 text-sm">
                                <MetaItem
                                  label="promptTokens"
                                  value={String(lastParsedResponse.usage.promptTokens ?? "—")}
                                />
                                <MetaItem
                                  label="completionTokens"
                                  value={String(lastParsedResponse.usage.completionTokens ?? "—")}
                                />
                                <MetaItem
                                  label="totalTokens"
                                  value={String(lastParsedResponse.usage.totalTokens ?? "—")}
                                />
                                <MetaItem
                                  label="cacheHitTokens"
                                  value={String(lastParsedResponse.usage.cacheHitTokens ?? "—")}
                                />
                                <MetaItem
                                  label="cacheMissTokens"
                                  value={String(lastParsedResponse.usage.cacheMissTokens ?? "—")}
                                />
                              </div>
                            ) : (
                              <p className="mt-3 text-sm text-muted-foreground">
                                本次响应没有 usage 信息。
                              </p>
                            )}
                          </div>
                        </section>

                        {lastParsedResponse.nativeRequestPayload ? (
                          <JsonPanelSection
                            title="Native Request Payload"
                            items={nativePayloadItems}
                            activePanelKey={activeNativePayloadPanelKey}
                            activeCopyStatus={nativePayloadCopyStatus}
                            onCopy={(panelKey, text) => {
                              void handleCopyNativePayload(panelKey, text);
                            }}
                          />
                        ) : (
                          <section className="space-y-3">
                            <h2 className="text-sm font-semibold">Native Request Payload</h2>
                            <p className="text-sm text-muted-foreground">
                              当前 provider 未返回 native request payload。
                            </p>
                          </section>
                        )}
                      </>
                    ) : null}
                  </div>
                )}
              </Panel>
            </div>
          </section>

          <div className="xl:min-h-0 xl:overflow-hidden">
            <Panel
              title="Run Settings"
              description="选择 provider、model、toolChoice，并从这里发送请求。"
              className="flex h-full min-h-0 flex-col xl:sticky xl:top-0"
              bodyClassName="flex min-h-0 flex-1 flex-col"
            >
              <div className="space-y-5">
                <Field label="Provider">
                  {providersQuery.isLoading ? (
                    <StateHint text="正在读取 provider 列表..." />
                  ) : providersQuery.isError ? (
                    <StateHint text={providersQuery.error.message} tone="error" />
                  ) : providers.length === 0 ? (
                    <StateHint
                      text="没有可用 provider，请先在服务端配置 LLM 凭证。"
                      tone="warning"
                    />
                  ) : (
                    <Select
                      value={selectedProvider?.id ?? undefined}
                      onValueChange={handleProviderChange}
                    >
                      <SelectTrigger aria-label="Provider">
                        <SelectValue placeholder="请选择 provider" />
                      </SelectTrigger>
                      <SelectContent>
                        {providers.map(provider => (
                          <SelectItem key={provider.id} value={provider.id}>
                            {provider.id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </Field>

                <Field label="Model">
                  <Select
                    value={selectedModel || undefined}
                    onValueChange={setModel}
                    disabled={!selectedProvider || selectedProvider.models.length === 0}
                  >
                    <SelectTrigger aria-label="Model">
                      <SelectValue
                        placeholder={selectedProvider ? "请选择模型" : "请先选择 provider"}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {selectedProvider?.models.map(providerModel => (
                        <SelectItem key={providerModel} value={providerModel}>
                          {providerModel}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field label="Tool Choice">
                  <Select
                    value={toolChoiceMode}
                    onValueChange={value => setToolChoiceMode(value as ToolChoiceMode)}
                  >
                    <SelectTrigger aria-label="Tool Choice">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">none</SelectItem>
                      <SelectItem value="auto">auto</SelectItem>
                      <SelectItem value="required">required</SelectItem>
                      <SelectItem value="tool">指定工具</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>

                {toolChoiceMode === "tool" ? (
                  <Field label="指定工具">
                    <Select
                      value={effectiveSelectedToolNameForChoice || undefined}
                      onValueChange={setSelectedToolNameForChoice}
                      disabled={currentToolNames.length === 0}
                    >
                      <SelectTrigger aria-label="指定工具">
                        <SelectValue placeholder="请先添加工具定义" />
                      </SelectTrigger>
                      <SelectContent>
                        {currentToolNames.map(toolName => (
                          <SelectItem key={toolName} value={toolName}>
                            {toolName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                ) : null}

                <div className="rounded-2xl border border-dashed bg-muted/20 p-4 text-xs text-muted-foreground">
                  <p>当前 provider：{selectedProvider?.id ?? "未选择"}</p>
                  <p className="mt-1">
                    当前 model：{selectedModel.trim().length > 0 ? selectedModel : "未选择"}
                  </p>
                  <p className="mt-1">工具数量：{tools.length}</p>
                  <p className="mt-1">消息数量：{messages.length}</p>
                </div>
              </div>

              <div className="mt-8 space-y-4 border-t border-slate-200/80 pt-5">
                <Button
                  type="button"
                  className="h-12 w-full justify-center rounded-2xl"
                  onClick={handleSubmit}
                  disabled={requestMutation.isPending}
                >
                  <SendHorizontal className="mr-2 h-4 w-4" />
                  {requestMutation.isPending ? "发送中..." : "发送请求"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 w-full justify-center rounded-2xl"
                  onClick={handleReset}
                >
                  <RefreshCcw className="mr-2 h-4 w-4" />
                  重置示例
                </Button>
                {editorError ? (
                  <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    {editorError}
                  </div>
                ) : null}
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageEditorCard({
  index,
  message,
  total,
  onDelete,
  onMoveUp,
  onMoveDown,
  onRoleChange,
  onTextChange,
  onToolCallIdChange,
  onAddTextPart,
  onAddImagePart,
  onPartChange,
  onPartMove,
  onPartDelete,
  onAddAssistantToolCall,
  onAssistantToolCallChange,
  onAssistantToolCallDelete,
}: {
  index: number;
  message: EditorMessage;
  total: number;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRoleChange: (role: EditorRole) => void;
  onTextChange: (value: string) => void;
  onToolCallIdChange: (value: string) => void;
  onAddTextPart: () => void;
  onAddImagePart: (file: File | null) => void;
  onPartChange: (partId: string, updater: (part: EditorContentPart) => EditorContentPart) => void;
  onPartMove: (partId: string, direction: "up" | "down") => void;
  onPartDelete: (partId: string) => void;
  onAddAssistantToolCall: () => void;
  onAssistantToolCallChange: (
    toolCallId: string,
    updater: (toolCall: EditorToolCall) => EditorToolCall,
  ) => void;
  onAssistantToolCallDelete: (toolCallId: string) => void;
}) {
  return (
    <section className="rounded-2xl border bg-background/80 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Message {index + 1}
          </p>
          <div className="w-[180px]">
            <Select value={message.role} onValueChange={value => onRoleChange(value as EditorRole)}>
              <SelectTrigger aria-label={`Message ${index + 1} role`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">user</SelectItem>
                <SelectItem value="assistant">assistant</SelectItem>
                <SelectItem value="tool">tool</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            type="button"
            size="icon"
            variant="outline"
            onClick={onMoveUp}
            disabled={index === 0}
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="outline"
            onClick={onMoveDown}
            disabled={index === total - 1}
          >
            <ArrowDown className="h-4 w-4" />
          </Button>
          <Button type="button" size="icon" variant="outline" onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {message.role === "user" ? (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={onAddTextPart}>
              <Plus className="mr-2 h-4 w-4" />
              文本片段
            </Button>
            <label className="inline-flex cursor-pointer items-center justify-center whitespace-nowrap rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground">
              <ImagePlus className="mr-2 h-4 w-4" />
              上传图片
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={event => {
                  const file = event.target.files?.[0] ?? null;
                  void onAddImagePart(file);
                  event.target.value = "";
                }}
              />
            </label>
          </div>

          {message.parts.length === 0 ? (
            <StateHint text="这条 user 消息还没有内容。" />
          ) : (
            <div className="space-y-3">
              {message.parts.map((part, partIndex) => (
                <section key={part.id} className="rounded-xl border bg-muted/20 p-3">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">
                        {part.type === "text" ? "文本片段" : "图片片段"}
                      </p>
                      <p className="text-xs text-muted-foreground">片段 {partIndex + 1}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        onClick={() => onPartMove(part.id, "up")}
                        disabled={partIndex === 0}
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        onClick={() => onPartMove(part.id, "down")}
                        disabled={partIndex === message.parts.length - 1}
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        onClick={() => onPartDelete(part.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {part.type === "text" ? (
                    <textarea
                      value={part.text}
                      onChange={event =>
                        onPartChange(part.id, currentPart =>
                          currentPart.type === "text"
                            ? {
                                ...currentPart,
                                text: event.target.value,
                              }
                            : currentPart,
                        )
                      }
                      placeholder="输入文本内容"
                      className="min-h-[110px] w-full resize-y rounded-xl border bg-background p-3 text-sm outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    />
                  ) : (
                    <div className="grid gap-3 md:grid-cols-[180px_minmax(0,1fr)]">
                      <img
                        src={part.dataUrl}
                        alt={part.fileName || "uploaded"}
                        className="h-36 w-full rounded-xl border object-cover"
                      />
                      <div className="space-y-3">
                        <Field label="文件名">
                          <input
                            value={part.fileName}
                            onChange={event =>
                              onPartChange(part.id, currentPart =>
                                currentPart.type === "image"
                                  ? {
                                      ...currentPart,
                                      fileName: event.target.value,
                                    }
                                  : currentPart,
                              )
                            }
                            className="h-10 w-full rounded-xl border bg-background px-3 text-sm outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          />
                        </Field>
                        <Field label="MIME Type">
                          <input
                            value={part.mimeType}
                            onChange={event =>
                              onPartChange(part.id, currentPart =>
                                currentPart.type === "image"
                                  ? {
                                      ...currentPart,
                                      mimeType: event.target.value,
                                    }
                                  : currentPart,
                              )
                            }
                            className="h-10 w-full rounded-xl border bg-background px-3 text-sm outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          />
                        </Field>
                      </div>
                    </div>
                  )}
                </section>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {message.role === "assistant" ? (
        <div className="mt-4 space-y-4">
          <textarea
            value={message.content}
            onChange={event => onTextChange(event.target.value)}
            placeholder="assistant 文本内容"
            className="min-h-[120px] w-full resize-y rounded-xl border bg-background p-3 text-sm outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />

          <div className="rounded-xl border border-dashed bg-muted/20 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">Tool Calls</h3>
                <p className="text-xs text-muted-foreground">可选，用于构造 assistant 历史响应。</p>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={onAddAssistantToolCall}>
                <Plus className="mr-2 h-4 w-4" />
                新增 Tool Call
              </Button>
            </div>

            {message.toolCalls.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">当前没有 tool calls。</p>
            ) : (
              <div className="mt-3 space-y-3">
                {message.toolCalls.map(toolCall => (
                  <section key={toolCall.id} className="rounded-xl border bg-background p-3">
                    <div className="mb-3 flex justify-end">
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        onClick={() => onAssistantToolCallDelete(toolCall.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <Field label="Tool Call ID">
                        <input
                          value={toolCall.toolCallId}
                          onChange={event =>
                            onAssistantToolCallChange(toolCall.id, currentToolCall => ({
                              ...currentToolCall,
                              toolCallId: event.target.value,
                            }))
                          }
                          className="h-10 w-full rounded-xl border bg-background px-3 text-sm outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        />
                      </Field>
                      <Field label="Tool Name">
                        <input
                          value={toolCall.name}
                          onChange={event =>
                            onAssistantToolCallChange(toolCall.id, currentToolCall => ({
                              ...currentToolCall,
                              name: event.target.value,
                            }))
                          }
                          className="h-10 w-full rounded-xl border bg-background px-3 text-sm outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        />
                      </Field>
                    </div>

                    <Field label="Arguments JSON" className="mt-3">
                      <textarea
                        value={toolCall.argumentsText}
                        onChange={event =>
                          onAssistantToolCallChange(toolCall.id, currentToolCall => ({
                            ...currentToolCall,
                            argumentsText: event.target.value,
                          }))
                        }
                        className="min-h-[110px] w-full resize-y rounded-xl border bg-background p-3 font-mono text-xs outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      />
                    </Field>
                  </section>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {message.role === "tool" ? (
        <div className="mt-4 space-y-3">
          <Field label="Tool Call ID">
            <input
              value={message.toolCallId}
              onChange={event => onToolCallIdChange(event.target.value)}
              placeholder="例如 call_123"
              className="h-10 w-full rounded-xl border bg-background px-3 text-sm outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </Field>
          <Field label="Tool Output">
            <textarea
              value={message.content}
              onChange={event => onTextChange(event.target.value)}
              placeholder="工具返回内容"
              className="min-h-[120px] w-full resize-y rounded-xl border bg-background p-3 text-sm outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </Field>
        </div>
      ) : null}
    </section>
  );
}

function ToolEditorCard({
  tool,
  index,
  total,
  onMoveUp,
  onMoveDown,
  onDelete,
  onChange,
  onAddProperty,
  onPropertyChange,
  onPropertyMove,
  onPropertyDelete,
}: {
  tool: EditorTool;
  index: number;
  total: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  onChange: (updater: (tool: EditorTool) => EditorTool) => void;
  onAddProperty: () => void;
  onPropertyChange: (
    propertyId: string,
    updater: (property: EditorToolProperty) => EditorToolProperty,
  ) => void;
  onPropertyMove: (propertyId: string, direction: "up" | "down") => void;
  onPropertyDelete: (propertyId: string) => void;
}) {
  return (
    <section className="rounded-2xl border bg-background/80 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Tool {index + 1}</p>
          <p className="text-sm font-semibold">{tool.name.trim() || "未命名工具"}</p>
        </div>

        <div className="flex gap-2">
          <Button
            type="button"
            size="icon"
            variant="outline"
            onClick={onMoveUp}
            disabled={index === 0}
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="outline"
            onClick={onMoveDown}
            disabled={index === total - 1}
          >
            <ArrowDown className="h-4 w-4" />
          </Button>
          <Button type="button" size="icon" variant="outline" onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Field label="Name">
          <input
            value={tool.name}
            onChange={event =>
              onChange(currentTool => ({
                ...currentTool,
                name: event.target.value,
              }))
            }
            className="h-10 w-full rounded-xl border bg-background px-3 text-sm outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </Field>
        <Field label="Description">
          <input
            value={tool.description}
            onChange={event =>
              onChange(currentTool => ({
                ...currentTool,
                description: event.target.value,
              }))
            }
            className="h-10 w-full rounded-xl border bg-background px-3 text-sm outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </Field>
      </div>

      <div className="mt-4 rounded-xl border border-dashed bg-muted/20 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Properties</h3>
            <p className="text-xs text-muted-foreground">`parameters.type` 固定为 object。</p>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={onAddProperty}>
            <Plus className="mr-2 h-4 w-4" />
            新增属性
          </Button>
        </div>

        {tool.properties.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">当前没有参数属性。</p>
        ) : (
          <div className="mt-3 space-y-3">
            {tool.properties.map((property, propertyIndex) => (
              <section key={property.id} className="rounded-xl border bg-background p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{property.name.trim() || "未命名属性"}</p>
                    <p className="text-xs text-muted-foreground">属性 {propertyIndex + 1}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      onClick={() => onPropertyMove(property.id, "up")}
                      disabled={propertyIndex === 0}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      onClick={() => onPropertyMove(property.id, "down")}
                      disabled={propertyIndex === tool.properties.length - 1}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      onClick={() => onPropertyDelete(property.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px]">
                  <Field label="Property Name">
                    <input
                      value={property.name}
                      onChange={event =>
                        onPropertyChange(property.id, currentProperty => ({
                          ...currentProperty,
                          name: event.target.value,
                        }))
                      }
                      className="h-10 w-full rounded-xl border bg-background px-3 text-sm outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    />
                  </Field>

                  <Field label="Type">
                    <Select
                      value={property.type}
                      onValueChange={value =>
                        onPropertyChange(property.id, currentProperty => ({
                          ...currentProperty,
                          type: value as EditorPropertyType,
                          rawSchema: {
                            ...currentProperty.rawSchema,
                            type: value,
                          },
                        }))
                      }
                    >
                      <SelectTrigger aria-label="Property Type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="string">string</SelectItem>
                        <SelectItem value="number">number</SelectItem>
                        <SelectItem value="integer">integer</SelectItem>
                        <SelectItem value="boolean">boolean</SelectItem>
                        <SelectItem value="object">object</SelectItem>
                        <SelectItem value="array">array</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>

                <Field label="Description" className="mt-3">
                  <input
                    value={property.description}
                    onChange={event =>
                      onPropertyChange(property.id, currentProperty => ({
                        ...currentProperty,
                        description: event.target.value,
                      }))
                    }
                    className="h-10 w-full rounded-xl border bg-background px-3 text-sm outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  />
                </Field>
              </section>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function parsePlaygroundPayload({
  provider,
  model,
  availableModels,
  systemPrompt,
  messages,
  tools,
  toolChoiceMode,
  selectedToolNameForChoice,
}: {
  provider: LlmProviderOption["id"];
  model: string;
  availableModels: string[];
  systemPrompt: string;
  messages: EditorMessage[];
  tools: EditorTool[];
  toolChoiceMode: ToolChoiceMode;
  selectedToolNameForChoice: string;
}):
  | {
      success: true;
      data: LlmPlaygroundChatRequest;
    }
  | {
      success: false;
      error: string;
    } {
  if (model.trim().length === 0) {
    return {
      success: false,
      error: "请先选择 model。",
    };
  }

  if (!availableModels.includes(model)) {
    return {
      success: false,
      error: "所选 model 不在当前 provider 的配置列表中。",
    };
  }

  const parsedMessages = serializeMessages(messages);
  if (!parsedMessages.success) {
    return parsedMessages;
  }

  const parsedTools = serializeTools(tools);
  if (!parsedTools.success) {
    return parsedTools;
  }

  const toolChoice = serializeToolChoice({
    toolChoiceMode,
    selectedToolNameForChoice,
    currentToolNames: parsedTools.data.map(tool => tool.name),
  });
  if (!toolChoice.success) {
    return toolChoice;
  }

  const payloadParsed = LlmPlaygroundChatRequestSchema.safeParse({
    provider,
    model,
    ...(systemPrompt.trim().length > 0 ? { system: systemPrompt.trim() } : {}),
    messages: parsedMessages.data,
    tools: parsedTools.data,
    toolChoice: toolChoice.data,
  });

  if (!payloadParsed.success) {
    return {
      success: false,
      error: `提交参数校验失败：${formatSchemaIssues(payloadParsed.error.issues)}`,
    };
  }

  return {
    success: true,
    data: payloadParsed.data,
  };
}

function serializeMessages(messages: EditorMessage[]):
  | {
      success: true;
      data: PlaygroundMessage[];
    }
  | {
      success: false;
      error: string;
    } {
  const serializedMessages: PlaygroundMessage[] = [];

  for (const [index, message] of messages.entries()) {
    if (message.role === "user") {
      const serializedParts = message.parts
        .map(part => {
          if (part.type === "text") {
            const text = part.text.trim();
            if (text.length === 0) {
              return null;
            }

            return {
              type: "text",
              text,
            } as const;
          }

          if (part.dataUrl.trim().length === 0) {
            return null;
          }

          return {
            type: "image",
            fileName: part.fileName.trim() || undefined,
            mimeType: part.mimeType.trim(),
            dataUrl: part.dataUrl,
          } as const;
        })
        .filter((part): part is PlaygroundContentPart => part !== null);

      if (serializedParts.length === 0) {
        return {
          success: false,
          error: `第 ${index + 1} 条 user 消息没有有效内容。`,
        };
      }

      if (
        serializedParts.length === 1 &&
        serializedParts[0].type === "text" &&
        serializedParts[0].text.trim().length > 0
      ) {
        serializedMessages.push({
          role: "user",
          content: serializedParts[0].text,
        });
      } else {
        serializedMessages.push({
          role: "user",
          content: serializedParts,
        });
      }

      continue;
    }

    if (message.role === "assistant") {
      const toolCalls: LlmToolCallPayload[] = [];
      for (const toolCall of message.toolCalls) {
        const toolCallId = toolCall.toolCallId.trim();
        const toolName = toolCall.name.trim();
        if (
          toolCallId.length === 0 &&
          toolName.length === 0 &&
          toolCall.argumentsText.trim().length === 0
        ) {
          continue;
        }

        let parsedArguments: unknown;
        try {
          parsedArguments = JSON.parse(toolCall.argumentsText || "{}");
        } catch (error) {
          return {
            success: false,
            error: `第 ${index + 1} 条 assistant 消息的 tool call 参数 JSON 解析失败：${
              error instanceof Error ? error.message : "未知错误"
            }`,
          };
        }

        if (
          !parsedArguments ||
          typeof parsedArguments !== "object" ||
          Array.isArray(parsedArguments)
        ) {
          return {
            success: false,
            error: `第 ${index + 1} 条 assistant 消息的 tool call 参数必须是 JSON object。`,
          };
        }

        toolCalls.push({
          id: toolCallId,
          name: toolName,
          arguments: parsedArguments as Record<string, unknown>,
        });
      }

      serializedMessages.push({
        role: "assistant",
        content: message.content,
        toolCalls,
      });
      continue;
    }

    serializedMessages.push({
      role: "tool",
      toolCallId: message.toolCallId,
      content: message.content,
    });
  }

  if (serializedMessages.length === 0) {
    return {
      success: false,
      error: "至少需要一条消息。",
    };
  }

  return {
    success: true,
    data: serializedMessages,
  };
}

function serializeTools(tools: EditorTool[]):
  | {
      success: true;
      data: LlmToolDefinition[];
    }
  | {
      success: false;
      error: string;
    } {
  const serializedTools: LlmToolDefinition[] = [];
  const seenToolNames = new Set<string>();

  for (const [index, tool] of tools.entries()) {
    const toolName = tool.name.trim();
    if (toolName.length === 0) {
      return {
        success: false,
        error: `第 ${index + 1} 个工具缺少名称。`,
      };
    }

    if (seenToolNames.has(toolName)) {
      return {
        success: false,
        error: `工具名称重复：${toolName}`,
      };
    }
    seenToolNames.add(toolName);

    const properties: Record<string, unknown> = {};
    const seenPropertyNames = new Set<string>();
    for (const property of tool.properties) {
      const propertyName = property.name.trim();
      if (propertyName.length === 0) {
        return {
          success: false,
          error: `工具 ${toolName} 存在未命名属性。`,
        };
      }

      if (seenPropertyNames.has(propertyName)) {
        return {
          success: false,
          error: `工具 ${toolName} 的属性名重复：${propertyName}`,
        };
      }
      seenPropertyNames.add(propertyName);

      const nextSchema: Record<string, unknown> = {
        ...property.rawSchema,
        type: property.type,
      };
      if (property.description.trim().length > 0) {
        nextSchema.description = property.description.trim();
      } else {
        delete nextSchema.description;
      }

      properties[propertyName] = nextSchema;
    }

    serializedTools.push({
      name: toolName,
      ...(tool.description.trim().length > 0 ? { description: tool.description.trim() } : {}),
      parameters: {
        type: "object",
        properties,
      },
    });
  }

  return {
    success: true,
    data: serializedTools,
  };
}

function serializeToolChoice({
  toolChoiceMode,
  selectedToolNameForChoice,
  currentToolNames,
}:
  | {
      toolChoiceMode: Exclude<ToolChoiceMode, "tool">;
      selectedToolNameForChoice: string;
      currentToolNames: string[];
    }
  | {
      toolChoiceMode: "tool";
      selectedToolNameForChoice: string;
      currentToolNames: string[];
    }):
  | {
      success: true;
      data: LlmPlaygroundChatRequest["toolChoice"];
    }
  | {
      success: false;
      error: string;
    } {
  if (toolChoiceMode !== "tool") {
    return {
      success: true,
      data: toolChoiceMode,
    };
  }

  const toolName = selectedToolNameForChoice.trim();
  if (toolName.length === 0) {
    return {
      success: false,
      error: "请选择 toolChoice 对应的工具。",
    };
  }

  if (!currentToolNames.includes(toolName)) {
    return {
      success: false,
      error: "toolChoice 指定的工具必须存在于当前工具定义列表中。",
    };
  }

  return {
    success: true,
    data: {
      tool_name: toolName,
    },
  };
}

function formatSchemaIssues(
  issues: Array<{
    path: Array<string | number>;
    message: string;
  }>,
): string {
  return issues
    .map(issue => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

function formatHttpError(response: ApiRequestResult): string {
  const body =
    typeof response.body === "string"
      ? response.body
      : response.body
        ? formatJson(response.body)
        : "";
  return [`HTTP ${response.status} ${response.statusText}`.trim(), body].filter(Boolean).join("\n");
}

function formatJson(value: unknown): string {
  const formatted = JSON.stringify(value, null, 2);
  return formatted ?? "null";
}

function createDefaultMessages(): EditorMessage[] {
  return [
    {
      id: createEditorId(),
      role: "user",
      parts: [createTextPart("你好")],
    },
  ];
}

function createMessage(role: EditorRole): EditorMessage {
  if (role === "user") {
    return {
      id: createEditorId(),
      role: "user",
      parts: [createTextPart("")],
    };
  }

  if (role === "assistant") {
    return {
      id: createEditorId(),
      role: "assistant",
      content: "",
      toolCalls: [],
    };
  }

  return {
    id: createEditorId(),
    role: "tool",
    toolCallId: "",
    content: "",
  };
}

function createTextPart(text: string): EditorTextPart {
  return {
    id: createEditorId(),
    type: "text",
    text,
  };
}

function createToolCall(): EditorToolCall {
  return {
    id: createEditorId(),
    toolCallId: "",
    name: "",
    argumentsText: "{}",
  };
}

function createToolEditor(): EditorTool {
  return {
    id: createEditorId(),
    name: "",
    description: "",
    properties: [],
  };
}

function createToolProperty(): EditorToolProperty {
  return {
    id: createEditorId(),
    name: "",
    type: "string",
    description: "",
    rawSchema: {
      type: "string",
    },
  };
}

function toolDefinitionToEditor(tool: LlmToolDefinition): EditorTool {
  return {
    id: createEditorId(),
    name: tool.name,
    description: tool.description ?? "",
    properties: Object.entries(tool.parameters.properties).map(([name, rawSchema]) => {
      const objectSchema =
        rawSchema && typeof rawSchema === "object" && !Array.isArray(rawSchema)
          ? (rawSchema as Record<string, unknown>)
          : {};

      return {
        id: createEditorId(),
        name,
        type: normalizeEditorPropertyType(objectSchema.type),
        description: typeof objectSchema.description === "string" ? objectSchema.description : "",
        rawSchema: objectSchema,
      };
    }),
  };
}

function playgroundMessageToEditor(message: PlaygroundMessage): EditorMessage {
  if (message.role === "user") {
    if (typeof message.content === "string") {
      return {
        id: createEditorId(),
        role: "user",
        parts: [createTextPart(message.content)],
      };
    }

    return {
      id: createEditorId(),
      role: "user",
      parts: message.content.map(playgroundContentPartToEditor),
    };
  }

  if (message.role === "assistant") {
    return {
      id: createEditorId(),
      role: "assistant",
      content: message.content,
      toolCalls: message.toolCalls.map(toolCall => ({
        id: createEditorId(),
        toolCallId: toolCall.id,
        name: toolCall.name,
        argumentsText: formatJson(toolCall.arguments),
      })),
    };
  }

  return {
    id: createEditorId(),
    role: "tool",
    toolCallId: message.toolCallId,
    content: message.content,
  };
}

function playgroundContentPartToEditor(part: PlaygroundContentPart): EditorContentPart {
  if (part.type === "text") {
    return createTextPart(part.text);
  }

  return {
    id: createEditorId(),
    type: "image",
    fileName: part.fileName ?? "",
    mimeType: part.mimeType,
    dataUrl: part.dataUrl,
  };
}

function normalizeEditorPropertyType(value: unknown): EditorPropertyType {
  if (
    value === "string" ||
    value === "number" ||
    value === "integer" ||
    value === "boolean" ||
    value === "object" ||
    value === "array"
  ) {
    return value;
  }

  return "string";
}

function convertMessageRole(message: EditorMessage, role: EditorRole): EditorMessage {
  if (message.role === role) {
    return message;
  }

  return createMessage(role);
}

function moveItem<T extends { id: string }>(
  items: T[],
  itemId: string,
  direction: "up" | "down",
): T[] {
  const index = items.findIndex(item => item.id === itemId);
  if (index < 0) {
    return items;
  }

  const nextIndex = direction === "up" ? index - 1 : index + 1;
  if (nextIndex < 0 || nextIndex >= items.length) {
    return items;
  }

  const nextItems = [...items];
  const [item] = nextItems.splice(index, 1);
  nextItems.splice(nextIndex, 0, item);
  return nextItems;
}

function createEditorId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2, 10)}`;
}

async function readFileAsDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => {
      reject(new Error("图片读取失败"));
    };
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("图片读取失败"));
    };
    reader.readAsDataURL(file);
  });
}

function Panel({
  title,
  description,
  className,
  bodyClassName,
  children,
}: {
  title: string;
  description: string;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`rounded-2xl border bg-background/88 p-5 shadow-sm backdrop-blur ${className ?? ""}`}
    >
      <div className="mb-4 space-y-1">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={`block space-y-2 ${className ?? ""}`}>
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

function StateHint({
  text,
  tone = "default",
}: {
  text: string;
  tone?: "default" | "warning" | "error";
}) {
  const toneClassName =
    tone === "error"
      ? "border-destructive/30 bg-destructive/10 text-destructive"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-dashed bg-muted/20 text-muted-foreground";

  return (
    <div
      className={`flex min-h-[100px] items-center justify-center rounded-2xl border px-4 py-6 text-center text-sm ${toneClassName}`}
    >
      {text}
    </div>
  );
}

function ToolCallCard({ toolCall }: { toolCall: LlmToolCallPayload }) {
  return (
    <details className="rounded-xl border bg-muted/20 p-3">
      <summary className="cursor-pointer text-sm font-medium">
        {toolCall.name}
        <span className="ml-2 font-mono text-xs text-muted-foreground">{toolCall.id}</span>
      </summary>
      <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded-xl bg-slate-950 p-3 font-mono text-xs leading-6 text-slate-100">
        {formatJson(toolCall.arguments)}
      </pre>
    </details>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="break-words text-sm font-medium">{value}</p>
    </div>
  );
}
