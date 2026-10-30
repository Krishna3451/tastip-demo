import { expect, test } from "bun:test";
import { readChatReply } from "./chat-reply";

function streamed(parts: string[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const part of parts) controller.enqueue(encoder.encode(part));
        controller.close();
      },
    }),
    { headers: { "Content-Type": "application/x-ndjson" } },
  );
}
test("incremental chat keeps partial text transient and requires a complete validated reply", async () => {
  const reply = { message: "A café by the river", provider: "openai" as const };
  const text: string[] = [];
  const wire = `${JSON.stringify({ type: "text", text: "A café" })}\n${JSON.stringify({ type: "text", text: reply.message })}\n${JSON.stringify({ type: "complete", reply })}\n`;
  expect(
    await readChatReply(streamed([wire.slice(0, 13), wire.slice(13, 39), wire.slice(39)]), (part) =>
      text.push(part),
    ),
  ).toEqual(reply);
  expect(text).toEqual(["A café", reply.message]);
  expect(
    await readChatReply(Response.json({ message: "Local change", provider: "local" }), () => {}),
  ).toEqual({ message: "Local change", provider: "local" });
});
test("interrupted, malformed and invalid proposal streams cannot become completed history", async () => {
  for (const wire of [
    '{"type":"text","text":"Draft only"}\n',
    '{"type":"text","text":"A"}\n{"type":"text","text":"B"}\n',
    '{"type":"complete","reply":{"message":"Done","provider":"openai","proposal":{"operations":[]}}}\n',
    '{"type":"complete","reply":{"message":"Done","provider":"openai"}}\n{"type":"text","text":"Extra"}\n',
    '{"type":"text","text":"unterminated',
    '{"type":"error","message":"Connection lost"}\n',
  ])
    await expect(readChatReply(streamed([wire]), () => {})).rejects.toThrow();
});

test("partial text arrives while the transport stays open and never supplies a proposal early", async () => {
  let transport!: ReadableStreamDefaultController<Uint8Array>;
  const received: string[] = [];
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        transport = controller;
      },
    }),
    { headers: { "Content-Type": "application/x-ndjson" } },
  );
  let finished = false;
  const result = readChatReply(response, (text) => received.push(text)).then((reply) => {
    finished = true;
    return reply;
  });
  const encoder = new TextEncoder();
  transport.enqueue(encoder.encode('{"type":"text","text":"A quiet morning"}\n'));
  for (let i = 0; i < 5; i++) await Promise.resolve();
  expect(received).toEqual(["A quiet morning"]);
  expect(finished).toBe(false);
  transport.enqueue(
    encoder.encode(
      '{"type":"complete","reply":{"message":"A quiet morning in Lisbon.","provider":"openai"}}\n',
    ),
  );
  transport.close();
  expect(await result).toEqual({ message: "A quiet morning in Lisbon.", provider: "openai" });
});
