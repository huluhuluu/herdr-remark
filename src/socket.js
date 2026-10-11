"use strict";

const net = require("node:net");

// Herdr's API socket answers exactly one request per connection and then closes
// it, so every call dials a fresh connection. That is still roughly twelve times
// cheaper than spawning the `herdr` CLI per call, which is what makes an
// animated lamp affordable at all.

function pipePath(socketPath) {
  if (!socketPath) return null;
  // Windows exposes the socket as a named pipe under \\.\pipe\.
  if (process.platform === "win32" && !socketPath.startsWith("\\\\"))
    return "\\\\.\\pipe\\" + socketPath;
  return socketPath;
}

function request(method, params, { socketPath = process.env.HERDR_SOCKET_PATH, timeout = 5000 } = {}) {
  const target = pipePath(socketPath);
  if (!target) return Promise.reject(new Error("HERDR_SOCKET_PATH 未设置。"));
  return new Promise((resolve, reject) => {
    const socket = net.connect(target);
    let buffer = "";
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error); else resolve(value);
    };
    socket.setEncoding("utf8");
    socket.setTimeout(timeout, () => finish(new Error(`herdr socket 超时：${method}`)));
    socket.on("error", error => finish(new Error(`herdr socket 失败：${error.message}`)));
    socket.on("end", () => finish(new Error(`herdr socket 响应不完整：${method}`)));
    socket.on("close", () => finish(new Error(`herdr socket 已关闭：${method}`)));
    socket.on("connect", () => socket.write(JSON.stringify({ id: "remark", method, params }) + "\n"));
    socket.on("data", chunk => {
      buffer += chunk;
      const end = buffer.indexOf("\n");
      if (end < 0) return;
      let message;
      try { message = JSON.parse(buffer.slice(0, end)); }
      catch { return finish(new Error(`herdr socket 返回了无法解析的数据：${method}`)); }
      if (message.error) return finish(new Error(message.error.message || JSON.stringify(message.error)));
      finish(null, message.result || {});
    });
  });
}

// Subscriptions keep their connection open. Herdr fixes the subscription set
// per connection, so callers reconnect when the set of watched panes changes.
function subscribe(subscriptions, onEvent, { socketPath = process.env.HERDR_SOCKET_PATH, timeout = 5000 } = {}) {
  const target = pipePath(socketPath);
  if (!target) throw new Error("HERDR_SOCKET_PATH 未设置。");
  const socket = net.connect(target);
  let buffer = "";
  let started = false;
  const ready = new Promise((resolve, reject) => {
    const fail = error => { reject(error); socket.destroy(); };
    socket.setEncoding("utf8");
    socket.setTimeout(timeout, () => fail(new Error("herdr 订阅超时。")));
    socket.on("error", fail);
    socket.on("end", () => socket.destroy());
    socket.on("close", () => { if (!started) reject(new Error("herdr 订阅已关闭。")); });
    socket.on("connect", () => socket.write(JSON.stringify({ id: "remark", method: "events.subscribe",
      params: { subscriptions } }) + "\n"));
    socket.on("data", chunk => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        let message;
        try { message = JSON.parse(line); }
        catch { fail(new Error("herdr 订阅返回了无法解析的数据。")); return; }
        if (message.error) { fail(new Error(message.error.message)); return; }
        if (message.result?.type === "subscription_started") {
          started = true;
          socket.setTimeout(0);
          resolve();
        } else if (message.event) onEvent(message);
      }
    });
  });
  return { ready, close: () => socket.destroy(), get closed() { return socket.destroyed; } };
}

module.exports = { pipePath, request, subscribe };
