import { v4 as uuidv4 } from "uuid";

export function correlationId(req, res, next) {
  const incoming = req.header("x-correlation-id");
  const id = (incoming && incoming.trim()) || uuidv4();
  req.correlationId = id;
  res.setHeader("x-correlation-id", id);
  next();
}

