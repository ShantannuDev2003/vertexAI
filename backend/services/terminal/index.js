
import dns from "dns";
dns.setServers(["8.8.8.8", "1.1.1.1"]);
import cookieParser from "cookie-parser";
import redis from "../../shared/redis/redis.js";
import httpProxy from "http-proxy";
import express from "express";
import dotenv from "dotenv";
import { connectDb } from "./config/db.js";
import http from "http";
import { Server } from "socket.io";
import os from "os";
import path from "path";
import fs from "fs/promises";
import fsWatch from "fs";
import pty from "node-pty";

dotenv.config();

const port = process.env.PORT || 8005;
const app = express();
app.use(express.json());
const previewProxy = httpProxy.createProxyServer({
  changeOrigin: true,
  ws: true,
});
const fileServiceUrl =
  process.env.FILE_SERVICE_URL || "http://localhost:8003";

const WORKSPACE_ROOT = path.join(os.tmpdir(), "vertex-ai");
const SHELL = process.platform === "win32" ? "powershell.exe" : "bash";

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: true,
    credentials: true,
  },
});

const sessions = new Map();
const ignoredDirectories = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
]);

const send = (socket, data) => {
  if (socket.connected) {
    socket.emit("terminal:data", String(data || ""));
  }
};

const safeName = (name) => {
  if (
    !name ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\")
  ) {
    throw new Error(`Invalid file/folder name: ${name}`);
  }
  return name;
};

const workspace = (projectId) =>
  path.join(WORKSPACE_ROOT, String(projectId));

const normaliseCols = (cols) => {
  const value = Number(cols);
  if (!Number.isFinite(value)) return 80;
  return Math.max(20, Math.min(Math.floor(value), 500));
};

const normaliseRows = (rows) => {
  const value = Number(rows);
  if (!Number.isFinite(value)) return 30;
  return Math.max(5, Math.min(Math.floor(value), 200));
};

