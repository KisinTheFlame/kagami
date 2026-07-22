import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBytes, formatDateTime } from "@/lib/format";
import { getApiErrorMessage } from "@/lib/api";
import { useDeleteRom, useGbaRoms, useUploadRom } from "./useGbaLive";

/** ROM 库管理(#541 PR3):上传(裸字节 POST + encodeURIComponent 名字 header)/ 列表 / 删除。 */
export function GbaRomManager() {
  const romsQuery = useGbaRoms();
  const upload = useUploadRom();
  const remove = useDeleteRom();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);

  const roms = romsQuery.data?.roms ?? [];

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setFile(selected);
    setFeedback(null);
    if (selected) {
      // 名称预填文件基名(去 .gba/.agb 扩展),可改。
      setName(selected.name.replace(/\.(gba|agb)$/i, ""));
    }
  }

  function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || name.trim().length === 0) {
      return;
    }
    setFeedback(null);
    upload.mutate(
      { name: name.trim(), file },
      {
        onSuccess: () => {
          setFeedback("上传成功");
          setFile(null);
          setName("");
          if (fileInputRef.current) {
            fileInputRef.current.value = "";
          }
        },
        onError: error => {
          setFeedback(getApiErrorMessage(error));
        },
      },
    );
  }

  function handleDelete(romId: number, romName: string) {
    if (!window.confirm(`删除 ROM「${romName}」?电池存档会一并删除,不可恢复。`)) {
      return;
    }
    setFeedback(null);
    remove.mutate(romId, {
      onError: error => {
        setFeedback(getApiErrorMessage(error));
      },
    });
  }

  return (
    <section className="rounded-none border bg-card" aria-label="ROM 库">
      <header className="border-b px-4 py-2">
        <h2 className="font-serif text-lg">ROM 库</h2>
      </header>

      <form onSubmit={handleUpload} className="flex flex-wrap items-center gap-3 border-b p-4">
        <input
          ref={fileInputRef}
          type="file"
          accept=".gba,.agb"
          aria-label="选择 ROM 文件"
          onChange={handleFileChange}
          className="text-sm file:mr-3 file:rounded-none file:border file:bg-background file:px-3 file:py-1.5 file:text-sm"
        />
        <input
          type="text"
          aria-label="ROM 名称"
          placeholder="ROM 名称"
          value={name}
          onChange={event => setName(event.target.value)}
          className="rounded-none border bg-background px-2 py-1.5 text-sm"
        />
        <Button
          type="submit"
          size="sm"
          disabled={!file || name.trim().length === 0 || upload.isPending}
        >
          {upload.isPending ? "上传中…" : "上传"}
        </Button>
        {feedback ? <span className="text-sm text-muted-foreground">{feedback}</span> : null}
      </form>

      {romsQuery.isError ? (
        <p className="p-4 text-sm text-muted-foreground">ROM 列表加载失败</p>
      ) : roms.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">
          {romsQuery.isLoading ? "加载中…" : "库是空的——上传一个 .gba 给小镜"}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>大小</TableHead>
              <TableHead>存档</TableHead>
              <TableHead>上次游玩</TableHead>
              <TableHead>入库时间</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {roms.map(rom => (
              <TableRow key={rom.id}>
                <TableCell className="font-medium">{rom.name}</TableCell>
                <TableCell className="font-mono text-xs tabular-nums">
                  {formatBytes(rom.sizeBytes)}
                </TableCell>
                <TableCell className="text-xs">{rom.hasSave ? "有" : "—"}</TableCell>
                <TableCell className="font-mono text-xs tabular-nums">
                  {rom.lastPlayedAt ? formatDateTime(rom.lastPlayedAt) : "—"}
                </TableCell>
                <TableCell className="font-mono text-xs tabular-nums">
                  {formatDateTime(rom.createdAt)}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={remove.isPending}
                    onClick={() => handleDelete(rom.id, rom.name)}
                  >
                    删除
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
