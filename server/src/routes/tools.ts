/**
 * Small authenticated helpers used by the profile setup + editing UI:
 *   - extract-text: pull text out of an uploaded pdf/docx/txt resource file
 *   - resolve-channel: turn a competitor URL into {name, url, channel_id}
 *
 * Both are cheap and auth-guarded; neither writes anything, so they are not
 * metered against the expensive-action quotas.
 */
import { Router } from "express";
import { z } from "zod";
import { BadRequestError } from "../errors.js";
import { extractText } from "../services/extractText.js";
import { getScriptRunner } from "../services/scripts.js";

export const toolsRouter = Router();

toolsRouter.post("/extract-text", async (req, res, next) => {
  try {
    const schema = z.object({
      filename: z.string().min(1),
      media_type: z.string().default(""),
      data: z.string().min(1), // base64
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError("filename and base64 data are required");
    const buffer = Buffer.from(parsed.data.data, "base64");
    const text = await extractText(parsed.data.filename, parsed.data.media_type, buffer);
    res.json({ text });
  } catch (err) {
    next(err);
  }
});

toolsRouter.post("/resolve-channel", async (req, res, next) => {
  try {
    const schema = z.object({ url: z.string().min(3) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError("A channel URL or @handle is required");
    const data = await getScriptRunner().fetchChannelData(parsed.data.url);
    res.json({ name: data.channel_title, url: parsed.data.url, channel_id: data.channel_id });
  } catch (err) {
    next(err);
  }
});
