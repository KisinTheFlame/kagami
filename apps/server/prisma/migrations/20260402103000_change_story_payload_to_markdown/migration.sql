ALTER TABLE "story"
ADD COLUMN "markdown" TEXT;

UPDATE "story"
SET "markdown" = CONCAT(
  '# ',
  COALESCE(NULLIF(BTRIM("payload" ->> 'title'), ''), '未命名记忆'),
  E'\n',
  '- 时间：',
  COALESCE(NULLIF(BTRIM("payload" ->> 'time'), ''), '待补充'),
  E'\n',
  '- 场景：',
  COALESCE(BTRIM("payload" ->> 'scene'), ''),
  E'\n',
  '- 人物：',
  COALESCE(
    (
      SELECT string_agg(BTRIM("people"."value"), '、' ORDER BY "people"."ordinality")
      FROM jsonb_array_elements_text(COALESCE("payload" -> 'people', '[]'::jsonb)) WITH ORDINALITY AS "people"("value", "ordinality")
      WHERE BTRIM("people"."value") <> ''
    ),
    ''
  ),
  E'\n',
  '- 影响：',
  COALESCE(NULLIF(BTRIM("payload" ->> 'status'), ''), '待补充'),
  E'\n\n',
  '起因：',
  COALESCE(NULLIF(BTRIM("payload" ->> 'cause'), ''), '待补充'),
  E'\n',
  '经过：',
  E'\n',
  COALESCE(
    (
      SELECT string_agg(
        "steps"."ordinality"::TEXT || '. ' || BTRIM("steps"."value"),
        E'\n'
        ORDER BY "steps"."ordinality"
      )
      FROM jsonb_array_elements_text(COALESCE("payload" -> 'process', '[]'::jsonb)) WITH ORDINALITY AS "steps"("value", "ordinality")
      WHERE BTRIM("steps"."value") <> ''
    ),
    '1. 待补充'
  ),
  E'\n',
  '结果：',
  COALESCE(NULLIF(BTRIM("payload" ->> 'result'), ''), '待补充')
);

ALTER TABLE "story"
ALTER COLUMN "markdown" SET NOT NULL;

ALTER TABLE "story"
DROP COLUMN "payload";
