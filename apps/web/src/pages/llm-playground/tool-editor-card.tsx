/** 工具编辑卡：单个工具定义（含参数 schema 属性表）的编辑 UI。从 LlmPlaygroundPage.tsx 拆出（纯移动）。 */
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { EditorPropertyType, EditorTool, EditorToolProperty } from "./playground-editor";
import { Field } from "./playground-ui";
export function ToolEditorCard({
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
    <section className="rounded-none border bg-background/80 p-4">
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
            className="h-10 w-full rounded-none border bg-background px-3 text-sm outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
            className="h-10 w-full rounded-none border bg-background px-3 text-sm outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </Field>
      </div>

      <div className="mt-4 rounded-none border border-dashed bg-muted/20 p-4">
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
              <section key={property.id} className="rounded-none border bg-background p-3">
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
                      className="h-10 w-full rounded-none border bg-background px-3 text-sm outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
                    className="h-10 w-full rounded-none border bg-background px-3 text-sm outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
