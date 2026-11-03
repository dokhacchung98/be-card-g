import { createAppServer } from "../src/server.js";

const appServer = createAppServer();

export default function handler(req, res) {
  return appServer.emit("request", req, res);
}
