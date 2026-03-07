import { zodToJsonSchema } from "zod-to-json-schema";
import { type z } from "zod";

type JsonSchemaNode = {
  type?: string | string[];
  format?: string;
  enum?: unknown[];
  default?: unknown;
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  allOf?: JsonSchemaNode[];
};

export type GeneratedFieldType = "text" | "number" | "datetime" | "select";

export type GeneratedFieldOption = {
  label: string;
  value: string;
};

export type GeneratedField = {
  name: string;
  label: string;
  type: GeneratedFieldType;
  required: boolean;
  defaultValue?: string;
  options?: GeneratedFieldOption[];
  min?: number;
  max?: number;
  numberMode?: "integer" | "number";
};

export function generateFieldsFromSchema(schema: z.ZodTypeAny): GeneratedField[] {
  const jsonSchema = zodToJsonSchema(schema, {
    target: "jsonSchema7",
    $refStrategy: "none",
  }) as JsonSchemaNode;

  const objectSchema = resolveObjectSchema(jsonSchema);
  if (!objectSchema?.properties) {
    return [];
  }

  const requiredSet = new Set(objectSchema.required ?? []);
  return Object.entries(objectSchema.properties).map(([name, propertySchema]) =>
    toGeneratedField({
      name,
      schema: propertySchema,
      required: requiredSet.has(name),
    }),
  );
}

function resolveObjectSchema(schema: JsonSchemaNode): JsonSchemaNode | null {
  if (isObjectType(schema) && schema.properties) {
    return schema;
  }

  if (!schema.allOf) {
    return null;
  }

  for (const node of schema.allOf) {
    if (isObjectType(node) && node.properties) {
      return node;
    }
  }

  return null;
}

function toGeneratedField({
  name,
  schema,
  required,
}: {
  name: string;
  schema: JsonSchemaNode;
  required: boolean;
}): GeneratedField {
  const enumValues = getEnumValues(schema);
  if (enumValues) {
    return {
      name,
      label: name,
      type: "select",
      required,
      defaultValue: toStringValue(schema.default),
      options: enumValues.map(value => ({
        label: String(value),
        value: String(value),
      })),
    };
  }

  const numberMode = getNumberMode(schema);
  if (numberMode) {
    return {
      name,
      label: name,
      type: "number",
      required,
      defaultValue: toStringValue(schema.default),
      min: toMinValue(schema, numberMode),
      max: toMaxValue(schema, numberMode),
      numberMode,
    };
  }

  if (hasType(schema, "string") && schema.format === "date-time") {
    return {
      name,
      label: name,
      type: "datetime",
      required,
      defaultValue: toStringValue(schema.default),
    };
  }

  return {
    name,
    label: name,
    type: "text",
    required,
    defaultValue: toStringValue(schema.default),
  };
}

function getEnumValues(schema: JsonSchemaNode): unknown[] | undefined {
  if (!schema.enum || schema.enum.length === 0) {
    return undefined;
  }

  return schema.enum;
}

function getNumberMode(schema: JsonSchemaNode): "integer" | "number" | null {
  if (hasType(schema, "integer")) {
    return "integer";
  }

  if (hasType(schema, "number")) {
    return "number";
  }

  return null;
}

function toMinValue(schema: JsonSchemaNode, numberMode: "integer" | "number"): number | undefined {
  if (typeof schema.minimum === "number") {
    return schema.minimum;
  }

  if (typeof schema.exclusiveMinimum !== "number") {
    return undefined;
  }

  if (numberMode === "integer") {
    return schema.exclusiveMinimum + 1;
  }

  return undefined;
}

function toMaxValue(schema: JsonSchemaNode, numberMode: "integer" | "number"): number | undefined {
  if (typeof schema.maximum === "number") {
    return schema.maximum;
  }

  if (typeof schema.exclusiveMaximum !== "number") {
    return undefined;
  }

  if (numberMode === "integer") {
    return schema.exclusiveMaximum - 1;
  }

  return undefined;
}

function hasType(schema: JsonSchemaNode, expectedType: string): boolean {
  if (typeof schema.type === "string") {
    return schema.type === expectedType;
  }

  if (Array.isArray(schema.type)) {
    return schema.type.includes(expectedType);
  }

  return false;
}

function isObjectType(schema: JsonSchemaNode): boolean {
  return hasType(schema, "object");
}

function toStringValue(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return String(value);
}
