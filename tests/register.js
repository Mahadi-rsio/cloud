import { register } from "node:module";
import { pathToFileURL } from "node:url";

register(
  "data:text/javascript," +
    encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    const subpath = specifier.slice(2);
    const ext = subpath.endsWith(".ts") || subpath.endsWith(".js") ? "" : ".ts";
    const url = new URL("./" + subpath + ext, "file://" + process.cwd() + "/");
    return next(url.href, context);
  }
  return next(specifier, context);
}
`),
  pathToFileURL("./"),
);
