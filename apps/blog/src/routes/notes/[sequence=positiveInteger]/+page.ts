import type { PageLoad } from "./$types";
import { localeFromPath, localizedPath } from "$lib/locales";
import { error } from "@sveltejs/kit";
import { publicRepository } from "$lib/public-api";
import { renderMarkdown } from "$lib/markdown";

export const load: PageLoad = async ({ params, url, parent }) => {
  const { locale } = await parent();
  const sequence = Number(params.sequence);
  if (!Number.isSafeInteger(sequence) || sequence < 1) error(404, "手记不存在");
  const note = await publicRepository(locale).noteBySequence(sequence);
  if (!note) error(404, "手记不存在");
  return { note, html: await renderMarkdown(note.markdown) };
};
