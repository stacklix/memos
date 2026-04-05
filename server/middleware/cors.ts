import { cors } from "hono/cors";

export const apiCors = cors({
  origin: (origin) => origin || "*",
  allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Authorization", "Content-Type", "Cookie"],
  exposeHeaders: ["Set-Cookie"],
  credentials: true,
});
