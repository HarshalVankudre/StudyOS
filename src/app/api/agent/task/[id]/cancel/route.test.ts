import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getLocale: vi.fn(),
  getDictionary: vi.fn(),
  cancelTask: vi.fn(),
  abortActiveTask: vi.fn(),
  getTask: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/i18n/server", () => ({ getLocale: mocks.getLocale }));
vi.mock("@/lib/i18n/dictionaries", () => ({
  getDictionary: mocks.getDictionary,
}));
vi.mock("@/lib/ai/tasks/store", () => ({
  cancelTask: mocks.cancelTask,
  getTask: mocks.getTask,
}));
vi.mock("@/lib/ai/tasks/cancellation", () => ({
  abortActiveTask: mocks.abortActiveTask,
}));

import { POST } from "./route";

function buildDict() {
  return {
    ai: {
      errors: {
        notAuthenticated: "Not authenticated",
      },
    },
  };
}

async function parseJson(response: Response) {
  return response.json();
}

describe("POST /api/agent/task/[id]/cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLocale.mockResolvedValue("en");
    mocks.getDictionary.mockReturnValue(buildDict());
    mocks.auth.mockResolvedValue({ userId: "user-1" });
  });

  it("returns the localized 401 response when unauthenticated", async () => {
    mocks.auth.mockResolvedValue({ userId: null });

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "task-1" }),
    });

    expect(response.status).toBe(401);
    await expect(parseJson(response)).resolves.toEqual({
      error: "Not authenticated",
    });
    expect(mocks.cancelTask).not.toHaveBeenCalled();
    expect(mocks.abortActiveTask).not.toHaveBeenCalled();
    expect(mocks.getTask).not.toHaveBeenCalled();
  });

  it("persists cancellation before aborting active work when durable cancel succeeds", async () => {
    mocks.cancelTask.mockResolvedValue(true);
    mocks.abortActiveTask.mockReturnValue(true);

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "task-1" }),
    });

    expect(response.status).toBe(200);
    await expect(parseJson(response)).resolves.toEqual({
      status: "cancelled",
      interrupted: true,
    });
    expect(mocks.cancelTask).toHaveBeenCalledWith("task-1");
    expect(mocks.abortActiveTask).toHaveBeenCalledWith("task-1");
    expect(mocks.cancelTask.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.abortActiveTask.mock.invocationCallOrder[0],
    );
    expect(mocks.getTask).not.toHaveBeenCalled();
  });

  it("reports cancellation when the durable cancel succeeds but no local task is active", async () => {
    mocks.cancelTask.mockResolvedValue(true);
    mocks.abortActiveTask.mockReturnValue(false);

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "task-1" }),
    });

    expect(response.status).toBe(200);
    await expect(parseJson(response)).resolves.toEqual({
      status: "cancelled",
      interrupted: false,
    });
    expect(mocks.abortActiveTask).toHaveBeenCalledWith("task-1");
    expect(mocks.getTask).not.toHaveBeenCalled();
  });

  it("returns 404 when the task is missing after durable cancel is already false", async () => {
    mocks.cancelTask.mockResolvedValue(false);
    mocks.getTask.mockResolvedValue(null);

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "task-1" }),
    });

    expect(response.status).toBe(404);
    await expect(parseJson(response)).resolves.toEqual({
      error: "Task not found",
    });
    expect(mocks.getTask).toHaveBeenCalledWith("task-1");
    expect(mocks.abortActiveTask).not.toHaveBeenCalled();
  });

  it("reports an already cancelled task when durable cancellation is no longer needed", async () => {
    mocks.cancelTask.mockResolvedValue(false);
    mocks.getTask.mockResolvedValue({ status: "cancelled" });

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "task-1" }),
    });

    expect(response.status).toBe(200);
    await expect(parseJson(response)).resolves.toEqual({
      status: "cancelled",
      interrupted: false,
    });
    expect(mocks.abortActiveTask).not.toHaveBeenCalled();
  });

  it("reports an already finished task when durable cancellation is no longer needed", async () => {
    mocks.cancelTask.mockResolvedValue(false);
    mocks.getTask.mockResolvedValue({ status: "done" });

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "task-1" }),
    });

    expect(response.status).toBe(200);
    await expect(parseJson(response)).resolves.toEqual({
      status: "already_finished",
      interrupted: false,
    });
    expect(mocks.abortActiveTask).not.toHaveBeenCalled();
  });
});
