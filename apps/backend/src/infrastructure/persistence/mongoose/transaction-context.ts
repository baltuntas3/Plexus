import { AsyncLocalStorage } from "node:async_hooks";
import type { ClientSession } from "mongoose";

// Ambient session propagation. The alternative — threading a ClientSession
// through every repository method — leaks a Mongoose primitive into every
// domain port. AsyncLocalStorage keeps the session available to the
// Mongoose adapters inside a UoW boundary without any change to the
// repository interfaces seen by application code.
const storage = new AsyncLocalStorage<ClientSession>();

export const getCurrentSession = (): ClientSession | undefined => storage.getStore();

export const runWithSession = <T>(
  session: ClientSession,
  fn: () => Promise<T>,
): Promise<T> => storage.run(session, fn);