const requestFileService = async (route, userId, options = {}) => {
  const response = await fetch(`${fileServiceUrl}${route}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-user-id": String(userId),
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }

  if (!response.ok) {
    throw new Error(
      data?.message || `File service returned ${response.status}`
    );
  }

  return data;
};

const getTree = async (projectId, userId) =>
  requestFileService(`/tree/${projectId}`, userId);

const isIgnoredPath = (relativePath) => {
  const parts = relativePath.split(/[\\/]+/);
  return parts.some((part) => ignoredDirectories.has(part));
};

const workspaceNodes = (tree) =>
  tree.length === 1 && tree[0]?.type === "folder"
    ? { rootNode: tree[0], nodes: tree[0].children || [] }
    : { rootNode: null, nodes: tree };

const resolveParentPath = (relativePath) => {
  if (!relativePath || relativePath === ".") return "";

  const parent = path.dirname(relativePath);
  return parent === "." ? "" : parent;
};

const flattenTree = (nodes, parentPath = "", result = []) => {
  for (const node of nodes || []) {
    const relativePath = parentPath
      ? path.join(parentPath, node.name)
      : node.name;

    if (isIgnoredPath(relativePath)) continue;

    result.push({
      ...node,
      relativePath,
    });

    if (node.type === "folder") {
      flattenTree(node.children || [], relativePath, result);
    }
  }

  return result;
};

const removeStaleEntries = async (
  directory,
  expectedPaths,
  relativeDirectory = ""
) => {
  const entries = await fs.readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (ignoredDirectories.has(entry.name)) continue;

    const relativePath = relativeDirectory
      ? path.join(relativeDirectory, entry.name)
      : entry.name;
    const fullPath = path.join(directory, entry.name);
    const expected = expectedPaths.get(relativePath);

    if (!expected) {
      await fs.rm(fullPath, { recursive: true, force: true });
      continue;
    }

    if (
      (entry.isDirectory() && expected.type !== "folder") ||
      (entry.isFile() && expected.type !== "file")
    ) {
      await fs.rm(fullPath, { recursive: true, force: true });
      continue;
    }

    if (entry.isDirectory()) {
      await removeStaleEntries(fullPath, expectedPaths, relativePath);
    }
  }
};

const writeNodes = async (nodes, directory) => {
  for (const node of nodes || []) {
    const name = safeName(node.name);

    if (ignoredDirectories.has(name)) continue;

    const target = path.join(directory, name);

    if (node.type === "folder") {
      await fs.mkdir(target, { recursive: true });
      await writeNodes(node.children || [], target);
    } else if (node.type === "file") {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, node.content || "", "utf8");
    }
  }
};

const syncProject = async (projectId, userId) => {
  const tree = await getTree(projectId, userId);
  const root = workspace(projectId);

  await fs.mkdir(root, { recursive: true });

  const { nodes } = workspaceNodes(tree);
  const expectedPaths = new Map(
    flattenTree(nodes).map((entry) => [entry.relativePath, entry])
  );

  await removeStaleEntries(root, expectedPaths);
  await writeNodes(nodes, root);

  return { tree, root };
};

const getLanguage = (name) => {
  const extension = path.extname(name).slice(1).toLowerCase();

  const languages = {
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    ts: "typescript",
    tsx: "typescript",
    py: "python",
    html: "html",
    css: "css",
    json: "json",
    md: "markdown",
    yml: "yaml",
    yaml: "yaml",
    java: "java",
    c: "c",
    cpp: "cpp",
    cs: "csharp",
    go: "go",
    rs: "rust",
    sh: "shell",
    ps1: "powershell",
  };

  return languages[extension] || "plaintext";
};

const synchronizeWorkspace = async (session) => {
  if (session.syncing) {
    session.syncPending = true;
    return;
  }

  session.syncing = true;

  try {
    do {
      session.syncPending = false;

      const tree = await getTree(session.projectId, session.userId);
      const { rootNode, nodes } = workspaceNodes(tree);
      const databaseEntries = flattenTree(nodes);
      const databaseByPath = new Map(
        databaseEntries.map((entry) => [entry.relativePath, entry])
      );
      if (rootNode) databaseByPath.set("", rootNode);

      const diskEntries = [];

      const scanDirectory = async (directory, relativeDirectory = "") => {
        const entries = await fs.readdir(directory, {
          withFileTypes: true,
        });

        for (const entry of entries) {
          if (ignoredDirectories.has(entry.name)) continue;

          const relativePath = relativeDirectory
            ? path.join(relativeDirectory, entry.name)
            : entry.name;

          const fullPath = path.join(directory, entry.name);

          if (entry.isDirectory()) {
            diskEntries.push({
              name: entry.name,
              type: "folder",
              relativePath,
              fullPath,
            });

            await scanDirectory(fullPath, relativePath);
          } else if (entry.isFile()) {
            diskEntries.push({
              name: entry.name,
              type: "file",
              relativePath,
              fullPath,
            });
          }
        }
      };

      await scanDirectory(session.cwd);

      const diskByPath = new Map(
        diskEntries.map((entry) => [entry.relativePath, entry])
      );

      // Create missing folders, from shallowest to deepest.
      const missingFolders = diskEntries
        .filter(
          (entry) =>
            entry.type === "folder" &&
            !databaseByPath.has(entry.relativePath)
        )
        .sort(
          (a, b) =>
            a.relativePath.split(path.sep).length -
            b.relativePath.split(path.sep).length
        );

      for (const folder of missingFolders) {
        const parentPath = resolveParentPath(folder.relativePath);
        const parent = databaseByPath.get(parentPath);

        if (!parent || parent.type !== "folder") continue;

        const created = await requestFileService(
          "/create-folder",
          session.userId,
          {
            method: "POST",
            body: JSON.stringify({
              projectId: session.projectId,
              name: folder.name,
              parentId: parent._id,
            }),
          }
        );

        databaseByPath.set(folder.relativePath, {
          ...created,
          relativePath: folder.relativePath,
          children: [],
        });
      }

      // Refresh the tree so newly created folder IDs are available.
      const refreshedTree = await getTree(
        session.projectId,
        session.userId
      );
      const { rootNode: refreshedRootNode, nodes: refreshedNodes } =
        workspaceNodes(refreshedTree);
      const refreshedEntries = flattenTree(refreshedNodes);
      const refreshedByPath = new Map(
        refreshedEntries.map((entry) => [entry.relativePath, entry])
      );
      if (refreshedRootNode) refreshedByPath.set("", refreshedRootNode);

      // Create missing files and update changed contents.
      const renamedPaths = new Set();
      for (const diskFile of diskEntries.filter(
        (entry) => entry.type === "file"
      )) {
        const parentPath = resolveParentPath(diskFile.relativePath);
        const parent = refreshedByPath.get(parentPath);

        if (!parent || parent.type !== "folder") continue;

        const content = await fs.readFile(diskFile.fullPath, "utf8");
        const existing = refreshedByPath.get(diskFile.relativePath);

        if (!existing) {
          const renamed = databaseEntries.find(
            (entry) =>
              entry.type === "file" &&
              !diskByPath.has(entry.relativePath) &&
              !renamedPaths.has(entry.relativePath) &&
              resolveParentPath(entry.relativePath) === parentPath &&
              session.databaseSnapshot?.get(entry.relativePath)?.content ===
                content
          );

          if (renamed) {
            await requestFileService(`/update/${renamed._id}`, session.userId, {
              method: "POST",
              body: JSON.stringify({
                name: diskFile.name,
                content,
              }),
            });
            renamedPaths.add(renamed.relativePath);
            continue;
          }

          await requestFileService("/create-file", session.userId, {
            method: "POST",
            body: JSON.stringify({
              projectId: session.projectId,
              name: diskFile.name,
              parentId: parent._id,
              content,
              language: getLanguage(diskFile.name),
            }),
          });
        } else if (existing.type === "file" && existing.content !== content) {
          await requestFileService(`/update/${existing._id}`, session.userId, {
            method: "POST",
            body: JSON.stringify({ content }),
          });
        }
      }

      // Delete database entries that no longer exist on disk.
      // Delete children before their parent folders.
      const latestTree = await getTree(
        session.projectId,
        session.userId
      );
      const { nodes: latestNodes } = workspaceNodes(latestTree);
      const latestEntries = flattenTree(latestNodes);

      const missingEntries = latestEntries
        .filter(
          (entry) =>
            !diskByPath.has(entry.relativePath) &&
            session.databaseSnapshot?.has(entry.relativePath)
        )
        .sort(
          (a, b) =>
            b.relativePath.split(path.sep).length -
            a.relativePath.split(path.sep).length
        );

      for (const entry of missingEntries) {
        await requestFileService(`/${entry._id}`, session.userId, {
          method: "DELETE",
        });
      }

      const latestTreeAfterSync = await getTree(
        session.projectId,
        session.userId
      );
      session.databaseSnapshot = createDatabaseSnapshot(latestTreeAfterSync);
    } while (session.syncPending);

    session.socket?.emit("terminal:files-changed", {
      projectId: session.projectId,
    });
  } catch (error) {
    console.error("[terminal sync] error:", error.message);
  } finally {
    session.syncing = false;
    session.diskChanged = false;
  }
};

const createDatabaseSnapshot = (tree) => {
  const { nodes } = workspaceNodes(tree);
  return new Map(
    flattenTree(nodes).map((entry) => [
      entry.relativePath,
      { type: entry.type, content: entry.content },
    ])
  );
};

const synchronizeDatabaseToWorkspace = async (session) => {
  if (session.syncing || session.diskChanged) return;

  try {
    const tree = await getTree(session.projectId, session.userId);
    const { nodes } = workspaceNodes(tree);
    const entries = flattenTree(nodes);
    const currentByPath = new Map(
      entries.map((entry) => [entry.relativePath, entry])
    );
    const previous = session.databaseSnapshot || new Map();

    for (const entry of entries) {
      const target = path.join(session.cwd, entry.relativePath);

      if (entry.type === "folder") {
        await fs.mkdir(target, { recursive: true });
        continue;
      }

      const previousEntry = previous.get(entry.relativePath);
      if (!previousEntry || previousEntry.content !== entry.content) {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, entry.content || "", "utf8");
      }
    }

    for (const [relativePath] of previous) {
      if (currentByPath.has(relativePath) || isIgnoredPath(relativePath)) {
        continue;
      }

      const target = path.join(session.cwd, relativePath);
      await fs.rm(target, { recursive: true, force: true });
    }

    session.databaseSnapshot = createDatabaseSnapshot(tree);
  } catch (error) {
    console.error("[terminal database sync] error:", error.message);
  }
};

const startWorkspaceWatcher = (root, session) => {
  let debounceTimer;

  const watcher = fsWatch.watch(
    root,
    { recursive: true },
    (eventType, filename) => {
      if (!filename) return;

      const relativePath = filename.toString();

      if (isIgnoredPath(relativePath)) return;

      session.diskChanged = true;
      console.log(`[terminal watcher] ${eventType}: ${relativePath}`);

      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        synchronizeWorkspace(session);
      }, 750);
    }
  );

  watcher.on("error", (error) => {
    console.error("[terminal watcher] error:", error.message);
  });

  watcher.on("close", () => clearTimeout(debounceTimer));

  return watcher;
};

io.on("connection", (socket) => {
  console.log("Terminal Connected", socket.id);

  socket.on(
    "terminal:init",
    async ({ projectId, userId, cols = 80, rows = 30 }) => {
      try {
        projectId = String(projectId || "");
        userId = String(userId || "");

        if (!projectId || !userId) {
          throw new Error("Project ID and User ID are required");
        }

        const existingSession = sessions.get(socket.id);

        if (existingSession) {
          await synchronizeWorkspace(existingSession);
          existingSession.watcher?.close();
          clearInterval(existingSession.syncTimer);
          existingSession.ptyProcess.kill();
          sessions.delete(socket.id);
        }

        cols = normaliseCols(cols);
        rows = normaliseRows(rows);

        const { root, tree } = await syncProject(projectId, userId);

        const session = {
          projectId,
          userId,
          socket,
          cwd: root,
          ptyProcess: null,
          watcher: null,
          syncing: false,
          syncPending: false,
          diskChanged: false,
          databaseSnapshot: createDatabaseSnapshot(tree),
          syncTimer: null,
        };

        session.watcher = startWorkspaceWatcher(root, session);
        session.syncTimer = setInterval(() => {
          synchronizeDatabaseToWorkspace(session);
        }, 1000);

        session.ptyProcess = pty.spawn(SHELL, [], {
          name: "xterm-256color",
          cols,
          rows,
          cwd: root,
          env: {
            ...process.env,
            FORCE_COLOR: "1",
          },
        });

        session.ptyProcess.onData((data) => send(socket, data));

        session.ptyProcess.onExit(({ exitCode }) => {
          send(
            socket,
            `\r\n\x1b[90m[shell exited: ${exitCode}]\x1b[0m\r\n`
          );

          if (sessions.get(socket.id) === session) {
            session.watcher?.close();
          clearInterval(session.syncTimer);
          sessions.delete(socket.id);
          }
        });

        sessions.set(socket.id, session);

        socket.emit("terminal:ready", { cols, rows });
      } catch (error) {
        console.error("terminal:init error", error);
        send(socket, `\r\n\x1b[31m${error.message}\x1b[0m\r\n`);
      }
    }
  );

  socket.on("terminal:write", (data) => {
    const session = sessions.get(socket.id);
    if (!session) return;
    session.ptyProcess.write(String(data));
  });

  socket.on("terminal:resize", ({ cols, rows }) => {
    const session = sessions.get(socket.id);
    if (!session) return;

    cols = Number(cols);
    rows = Number(rows);

    if (!Number.isFinite(cols) || !Number.isFinite(rows)) return;

    session.ptyProcess.resize(
      normaliseCols(cols),
      normaliseRows(rows)
    );
  });

  socket.on("disconnect", () => {
    console.log("terminal disconnected");

    const session = sessions.get(socket.id);
    if (!session) return;

    session.watcher?.close();
    clearInterval(session.syncTimer);

    try {
      session.ptyProcess.kill();
    } catch { }

    sessions.delete(socket.id);
  });
});

app.get("/health", (req, res) => {
  res.json({ success: true, service: "terminal" });
});

app.use("/preview", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"];
    const projectId = req.originalUrl.split("/")[2];

    if (!userId || !projectId) {
      return res.status(400).json({
        message: "User ID and project ID are required",
      });
    }

    // Verify that this user can access this project's files.
    const tree = await getTree(projectId, userId);

    if (!tree || tree.length === 0) {
      return res.status(404).json({
        message: "Project not found or has no files",
      });
    }

    // Preserve the full Vite base path.
    req.url = req.originalUrl;

    previewProxy.web(req, res, {
      target: "http://127.0.0.1:5173",
    });

  } catch (error) {
    console.error("[preview proxy] error:", error.message);

    return res.status(500).json({
      message: "Preview proxy failed",
    });
  }
});

server.listen(port, () => {
  connectDb();
  console.log(`terminal service started at ${port}`);
});
