/** 消息编辑卡：单条 user/assistant/tool 消息的编辑 UI。从 LlmPlaygroundPage.tsx 拆出（纯移动）。 */
import { ArrowDown, ArrowUp, ImagePlus, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  EditorContentPart,
  EditorMessage,
  EditorRole,
  EditorToolCall,
} from "./playground-editor";
import { Field, StateHint } from "./playground-ui";
export function MessageEditorCard({
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
    <section className="rounded-none border bg-background/80 p-4">
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
            <label className="inline-flex cursor-pointer items-center justify-center whitespace-nowrap rounded-none border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground">
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
                <section key={part.id} className="rounded-none border bg-muted/20 p-3">
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
                      className="min-h-[110px] w-full resize-y rounded-none border bg-background p-3 text-sm outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    />
                  ) : (
                    <div className="grid gap-3 md:grid-cols-[180px_minmax(0,1fr)]">
                      <img
                        src={part.dataUrl}
                        alt={part.fileName || "uploaded"}
                        className="h-36 w-full rounded-none border object-cover"
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
                            className="h-10 w-full rounded-none border bg-background px-3 text-sm outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
                            className="h-10 w-full rounded-none border bg-background px-3 text-sm outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
            className="min-h-[120px] w-full resize-y rounded-none border bg-background p-3 text-sm outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />

          <div className="rounded-none border border-dashed bg-muted/20 p-4">
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
                  <section key={toolCall.id} className="rounded-none border bg-background p-3">
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
                          className="h-10 w-full rounded-none border bg-background px-3 text-sm outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
                          className="h-10 w-full rounded-none border bg-background px-3 text-sm outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
                        className="min-h-[110px] w-full resize-y rounded-none border bg-background p-3 font-mono text-xs outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
              className="h-10 w-full rounded-none border bg-background px-3 text-sm outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </Field>
          <Field label="Tool Output">
            <textarea
              value={message.content}
              onChange={event => onTextChange(event.target.value)}
              placeholder="工具返回内容"
              className="min-h-[120px] w-full resize-y rounded-none border bg-background p-3 text-sm outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </Field>
        </div>
      ) : null}
    </section>
  );
}
