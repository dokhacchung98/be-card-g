import { createAppServer } from "../src/server.js";

const appServer = createAppServer();

export default async function handler(req, res) {
  return appServer.requestHandler(req, res);
}
