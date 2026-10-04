// Colyseus connection + typed send helpers. Views attach their own onMessage handlers.
import { Client, Room } from "@colyseus/sdk";

export function serverWsUrl(): string {
  const { protocol, hostname, port } = window.location;
  const wsProto = protocol === "https:" ? "wss" : "ws";
  if (port === "5173") return `${wsProto}://${hostname}:2567`; // vite dev
  return `${wsProto}://${hostname}:${port || (protocol === "https:" ? "443" : "80")}`;
}

export async function joinRoom(seat: string, options: Record<string, unknown> = {}): Promise<Room> {
  const client = new Client(serverWsUrl());
  return client.joinOrCreate("trainer", { seat, scenario: "reach", ...options });
}

export const sendDecision = (room: Room, d: { decisionId: string; choice: string; rationale: string; confidence: number }) =>
  room.send("decision", d);
export const sendChat = (room: Room, to: string, text: string) => room.send("chat", { to, text });
export const sendVerify = (room: Room, to: string, text: string) => room.send("verify_request", { to, text });
export const sendLinkPatch = (room: Room, link: string, patch: Record<string, number | boolean>) =>
  room.send("link_patch", { link, patch });
export const sendInjectNow = (room: Room, index: number) => room.send("inject_now", { index });
export const sendFreeze = (room: Room, freeze: boolean) => room.send("freeze_set", { freeze });
export const sendProbeAnswer = (room: Room, freezeId: string, answers: { queryId: string; answer: string }[]) =>
  room.send("probe_answer", { freezeId, answers });
export const sendSart = (room: Room, s: { demand: number; supply: number; understanding: number }) =>
  room.send("sart", s);
