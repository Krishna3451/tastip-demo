export const E2E_PORT = Number(process.env.TASTIP_E2E_PORT ?? "3101");
if (!Number.isInteger(E2E_PORT) || E2E_PORT < 1 || E2E_PORT > 65535)
  throw new Error("TASTIP_E2E_PORT must be a valid local port.");
export const E2E_ORIGIN = `http://127.0.0.1:${E2E_PORT}`;
