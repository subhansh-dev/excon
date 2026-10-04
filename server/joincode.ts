// Signed seat join codes. Token = base64url("<roomId>\n<seat>") + "." + HMAC(secret).
// Server-assigned seats: whoever presents a valid token joins as the seat embedded in it —
// the client's ?view= choice stops being authoritative.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const SECRET = process.env.ROOM_PASSWORD || randomBytes(32).toString("hex");

export function issueJoinToken(roomId: string, seat: string): string {
  const payload = Buffer.from(`${roomId}\n${seat}`, "utf8").toString("base64url");
  const sig = createHmac("sha256", SECRET).update(payload).digest("hex").slice(0, 32);
  return `${payload}.${sig}`;
}

export function verifyJoinToken(token: string): { roomId: string; seat: string } | null {
  const i = token.lastIndexOf(".");
  if (i <= 0) return null;
  const payload = token.slice(0, i);
  const sig = Buffer.from(token.slice(i + 1), "utf8");
  const expect = Buffer.from(createHmac("sha256", SECRET).update(payload).digest("hex").slice(0, 32), "utf8");
  if (sig.length !== expect.length || !timingSafeEqual(sig, expect)) return null;
  try {
    const [roomId, seat] = Buffer.from(payload, "base64url").toString("utf8").split("\n");
    if (!roomId || !seat) return null;
    return { roomId, seat };
  } catch {
    return null;
  }
}
