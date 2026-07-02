import { contractUrl } from "@kagami/http/url";
import { agentApiContract } from "@kagami/agent-api/contract";
import {
  LlmProviderListResponseSchema,
  type LlmToolDefinition,
  type LlmProviderOption,
} from "@kagami/llm-api/llm-chat";
import {
  LlmPlaygroundChatResponseSchema,
  LlmPlaygroundToolListResponseSchema,
  type LlmPlaygroundChatRequest,
  type LlmPlaygroundChatResponse,
} from "@kagami/agent-api/playground";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, RefreshCcw, SendHorizontal } from "lucide-react";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
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
import {
  convertMessageRole,
  createDefaultMessages,
  createEditorId,
  createMessage,
  createTextPart,
  createToolCall,
  createToolEditor,
  createToolProperty,
  formatHttpError,
  formatSchemaIssues,
  moveItem,
  parsePlaygroundPayload,
  playgroundMessageToEditor,
  readFileAsDataUrl,
  toolDefinitionToEditor,
  type EditorContentPart,
  type EditorMessage,
  type EditorRole,
  type EditorTool,
  type EditorToolCall,
  type EditorToolProperty,
  type PlaygroundResult,
  type ToolChoiceMode,
} from "./playground-editor";
import { MessageEditorCard } from "./message-editor-card";
import { ToolEditorCard } from "./tool-editor-card";
import { Field, MetaItem, Panel, StateHint, ToolCallCard } from "./playground-ui";

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
      path: contractUrl(agentApiContract.listProviders),
      schema: LlmProviderListResponseSchema,
    }),
  });

  const toolLibraryQuery = useQuery({
    ...createSchemaQueryOptions({
      queryKey: queryKeys.llm.playgroundTools(),
      path: contractUrl(agentApiContract.listPlaygroundTools),
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
        response = await apiPost(contractUrl(agentApiContract.playgroundChat), payload);
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
    const nextProvider = providers.find(provider => provider.id === nextProviderId);
    if (nextProvider === undefined) {
      // 未知/陈旧的 provider id 直接忽略，避免把页面切到空白选择。
      return;
    }

    setSelectedProviderId(nextProvider.id);
    setModel(nextProvider.models[0] ?? "");
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
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-auto bg-background p-3 md:p-6 xl:overflow-hidden">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 xl:h-full xl:min-h-0 xl:flex-1">
        <div className="grid grid-cols-1 gap-4 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,1fr)_320px] xl:overflow-hidden">
          <section className="flex min-h-0 flex-col overflow-hidden rounded-none border bg-card">
            <div className="border-b border-border/80 px-6 py-5">
              <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                Playground Canvas
              </p>
              <h2 className="mt-2 text-lg font-semibold text-foreground">上下文编排区</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                在一个连续工作台里组织 prompt、消息、工具定义和响应结果。
              </p>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 xl:p-5">
              <Panel title="System Prompt" description="单独控制系统提示词，不混入消息列表。">
                <textarea
                  value={systemPrompt}
                  onChange={event => setSystemPrompt(event.target.value)}
                  placeholder="可选，例如：你是一名严谨的代码评审助手。"
                  className="min-h-[120px] w-full resize-y rounded-none border bg-background p-4 text-sm outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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

                  <section className="rounded-none border border-dashed bg-muted/20 p-4">
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
                          {getApiErrorMessage(toolLibraryQuery.error)}
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
                      <div className="grid grid-cols-1 gap-3 rounded-none border bg-muted/20 p-4 md:grid-cols-3">
                        <MetaItem label="Provider" value={lastPayload.provider} />
                        <MetaItem label="Model" value={lastPayload.model} />
                        <MetaItem
                          label="HTTP"
                          value={`${lastResponse.status} ${lastResponse.statusText}`.trim()}
                        />
                      </div>
                    ) : null}

                    {responseError ? (
                      <div className="rounded-none border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                        {responseError}
                      </div>
                    ) : null}

                    {lastParsedResponse ? (
                      <>
                        <section className="rounded-none border bg-background/80 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <h2 className="text-sm font-semibold">Assistant Output</h2>
                            <span className="text-xs text-muted-foreground">
                              {lastParsedResponse.provider} · {lastParsedResponse.model}
                            </span>
                          </div>
                          <pre className="mt-3 whitespace-pre-wrap break-words rounded-none bg-muted/30 p-4 text-xs leading-6">
                            {lastParsedResponse.message.content || "模型未返回文本内容。"}
                          </pre>
                        </section>

                        <section className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                          <div className="rounded-none border bg-background/80 p-4">
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

                          <div className="rounded-none border bg-background/80 p-4">
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
                    <StateHint text={getApiErrorMessage(providersQuery.error)} tone="error" />
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

                <div className="rounded-none border border-dashed bg-muted/20 p-4 text-xs text-muted-foreground">
                  <p>当前 provider：{selectedProvider?.id ?? "未选择"}</p>
                  <p className="mt-1">
                    当前 model：{selectedModel.trim().length > 0 ? selectedModel : "未选择"}
                  </p>
                  <p className="mt-1">工具数量：{tools.length}</p>
                  <p className="mt-1">消息数量：{messages.length}</p>
                </div>
              </div>

              <div className="mt-8 space-y-4 border-t border-border/80 pt-5">
                <Button
                  type="button"
                  className="h-12 w-full justify-center rounded-none"
                  onClick={handleSubmit}
                  disabled={requestMutation.isPending}
                >
                  <SendHorizontal className="mr-2 h-4 w-4" />
                  {requestMutation.isPending ? "发送中..." : "发送请求"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 w-full justify-center rounded-none"
                  onClick={handleReset}
                >
                  <RefreshCcw className="mr-2 h-4 w-4" />
                  重置示例
                </Button>
                {editorError ? (
                  <div className="rounded-none border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
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
