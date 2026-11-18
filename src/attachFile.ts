// A drawing from a file on the designer's computer (M30, SC-164). Over MCP the designer's pictures stay in the
// client's chat, which the editor never sees; this server runs on the designer's computer, so it reads the file and
// hands it to the editor, which keeps it as an attached picture ("Image N") for zoom_image and set_survey_map.
// Node only: server.ts offers the tool; the built-in agent has the chat's paperclip.

import { readFile, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, resolve } from "node:path";
import { homedir } from "node:os";

const TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/** A picture file read as a data URI, with checks that say what to do when it can't be used */
export async function readImageFile(path: string): Promise<{ dataUri: string; name: string; bytes: number }> {
  if (typeof path !== "string" || !path.trim()) throw new Error("Give the file's full path, e.g. C:/Users/…/plan.png");
  let p = path.trim().replace(/^["']|["']$/g, "");
  if (p === "~" || p.startsWith("~/") || p.startsWith("~\\")) p = resolve(homedir(), p.slice(2));
  if (!isAbsolute(p)) {
    throw new Error(`"${path}" is not a full path: ask the designer for the whole path to the file (e.g. C:/Users/…/plan.png)`);
  }
  const type = TYPES[extname(p).toLowerCase()];
  if (!type) throw new Error(`${basename(p)}: a PNG, JPEG or WebP picture only — a PDF: export the page as an image first`);
  let size: number;
  try {
    const info = await stat(p);
    if (!info.isFile()) throw new Error(`${p} is a folder, not a file`);
    size = info.size;
  } catch (e) {
    if (e instanceof Error && e.message.endsWith("not a file")) throw e;
    throw new Error(`No file at ${p}: check the path with the designer`);
  }
  if (size > MAX_IMAGE_BYTES) {
    throw new Error(`${basename(p)} is ${(size / 1048576).toFixed(1)} MB: at most ${MAX_IMAGE_BYTES / 1048576} MB — ask for a smaller export`);
  }
  const data = await readFile(p);
  return { dataUri: `data:${type};base64,${data.toString("base64")}`, name: basename(p), bytes: size };
}

export const ATTACH_IMAGE_TOOL = {
  name: "attach_image",
  description:
    "Hand the editor a picture from a file on the designer's computer — a survey map, a site plan, a dimensioned drawing. " +
    "Pictures the designer pastes into this chat never reach the editor, so the map tools can't use them: ask where the file is " +
    "and attach it by its full path. The editor keeps it at full size as the next attached image; the reply shows its copy " +
    "(view \"N\"): point at that copy's pixels with zoom_image (a close-up) and set_survey_map (lay it under the garden by matched points). " +
    "PNG, JPEG or WebP, up to 20 MB; a PDF: a page exported as an image first.",
  inputSchema: {
    type: "object" as const,
    properties: {
      path: { type: "string", description: "The file's full path on the designer's computer, e.g. C:/Users/Ania/Documents/plan.png" },
      label: { type: "string", description: "What the picture is, e.g. 'site plan from the developer'" },
    },
    required: ["path"],
  },
};
