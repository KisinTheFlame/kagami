import { afterEach, describe, expect, it, vi } from "vitest";
import { NapcatEventPersistenceWriter } from "../../src/napcat/application/napcat-gateway/event-persistence-writer.js";
import { DefaultNapcatGatewayService } from "../../src/napcat/application/napcat-gateway.impl.service.js";
import type { NapcatGatewayService } from "../../src/napcat/application/napcat-gateway.service.js";
import {
  FakeWebSocket,
  createAgentEventQueue,
  createConfigManager,
  createNapcatGroupMessageDao,
  initTestLogger,
} from "./napcat-gateway.test-helper.js";

const imageMessageAnalyzer = {
  analyzeImageSegment: vi.fn().mockResolvedValue({ description: "", resid: null }),
};

async function startGateway(): Promise<{ gateway: NapcatGatewayService; socket: FakeWebSocket }> {
  const sockets: FakeWebSocket[] = [];
  const gateway = await DefaultNapcatGatewayService.create({
    configManager: createConfigManager(),
    enqueueGroupMessageEvent: createAgentEventQueue().enqueue,
    persistenceWriter: new NapcatEventPersistenceWriter({}),
    imageMessageAnalyzer,
    qqMessageDao: createNapcatGroupMessageDao(),
    createWebSocket: () => {
      const socket = new FakeWebSocket();
      sockets.push(socket);
      return socket;
    },
  });
  const startPromise = gateway.start();
  sockets[0].emitOpen();
  await startPromise;
  return { gateway, socket: sockets[0] };
}

function sentPayloadAt(socket: FakeWebSocket, index: number) {
  return JSON.parse(socket.sentPayloads[index]) as {
    action: string;
    params: Record<string, unknown>;
    echo: string;
  };
}

function respond(socket: FakeWebSocket, index: number, data: unknown): void {
  const payload = sentPayloadAt(socket, index);
  socket.emitMessage(
    JSON.stringify({ status: "ok", retcode: 0, data, message: "", echo: payload.echo }),
  );
}

describe("DefaultNapcatGatewayService group files", () => {
  initTestLogger();
  afterEach(() => vi.useRealTimers());

  it("listGroupFiles (root) → get_group_root_files，snake→camel 映射 + size 兜底", async () => {
    const { gateway, socket } = await startGateway();
    const promise = gateway.listGroupFiles({ groupId: "123", fileCount: 100 });

    const payload = sentPayloadAt(socket, 0);
    expect(payload.action).toBe("get_group_root_files");
    expect(payload.params).toEqual({ group_id: "123", file_count: 100 });

    respond(socket, 0, {
      files: [
        {
          file_id: "f1",
          file_name: "a.pdf",
          file_size: 2048,
          upload_time: 111,
          uploader_name: "阿三",
        },
        { file_id: "f2", file_name: "b.zip", size: 4096 }, // 只有 size，无 file_size
      ],
      folders: [{ folder_id: "d1", folder_name: "资料", total_file_count: 3 }],
    });

    await expect(promise).resolves.toEqual({
      files: [
        { fileId: "f1", fileName: "a.pdf", size: 2048, uploadTime: 111, uploaderName: "阿三" },
        { fileId: "f2", fileName: "b.zip", size: 4096, uploadTime: null, uploaderName: "" },
      ],
      folders: [{ folderId: "d1", folderName: "资料", fileCount: 3 }],
    });
    await gateway.stop();
  });

  it("listGroupFiles (folderId) → get_group_files_by_folder + folder_id 参数", async () => {
    const { gateway, socket } = await startGateway();
    const promise = gateway.listGroupFiles({ groupId: "123", folderId: "d1", fileCount: 100 });

    const payload = sentPayloadAt(socket, 0);
    expect(payload.action).toBe("get_group_files_by_folder");
    expect(payload.params).toEqual({ group_id: "123", file_count: 100, folder_id: "d1" });

    respond(socket, 0, { files: [], folders: [] });
    await expect(promise).resolves.toEqual({ files: [], folders: [] });
    await gateway.stop();
  });

  it("getGroupFileUrl → get_group_file_url → { url }", async () => {
    const { gateway, socket } = await startGateway();
    const promise = gateway.getGroupFileUrl({ groupId: "123", fileId: "f1" });

    const payload = sentPayloadAt(socket, 0);
    expect(payload.action).toBe("get_group_file_url");
    expect(payload.params).toEqual({ group_id: "123", file_id: "f1" });

    respond(socket, 0, { url: "https://cdn.qq.com/f1" });
    await expect(promise).resolves.toEqual({ url: "https://cdn.qq.com/f1" });
    await gateway.stop();
  });

  it("uploadGroupFile → upload_group_file，file 走 base64:// 自包含", async () => {
    const { gateway, socket } = await startGateway();
    const promise = gateway.uploadGroupFile({
      groupId: "123",
      fileRef: "base64://QUJD",
      name: "x.pdf",
      folderId: "d1",
    });

    const payload = sentPayloadAt(socket, 0);
    expect(payload.action).toBe("upload_group_file");
    expect(payload.params).toEqual({
      group_id: "123",
      file: "base64://QUJD",
      name: "x.pdf",
      folder_id: "d1",
    });

    respond(socket, 0, null);
    await expect(promise).resolves.toBeUndefined();
    await gateway.stop();
  });

  it("NapCat 失败（retcode!=0）→ 抛错冒泡", async () => {
    const { gateway, socket } = await startGateway();
    const promise = gateway.getGroupFileUrl({ groupId: "123", fileId: "bad" });
    const payload = sentPayloadAt(socket, 0);
    socket.emitMessage(
      JSON.stringify({
        status: "failed",
        retcode: 1200,
        data: null,
        message: "no such file",
        echo: payload.echo,
      }),
    );
    await expect(promise).rejects.toBeInstanceOf(Error);
    await gateway.stop();
  });
});
