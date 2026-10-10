// Next's compile-time boundary remains intact in web builds. The standalone
// backend/worker has no browser bundle and can import the same server modules.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return { url: "data:text/javascript,export%20%7B%7D", shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
