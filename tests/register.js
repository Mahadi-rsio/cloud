import { register } from "node:module";
import { pathToFileURL } from "node:url";

register(
  "data:text/javascript," +
    encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    const subpath = specifier.slice(2);
    let resolvedSubpath = subpath;
    if (!subpath.endsWith(".ts") && !subpath.endsWith(".js") && !subpath.endsWith(".json")) {
      resolvedSubpath = subpath + ".ts";
    }
    const url = new URL("./" + resolvedSubpath, "file://" + process.cwd() + "/");
    try {
      return await next(url.href, context);
    } catch {
      // Try directory index.ts
      const indexUrl = new URL("./" + subpath + "/index.ts", "file://" + process.cwd() + "/");
      return next(indexUrl.href, context);
    }
  }

  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    if (!specifier.endsWith(".ts") && !specifier.endsWith(".js") && !specifier.endsWith(".json") && !specifier.endsWith(".mjs")) {
      try {
        return await next(specifier + ".ts", context);
      } catch {
        try {
          return await next(specifier + "/index.ts", context);
        } catch {
          // fall through
        }
      }
    }
  }

  return next(specifier, context);
}
`),
  pathToFileURL("./"),
);
